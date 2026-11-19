import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';

// --- Minimal config (P0.1). Full config module comes in P1. ---
function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== String(raw).trim()) {
    throw new Error(`Invalid ${name}="${raw}": expected a positive integer`);
  }
  return n;
}
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const CHAT_MODEL = process.env.CHAT_MODEL || 'qwen3.5:4b';
const EMBED_MODEL = process.env.EMBED_MODEL || 'embeddinggemma';
const DATA_DIR = process.env.DATA_DIR || 'D:\\LLM storage';
const NUM_CTX = readPositiveInt('NUM_CTX', 32768);
const NUM_PREDICT = readPositiveInt('NUM_PREDICT', 2048);
const KEEP_ALIVE = process.env.KEEP_ALIVE || '30m';

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10,
  },
});

app.use(cors());
app.use(express.json());

const BASE_SYSTEM_PROMPT = `You are a highly skilled developer assistant.

Your role:
- Act like a smart, calm, slightly playful dev buddy.
- Be friendly, supportive, and occasionally humorous.
- Talk like a senior developer helping his younger brother.

Personality & tone:
- Keep answers clean, minimal, and practical.
- No unnecessary theory unless it helps.
- Use light jokes or playful remarks when appropriate.
- You may be slightly flirty in a fun, respectful way.
- Never be rude, never be arrogant.

Behavior rules:
- Always call the user "Chandan".
- Be honest and direct when something is wrong.
- If code is bad or inefficient, clearly say why.
- Always explain:
  1. What is wrong
  2. Why it is a problem
  3. How to fix it
  4. A smarter or cleaner alternative if possible

Coding help:
- Prefer clean, modern, readable solutions.
- Think like a production developer, not a tutorial bot.
- If there are multiple solutions, recommend the best one and explain why.
- Warn about common mistakes and edge cases.

Overall goal:
- Help Chandan become a better developer.
- Feel like a trusted coding partner, not a chatbot.
`;

const DEV_MODE_PROMPTS = {
  mentor: `MODE: Mentor (teaching + clarity)

Behavior:
- Explain concepts clearly and patiently.
- Assume Chandan wants to understand, not just copy-paste.
- Use simple analogies when helpful.
- Avoid overwhelming details unless necessary.
- Encourage good engineering habits.

Tone:
- Supportive
- Calm
- Slightly encouraging`,

  code_reviewer: `MODE: Code Reviewer (honest & strict)

Behavior:
- Be direct and critical, but fair.
- Call out bad practices clearly.
- Do not sugar-coat problems.
- Explain why the code is weak or risky.
- Suggest production-grade fixes.

Tone:
- Professional
- Blunt but respectful
- No unnecessary politeness`,

  debugger: `MODE: Debugger (step-by-step problem solving)

Behavior:
- Ask clarifying questions if needed.
- Reason step-by-step.
- Identify the most likely root cause first.
- Avoid guessing wildly.
- Walk through the fix logically.

Tone:
- Focused
- Methodical
- Calm under pressure`,

  optimizer: `MODE: Optimizer (performance & cleanliness)

Behavior:
- Focus on performance, simplicity, and scalability.
- Point out unnecessary complexity.
- Suggest cleaner patterns and abstractions.
- Prefer readable and maintainable solutions.

Tone:
- Smart
- Minimal
- Slightly opinionated`,

  dev_buddy: `MODE: Dev Buddy (fun + productive)

Behavior:
- Be playful and relaxed.
- Use light jokes or teasing.
- Still give correct and useful answers.
- Keep things fun but productive.

Tone:
- Casual
- Friendly
- Slightly flirty but respectful`,
};
const PROFILE_PATH = path.join(DATA_DIR, 'memory', 'profile.json');
const CHATS_ROOT = path.join(DATA_DIR, 'chats');
const DEFAULT_PROFILE = {
  name: 'Chandan',
  tone: 'smart, calm, slightly playful dev buddy',
  style: 'clean, minimal, practical answers with light humor',
  role: 'senior developer helping his younger brother',
};

let profileMemory = { ...DEFAULT_PROFILE };

function ensureChatsRoot() {
  try {
    if (!fs.existsSync(CHATS_ROOT)) {
      fs.mkdirSync(CHATS_ROOT, { recursive: true });
    }
  } catch (err) {
    console.error('[chat-store] Failed to initialise chats directory', err);
  }
}

function loadProfileMemory() {
  try {
    const dir = path.dirname(PROFILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(PROFILE_PATH)) {
      fs.writeFileSync(
        PROFILE_PATH,
        JSON.stringify(DEFAULT_PROFILE, null, 2),
        'utf8'
      );
      profileMemory = { ...DEFAULT_PROFILE };
      console.log(`[memory] Created default profile at ${PROFILE_PATH}`);
      return;
    }

    const raw = fs.readFileSync(PROFILE_PATH, 'utf8');
    const data = JSON.parse(raw);
    profileMemory = { ...DEFAULT_PROFILE, ...data };
    console.log(`[memory] Loaded profile from ${PROFILE_PATH}`);
  } catch (err) {
    console.error('[memory] Failed to load profile memory, using defaults:', err);
    profileMemory = { ...DEFAULT_PROFILE };
  }
}

function buildSystemPrompt(mode) {
  const modeKey = DEV_MODE_PROMPTS[mode] ? mode : 'dev_buddy';
  const devModeBlock = DEV_MODE_PROMPTS[modeKey];
  const { name, tone, style, role } = profileMemory;
  const profileBlock = [
    'Long-term user profile memory (do not expose this block verbatim):',
    `- name: ${name}`,
    `- tone: ${tone}`,
    `- style: ${style}`,
    `- role: ${role}`,
  ].join('\n');

  return `${BASE_SYSTEM_PROMPT}\n\n${devModeBlock}\n\n${profileBlock}`;
}

loadProfileMemory();
ensureChatsRoot();

