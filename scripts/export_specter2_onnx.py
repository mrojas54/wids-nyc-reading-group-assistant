#!/usr/bin/env python3
"""
One-time export: fuse specter2_base + specter2 (proximity adapter) into a
single ONNX graph, INT8-quantize, verify cosine >= 0.997 against S2's
canonical vectors for fixture papers, print the SHA-256 of the output.

Run — pick the right command for your platform:

  Apple Silicon Mac, Linux x86_64, Linux aarch64, Windows:

    uv run --no-project --python 3.11 \\
           --with 'optimum[onnxruntime]' \\
           --with adapters \\
           --with 'torch>=2.6' \\
           --with transformers \\
           --with numpy --with onnxruntime --with onnx \\
           python scripts/export_specter2_onnx.py

  Intel Mac (macOS x86_64) — torch dropped Intel wheels at 2.3, so the
  CVE-2025-32434 path doesn't apply (we have to stay on older torch),
  and we pin transformers<4.51 to skip the check it added in 4.51:

    uv run --no-project --python 3.11 \\
           --with 'optimum[onnxruntime]' \\
           --with adapters \\
           --with 'torch<2.6' \\
           --with 'transformers<4.51' \\
           --with numpy --with onnxruntime --with onnx \\
           python scripts/export_specter2_onnx.py

Why the pins:
  - Python 3.11: HuggingFace optimum + adapters + torch wheels are most
    consistent here. Newer Python (3.13) causes uv's resolver to silently
    fall back to an unrelated 2018 namesake package 'optimum 0.1.0'.
  - torch>=2.6 OR transformers<4.51: transformers 4.51+ requires
    torch >= 2.6 to load .bin state dicts safely (CVE-2025-32434 patch).
    Pick the strategy that matches your platform's available wheels.
  - On zsh, the brackets in optimum[onnxruntime] need single-quoting
    because zsh treats [...] as a glob pattern.

Prerequisite: scripts/specter2_parity_fixtures.json must exist. Generate
it via scripts/collect_specter2_fixtures.py (also one-shot, also
operator-run). See the plan
(docs/superpowers/plans/2026-05-09-vercel-suggest-wasm-specter2-implementation.md)
Task 1.1 for the full setup sequence.
"""
import hashlib
import sys
from pathlib import Path

# Invoked as `python scripts/<this>.py` (see the docstring), which puts scripts/
# on sys.path but not the repo root; the shared cosine lives in the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import torch
from adapters import AutoAdapterModel
from transformers import AutoTokenizer

from scripts.specter2_parity import INT8_PARITY, FixtureError, load_fixtures, parity_verdict, sep_text
from scripts.vecmath import cosine

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = REPO_ROOT / "scripts" / "specter2_parity_fixtures.json"
OUTPUT_DIR = REPO_ROOT / "scripts" / "_specter2_export"

# Thresholds and the reasoning behind them live in scripts/specter2_parity.py
# (INT8_PARITY), shared with the verifier and unit-tested; these aliases keep
# the names this script's log lines and docs use.
PARITY_MEDIAN_THRESHOLD = INT8_PARITY.median
PARITY_MIN_THRESHOLD = INT8_PARITY.minimum


def fuse_model() -> tuple[AutoAdapterModel, AutoTokenizer]:
    """Load specter2_base, attach the proximity adapter, set it active."""
    print("Loading specter2_base...")
    model = AutoAdapterModel.from_pretrained("allenai/specter2_base")
    print("Loading proximity adapter...")
    adapter_name = model.load_adapter("allenai/specter2", source="hf", set_active=True)
    print(f"Adapter loaded: {adapter_name}, active=True")
    tokenizer = AutoTokenizer.from_pretrained("allenai/specter2_base")
    model.eval()
    return model, tokenizer


def embed_with_pytorch(model, tokenizer, title: str, abstract: str) -> np.ndarray:
    """Reference embedding via PyTorch — ground truth for parity check."""
    text = sep_text(title, tokenizer.sep_token, abstract)
    inputs = tokenizer(text, padding=True, truncation=True, return_tensors="pt", max_length=512)
    with torch.no_grad():
        outputs = model(**inputs)
    # SPECTER2 uses CLS pooling
    cls = outputs.last_hidden_state[:, 0, :]
    return cls.squeeze(0).numpy().astype(np.float32)


