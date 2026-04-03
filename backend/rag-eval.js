// Simple RAG evaluation harness (dev-only)
// Usage:
//   1. Start backend:  npm start
//   2. Ensure your test documents are uploaded/indexed (via UI or /upload).
//   3. Run:          node rag-eval.js
//
// This script will:
//   - Send test questions to /chat with ragDebug enabled
//   - Check that the expected source file appears in the sources
//   - Check that the answer contains required text
//   - Log pass/fail per test, plus a summary

const CHAT_URL = 'http://localhost:3001/chat';

/** @type {Array<{ name: string; question: string; expectedSourceFile: string; mustContainText: string; mode?: string }>} */
const TEST_CASES = [
  {
    name: 'Auth flow PDF: token validation phrase',
    question: 'Where in the docs is the login token validated?',
    expectedSourceFile: 'auth-flow.pdf',
    mustContainText: 'token',
    mode: 'dev_buddy',
  },
  {
    name: 'Config key lookup',
    question: 'Which document talks about NEXT_PUBLIC_API_URL configuration?',
    expectedSourceFile: 'config.md',
    mustContainText: 'NEXT_PUBLIC_API_URL',
    mode: 'dev_buddy',
  },
];

async function runSingleTest(test) {
  const body = {
    message: test.question,
    mode: test.mode || 'dev_buddy',
    ragDebug: true,
  };

  let res;
  try {
    res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`❌ [${test.name}] Request failed:`, err?.message || err);
    return { ok: false, reason: 'request_failed' };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`❌ [${test.name}] HTTP ${res.status} from /chat`, text);
    return { ok: false, reason: 'http_error' };
  }

  const data = await res.json().catch((err) => {
    console.error(`❌ [${test.name}] Failed to parse JSON:`, err?.message || err);
    return null;
  });

  if (!data) {
    return { ok: false, reason: 'bad_json' };
  }

  const answer = typeof data.answer === 'string' ? data.answer : String(data.reply ?? '');
  const sources = Array.isArray(data.sources) ? data.sources : [];

  const answerLower = answer.toLowerCase();
  const requiredLower = test.mustContainText.toLowerCase();
  const containsRequiredText = requiredLower && answerLower.includes(requiredLower);

  const expectedFileLower = test.expectedSourceFile.toLowerCase();
  const hasExpectedSource = sources.some((src) =>
    typeof src?.file === 'string' && src.file.toLowerCase().includes(expectedFileLower)
  );

  const ok = containsRequiredText && hasExpectedSource;

  const debugSummary = {
    hasExpectedSource,
    containsRequiredText,
    sources,
    ragDebug: data.ragDebug ?? null,
  };

  if (ok) {
    console.log(`✅ [${test.name}] PASS`);
  } else {
    console.log(`❌ [${test.name}] FAIL`);
    console.log('    hasExpectedSource    =', hasExpectedSource);
    console.log('    containsRequiredText =', containsRequiredText);
    console.log('    answer (first 200 chars):');
    console.log('    ', answer.slice(0, 200).replace(/\s+/g, ' '));
    console.log('    sources:');
    for (const src of sources) {
      console.log(
        '     -',
        src.file,
        'chunk',
        src.chunk,
        '| kind =',
        src.kind,
        '| preview =',
        (src.preview || '').slice(0, 120).replace(/\s+/g, ' ')
      );
    }
  }

  return { ok, debugSummary };
}

async function main() {
  let passed = 0;
  let failed = 0;

  for (const test of TEST_CASES) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runSingleTest(test);
    if (result.ok) passed += 1;
    else failed += 1;
  }

  console.log('--- RAG evaluation summary ---');
  console.log('Total tests:', TEST_CASES.length);
  console.log('Passed     :', passed);
  console.log('Failed     :', failed);
}

main().catch((err) => {
  console.error('Unexpected error in RAG eval script:', err);
  process.exitCode = 1;
});