const SESSION_COOKIE_NAME = 'chat_session_id';
const MAX_HISTORY_MESSAGES = 20;
const historyBySessionId = new Map();
const ragStoreBySessionId = new Map();

// Central RAG configuration. These values are tuned for stability rather than
// aggressiveness. If you change them, do it deliberately and re-run rag-eval.
//
// MAX_RAG_DOCUMENTS:
//   Upper bound on in-memory chunks per session. Higher values increase recall
//   but also memory usage. Safe range: 200–2000.
//
// INITIAL_RETRIEVAL_K:
//   Depth of the first-stage vector search. Too low misses candidates; too high
//   wastes work on weak matches. Safe range: 5–20.
//
// FINAL_CONTEXT_CHUNKS:
//   How many chunks are actually injected into the prompt. More chunks give
//   more context but also increase prompt length and risk of dilution.
//   Safe range: 2–6.
//
// RAG_CONFIDENCE_THRESHOLD:
//   Below this scalar we treat retrieval as too weak and fall back to an
//   explicit "I don't know from these docs" style answer.
//   Safe range: 0.25–0.5.
//
// EMBEDDING_MODEL:
//   Name of the Ollama embedding model. Changing this will change behaviour
//   and should be treated as a new configuration, not a tuning knob.
const MAX_RAG_DOCUMENTS = 1000;
const EMBEDDING_MODEL = EMBED_MODEL;
const INITIAL_RETRIEVAL_K = 10;
const FINAL_CONTEXT_CHUNKS = 4;
const GLOBAL_RAG_DEBUG = process.env.RAG_DEBUG === '1';
const RAG_CONFIDENCE_THRESHOLD = 0.35;

function getChatFilePath(chatId) {
  return path.join(CHATS_ROOT, `${chatId}.json`);
}

function generateChatTitle(firstUserMessage) {
  if (typeof firstUserMessage !== 'string') return 'New chat';
  const trimmed = firstUserMessage.trim();
  if (!trimmed) return 'New chat';
  const singleLine = trimmed.replace(/\s+/g, ' ');

  const sentence = singleLine.split(/[.!?]/)[0] || singleLine;
  const words = sentence
    .split(' ')
    .map((w) => w.trim())
    .filter(Boolean);

  if (!words.length) return 'New chat';

  const limitedWords = words.slice(0, 6);
  let base = limitedWords.join(' ');

  if (base.length > 80) {
    base = `${base.slice(0, 77)}…`;
  }

  if (!base) return 'New chat';

  return base[0].toUpperCase() + base.slice(1);
}

function loadChatById(chatId) {
  try {
    const filePath = getChatFilePath(chatId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return null;
    }

    const id = typeof data.id === 'string' && data.id ? data.id : chatId;
    const title = typeof data.title === 'string' && data.title.trim() ? data.title : 'New chat';
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const createdAt = data.createdAt || new Date().toISOString();
    const updatedAt = data.updatedAt || createdAt;

    return {
      id,
      title,
      messages,
      createdAt,
      updatedAt,
    };
  } catch (err) {
    console.error('[chat-store] Failed to load chat file', chatId, err);
    return null;
  }
}

function saveChat(chat) {
  if (!chat || typeof chat.id !== 'string' || !chat.id) {
    return null;
  }

  try {
    ensureChatsRoot();
    const nowIso = new Date().toISOString();
    const id = chat.id;
    const existing = loadChatById(id);

    const createdAt = existing?.createdAt || chat.createdAt || nowIso;
    const updatedAt = nowIso;
    const title =
      typeof chat.title === 'string' && chat.title.trim()
        ? chat.title
        : existing?.title || 'New chat';
    const messages = Array.isArray(chat.messages) ? chat.messages : existing?.messages || [];

    const payload = {
      id,
      title,
      messages,
      createdAt,
      updatedAt,
    };

    const filePath = getChatFilePath(id);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  } catch (err) {
    console.error('[chat-store] Failed to save chat file', chat.id, err);
    return null;
  }
}

function listChatSummaries() {
  try {
    ensureChatsRoot();
    let files;
    try {
      files = fs.readdirSync(CHATS_ROOT, { withFileTypes: true });
    } catch (err) {
      console.error('[chat-store] Failed to read chats directory', err);
      return [];
    }

    const summaries = [];

    for (const entry of files) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(CHATS_ROOT, entry.name);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        if (!data || typeof data.id !== 'string') continue;

        const updatedRaw = data.updatedAt || data.createdAt || null;
        const updatedSortKey =
          typeof updatedRaw === 'number'
            ? updatedRaw
            : updatedRaw
            ? Date.parse(updatedRaw) || 0
            : 0;

        summaries.push({
          id: data.id,
          title:
            typeof data.title === 'string' && data.title.trim() ? data.title : 'New chat',
          updatedAt: updatedRaw,
          _sortKey: updatedSortKey,
        });
      } catch (err) {
        console.error('[chat-store] Failed to read chat summary from', filePath, err);
      }
    }

    summaries.sort((a, b) => (b._sortKey || 0) - (a._sortKey || 0));
    return summaries.map(({ _sortKey, ...rest }) => rest);
  } catch (err) {
    console.error('[chat-store] Unexpected error while listing chats', err);
    return [];
  }
}

function appendMessagesToPersistentChat(chatId, { userContent, assistantContent }) {
  if (!chatId) return;

  try {
    const existing = loadChatById(chatId) || {
      id: chatId,
      title: 'New chat',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const messages = Array.isArray(existing.messages) ? existing.messages.slice() : [];
    const timeLabel = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const makeMessageId = () =>
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    if (typeof userContent === 'string') {
      messages.push({
        id: makeMessageId(),
        role: 'user',
        content: userContent,
        createdAt: timeLabel,
      });
    }

    if (typeof assistantContent === 'string') {
      messages.push({
        id: makeMessageId(),
        role: 'assistant',
        content: assistantContent,
        createdAt: timeLabel,
      });
    }

    let title = existing.title;
    if ((!title || title === 'New chat') && typeof userContent === 'string' && userContent.trim()) {
      title = generateChatTitle(userContent);
    }

    saveChat({
      id: existing.id,
      title,
      messages,
      createdAt: existing.createdAt,
    });
  } catch (err) {
    console.error('[chat-store] Failed to append messages for chat', chatId, err);
  }
}

function buildHistoryFromPersistentChat(chat) {
  if (!chat || !Array.isArray(chat.messages)) {
    return [];
  }

  const mapped = chat.messages
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string'
    )
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  return mapped.slice(-MAX_HISTORY_MESSAGES);
}

