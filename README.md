# 🧠 Local-LLM — Private AI Chat Assistant

A **fully local, privacy-first AI chat application** powered by [Ollama](https://ollama.com) and the Llama 3 8B model. No cloud APIs, no data leaves your machine — your conversations stay yours.

Built with a React + Vite frontend and a Node.js/Express backend, Local-LLM delivers a polished ChatGPT-style experience that runs entirely on your hardware.

---

## ✨ Key Features

### 💬 Conversational Chat
- **Persistent chat history** — Conversations are saved to disk as JSON files and survive server restarts.
- **Multi-chat support** — Create, rename, switch between, and delete chat sessions via a sidebar.
- **Typing animation** — Assistant responses stream in character-by-character for a natural feel.
- **Context-aware** — Maintains a rolling history window (last 20 messages) so the model remembers what you discussed.

### 🎭 Developer Modes
Switch between **five personality modes** to get the kind of help you need:

| Mode | Personality | Best For |
|------|-------------|----------|
| **Dev Buddy** | Casual, fun, productive | General coding chat |
| **Mentor** | Patient, encouraging, clear | Learning new concepts |
| **Code Reviewer** | Blunt, strict, professional | Reviewing code quality |
| **Debugger** | Methodical, step-by-step | Hunting down bugs |
| **Optimizer** | Opinionated, minimal, smart | Performance & clean code |

### 📎 RAG (Retrieval-Augmented Generation)
Upload documents and ask questions grounded in their content:

- **Supported file types:**
  - 📄 **PDFs** — Extracted via `pdf-parse`
  - 🖼️ **Images** — OCR via `Tesseract.js` (screenshots, scanned docs)
  - 💻 **Code files** — `.js`, `.ts`, `.py`, `.java`, `.go`, `.rs`, `.rb`, `.php`, `.html`, `.css`, `.json`, `.sql`, `.sh`, and more
  - 📝 **Documents** — `.txt`, `.md`, `.doc`, `.docx`, `.ppt`, `.pptx`
- **Smart chunking** — Content is split differently based on file type (code is grouped by function/class, documents by paragraph, OCR by cleaned lines).
- **Hybrid retrieval** — Combines vector similarity (via Ollama embeddings) with keyword scoring for more accurate results.
- **Confidence threshold** — If retrieval quality is too low, the system honestly says "I don't have enough information" instead of hallucinating.
- **Multi-file upload** — Attach up to 10 files (10 MB each) in a single upload.

### 🎤 Voice Input
- **Speech-to-text** — Click the microphone to dictate your messages using the browser's built-in Web Speech API.

### 📸 Screenshot Capture
- **Screen capture** — Take a screenshot directly from the chat input, which is then OCR'd and indexed for RAG.

### 🔒 Fully Local & Private
- All processing happens on `localhost` — no external API calls.
- Chat history is stored as plain JSON files on your local drive.
- Embeddings are generated locally via Ollama.

---

## 🏗️ Architecture

```
Local-LLM/
├── backend/                 # Node.js + Express API server
│   ├── server.js            # Main server — chat, RAG, file upload, history
│   ├── rag-eval.js          # Dev-only RAG evaluation harness
│   ├── eng.traineddata      # Tesseract OCR language data (English)
│   └── package.json
│
├── frontend/                # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx          # Root component — chat state management
│   │   ├── main.jsx         # React entry point
│   │   ├── index.css        # Global styles
│   │   ├── components/
│   │   │   ├── Sidebar.jsx      # Chat list, new chat, rename/delete
│   │   │   ├── ChatWindow.jsx   # Active chat view
│   │   │   ├── ChatInput.jsx    # Input bar — text, files, voice, modes
│   │   │   ├── MessageBubble.jsx# Individual message rendering
│   │   │   └── MessageList.jsx  # Scrollable message container
│   │   └── data/
│   │       └── mockData.js      # Sample data for development
│   ├── vite.config.js       # Vite config with API proxy
│   ├── tailwind.config.cjs  # TailwindCSS configuration
│   ├── postcss.config.cjs   # PostCSS configuration
│   └── package.json
│
└── README.md
```

### How It Works

```
┌──────────────┐     HTTP      ┌──────────────┐     HTTP      ┌──────────────┐
│   Frontend   │ ────────────► │   Backend    │ ────────────► │    Ollama    │
│  React/Vite  │ ◄──────────── │  Express.js  │ ◄──────────── │  (llama3:8b) │
│  Port 5173   │    JSON       │  Port 3001   │    JSON       │  Port 11434  │
└──────────────┘               └──────┬───────┘               └──────────────┘
                                      │
                               ┌──────┴───────┐
                               │  Local Disk  │
                               │  D:\LLM storage\
                               │  ├── chats/  │
                               │  └── memory/ │
                               └──────────────┘
```

1. **Frontend** sends user messages to the backend via `/chat`.
2. **Backend** retrieves conversation history, builds a system prompt based on the selected mode, optionally injects RAG context from uploaded files, and forwards everything to Ollama.
3. **Ollama** runs the Llama 3 8B model locally and returns the response.
4. **Backend** persists the exchange to disk and sends the reply back to the frontend.
5. **Frontend** renders the response with a typing animation.

---

## 🛠️ Tech Stack

### Backend
| Technology | Purpose |
|------------|---------|
| **Node.js** | Runtime environment |
| **Express.js** | HTTP API framework |
| **Ollama** | Local LLM inference (`llama3:8b`) + embeddings (`embeddinggemma`) |
| **pdf-parse** | PDF text extraction |
| **Tesseract.js** | OCR for image files |
| **Multer** | Multipart file upload handling |
| **Crypto** | Session ID + chat ID generation |

### Frontend
| Technology | Purpose |
|------------|---------|
| **React 18** | UI component library |
| **Vite 4** | Fast dev server + bundler |
| **TailwindCSS 3** | Utility-first styling |
| **SWC** | Fast JSX compilation (via `@vitejs/plugin-react-swc`) |
| **Web Speech API** | Browser-native voice input |

---

## 📋 Prerequisites

Before running the project, ensure you have:

1. **Node.js** (v18 or later) — [Download](https://nodejs.org/)
2. **Ollama** installed and running — [Install Ollama](https://ollama.com/download)
3. **Required Ollama models** pulled:

```bash
# Pull the chat model
ollama pull llama3:8b

# Pull the embedding model (used for RAG)
ollama pull embeddinggemma
```

4. **Storage directory** — The backend stores chats and profile data at `D:\LLM storage\`. Create this directory if it doesn't exist:

```bash
mkdir "D:\LLM storage\chats"
mkdir "D:\LLM storage\memory"
```

> **Note:** You can change the storage path by editing `CHATS_ROOT` and `PROFILE_PATH` in `backend/server.js`.

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/Local-LLM.git
cd Local-LLM
```

### 2. Start Ollama

Make sure the Ollama service is running on `http://localhost:11434`:

```bash
ollama serve
```

### 3. Install & Start the Backend

```bash
cd backend
npm install
npm start
```

The backend will start on **http://localhost:3001**.

### 4. Install & Start the Frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend will start on **http://localhost:5173** and automatically proxy API requests to the backend.

### 5. Open the App

Navigate to **http://localhost:5173** in your browser and start chatting!

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/chats` | List all saved chat sessions |
| `GET` | `/chats/:id` | Get a specific chat with full message history |
| `POST` | `/chats` | Create a new chat session |
| `PATCH` | `/chats/:id/title` | Rename a chat session |
| `DELETE` | `/chats/:id` | Delete a chat session |
| `POST` | `/chat` | Send a message and receive an AI response |
| `POST` | `/chat/reset` | Reset the current session (history + RAG) |
| `POST` | `/upload` | Upload files for RAG indexing |

### Chat Request Body

```json
{
  "message": "How do I center a div?",
  "mode": "dev_buddy",
  "chatId": "uuid-of-chat",
  "ragDebug": false
}
```

### Chat Response Body

```json
{
  "reply": "Hey Chandan! There are a few ways...",
  "answer": "Hey Chandan! There are a few ways...",
  "sources": [
    {
      "file": "styles.css",
      "chunk": 2,
      "kind": "code",
      "preview": "..."
    }
  ],
  "chatId": "uuid-of-chat",
  "chat": {
    "id": "uuid-of-chat",
    "title": "How do I center a",
    "updatedAt": "2026-04-03T06:00:00.000Z"
  }
}
```

---

## 🧪 RAG Evaluation

A built-in evaluation harness is included for testing RAG retrieval quality:

```bash
cd backend

# 1. Make sure the backend is running (npm start)
# 2. Upload your test documents through the UI
# 3. Run the evaluation
node rag-eval.js
```

The script sends predefined questions to the `/chat` endpoint with `ragDebug: true` and checks:
- Whether the expected source file appears in the results.
- Whether the answer contains required keywords.

Edit `TEST_CASES` in `rag-eval.js` to add your own test scenarios.

---

## ⚙️ Configuration

### RAG Tuning (in `backend/server.js`)

| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_RAG_DOCUMENTS` | `1000` | Max in-memory chunks per session |
| `EMBEDDING_MODEL` | `embeddinggemma` | Ollama embedding model name |
| `INITIAL_RETRIEVAL_K` | `10` | Top-K candidates from vector search |
| `FINAL_CONTEXT_CHUNKS` | `4` | Chunks injected into the prompt |
| `RAG_CONFIDENCE_THRESHOLD` | `0.35` | Below this, falls back to "I don't know" |
| `MAX_HISTORY_MESSAGES` | `20` | Rolling context window size |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend server port |
| `RAG_DEBUG` | `0` | Set to `1` to enable global RAG debug logging |

---

## 📁 Data Storage

All data is stored locally on your machine:

```
D:\LLM storage\
├── chats/                   # One JSON file per chat session
│   ├── <uuid>.json
│   └── ...
└── memory/
    └── profile.json         # Persistent user profile (name, tone, style)
```

### Profile Memory

The system maintains a persistent profile at `D:\LLM storage\memory\profile.json`:

```json
{
  "name": "Chandan",
  "tone": "smart, calm, slightly playful dev buddy",
  "style": "clean, minimal, practical answers with light humor",
  "role": "senior developer helping his younger brother"
}
```

This profile is injected into every system prompt so the AI maintains a consistent personality across sessions.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

<p align="center">
  Built with ❤️ for developers who value privacy and local-first AI.
</p>
