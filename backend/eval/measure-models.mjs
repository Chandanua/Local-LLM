// Speed and GPU-fit measurement for local Ollama models (book section 5.2.4).
// Usage: node backend/eval/measure-models.mjs --model qwen3.5:4b --ctx 4096,16384 --runs 4 --nothink --embedcheck --out results.csv
// No dependencies. Needs Ollama at OLLAMA_HOST (default http://127.0.0.1:11434) and the
// "ollama-local" Docker container for `ollama ps` (override with OLLAMA_CONTAINER).
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const CONTAINER = process.env.OLLAMA_CONTAINER || 'ollama-local';
const PROMPT = 'Explain in about 150 words how HTTP caching works.';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const model = arg('model');
const contexts = String(arg('ctx', '4096')).split(',').map((s) => Number.parseInt(s, 10));
const runs = Number.parseInt(arg('runs', '4'), 10);
const noThink = arg('nothink', false) === true;
const embedCheck = arg('embedcheck', false) === true;
const out = arg('out', 'measure.csv');
if (!model) throw new Error('--model is required');

function ollamaPs() {
  return execSync(`docker exec ${CONTAINER} ollama ps`, { encoding: 'utf8' });
}

function processorFor(psText, name) {
  const names = name.includes(':') ? [name] : [name, `${name}:latest`];
  const line = psText.split('\n').find((l) => names.some((n) => l.startsWith(n + ' ') || l.startsWith(n + '\t')));
  if (!line) return 'not loaded';
  const m = line.match(/(\d+%\/\d+% CPU\/GPU|\d+% GPU|\d+% CPU)/);
  return m ? m[1] : 'unknown';
}

async function post(path, body, timeoutMs) {
  const res = await fetch(`${HOST}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function generate(numCtx) {
  const body = {
    model,
    prompt: PROMPT,
    stream: false,
    options: { num_ctx: numCtx, num_predict: 200, temperature: 0, seed: 1 },
  };
  if (noThink) body.think = false;
  return post('/api/generate', body, 300_000);
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (a) => (a.length ? `${median(a).toFixed(1)} (${Math.min(...a).toFixed(1)}-${Math.max(...a).toFixed(1)})` : 'n/a');

if (!existsSync(out)) {
  writeFileSync(out, 'time,model,num_ctx,run,cold,eval_count,tok_s,ttft_ms,load_ms,processor,embed_processor\n');
}

for (const numCtx of contexts) {
  const tok = [];
  const ttft = [];
  let proc = '';
  let embProc = '';
  for (let run = 1; run <= runs; run++) {
    try {
      const r = await generate(numCtx);
      const tokS = r.eval_count / (r.eval_duration / 1e9);
      const ttftMs = (r.load_duration + r.prompt_eval_duration) / 1e6;
      const loadMs = r.load_duration / 1e6;
      let ps = ollamaPs();
      proc = processorFor(ps, model);
      embProc = '';
      if (embedCheck && run === runs) {
        await post('/api/embed', { model: 'embeddinggemma', input: ['test'], options: { num_gpu: 0 } }, 120_000);
        ps = ollamaPs();
        proc = processorFor(ps, model);
        embProc = processorFor(ps, 'embeddinggemma');
      }
      if (run > 1) { tok.push(tokS); ttft.push(ttftMs); }
      appendFileSync(out, [new Date().toISOString(), model, numCtx, run, run === 1, r.eval_count,
        tokS.toFixed(2), ttftMs.toFixed(0), loadMs.toFixed(0), proc, embProc].join(',') + '\n');
    } catch (e) {
      const msg = String(e.message).replace(/[,\n]/g, ' ').slice(0, 120);
      appendFileSync(out, [new Date().toISOString(), model, numCtx, run, run === 1, '', '', '', '', `ERROR ${msg}`, ''].join(',') + '\n');
      console.log(`ctx ${numCtx} run ${run}: ERROR ${msg}`);
    }
  }
  console.log(`${model} ctx=${numCtx} | processor=${proc}${embProc ? ` | embedder=${embProc}` : ''} | tok/s ${fmt(tok)} | first-token ms ${fmt(ttft)}`);
}