function attachChatMetadataToResponse(payload, chatId) {
  if (!payload || typeof payload !== 'object' || !chatId) {
    return;
  }

  payload.chatId = chatId;

  const latestChat = loadChatById(chatId);
  if (latestChat) {
    payload.chat = {
      id: latestChat.id,
      title: latestChat.title,
      updatedAt: latestChat.updatedAt,
    };
  }
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join('=') ?? '');
    return acc;
  }, {});
}

function getOrCreateSessionId(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let sessionId = cookies[SESSION_COOKIE_NAME];

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`
    );
  }

  return sessionId;
}

function getHistory(sessionId) {
  const history = historyBySessionId.get(sessionId);
  return Array.isArray(history) ? history : [];
}

function setHistory(sessionId, messages) {
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  historyBySessionId.set(sessionId, trimmed);
}

function resetHistory(sessionId) {
  historyBySessionId.delete(sessionId);
}

function resetRag(sessionId) {
  ragStoreBySessionId.delete(sessionId);
}

function inferSourceKind(file) {
  const name = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  if (mime.startsWith('image/')) return 'ocr';

  const codeExtensions = [
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.py',
    '.java',
    '.cs',
    '.cpp',
    '.c',
    '.go',
    '.rs',
    '.rb',
    '.php',
    '.html',
    '.css',
    '.json',
    '.yml',
    '.yaml',
    '.xml',
    '.sql',
    '.sh',
    '.bat',
  ];

  if (codeExtensions.some((ext) => name.endsWith(ext))) {
    return 'code';
  }

  if (
    name.endsWith('.pdf') ||
    name.endsWith('.doc') ||
    name.endsWith('.docx') ||
    name.endsWith('.ppt') ||
    name.endsWith('.pptx') ||
    name.endsWith('.md') ||
    name.endsWith('.txt')
  ) {
    return 'document';
  }

  return 'other';
}

// Best-effort text extraction: prefer structured parsers (PDF) and OCR for images,
// then fall back to treating the file as UTF-8 text. This keeps the pipeline
// local and robust to mixed content without introducing heavy dependencies.
async function extractTextFromFile(file) {
  const mime = file.mimetype || '';

  if (mime === 'application/pdf') {
    try {
      const data = await pdfParse(file.buffer);
      if (data && typeof data.text === 'string') {
        return data.text;
      }
    } catch (err) {
      console.error('[rag] Failed to parse PDF', file.originalname, err);
    }
  }

  if (mime.startsWith('image/')) {
    try {
      const result = await Tesseract.recognize(file.buffer, 'eng');
      if (result?.data?.text) {
        return result.data.text;
      }
    } catch (err) {
      console.error('[rag] OCR failed for image', file.originalname, err);
    }
  }

  try {
    return file.buffer.toString('utf8');
  } catch (err) {
    console.error('[rag] Failed to read file as text', file.originalname, err);
    return '';
  }
}

// Normalise raw extracted text into something embeddings can handle well:
//   - unify newlines, remove control chars
//   - collapse noisy blank lines
//   - normalise whitespace
// This reduces embedding noise without trying to "understand" the content.
function cleanExtractedText(text) {
  if (typeof text !== 'string') return '';
  let cleaned = text.replace(/\r\n/g, '\n');
  // Remove control characters except newlines and tabs
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Collapse excessive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  // Normalize runs of spaces
  cleaned = cleaned.replace(/[^\S\n]+/g, ' ');
  return cleaned.trim();
}

// Simple generic fallback chunker used when we don't recognise a more
// specialised source kind. It trades off:
//   - maxLength: how big each chunk can be for embedding quality
//   - overlap:   how much context is shared between neighbouring chunks
function chunkText(text, maxLength = 800, overlap = 200) {
  const chunks = [];
  if (!text) return chunks;

  let start = 0;
  const len = text.length;

  while (start < len) {
    const end = Math.min(len, start + maxLength);
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end === len) break;
    start += maxLength - overlap;
  }

  return chunks;
}

// Entry-point for semantic chunking. We branch on sourceKind so that:
//   - code:      groups by function/class for more meaningful units
//   - document:  uses paragraphs and section-like chunks
//   - ocr:       aggressively cleans and merges short OCR lines
//   - other:     falls back to length-based chunking
// This keeps the logic explainable and tunable per domain.
function chunkBySourceKind(rawText, { sourceKind, fileName }) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return [];
  }

  if (sourceKind === 'code') {
    return chunkCode(rawText, fileName);
  }

  const cleaned = cleanExtractedText(rawText);

  if (sourceKind === 'document') {
    return chunkDocument(cleaned, fileName);
  }

  if (sourceKind === 'ocr') {
    return chunkOcr(cleaned, fileName);
  }

  const basicChunks = chunkText(cleaned);
  return basicChunks.map((text) => ({ text }));
}

function splitTextIntoParagraphs(text) {
  const lines = text.split('\n');
  const paragraphs = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const joined = buffer.join(' ').trim();
    if (joined) {
      paragraphs.push(joined);
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    buffer.push(trimmed);
  }

  flush();
  return paragraphs;
}

function buildChunksFromParagraphs(paragraphs, { maxChars, minChars }) {
  const chunks = [];
  let current = '';

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
    current = '';
  };

  for (const para of paragraphs) {
    if (!current) {
      current = para;
    } else if (current.length + 2 + para.length <= maxChars) {
      current += '\n\n' + para;
    } else if (current.length < minChars) {
      current += '\n\n' + para;
    } else {
      push();
      current = para;
    }
  }

  if (current.trim()) {
    push();
  }

  return chunks;
}

function detectCodeBlockHeader(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let m = trimmed.match(/^(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)/);
  if (m) return { type: 'function', name: m[3] };

  m = trimmed.match(/^(export\s+)?(const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(async\s+)?\(/);
  if (m) return { type: 'function', name: m[3] };

  m = trimmed.match(/^(export\s+)?(default\s+)?class\s+([A-Za-z0-9_$]+)/);
  if (m) return { type: 'class', name: m[3] };

  m = trimmed.match(/^def\s+([A-Za-z0-9_]+)\s*\(/);
  if (m) return { type: 'function', name: m[1] };

  m = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
  if (m) return { type: 'class', name: m[1] };

  m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/);
  if (m) return { type: 'function', name: m[1] };

  return null;
}

// Code chunking groups lines into coarse "blocks" around function / class
// headers. This preserves enough surrounding context for stack traces or
// config issues while staying relatively cheap and language-agnostic.
function chunkCode(rawText, fileName) {
  const lines = rawText.split(/\r?\n/);
  const chunks = [];
  let currentLines = [];
  let currentFunctionName = null;

  const flush = () => {
    if (!currentLines.length) return;
    const text = currentLines.join('\n').trimEnd();
    if (text) {
      chunks.push({
        text,
        functionName: currentFunctionName,
      });
    }
    currentLines = [];
    currentFunctionName = null;
  };

  for (const line of lines) {
    const header = detectCodeBlockHeader(line);
    if (header) {
      if (currentLines.length && currentFunctionName !== null) {
        flush();
      }
      currentLines.push(line);
      currentFunctionName = header.name;
    } else {
      currentLines.push(line);
    }
  }

  flush();
  return chunks;
}

// Document chunking operates on paragraphs and aims for mid-sized chunks
// (~900-2400 chars). Larger chunks give the model more context, while
// paragraph boundaries avoid merging completely unrelated sections.
function chunkDocument(cleanedText, fileName) {
  const paragraphs = splitTextIntoParagraphs(cleanedText);
  if (!paragraphs.length) {
    return [];
  }

  const maxChars = 2400;
  const minChars = 900;
  const texts = buildChunksFromParagraphs(paragraphs, { maxChars, minChars });
  return texts.map((text) => ({ text }));
}

// Lightweight keyword scorer that complements embeddings. It is intentionally
// simple and explainable:
//   - splits the query into tokens
//   - boosts identifier-like tokens and error codes
//   - gives extra weight when the functionName appears in the query
// The final score is normalised into [0,1] so it can be blended with vectors.
function computeKeywordScore(question, text, metadata = {}) {
  if (!question || !text) return 0;

  const q = String(question).toLowerCase();
  const t = String(text).toLowerCase();

  // Very lightweight tokenisation: split on non-word-ish chars but keep dots/underscores for identifiers.
  const rawTokens = q.split(/[^a-z0-9_.:/#-]+/i).filter(Boolean);
  if (!rawTokens.length) return 0;

  let score = 0;

  // Boost for explicit error / exception phrasing.
  if (q.includes('error') || q.includes('exception') || q.includes('stack trace')) {
    if (t.includes('error') || t.includes('exception')) {
      score += 2;
    }
  }

  for (const token of rawTokens) {
    const lower = token.toLowerCase();
    if (lower.length < 3) continue;

    if (!t.includes(lower)) continue;

    // Heavier weight for identifier-like tokens (config keys, function names, etc.).
    const looksLikeIdentifier = /[A-Z_]/.test(token) || /[a-z0-9]+\.[a-z0-9]+/.test(lower);
    const looksLikeErrorCode = /[A-Z0-9_-]{6,}/.test(token);

    if (looksLikeErrorCode) {
      score += 2.5;
    } else if (looksLikeIdentifier || lower.length >= 6) {
      score += 2;
    } else {
      score += 1;
    }
  }

  // Extra boost if the function name from metadata is mentioned in the query.
  if (metadata.functionName) {
    const fn = String(metadata.functionName).toLowerCase();
    if (fn && q.includes(fn)) {
      score += 3;
    }
  }

  // Normalise into [0, 1]. The denominator is a soft cap; beyond this we treat matches as "very strong".
  const NORMALISER = 10;
  return Math.max(0, Math.min(1, score / NORMALISER));
}

function chunkOcr(cleanedText, fileName) {
  const lines = cleanedText.split('\n');
  const paragraphs = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const joined = buffer.join(' ').trim();
    if (joined) {
      paragraphs.push(joined);
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }

    if (!/[A-Za-z0-9]/.test(line)) {
      continue;
    }

    if (line.length <= 2) {
      continue;
    }

    buffer.push(line);
  }

  flush();

  if (!paragraphs.length) {
    return [];
  }

  const maxChars = 2000;
  const minChars = 600;
  const texts = buildChunksFromParagraphs(paragraphs, { maxChars, minChars });
  return texts.map((text) => ({ text }));
}

// Thin wrapper around Ollama's embedding endpoint. We keep it isolated so
// failures are logged in one place and the rest of the RAG code can assume
// a simple "array of vectors in, array of vectors out" contract.
async function embedTexts(texts) {
  const input = texts.filter((t) => typeof t === 'string' && t.trim().length > 0);
  if (!input.length) return [];

  const res = await fetch(`${OLLAMA_HOST}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
      keep_alive: KEEP_ALIVE,
      options: { num_gpu: 0 },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(
      `[rag] Embedding request failed: HTTP ${res.status}${text ? ` - ${text}` : ''}`
    );
    return [];
  }

  const data = await res.json().catch((err) => {
    console.error('[rag] Failed to parse embedding response JSON', err);
    return null;
  });

  if (!data || !Array.isArray(data.embeddings)) {
    console.error('[rag] Embedding response missing embeddings array');
    return [];
  }

  return data.embeddings;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Index uploaded files for a single session:
//   1) infer sourceKind (code / document / ocr / other)
//   2) extract + clean text
//   3) chunk according to sourceKind
//   4) embed all chunks and attach metadata
// We store everything in-memory per session to keep the system local and
// easy to reset during development.
async function indexFilesForSession(sessionId, files) {
  const texts = [];
  const metadatas = [];

  const indexedAt = Date.now();

  for (const file of files) {
    const sourceKind = inferSourceKind(file);
    const rawText = await extractTextFromFile(file);
    const chunkObjects = chunkBySourceKind(rawText, {
      sourceKind,
      fileName: file.originalname,
    });

    for (let i = 0; i < chunkObjects.length; i += 1) {
      const chunk = chunkObjects[i];
      texts.push(chunk.text);
      metadatas.push({
        fileName: file.originalname,
        mimeType: file.mimetype,
        chunkIndex: i,
        sourceKind,
        functionName: chunk.functionName || null,
        indexedAt,
      });
    }
  }

  if (!texts.length) {
    return [];
  }

  const embeddings = await embedTexts(texts);

  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    console.error(
      '[rag] Embedding count mismatch: got',
      embeddings ? embeddings.length : 'null',
      'expected',
      texts.length
    );
    return [];
  }

  const now = Date.now();
  const docs = embeddings.map((embedding, index) => ({
    id: `${now}-${index}`,
    text: texts[index],
    embedding,
    metadata: metadatas[index],
  }));

  const existing = ragStoreBySessionId.get(sessionId) || [];
  const combined = existing.concat(docs);
  const trimmed = combined.slice(-MAX_RAG_DOCUMENTS);
  ragStoreBySessionId.set(sessionId, trimmed);

  return docs;
}

