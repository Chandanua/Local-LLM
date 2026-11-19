// Small coding test for local worker models: 5 JS tasks with automatic checks.
// Usage: node backend/eval/coding-test.mjs --model qwen3.5:4b --runs 3 --nothink --ctx 4096 --out coding.csv
// Each answer is run in a sandbox (node:vm, 2 s timeout) against fixed test cases.
import vm from 'node:vm';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const model = arg('model');
const runs = Number.parseInt(arg('runs', '3'), 10);
const noThink = arg('nothink', false) === true;
const numCtx = Number.parseInt(arg('ctx', '4096'), 10);
const out = arg('out', 'coding.csv');
const selfTest = arg('selftest', false) === true;
if (!model && !selfTest) throw new Error('--model is required');

const TASKS = [
  {
    id: 'T1-slugify', fn: 'slugify',
    prompt: 'Write a JavaScript function slugify(text) that returns a URL slug: convert to lowercase, replace every run of characters that are not a-z or 0-9 (ASCII only) with a single "-", and remove leading and trailing "-". Example: slugify("Hello, World!") === "hello-world".',
    tests: [[['Hello, World!'], 'hello-world'], [['  Multiple   spaces  '], 'multiple-spaces'], [['Already-slug'], 'already-slug'],
      [['--x--'], 'x'], [[''], ''], [['Café 2026'], 'caf-2026']],
  },
  {
    id: 'T2-chatid', fn: 'isValidChatId',
    prompt: 'Write a JavaScript function isValidChatId(id) that returns true only if id is a string in the exact lowercase UUID shape 8-4-4-4-12 hex characters (0-9, a-f) separated by "-", and false for anything else (including non-strings, uppercase letters, extra characters, or paths).',
    tests: [[['3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'], true], [['3F2B8C1E-9A4D-4E6F-8B2A-1C3D5E7F9A0B'], false],
      [['../memory/profile'], false], [[123], false], [[''], false], [['3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b1'], false],
      [['3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0g'], false]],
  },
  {
    id: 'T3-cookies', fn: 'parseCookies',
    prompt: 'Write a JavaScript function parseCookies(header) that parses an HTTP Cookie header string into a plain object. Split on ";", trim each part, skip parts without "=", split each part at the FIRST "=" only into name and value, trim both, and decode the value with decodeURIComponent; if decoding throws, keep the raw value. If header is empty, null or undefined, return {}. It must never throw.',
    tests: [[['a=1; b=hello%20world'], { a: '1', b: 'hello world' }], [['x=%E0'], { x: '%E0' }], [[undefined], {}],
      [['token=abc=def'], { token: 'abc=def' }], [['bad; c=3'], { c: '3' }], [[''], {}]],
  },
  {
    id: 'T4-chunk', fn: 'chunkText',
    prompt: 'Write a JavaScript function chunkText(text, maxLen, overlap) that splits a string into chunks. The first chunk starts at index 0; each next chunk starts (maxLen - overlap) characters after the previous chunk start; every chunk is text.slice(start, start + maxLen); stop after the chunk that reaches the end of the text. Return [] for an empty string. Throw an Error if overlap < 0 or overlap >= maxLen. Example: chunkText("abcdefghij", 4, 1) returns ["abcd", "defg", "ghij"].',
    tests: [[['abcdefghij', 4, 1], ['abcd', 'defg', 'ghij']], [['abc', 5, 2], ['abc']], [['', 3, 1], []],
      [['abcdefg', 3, 0], ['abc', 'def', 'g']], [['abcdef', 3, 3], 'THROWS']],
  },
  {
    id: 'T5-history', fn: 'trimHistory',
    prompt: 'Write a JavaScript function trimHistory(messages, maxTokens). messages is an array of {role, content}. Estimate tokens of a message as Math.ceil(content.length / 4). If the first message has role "system", always keep it and count its tokens. Then, going backwards from the newest message, keep messages while the running total stays <= maxTokens; stop at the first message that does not fit (do not skip over it). Return the kept messages in their original order. Do not modify the input array.',
    tests: [
      [[[{ role: 'system', content: 'abcd' }, { role: 'user', content: 'aaaaaaaa' }, { role: 'assistant', content: 'bbbb' }], 2],
        [{ role: 'system', content: 'abcd' }, { role: 'assistant', content: 'bbbb' }]],
      [[[{ role: 'user', content: 'aaaa' }, { role: 'user', content: 'bbbb' }], 1], [{ role: 'user', content: 'bbbb' }]],
      [[[{ role: 'user', content: 'aaaa' }, { role: 'user', content: 'bbbbbbbbbbbb' }, { role: 'user', content: 'cc' }], 2],
        [{ role: 'user', content: 'cc' }]],
      [[[], 10], []],
    ],
  },
];

