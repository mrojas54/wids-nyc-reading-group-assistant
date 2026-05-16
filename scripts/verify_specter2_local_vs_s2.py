#!/usr/bin/env python3
"""One-shot: confirm local FP32 SPECTER2 ~= S2's served vectors.

Loads allenai/specter2_base + specter2 adapter (same recipe as
export_specter2_onnx.py), computes a fresh FP32 vector for every fixture
in scripts/specter2_parity_fixtures.json, and cosine-sims it against the
S2-served vector stored under fix["vector"].

Decision criterion for the fixture-harvester design pivot:

    median cos >= 0.999  AND  min cos >= 0.998

PASS  -> local FP32 inference is effectively identical to S2's served
        vector. We can replace S2 with any abstract source + local FP32
        reference.
FAIL  -> S2 is doing something nonstandard (different tokenizer,
        different adapter, post-processing, etc.). Stay on the
        S2-as-ground-truth design; the API key is the only real unblocker.

The thresholds here (0.999 / 0.998) are MUCH tighter than the INT8 parity
test (0.99 / 0.93) because we are comparing FP32-vs-FP32 across what
should be the same inference graph -- any meaningful gap signals a
model-config mismatch, not quantization noise.

Run -- pick the right command for your platform:

  Apple Silicon Mac, Linux x86_64, Linux aarch64, Windows:

    uv run --python 3.11 \\
           --with adapters \\
           --with 'torch>=2.6' \\
           --with transformers \\
           --with numpy \\
           python scripts/verify_specter2_local_vs_s2.py

  Intel Mac (macOS x86_64) OR Apple Silicon reusing a torch<2.3 cache:

    uv run --python 3.11 \\
           --with adapters \\
           --with 'torch<2.6' \\
           --with 'transformers<4.51' \\
           --with 'numpy<2' \\
           python scripts/verify_specter2_local_vs_s2.py

  Why 'numpy<2' on the second command: torch<2.3 was compiled against
  NumPy 1.x ABI. NumPy 2.0 (June 2024) broke that ABI. Without the pin,
  uv picks the latest cached numpy 2.x and torch dies at first .numpy()
  call with "RuntimeError: Numpy is not available". torch>=2.3 has the
  numpy<2.0 pin built into its metadata, so the first command doesn't
  need the explicit numpy bound.

Read-only. Does not modify scripts/specter2_parity_fixtures.json or any
other file. Exits 0 on pass, 1 on fail.
"""
import json
import sys
from pathlib import Path

import numpy as np
import torch
from adapters import AutoAdapterModel
from transformers import AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = REPO_ROOT / "scripts" / "specter2_parity_fixtures.json"

# FP32-vs-FP32 across the same inference graph should be near-identical.
# A real gap signals model-config mismatch (different adapter, tokenizer,
# pooling), not quantization noise -- so the thresholds are an order of
# magnitude tighter than the INT8 parity test.
PIVOT_MEDIAN_THRESHOLD = 0.999
PIVOT_MIN_THRESHOLD = 0.998


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def main() -> int:
    if not FIXTURES.exists():
        print(f"ERROR: {FIXTURES} missing.", file=sys.stderr)
        return 1

    fixtures = json.loads(FIXTURES.read_text())
    print(f"Loaded {len(fixtures)} fixtures from {FIXTURES.name}")

    print("Loading specter2_base...")
    model = AutoAdapterModel.from_pretrained("allenai/specter2_base")
    print("Loading proximity adapter...")
    model.load_adapter("allenai/specter2", source="hf", set_active=True)
    model.train(False)  # inference mode (equivalent to model.eval())
    tok = AutoTokenizer.from_pretrained("allenai/specter2_base")

    # Mirror verify_parity's tokenization exactly (export_specter2_onnx.py).
    # Using padding="max_length"+max_length=512 -- not padding=True -- so
    # any gap we see is NOT a tokenization-strategy artifact.
    sims = []
    print()
    print(f"{'#':>3}  {'paperId':<42}  {'cos':>8}")
    print("-" * 60)
    for i, fix in enumerate(fixtures, start=1):
        text = f"{fix['title']}{tok.sep_token}{fix['abstract']}"
        enc = tok(text, padding="max_length", truncation=True,
                  max_length=512, return_tensors="pt")
        with torch.no_grad():
            out = model(**enc)
        local_vec = out.last_hidden_state[0, 0, :].float().numpy()
        s2_vec = np.array(fix["vector"], dtype=np.float32)
        sim = cosine(local_vec, s2_vec)
        sims.append(sim)
        print(f"{i:>3}  {fix['paperId']:<42}  {sim:>8.6f}")

    median = float(np.median(sims))
    minimum = float(np.min(sims))
    mean = float(np.mean(sims))

    print("-" * 60)
    print(f"mean   = {mean:.6f}")
    print(f"median = {median:.6f}  (threshold {PIVOT_MEDIAN_THRESHOLD})")
    print(f"min    = {minimum:.6f}  (threshold {PIVOT_MIN_THRESHOLD})")
    print()

    passed = median >= PIVOT_MEDIAN_THRESHOLD and minimum >= PIVOT_MIN_THRESHOLD
    if passed:
        print("PASS -- local FP32 ~= S2 served vectors.")
        print("        Fixture-harvester design pivot is safe:")
        print("        harvest abstracts from any source, compute the")
        print("        ground-truth vector locally with this same recipe.")
        return 0

    print("FAIL -- local FP32 differs from S2 served vectors beyond tolerance.")
    print("        Do NOT pivot the harvester design. Either:")
    print("        (a) keep the S2-as-ground-truth fetcher and wait for the")
    print("            SEMANTIC_SCHOLAR_API_KEY, or")
    print("        (b) investigate the gap -- check S2's API docs for any")
    print("            recent changes to the embedding pipeline (different")
    print("            adapter version, different pooling, post-norm, etc.).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