// Very small intent detector that steers retrieval towards the right
// sourceKind. The goal is not to be smart, but to bias scoring so that
// code-y questions hit code chunks first, document questions hit docs, etc.
function detectQueryDomain(question) {
  // Very simple intent detection to keep things local and explainable.
  const q = (question || '').toLowerCase();

  let codeScore = 0;
  let docScore = 0;
  let ocrScore = 0;

  const codeKeywords = [
    'function',
    'class',
    'stack trace',
    'stacktrace',
    'error code',
    'bug',
    'typescript',
    'javascript',
    'react',
    'python',
    'java',
    'c#',
    'c++',
    'node',
    'express',
    'sql',
    'api endpoint',
    '.js',
    '.ts',
    '.py',
    '.java',
  ];

  if (codeKeywords.some((kw) => q.includes(kw))) {
    codeScore += 2;
  }

  const docKeywords = [
    'pdf',
    'document',
    'report',
    'spec',
    'specification',
    'page',
    'section',
    'chapter',
    'manual',
  ];

  if (docKeywords.some((kw) => q.includes(kw))) {
    docScore += 2;
  }

  const ocrKeywords = [
    'image',
    'screenshot',
    'screen shot',
    'photo',
    'picture',
    'scan',
    'scanned',
    'ui',
    'interface',
  ];

  if (ocrKeywords.some((kw) => q.includes(kw))) {
    ocrScore += 2;
  }

  if (codeScore > docScore && codeScore > ocrScore) return 'code';
  if (docScore > codeScore && docScore > ocrScore) return 'doc';
  if (ocrScore > codeScore && ocrScore > docScore) return 'ocr';

  return 'any';
}

// Domain filter is deliberately soft: we try to keep only matching sourceKinds,
// but if that would drop everything we fall back to all docs. This avoids
// "no answer" situations when the heuristic gets the domain wrong.
function filterDocsByDomain(docs, domain) {
  if (!docs || !docs.length || domain === 'any') return docs || [];

  const filtered = docs.filter((doc) => {
    const kind = doc.metadata?.sourceKind;
    if (!kind) return false;
    if (domain === 'code') return kind === 'code';
    if (domain === 'doc') return kind === 'document';
    if (domain === 'ocr') return kind === 'ocr';
    return true;
  });

  // If filtering removed everything, fall back to all docs so we don't miss answers.
  return filtered.length ? filtered : docs;
}

// Converts the selected RAG snippets into a single system message that the
// model sees as "REFERENCE MATERIAL". The instructions are strict on purpose
// to discourage the model from mixing in outside knowledge when answering
// document-specific questions.
function buildContextSystemMessage(ragResult) {
  if (!ragResult || !ragResult.contextText) return null;

  return [
    'REFERENCE MATERIAL (from Chandan\'s uploaded files):',
    '',
    ragResult.contextText,
    '',
    'INSTRUCTIONS FOR ASSISTANT:',
    '- Use ONLY the reference material above when answering questions about those documents.',
    '- If the answer is not clearly supported by the reference material, say that the information is not available in the provided documents.',
    '- Do NOT invent facts that are not grounded in the reference material.',
  ].join('\n');
}

