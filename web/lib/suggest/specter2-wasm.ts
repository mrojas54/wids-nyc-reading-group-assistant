import { ModelLoadError } from "./types";

// IMPORTANT: This SHA-256 must equal the hash of the file at SPECTER2_MODEL_BLOB_URL.
// See spec section "SHA-256 integrity pin" — value comes from Task 1.2 output.
// REPLACE THIS LITERAL with the hex string the export script printed.
const EXPECTED_MODEL_SHA256 = "REPLACE_WITH_SHA_FROM_TASK_1_2";

const MAX_BLOB_FETCH_RETRIES = 3;
const RETRY_BACKOFFS_MS = [1000, 2000, 4000];

let modelPromise: Promise<{ session: any; tokenizer: any }> | null = null;
let loadStartedAt: number | null = null;

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fetchBlobWithRetries(url: string): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let i = 0; i < MAX_BLOB_FETCH_RETRIES; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`blob fetch ${res.status}`);
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

  const buf = await fetchBlobWithRetries(url);
  const actualSha = await sha256Hex(buf);
  if (actualSha !== EXPECTED_MODEL_SHA256) {
    throw new ModelLoadError(`integrity mismatch: expected ${EXPECTED_MODEL_SHA256}, got ${actualSha}`);
  }

  // Lazy-import onnxruntime + tokenizer at first use to avoid penalizing cold paths
  // that never need WASM (the all-cache-hit case).
  const ort = await import("onnxruntime-web");
  const { AutoTokenizer } = await import("@xenova/transformers");
  const session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
  const tokenizer = await AutoTokenizer.from_pretrained("allenai/specter2_base");
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

    const outputs = await session.run({
      input_ids: enc.input_ids,
      attention_mask: enc.attention_mask,
    });
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
