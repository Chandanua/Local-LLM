# STATUS - Local-LLM

## Current step
- S1 done - waiting for owner to approve S2.

## Done
- 2026-11-17: branches main + testing-building; .gitignore added; node_modules and eng.traineddata untracked (commit fc6e33c).

## Next
- S2: choose and measure the app's chat model on this GPU (book P0, section 5.2.4), then card P0.1 (configurable model, host, context).

## Open / blockers
- Owner: rotate the OmniRoute API key (it was shown in a chat on 2026-11-19).
- Unproven: Docker publishes ports 11434 and 20128 on all network interfaces, so other devices on the Wi-Fi may reach Ollama and OmniRoute. Check in P1.
- The app's chat model and local-coder cannot both sit in 6 GB VRAM at once; Ollama will swap them (slower). Measure in S2.

## Worker log
| date | task | worker | result |
|------|------|--------|--------|
| 2026-11-19 | S1 smoke test | local-coder | ok, ~13 s (first call, model load; 22%/78% CPU/GPU) |
| 2026-11-19 | S1 smoke test | free-auto | ok, ~4 s |