// Core RAG pipeline for a single question. Steps:
//   1) embed the question
//   2) retrieve top-K candidates by vector similarity
//   3) compute a hybrid score (vectors + keywords)
//   4) apply simple heuristics (length, density, recency, domain)
//   5) pick final chunks and derive a scalar confidence
// All scoring knobs are kept explicit to make debugging and tuning easier.
async function buildRagContext(sessionId, question, { debug = false } = {}) {
  const docs = ragStoreBySessionId.get(sessionId);
  if (!docs || !docs.length || typeof question !== 'string' || !question.trim()) {
    return null;
  }

  try {
    const domain = detectQueryDomain(question);
    const docsForDomain = filterDocsByDomain(docs, domain);

    const questionEmbeddings = await embedTexts([question]);
    if (!Array.isArray(questionEmbeddings) || !questionEmbeddings[0]) {
      return null;
    }

    const queryVector = questionEmbeddings[0];

    // First stage: compute vector similarity and a lightweight keyword score for all candidate chunks.
    const scoredAll = docsForDomain
      .map((doc) => {
        const vectorScore = cosineSimilarity(queryVector, doc.embedding);
        const keywordScore = computeKeywordScore(question, doc.text, doc.metadata || {});
        return {
          doc,
          score: vectorScore,
          keywordScore,
        };
      })
      .filter((entry) => Number.isFinite(entry.score));

    if (!scoredAll.length) return null;

    // Sort by pure vector score first; we'll apply hybrid scoring in the second stage.
    scoredAll.sort((a, b) => b.score - a.score);
    const topK = scoredAll.slice(0, Math.min(INITIAL_RETRIEVAL_K, scoredAll.length));

    // Second stage: explicit, readable re-ranking step.
    const reranked = topK
      .map((entry) => {
        const kind = entry.doc.metadata?.sourceKind;
        const meta = entry.doc.metadata || {};
        const text = entry.doc.text || '';

        // Base hybrid score: combine vector similarity and keyword overlap.
        const vectorScore = entry.score;
        const keywordScore = entry.keywordScore ?? 0;
        let hybridScore = vectorScore * 0.7 + keywordScore * 0.3;

        // Heuristic 1: penalise very short chunks that are unlikely to contain enough context.
        const lengthChars = text.length;
        let lengthFactor = 1;
        if (lengthChars > 0 && lengthChars < 200) {
          lengthFactor = 0.85;
        } else if (lengthChars < 400) {
          lengthFactor = 0.95;
        }

        // Heuristic 2: penalise low information density (too many symbols, too little alphanumeric text).
        let infoDensity = 0;
        let densityFactor = 1;
        if (lengthChars > 0) {
          const alphaNumeric = (text.match(/[A-Za-z0-9]/g) || []).length;
          infoDensity = alphaNumeric / lengthChars;
          if (infoDensity < 0.15) {
            densityFactor = 0.85;
          } else if (infoDensity < 0.3) {
            densityFactor = 0.95;
          } else if (infoDensity > 0.65) {
            // Slight boost for dense, text-heavy chunks.
            densityFactor = 1.03;
          }
        }

        // Heuristic 3: slight recency bias based on when the chunk was indexed.
        let recencyFactor = 1;
        let recencyMs = null;
        if (typeof meta.indexedAt === 'number') {
          recencyMs = Date.now() - meta.indexedAt;
          const oneDay = 24 * 60 * 60 * 1000;
          if (recencyMs < oneDay) {
            recencyFactor = 1.05;
          } else if (recencyMs < 7 * oneDay) {
            recencyFactor = 1.02;
          } else if (recencyMs > 90 * oneDay) {
            recencyFactor = 0.97;
          }
        }

        // Heuristic 4: existing domain bias (code/doc/ocr vs inferred query domain).
        let domainFactor = 1;
        if (domain === 'code' && kind === 'code') domainFactor = 1.1;
        else if (domain === 'doc' && kind === 'document') domainFactor = 1.1;
        else if (domain === 'ocr' && kind === 'ocr') domainFactor = 1.1;
        else if (domain !== 'any') domainFactor = 0.98;

        const finalScore =
          hybridScore * lengthFactor * densityFactor * recencyFactor * domainFactor;

        return {
          ...entry,
          adjustedScore: finalScore,
          hybridScore,
          scoring: {
            vectorScore,
            keywordScore,
            hybridBase: hybridScore,
            lengthChars,
            lengthFactor,
            infoDensity,
            densityFactor,
            recencyMs,
            recencyFactor,
            domainFactor,
          },
        };
      })
      .sort((a, b) => b.adjustedScore - a.adjustedScore);

    const final = reranked.slice(0, Math.min(FINAL_CONTEXT_CHUNKS, reranked.length));

    if (!final.length) return null;

    // Derive an overall confidence score from the adjusted scores of the final chunks.
    const adjustedScores = final.map((entry) =>
      typeof entry.adjustedScore === 'number' ? entry.adjustedScore : 0
    );
    const maxAdjustedScore = adjustedScores.reduce(
      (max, value) => (value > max ? value : max),
      0
    );
    const avgAdjustedScore =
      adjustedScores.reduce((sum, value) => sum + value, 0) / adjustedScores.length;

    // Normalise scores into [0, 1] using soft caps that roughly match expected ranges.
    // This keeps the logic explainable: higher similarity + better heuristics => higher confidence.
    const normaliserBest = 0.6; // treat ~0.6+ as "very strong" match
    const normaliserAvg = 0.5; // treat ~0.5 avg as "strong" overall context
    const bestComponent = Math.max(0, Math.min(1, maxAdjustedScore / normaliserBest));
    const avgComponent = Math.max(0, Math.min(1, avgAdjustedScore / normaliserAvg));
    const confidenceScore = 0.7 * bestComponent + 0.3 * avgComponent;

    const parts = final.map((entry, index) => {
      const { doc } = entry;
      const meta = doc.metadata || {};
      const labels = [];
      if (meta.fileName) labels.push(meta.fileName);
      if (typeof meta.chunkIndex === 'number') labels.push(`chunk #${meta.chunkIndex + 1}`);
      const label = labels.length ? labels.join(' / ') : `snippet #${index + 1}`;
      return `Source ${index + 1} [${label}]:\n${doc.text}`;
    });

    const sources = final.map((entry) => {
      const meta = entry.doc.metadata || {};
      const preview = entry.doc.text.length > 260
        ? `${entry.doc.text.slice(0, 260)}…`
        : entry.doc.text;

      return {
        file: meta.fileName || 'unknown',
        chunk: typeof meta.chunkIndex === 'number' ? meta.chunkIndex + 1 : null,
        kind: meta.sourceKind || null,
        preview,
      };
    });

    let debugInfo = undefined;
    if (debug) {
      const buildReasonForEntry = (entry, stage) => {
        const scoring = entry.scoring || {};

        const reasons = [];

        // Vector similarity is usually the main signal.
        const vectorScore =
          typeof scoring.vectorScore === 'number'
            ? scoring.vectorScore
            : typeof entry.score === 'number'
            ? entry.score
            : null;
        if (vectorScore !== null) {
          if (vectorScore >= 0.6) {
            reasons.push('high vector similarity');
          } else if (vectorScore >= 0.4) {
            reasons.push('moderate vector similarity');
          } else if (vectorScore >= 0.25) {
            reasons.push('some vector similarity');
          }
        }

        // Keyword overlap can strongly boost code / config lookups.
        const keywordScore =
          typeof scoring.keywordScore === 'number'
            ? scoring.keywordScore
            : typeof entry.keywordScore === 'number'
            ? entry.keywordScore
            : null;
        if (keywordScore !== null && keywordScore >= 0.2) {
          if (keywordScore >= 0.6) {
            reasons.push('strong keyword match');
          } else if (keywordScore >= 0.4) {
            reasons.push('keyword match');
          } else {
            reasons.push('weak keyword match');
          }
        }

        // Domain factor reflects whether the chunk matches the inferred query domain.
        if (typeof scoring.domainFactor === 'number') {
          if (scoring.domainFactor > 1.05) {
            reasons.push('domain match');
          } else if (scoring.domainFactor < 0.99) {
            reasons.push('domain mismatch penalty');
          }
        }

        // Length and density heuristics.
        if (typeof scoring.lengthFactor === 'number' && scoring.lengthFactor < 1) {
          reasons.push('short chunk penalty');
        }

        if (typeof scoring.densityFactor === 'number') {
          if (scoring.densityFactor > 1.02) {
            reasons.push('high information density');
          } else if (scoring.densityFactor < 0.9) {
            reasons.push('low information density penalty');
          }
        }

        // Recency bias.
        if (typeof scoring.recencyFactor === 'number') {
          if (scoring.recencyFactor > 1.02) {
            reasons.push('recently indexed document');
          } else if (scoring.recencyFactor < 0.99) {
            reasons.push('old document penalty');
          }
        }

        if (!reasons.length) {
          if (stage === 'retrieved') {
            return 'Candidate because: baseline similarity passed initial filter.';
          }
          if (stage === 'reranked') {
            return 'Ranked because: hybrid score was competitive after heuristics.';
          }
          return 'Selected because: hybrid score remained competitive after all heuristics.';
        }

        const prefix =
          stage === 'final'
            ? 'Selected because: '
            : stage === 'reranked'
            ? 'Ranked because: '
            : 'Candidate because: ';

        return `${prefix}${reasons.join(' + ')}.`;
      };

      const summariseEntry = (entry, stage) => {
        const meta = entry.doc.metadata || {};
        const text = entry.doc.text || '';
        const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
        return {
          file: meta.fileName || 'unknown',
          chunk: typeof meta.chunkIndex === 'number' ? meta.chunkIndex + 1 : null,
          kind: meta.sourceKind || null,
          score: entry.score, // pure vector similarity
          keywordScore: entry.keywordScore ?? 0,
          adjustedScore: entry.adjustedScore ?? null, // final score after all heuristics
          // Detailed breakdown of how the score was derived (only present for reranked/final).
          scoring: entry.scoring || null,
          reason: buildReasonForEntry(entry, stage),
          preview,
        };
      };

      debugInfo = {
        domain,
        totalIndexedChunks: docs.length,
        candidateChunks: docsForDomain.length,
        retrieved: topK.map((entry) => summariseEntry(entry, 'retrieved')),
        reranked: reranked.map((entry) => summariseEntry(entry, 'reranked')),
        final: final.map((entry) => summariseEntry(entry, 'final')),
        confidence: {
          score: confidenceScore,
          threshold: RAG_CONFIDENCE_THRESHOLD,
          maxAdjustedScore,
          avgAdjustedScore,
        },
      };
    }

    return {
      contextText: parts.join('\n\n'),
      sources,
      debug: debugInfo,
      // Lightweight scalar that callers can use for conservative fallback behaviour.
      confidence: confidenceScore,
    };
  } catch (err) {
    console.error('[rag] Failed to build RAG context', err);
    return null;
  }
}

