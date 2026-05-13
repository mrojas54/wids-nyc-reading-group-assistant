import { ModelLoadError } from "./types";

// IMPORTANT: This SHA-256 must equal the hash of the file at SPECTER2_MODEL_BLOB_URL.
// If the operator re-quantizes (e.g., HF Hub republishes the proximity adapter,
// or the script's quantization mode changes), update this value in the same commit
// that pushes the new model to Vercel Blob.
//
// Current value: hash of specter2_int8.onnx produced by scripts/export_specter2_onnx.py
// against allenai/specter2_base + allenai/specter2 (proximity adapter), INT8-quantized
// via onnxruntime quantize_dynamic, on 2026-05-10. Verified parity: median cos=0.9927,
// min cos=0.9476 against 11 S2-canonical fixture papers (passes the 0.99/0.93 thresholds).
const EXPECTED_MODEL_SHA256 = "1db3c70bc2f4d5debfc256059d1e73261567411410f1930515d70e43283e8f6b";

const MAX_BLOB_FETCH_RETRIES = 3;
const RETRY_BACKOFFS_MS = [1000, 2000, 4000];

let modelPromise: Promise<{ session: any; tokenizer: any }> | null = null;
let loadStartedAt: number | null = null;

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fetchBlobWithRetries(url: string): Promise<ArrayBuffer> {
  const { get } = await import("@vercel/blob");
  let lastErr: unknown;
  for (let i = 0; i < MAX_BLOB_FETCH_RETRIES; i++) {
    try {
      const result = await get(url, { access: "private" });
      if (result?.statusCode !== 200 || !result.stream) {
        throw new Error(`blob fetch ${result?.statusCode ?? "no response"}`);
      }
      // Read the stream into an ArrayBuffer for SHA-256 verification + ONNX load
      const res = new Response(result.stream);
      return await res.arrayBuffer();
    } catch (e) {
      lastErr = e;
      if (i < MAX_BLOB_FETCH_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFFS_MS[i]));
      }
    }
  }
  throw new ModelLoadError(`blob fetch failed after ${MAX_BLOB_FETCH_RETRIES} retries: ${lastErr}`);
}

async function initModel() {
  loadStartedAt = Date.now();
  const url = process.env.SPECTER2_MODEL_BLOB_URL;
  if (!url) throw new ModelLoadError("SPECTER2_MODEL_BLOB_URL env var is not set");

  // Run all independent I/O in parallel: blob fetch, onnxruntime-web ESM load,
  // @xenova/transformers ESM load, and (chained off transformers) the tokenizer
  // fetch from huggingface.co. On a cold container the tokenizer fetch alone is
  // ~1–3s and the blob fetch ~3–10s; running them sequentially is wasted time.
  const bufPromise = fetchBlobWithRetries(url);
  const ortPromise = import("onnxruntime-web");
  const tokenizerPromise = (async () => {
    const transformers = await import("@xenova/transformers");
    // Vercel's /var/task/ is read-only; redirect the HF model cache to /tmp.
    transformers.env.cacheDir = "/tmp/transformers-cache";
    return transformers.AutoTokenizer.from_pretrained("allenai/specter2_base");
  })();

  const [buf, ort] = await Promise.all([bufPromise, ortPromise]);
  const actualSha = await sha256Hex(buf);
  if (actualSha !== EXPECTED_MODEL_SHA256) {
    throw new ModelLoadError(`integrity mismatch: expected ${EXPECTED_MODEL_SHA256}, got ${actualSha}`);
  }
  const session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
  const tokenizer = await tokenizerPromise;
  return { session, tokenizer };
}

export function isModelWarm(): boolean {
  return modelPromise !== null;
}

export function modelLoadStartedAt(): number | null {
  return loadStartedAt;
}

async function getModel() {
  if (!modelPromise) {
    modelPromise = initModel();
  }
  return modelPromise;
}

/**
 * Fire-and-forget model warmup. Safe to call repeatedly; subsequent calls
 * are no-ops once load is in flight. Errors are swallowed here because the
 * actual request will re-await via embedBatch -> getModel and surface a
 * proper ModelLoadError there.
 */
export function prewarmModel(): void {
  void getModel().catch(() => {});
}

/**
 * Awaitable model warmup. Returns once the WASM session + tokenizer are
 * fully loaded, or throws ModelLoadError. Used by the GET /api/suggest
 * warmup endpoint so the Lambda container stays alive until the model
 * promise is resolved (preventing freeze-mid-load).
 */
export async function ensureModelLoaded(): Promise<void> {
  await getModel();
}

/**
 * Embed a batch of {title, abstract} pairs via the WASM SPECTER2 model.
 * Chunks at 10 per forward pass to stay inside Lambda memory headroom.
 * Returns Float32Arrays in the same order as inputs.
 */
export async function embedBatch(
  items: Array<{ title: string; abstract: string }>
): Promise<Float32Array[]> {
  const { session, tokenizer } = await getModel();
  const CHUNK = 10;
  const results: Float32Array[] = [];

  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const texts = chunk.map(it => `${it.title}${tokenizer.sep_token}${it.abstract}`);
    const enc = await tokenizer(texts, { padding: "max_length", truncation: true, max_length: 512, return_tensors: "np" });

    // @xenova/transformers tensors have an undefined .location that
    // onnxruntime-web rejects. Build plain ORT tensors from the raw data.
    const { Tensor } = await import("onnxruntime-web");
    const inputIds = new Tensor("int64", enc.input_ids.data, enc.input_ids.dims);
    const attMask = new Tensor("int64", enc.attention_mask.data, enc.attention_mask.dims);
    const outputs = await session.run({ input_ids: inputIds, attention_mask: attMask });
    const lhs = outputs.last_hidden_state.data as Float32Array;  // shape: (B, 512, 768)
    const dim = 768;
    const seq = 512;
    for (let b = 0; b < chunk.length; b++) {
      const offset = b * seq * dim;  // CLS at seq position 0
      results.push(lhs.slice(offset, offset + dim));
    }
  }
  return results;
}