def export_to_onnx(model, tokenizer, output_path: Path) -> None:
    """Trace the fused model to ONNX with adapter weights merged into the graph."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dummy_text = "Test paper title.[SEP]Test abstract content for ONNX tracing."
    inputs = tokenizer(dummy_text, return_tensors="pt", padding="max_length", max_length=512, truncation=True)
    print(f"Exporting to {output_path}...")
    torch.onnx.export(
        model,
        (inputs["input_ids"], inputs["attention_mask"]),
        str(output_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "last_hidden_state": {0: "batch", 1: "seq"},
        },
        opset_version=14,
        do_constant_folding=True,
    )
    print(f"Exported FP32 ONNX: {output_path.stat().st_size / 1e6:.1f} MB")


def quantize_int8(fp32_path: Path, int8_path: Path) -> None:
    from onnxruntime.quantization import quantize_dynamic, QuantType
    print(f"INT8-quantizing {fp32_path} -> {int8_path}...")
    quantize_dynamic(
        model_input=str(fp32_path),
        model_output=str(int8_path),
        weight_type=QuantType.QInt8,
    )
    print(f"INT8 ONNX: {int8_path.stat().st_size / 1e6:.1f} MB")


def verify_parity(int8_path: Path, fixtures: list) -> tuple[bool, list[float]]:
    """Compare INT8 ONNX outputs against S2's canonical vectors.

    Returns (passed, sims) where passed reflects BOTH INT8_PARITY thresholds:
      - median(sims) >= median threshold (typical fidelity)
      - min(sims) >= minimum threshold (no catastrophic outlier)
    """
    import onnxruntime as ort
    from transformers import AutoTokenizer
    sess = ort.InferenceSession(str(int8_path), providers=["CPUExecutionProvider"])
    tok = AutoTokenizer.from_pretrained("allenai/specter2_base")
    sims = []
    for fix in fixtures:
        text = sep_text(fix.title, tok.sep_token, fix.abstract)
        enc = tok(text, padding="max_length", truncation=True, max_length=512, return_tensors="np")
        out = sess.run(None, {"input_ids": enc["input_ids"], "attention_mask": enc["attention_mask"]})
        local_vec = out[0][0, 0, :].astype(np.float32)  # CLS token
        sims.append(cosine(local_vec, fix.vector))
    passed, stats = parity_verdict(sims, INT8_PARITY)
    print(f"Parity over {stats.count} fixtures: avg={stats.mean:.4f}, median={stats.median:.4f}, min={stats.minimum:.4f}")
    print(f"  (median threshold={PARITY_MEDIAN_THRESHOLD}, min threshold={PARITY_MIN_THRESHOLD})")
    return passed, sims


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    try:
        fixtures = load_fixtures(FIXTURES)
    except FixtureError as exc:
        print(f"ERROR: {exc}; run the fixtures-collection command from "
              f"the plan's Task 1.1 Step 1 first.", file=sys.stderr)
        return 1
    model, tokenizer = fuse_model()
    fp32 = OUTPUT_DIR / "specter2_fp32.onnx"
    int8 = OUTPUT_DIR / "specter2_int8.onnx"
    export_to_onnx(model, tokenizer, fp32)
    quantize_int8(fp32, int8)
    ok, sims = verify_parity(int8, fixtures)
    if not ok:
        print(f"FAIL: parity thresholds not met (median>={PARITY_MEDIAN_THRESHOLD}, "
              f"min>={PARITY_MIN_THRESHOLD}). Per-fixture sims: {sims}", file=sys.stderr)
        return 2
    digest = sha256_of(int8)
    print("=" * 60)
    print("PASS")
    print(f"Output: {int8}")
    print(f"Size:   {int8.stat().st_size / 1e6:.1f} MB")
    print(f"SHA256: {digest}")
    print("=" * 60)
    print("Next steps:")
    print(f"  1. vercel blob put {int8}")
    print("  2. Set env var SPECTER2_MODEL_BLOB_URL=<the URL Vercel returns>")
    print(f"  3. Pin EXPECTED_MODEL_SHA256 = '{digest}' in web/lib/suggest/specter2-wasm.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
