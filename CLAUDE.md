# Local-LLM: rules for Claude Code

## What this is
- Local AI assistant app: backend/server.js (Express 4, ESM, ~1,759 lines, ~50 KB) + frontend/ (React 18 + Vite 4). Owner: Chandan.
- Goal: grow it step by step into a private local "JARVIS". The owner pastes ONE task at a time. Do only that task.
- Known today: chat model hardcoded to llama3:8b, no streaming, no tools, API open to any website and LAN device. Tasks refer to audit IDs H1-H9, M1-M36, L1-L37.

## Machine facts (verified 2026-11-19)
- Windows 11, PowerShell 5.1, Node 22.23.2, git 2.56, Claude Code 2.1.327.
- GPU: RTX 4050 Laptop, 6 GB VRAM. Only ONE large model fits at a time. RAM 16 GB, often only ~5 GB free: check before heavy runs. One heavy job at a time.
- Ollama runs in Docker container ollama-local (ollama/ollama v0.40.16 since 2026-11-19, GPU on, port 127.0.0.1:11434, OLLAMA_CONTEXT_LENGTH=8192, flash attention, q8_0 KV cache). Models live in Docker volume ollama-models. Installed: qwen3.5:4b (app chat model candidate, thinks by default - send think:false for speed), qwen2.5-coder:7b (local-coder; does NOT fit fully on GPU), embeddinggemma (run on CPU with options.num_gpu=0).
- Measured (backend/eval/results/2026-11-19-model-measure.md): qwen3.5:4b stays 100% GPU up to num_ctx 32768 with the embedder on CPU; 65536 spills to CPU.
- Run Ollama commands as: docker exec ollama-local ollama <command>
- pal runs in a Linux container: for every pal call set working_directory_absolute_path to /tmp (it rejects Windows paths like E:\...).
- OmniRoute runs in container omniroute at http://localhost:20128.
- Docker Desktop must be running for Ollama, OmniRoute and pal. The owner starts it with: & "$env:USERPROFILE\tools\start-docker-safe.ps1"
- App data folder: D:\LLM storage (chats, profile). Never delete or rewrite it.

## Who does what
- Owner: decides; approves anything destructive, costly or security-related; does logins, keys, admin windows.
- Main session (Opus): only big decisions - architecture, phase gates, root-cause verdicts, security design. Delegates the work.
- sonnet-1-builder (subagent): runs one task end to end - plans steps, gets drafts from free workers, applies and tests edits, commits.
- sonnet-2-verifier (subagent): re-checks claims independently, runs tests and measurements (3+ repeats). Never edits app code.
- Free workers via the pal MCP tools (text only - they cannot see, edit or run anything):
  - local-coder = qwen2.5-coder:7b on our GPU. Private: may see our code and logs. ~8K context: send under ~150 lines.
  - free-auto = OmniRoute free cloud pool. Plain-text general questions only.
  - gemini-worker = Gemini Flash. Plain-text general questions only.
- Delegate first to local-coder: drafts of small functions, tests, boilerplate, scripts; log summaries (chunked); first-pass review of small diffs; commit messages; doc drafts.
- Claude only: architecture, security/network code, secrets, git history, final checks, applying any edit.
- Never apply worker output unchecked. If a worker gets the same job wrong twice, do it yourself and note it.
- Max 3 worker calls per task unless the owner approves more. Skip workers for trivial jobs.

## Safety (hard rules)
- This folder is the owner's only copy. Commit before editing. Never delete files or folders (move them to _archive/). No git reset --hard, git clean, force push or history rewrite.
- Work only on branch testing-building. main moves only after a passing real-world test, by fast-forward or merge, when the owner says so. Tag proven releases. Before deleting any branch: annotated archive tag at its tip, pushed and verified.
- Never print, commit or send to cloud workers: .env files, API keys, tokens, passwords, IPs, SSH details, personal data. ~/.claude.json contains a key: never print it.
- Never change system, Docker, firewall or security settings yourself: write the steps for the owner.
- Ask before anything destructive, costly or hard to undo. Do not run npm install unless the task says so.

## Evidence rules
- Reproduce a problem before fixing it. Measure the baseline before judging a change.
- One variable at a time, at least 3 repeats, report median + range. Write numeric pass/fail gates BEFORE the run.
- Verdicts: proven / disproven / unproven. Fix only proven causes: failing test first, smallest fix, then green, then re-run all gates.
- A failed CI job is not a result until you know why it failed. The real-world test is the final judge.

## Token rules
- Read only the files the task needs; never re-read. Read server.js by line range, not whole.
- Send workers trimmed snippets; ask for short answers.
- No repeated test runs without a change. Short status updates.

## STATUS file
- Update docs/STATUS.md after every finished item. If usage is about to run out: finish the current item cleanly (tests green, committed, STATUS updated) and stop.

## Report format (end of every task)
- What changed (files) / proof (tests, numbers before -> after) / verified vs only reported / unproven or still open / what the owner must do next / worker calls (local, cloud) and rough Claude vs free-model split.
