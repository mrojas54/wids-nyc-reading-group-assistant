# Glossary — wids-nyc-reading-group-assistant

## Acronyms / models
| Term | Meaning | Context |
|------|---------|---------|
| SPECTER2 | Allen AI scientific paper embedding model (v2) | Used in suggest fallback; INT8 ONNX in Vercel Blob |
| ONNX | Open Neural Network Exchange | Cross-runtime model format; we export PyTorch → ONNX → INT8 |
| WASM | WebAssembly | Runtime for ONNX in Vercel Function; `onnxruntime-web` |
| S2 | Semantic Scholar (API) | Preferred embedding source; rate-limited |
| MMR | Maximal Marginal Relevance | Re-ranking after embedding similarity; `RankedResult.mmr_score` |
| pgvector | Postgres vector ext | Embedding cache table `paper_embeddings` |

## Internal terms
| Term | Meaning |
|------|---------|
| suggest | Admin "Find a paper" endpoint at `/admin/suggest` |
| the fallback | The WASM/ONNX local inference path (tier 3 of suggest) |
| parity | Cosine sim between S2-canonical and local-ONNX embeddings on fixture papers |
| Paper Pal | Companion page generator (supersedes leader-nudge) |
| companion page | Static Mermaid + Colab walkthrough per paper |

## Project codenames
| Codename | Project |
|----------|---------|
| SPECTER2 fallback | The merged WASM/ONNX local embedding work (see projects/specter2.md) |
