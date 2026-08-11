#!/usr/bin/env python3
"""Compute SPECTER2 FP32 embeddings locally — bit-identical to S2's served vectors.

This CLI is the fixture-harvester's local-embed worker. It reuses the exact
model-loading + tokenization recipe validated in
scripts/verify_specter2_local_vs_s2.py (commit 66142fd), so its 768-dim FP32
output is interchangeable with vectors stored under fix["vector"] in
scripts/specter2_parity_fixtures.json.

Recipe (do not drift from this without re-running the verifier):
  - allenai/specter2_base + allenai/specter2 proximity adapter (set_active=True)
  - tokenizer: padding="max_length", truncation=True, max_length=512
  - input format: f"{title}{tok.sep_token}{abstract}"
  - pooling: CLS token, i.e. last_hidden_state[0, 0, :].float()
  - model.train(False) inference mode

Usage:

  Single paper (args):
    embed_specter2_fp32.py --title "..." --abstract "..."
    -> {"vector": [768 floats]}

  Batch (JSONL stdin, one record per line):
    cat papers.jsonl | embed_specter2_fp32.py --stdin-json
    Each input line:  {"paperId": "...", "title": "...", "abstract": "..."}
    Each output line: {"paperId": "...", "vector": [...]}
    paperId is optional; if absent it's omitted from output. Extra fields
    pass through unchanged so callers can carry their own metadata.

  Timing & summary:
    --report-timing emits per-paper inference ms to stderr; the final stderr
    line is "summary: N papers, mean Xms, median Yms" — designed to be parsed
    by the orchestrator for wall-time estimation.

Run -- pick the right command for your platform (same as the verifier):

  Apple Silicon Mac, Linux x86_64, Linux aarch64, Windows:
    uv run --no-project --python 3.11 \\
           --with adapters \\
           --with 'torch>=2.6' \\
           --with transformers \\
           --with numpy \\
           python scripts/embed_specter2_fp32.py --title "..." --abstract "..."

  Intel Mac (macOS x86_64) OR Apple Silicon reusing a torch<2.6 cache:
    uv run --no-project --python 3.11 \\
           --with adapters \\
           --with 'torch<2.6' \\
           --with 'transformers<4.51' \\
           --with 'numpy<2' \\
           python scripts/embed_specter2_fp32.py --title "..." --abstract "..."

Exits 0 on success, 1 on input/argument error, 2 on per-record failure in
batch mode (errors logged to stderr; valid records still emit on stdout).
"""
import argparse
import json
import sys
import time
from typing import Any

import numpy as np
import torch
from adapters import AutoAdapterModel
from transformers import AutoTokenizer

MODEL_BASE = "allenai/specter2_base"
ADAPTER = "allenai/specter2"
MAX_LENGTH = 512


def load_model() -> tuple[Any, Any]:
    """Load specter2_base + proximity adapter. Mirrors the verifier exactly."""
    print("Loading specter2_base...", file=sys.stderr)
    model = AutoAdapterModel.from_pretrained(MODEL_BASE)
    print("Loading proximity adapter...", file=sys.stderr)
    model.load_adapter(ADAPTER, source="hf", set_active=True)
    model.train(False)
    tok = AutoTokenizer.from_pretrained(MODEL_BASE)
    return model, tok


def embed(model: Any, tok: Any, title: str, abstract: str) -> np.ndarray:
    """Return the 768-dim FP32 CLS vector for one (title, abstract) pair."""
    text = f"{title}{tok.sep_token}{abstract}"
    enc = tok(text, padding="max_length", truncation=True,
              max_length=MAX_LENGTH, return_tensors="pt")
    with torch.no_grad():
        out = model(**enc)
    return out.last_hidden_state[0, 0, :].float().numpy()


def emit_single(model: Any, tok: Any, title: str, abstract: str,
                report_timing: bool) -> None:
    t0 = time.perf_counter()
    vec = embed(model, tok, title, abstract)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    if report_timing:
        print(f"inference: {elapsed_ms:.1f}ms", file=sys.stderr)
        print(f"summary: 1 papers, mean {elapsed_ms:.1f}ms, "
              f"median {elapsed_ms:.1f}ms", file=sys.stderr)
    json.dump({"vector": vec.tolist()}, sys.stdout)
    sys.stdout.write("\n")


def emit_batch(model: Any, tok: Any, report_timing: bool) -> int:
    """Read JSONL from stdin, embed each, write JSONL to stdout.

    Returns 0 if all records succeeded, 2 if any record failed.
    """
    exit_code = 0
    timings: list[float] = []
    for lineno, raw in enumerate(sys.stdin, start=1):
        raw = raw.strip()
        if not raw:
            continue
        try:
            rec = json.loads(raw)
            title = rec["title"]
            abstract = rec["abstract"]
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"line {lineno}: skipped ({e})", file=sys.stderr)
            exit_code = 2
            continue

        try:
            t0 = time.perf_counter()
            vec = embed(model, tok, title, abstract)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
        except Exception as e:
            pid = rec.get("paperId", "<unknown>")
            print(f"line {lineno} ({pid}): embed failed ({e})", file=sys.stderr)
            exit_code = 2
            continue

        timings.append(elapsed_ms)
        if report_timing:
            pid = rec.get("paperId", "")
            tag = f" ({pid})" if pid else ""
            print(f"line {lineno}{tag}: {elapsed_ms:.1f}ms", file=sys.stderr)

        # Preserve passthrough fields; vector overwrites any prior vector key.
        out_rec = dict(rec)
        out_rec["vector"] = vec.tolist()
        json.dump(out_rec, sys.stdout)
        sys.stdout.write("\n")
        sys.stdout.flush()

    if report_timing and timings:
        arr = np.array(timings)
        print(f"summary: {len(timings)} papers, "
              f"mean {arr.mean():.1f}ms, median {np.median(arr):.1f}ms",
              file=sys.stderr)
    return exit_code


def main() -> int:
    p = argparse.ArgumentParser(
        description="Compute SPECTER2 FP32 embeddings locally.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--title", help="Paper title (single-shot mode).")
    p.add_argument("--abstract", help="Paper abstract (single-shot mode).")
    p.add_argument("--stdin-json", action="store_true",
                   help="Batch mode: read JSONL from stdin "
                        "(one {title, abstract, [paperId, ...]} per line).")
    p.add_argument("--report-timing", action="store_true",
                   help="Emit per-paper + summary inference timings to stderr.")
    args = p.parse_args()

    if args.stdin_json:
        if args.title or args.abstract:
            print("ERROR: --stdin-json is mutually exclusive with "
                  "--title/--abstract.", file=sys.stderr)
            return 1
        model, tok = load_model()
        return emit_batch(model, tok, args.report_timing)

    if not (args.title and args.abstract):
        print("ERROR: provide --title AND --abstract, or use --stdin-json.",
              file=sys.stderr)
        return 1

    model, tok = load_model()
    emit_single(model, tok, args.title, args.abstract, args.report_timing)
    return 0


if __name__ == "__main__":
    sys.exit(main())