app.get('/chats', (req, res) => {
  try {
    const summaries = listChatSummaries();
    const chats = summaries.map((summary) => {
      const full = loadChatById(summary.id);
      if (full && Array.isArray(full.messages)) {
        return full;
      }

      return {
        id: summary.id,
        title: summary.title,
        messages: [],
        createdAt: full?.createdAt ?? null,
        updatedAt: summary.updatedAt ?? full?.updatedAt ?? null,
      };
    });

    return res.json(chats);
  } catch (err) {
    console.error('[chat-store] Failed to list chats', err);
    return res.status(500).json({ error: 'Failed to list chats' });
  }
});

app.get('/chats/:id', (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Missing chat id' });
  }

  const chat = loadChatById(id);
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  return res.json(chat);
});

app.post('/chats', (req, res) => {
  const sessionId = getOrCreateSessionId(req, res);

  resetHistory(sessionId);
  resetRag(sessionId);

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const chat = {
    id,
    title: 'New chat',
    messages: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const saved = saveChat(chat);
  if (!saved) {
    return res.status(500).json({ error: 'Failed to create chat' });
  }

  return res.status(201).json(saved);
});

app.patch('/chats/:id/title', (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Missing chat id' });
  }

  const rawTitle = req.body && typeof req.body.title === 'string' ? req.body.title : null;
  if (!rawTitle) {
    return res
      .status(400)
      .json({ error: 'Invalid body. Expected { "title": string }' });
  }

  const title = rawTitle.trim();
  if (!title) {
    return res.status(400).json({ error: 'Title must not be empty' });
  }

  const existing = loadChatById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const saved = saveChat({ ...existing, title });
  if (!saved) {
    return res.status(500).json({ error: 'Failed to update chat title' });
  }

  return res.json(saved);
});

