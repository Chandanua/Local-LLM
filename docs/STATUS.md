# STATUS - Local-LLM

## Current step
- P0.1 done - waiting for owner.

## Done
- 2026-11-17: branches main + testing-building; .gitignore added; node_modules and eng.traineddata untracked (commit fc6e33c).
- 2026-11-19 S1: CLAUDE.md, sonnet subagents, STATUS file; worker smoke test ok (commit dc4dee0).
- 2026-11-19 S2: Ollama upgraded 0.15.4 -> 0.40.16 (old container kept as ollama-local-old); pulled qwen3.5:4b + embeddinggemma;
  speed, GPU-fit and coding tests saved in backend/eval/results/2026-11-19-model-measure.md (commit 5929aab).
- 2026-11-19: old Ollama containers and Feb image removed (~11 GB freed).
- 2026-11-19 P0.1: configurable Ollama host, chat/embed model, data dir, num_ctx; think:false + options on /chat; embedder on CPU. Verified: reply "ready", qwen3.5:4b 100% GPU, context 32768.

## Next
- Owner: decide whether local-coder switches to qwen3.5:4b, then P1 (full config module, API lockdown).

## Open / blockers
- Owner: rotate the OmniRoute API key (it was shown in a chat on 2026-11-19).
- DISPROVEN: ports exposed to the LAN. ollama-local and omniroute publish only on 127.0.0.1.
- UNPROVEN: qwen3.5:4b speed varied 33 vs 51 tok/s between two rounds at the same settings. Re-test under controlled conditions.
- Free RAM was often under 2 GB during tests (WSL/Docker VM ~7 GB). Consider a WSL memory limit (owner decision).
- qwen3.5:4b vs qwen2.5-coder:7b coding quality: tie on a 15-answer sample - unproven.
- qwen3.5:4b answered T5 with over-long output twice (hit 800-token cap): worker prompts must ask for short code-only answers.
## Worker log
| date | task | worker | result |
|------|------|--------|--------|
| 2026-11-19 | S1 smoke test | local-coder | ok, ~13 s (first call, model load; 22%/78% CPU/GPU) |
| 2026-11-19 | S1 smoke test | free-auto | ok, ~4 s |
| 2026-11-19 | S2 scripts | none | written by Claude manager session directly (no pal from that session) |
| 2026-11-19 | P0.1 .env.example draft | local-coder | ok, used as-is after check |