const SYSTEM = 'You are a coding assistant. Reply with ONLY one JavaScript code block that defines the requested function. Plain JavaScript, no imports, no TypeScript, no explanations.';

function extractCode(text) {
  const m = text.match(/```(?:javascript|js|mjs)?\s*\n([\s\S]*?)```/i);
  return m ? m[1] : text;
}

function check(code, task) {
  const harness = `${code}
;(() => { const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.entries(x).sort()) : x);
  const results = [];
  for (const [args, expected] of __tests) {
    try { const got = ${task.fn}(...args);
      results.push(expected === 'THROWS' ? false : canon(got) === canon(expected));
    } catch (e) { results.push(expected === 'THROWS'); }
  }
  return results; })()`;
  try {
    const res = vm.runInNewContext(harness, { __tests: structuredClone(task.tests) }, { timeout: 2000 });
    return { passed: res.filter(Boolean).length, total: task.tests.length, error: '' };
  } catch (e) {
    return { passed: 0, total: task.tests.length, error: String(e.message).slice(0, 80) };
  }
}

// --selftest: prove the test cases are right by running known-good reference answers.
const REFERENCE = {
  slugify: 'function slugify(t){return String(t).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");}',
  isValidChatId: 'function isValidChatId(id){return typeof id==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);}',
  parseCookies: 'function parseCookies(h){const o={};if(!h)return o;for(const p of String(h).split(";")){const s=p.trim();const i=s.indexOf("=");if(i<0)continue;const n=s.slice(0,i).trim();const v=s.slice(i+1).trim();try{o[n]=decodeURIComponent(v);}catch{o[n]=v;}}return o;}',
  chunkText: 'function chunkText(t,m,o){if(o<0||o>=m)throw new Error("bad overlap");const r=[];if(!t)return r;for(let s=0;;s+=m-o){r.push(t.slice(s,s+m));if(s+m>=t.length)break;}return r;}',
  trimHistory: 'function trimHistory(ms,max){const tk=(m)=>Math.ceil(m.content.length/4);let sys=null,rest=ms;if(ms.length&&ms[0].role==="system"){sys=ms[0];rest=ms.slice(1);}let total=sys?tk(sys):0;const kept=[];for(let i=rest.length-1;i>=0;i--){const t=tk(rest[i]);if(total+t>max)break;total+=t;kept.unshift(rest[i]);}return sys?[sys,...kept]:kept;}',
};
if (selfTest) {
  let ok = true;
  for (const task of TASKS) {
    const r = check(REFERENCE[task.fn], task);
    console.log(`selftest ${task.id}: ${r.passed}/${r.total}${r.error ? ' ERR ' + r.error : ''}`);
    ok = ok && r.passed === r.total;
  }
  console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL');
  process.exit(ok ? 0 : 1);
}

async function ask(prompt, seed) {
  const body = {
    model, stream: false,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    options: { num_ctx: numCtx, num_predict: 800, temperature: 0.3, seed },
  };
  if (noThink) body.think = false;
  const t0 = Date.now();
  const res = await fetch(`${HOST}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const r = await res.json();
  return { text: r.message.content, ms: Date.now() - t0, tokS: r.eval_count / (r.eval_duration / 1e9) };
}

if (!existsSync(out)) writeFileSync(out, 'time,model,task,run,passed,total,full_pass,wall_ms,tok_s,error\n');
let fullPasses = 0, tests = 0, testsPassed = 0;
const walls = [];
for (const task of TASKS) {
  for (let run = 1; run <= runs; run++) {
    let r = { passed: 0, total: task.tests.length, error: '' }, wall = '', tokS = '';
    try {
      const a = await ask(task.prompt, run);
      wall = a.ms; tokS = a.tokS.toFixed(1); walls.push(a.ms);
      r = check(extractCode(a.text), task);
    } catch (e) { r.error = String(e.message).slice(0, 80); }
    const full = r.passed === r.total;
    fullPasses += full ? 1 : 0; tests += r.total; testsPassed += r.passed;
    appendFileSync(out, [new Date().toISOString(), model, task.id, run, r.passed, r.total, full, wall, tokS,
      r.error.replace(/[,\n]/g, ' ')].join(',') + '\n');
    console.log(`${model} ${task.id} run ${run}: ${r.passed}/${r.total}${r.error ? ' ERR ' + r.error : ''} (${wall} ms)`);
  }
}
walls.sort((a, b) => a - b);
console.log(`SUMMARY ${model}: full passes ${fullPasses}/${TASKS.length * runs}, test cases ${testsPassed}/${tests}, median answer time ${walls[Math.floor(walls.length / 2)]} ms`);