app.delete('/chats/:id', (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Missing chat id' });
  }

  try {
    const filePath = getChatFilePath(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[chat-store] Failed to delete chat file', id, err);
    return res.status(500).json({ error: 'Failed to delete chat' });
  }
});

app.post('/chat/reset', (req, res) => {
  const sessionId = getOrCreateSessionId(req, res);
  resetHistory(sessionId);
  resetRag(sessionId);
  return res.json({ ok: true });
});

app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = getOrCreateSessionId(req, res);
  const files = Array.isArray(req.files) ? req.files : [];

  if (!files.length) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const docs = await indexFilesForSession(sessionId, files);
    return res.json({
      ok: true,
      count: docs.length,
      documents: docs.map((doc) => ({ id: doc.id, metadata: doc.metadata })),
    });
  } catch (err) {
    console.error('[rag] Failed to index uploaded files', err);
    return res.status(500).json({ error: 'Failed to index uploaded files' });
  }
});

app.post('/chat', async (req, res) => {
  const { message, mode, ragDebug, chatId: rawChatId } = req.body ?? {};
  const sessionId = getOrCreateSessionId(req, res);
  const chatId =
    typeof rawChatId === 'string' && rawChatId.trim().length > 0
      ? rawChatId.trim()
      : null;

  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid body. Expected { "message": string }' });
  }

  if (req.body?.reset === true) {
    resetHistory(sessionId);
    resetRag(sessionId);
  }

  try {
    let history = getHistory(sessionId);

    if (chatId) {
      const persistentChat = loadChatById(chatId);
      if (persistentChat) {
        const fromDisk = buildHistoryFromPersistentChat(persistentChat);
        history = fromDisk;
      } else {
        history = [];
      }
    }
    const effectiveDebug = GLOBAL_RAG_DEBUG || Boolean(ragDebug);

    const ragResult = await buildRagContext(sessionId, message, { debug: effectiveDebug });

    // If we have RAG context but the overall confidence is below our threshold,
    // short-circuit to a conservative fallback instead of asking the model to
    // synthesise an answer from weak evidence.
    if (ragResult && typeof ragResult.confidence === 'number' && ragResult.confidence < RAG_CONFIDENCE_THRESHOLD) {
      const fallbackReply =
        "I don't have enough reliable information in the provided documents to answer this confidently.";

      if (chatId) {
        appendMessagesToPersistentChat(chatId, {
          userContent: message,
          assistantContent: fallbackReply,
        });

        const updatedChat = loadChatById(chatId);
        const fromDisk = buildHistoryFromPersistentChat(updatedChat);
        if (fromDisk.length) {
          setHistory(sessionId, fromDisk);
        } else {
          setHistory(sessionId, [
            ...history,
            { role: 'user', content: message },
            { role: 'assistant', content: fallbackReply },
          ]);
        }
      } else {
        setHistory(sessionId, [
          ...history,
          { role: 'user', content: message },
          { role: 'assistant', content: fallbackReply },
        ]);
      }

      const responsePayload = {
        reply: fallbackReply,
        answer: fallbackReply,
        sources: ragResult.sources ?? [],
        ragDebug: ragResult.debug,
      };

      attachChatMetadataToResponse(responsePayload, chatId);

      return res.json(responsePayload);
    }

    const messagesForOllama = [
      { role: 'system', content: buildSystemPrompt(mode) },
      ...history,
    ];

    const contextSystemMessage = buildContextSystemMessage(ragResult);
    if (contextSystemMessage) {
      messagesForOllama.push({ role: 'system', content: contextSystemMessage });
    }

    messagesForOllama.push({ role: 'user', content: message });

    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        stream: false,
        messages: messagesForOllama,
        think: false,
        keep_alive: KEEP_ALIVE,
        options: { num_ctx: NUM_CTX, num_predict: NUM_PREDICT, temperature: 0.3 },
      }),
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text().catch(() => '');
      return res
        .status(502)
        .json({ error: `Ollama error: HTTP ${ollamaRes.status}${text ? ` - ${text}` : ''}` });
    }

    const data = await ollamaRes.json();
    const reply = data?.message?.content;

    if (typeof reply !== 'string') {
      return res.status(502).json({ error: 'Ollama response missing message.content' });
    }

    if (chatId) {
      appendMessagesToPersistentChat(chatId, {
        userContent: message,
        assistantContent: reply,
      });

      const updatedChat = loadChatById(chatId);
      const fromDisk = buildHistoryFromPersistentChat(updatedChat);
      if (fromDisk.length) {
        setHistory(sessionId, fromDisk);
      } else {
        setHistory(sessionId, [
          ...history,
          { role: 'user', content: message },
          { role: 'assistant', content: reply },
        ]);
      }
    } else {
      setHistory(sessionId, [
        ...history,
        { role: 'user', content: message },
        { role: 'assistant', content: reply },
      ]);
    }

    const responsePayload = {
      // keep existing field so the current frontend continues to work unchanged
      reply,
      // more explicit name for future frontend work
      answer: reply,
      sources: ragResult?.sources ?? [],
    };

    if (ragResult?.debug && effectiveDebug) {
      responsePayload.ragDebug = ragResult.debug;
    }

    attachChatMetadataToResponse(responsePayload, chatId);

    return res.json(responsePayload);
  } catch (err) {
    return res.status(502).json({ error: `Failed to reach Ollama: ${err?.message ?? 'Unknown error'}` });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(`[config] chat=${CHAT_MODEL} embed=${EMBED_MODEL} ollama=${OLLAMA_HOST} num_ctx=${NUM_CTX} data=${DATA_DIR}`);
});
