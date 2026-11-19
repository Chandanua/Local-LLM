# S2 model measurements - 2026-11-19

Run by Claude (manager session) directly on the laptop, with the owner's approval.
Scripts: backend/eval/measure-models.mjs, backend/eval/coding-test.mjs (self-test: reference answers pass 28/28).
Raw data: the CSV files in this folder.

## Test conditions
- Laptop on charger (100%), Windows power plan "Turbo". GPU RTX 4050 6141 MiB; Windows/apps used ~1.2-1.3 GB with no model loaded.
- Free RAM was LOW during most runs: 0.6-2.5 GB (WSL/Docker VM held ~7 GB). Treat CPU-side numbers with care.
- Docker containers running: ollama-local, omniroute, pal (upbeat_leavitt). No other project's containers.
- Network: model downloads only; no network load during measurements.

## Change made before measuring
- Ollama upgraded 0.15.4 -> 0.40.16 (old image was from 2026-02-01; qwen3.5:4b requires >= 0.30.0).
- Old container kept, stopped and renamed `ollama-local-old` (restart policy: no). New `ollama-local` has identical settings:
  GPU, port 127.0.0.1:11434, volume ollama-models, OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_TYPE=q8_0, OLLAMA_CONTEXT_LENGTH=8192, restart unless-stopped.
- Verified: models kept, GPU visible inside, OmniRoute container reaches it (version 0.40.16 returned).
- Pulled qwen3.5:4b (3.3 GB, 4.2B params, Q4_K_M, tools/vision/thinking, thinking ON by default) and embeddinggemma (621 MB).

## Gates (set before the runs)
- Chat model: largest num_ctx at 100% GPU with embeddinggemma loaded on CPU, and decode >= 80% of the 4096 figure. Warm first token < 1000 ms.
- local-coder: pass at a context if 100% GPU.

## qwen3.5:4b speed (think:false, 200 tokens, 1 warm-up + 3 measured runs; median (min-max))
| num_ctx | processor | tok/s round 1 | tok/s round 2 (embedder loaded) | first token ms (r1 / r2) | gate |
|---|---|---|---|---|---|
| 4096 | 100% GPU | 32.5 (32.3-33.2) | 33.1 (32.8-34.1) | 122 / 109 | reference |
| 16384 | 100% GPU | 50.9 (50.8-51.7) | 32.3 (31.7-32.5) | 81 / 96 | PASS |
| 32768 | 100% GPU | 51.6 (44.9-51.7) | 32.7 (32.4-33.1) | 87 / 102 | PASS (largest) |
| 65536 | 23%/77% CPU/GPU | 22.6 (21.6-25.4) | not run | 114 / - | FAIL (spills) |

- Embedder check (round 2): embeddinggemma 100% CPU at every context; qwen3.5:4b stayed 100% GPU.
- GPU memory with both loaded at 32768: 5449 / 6141 MiB (~700 MB headroom).
- UNPROVEN: why round 1 ran at ~51 tok/s at 16K/32K but round 2 at ~33. Ranges inside each round are tight, so it is a condition change
  between rounds (suspects: GPU clock state, low free RAM, the loaded embedder). Needs a controlled re-test.
- First token is ~0.1 s in all cases: PASS (< 1000 ms).

## qwen2.5-coder:7b speed (local-coder; 1 warm-up + 3 runs)
| Ollama | num_ctx | processor | tok/s | first token ms | gate |
|---|---|---|---|---|---|
| 0.15.4 | 4096 | 22%/78% CPU/GPU | 17.8 (17.7-17.9) | 182 | FAIL |
| 0.15.4 | 8192 | 22%/78% CPU/GPU | 20.7 (17.5-21.6) | 151 | FAIL |
| 0.40.16 | 4096 | 16%/84% CPU/GPU | 23.0 (22.8-23.0) | 51 | FAIL |
| 0.40.16 | 8192 | 19%/81% CPU/GPU | 21.7 (21.7-22.9) | 56 | FAIL |
- DISPROVEN: "a 4K context makes local-coder fit the GPU". The 4.7 GB weights alone do not fit next to Windows' ~1.2 GB.

## Coding test (5 small JS tasks x 3 runs, temperature 0.3, num_ctx 4096, answers run against fixed tests)
| model (Ollama) | full passes | test cases | median answer time | notes |
|---|---|---|---|---|
| qwen2.5-coder:7b (0.15.4) | 6/15 | 63/84 | 5.1 s | T5 0/12 |
| qwen2.5-coder:7b (0.40.16) | 6/15 | 71/84 | 3.4 s | T3 15/18, T4 12/15, T5 5/12 |
| qwen3.5:4b think:false (0.40.16) | 9/15 | 68/84 | 4.6 s | T3 18/18, T5 1/12 (2 answers cut off at the 800-token cap) |

Per task (cases passed out of 3 runs):
- T1 slugify: coder 18/18, qwen3.5 18/18
- T2 chat-id check: coder 21/21, qwen3.5 20/21
- T3 safe cookie parser: coder 15/18, qwen3.5 18/18
- T4 text chunker: coder 12/15, qwen3.5 11/15
- T5 history trimming: coder 5/12, qwen3.5 1/12

## Verdicts
- App chat model qwen3.5:4b fits fully on the GPU up to 32768 context with the embedder on CPU: PROVEN.
- Chosen by the gate: NUM_CTX = 32768. Safety note: only ~700 MB VRAM headroom; if `ollama ps` ever shows a CPU share, drop to 16384.
- Exact decode speed on this GPU: 33-51 tok/s, cause of the spread UNPROVEN.
- Coding quality qwen3.5:4b vs qwen2.5-coder:7b: roughly a TIE on this small sample (qwen3.5 more fully-correct answers 9 vs 6,
  coder slightly more test cases 71 vs 68). Not enough data to call a winner: UNPROVEN.
- Upgrading Ollama made qwen2.5-coder faster (23 vs 18-21 tok/s) and less CPU-bound (84% vs 78% GPU): PROVEN for this setup.
