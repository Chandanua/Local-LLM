import { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import ChatWindow from './components/ChatWindow.jsx';

function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [draftChat, setDraftChat] = useState(null);
  const [waitingChatId, setWaitingChatId] = useState(null);
  const [typingOutChatId, setTypingOutChatId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mode, setMode] = useState('dev_buddy');
  const typingTimerRef = useRef(null);

  const generateClientChatId = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (err) {
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  useEffect(() => {
    let cancelled = false;

    const loadChatsAndStartNew = async () => {
      let loadedChats = [];
      try {
        const res = await fetch('/chats');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data)) {
            const emptyChats = data.filter(
              (chat) => Array.isArray(chat.messages) && chat.messages.length === 0
            );
            const nonEmptyChats = data.filter(
              (chat) => !Array.isArray(chat.messages) || chat.messages.length > 0
            );

            loadedChats = nonEmptyChats;
            setChats(nonEmptyChats);

            await Promise.all(
              emptyChats.map(async (chat) => {
                if (!chat?.id) return;
                try {
                  await fetch(`/chats/${encodeURIComponent(chat.id)}`, {
                    method: 'DELETE',
                  });
                } catch (err) {
                }
              })
            );
          }
        }
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.error('Failed to load chats', err);
        }
      }

      if (cancelled) {
        return;
      }

      try {
        await fetch('/chat/reset', { method: 'POST' });
      } catch (err) {
      }

      setActiveChatId(null);
      setDraftChat({
        id: generateClientChatId(),
        title: 'New chat',
        messages: [],
      });
    };

    loadChatsAndStartNew();

    return () => {
      cancelled = true;
    };
  }, []);

  const stopTypingOut = () => {
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    setTypingOutChatId(null);
  };

  const handleNewChat = async () => {
    setWaitingChatId(null);
    stopTypingOut();

    try {
      await fetch('/chat/reset', { method: 'POST' });
    } catch (err) {
    }

    setActiveChatId(null);
    setDraftChat({
      id: generateClientChatId(),
      title: 'New chat',
      messages: [],
    });
  };

  const handleRenameChat = async (chat) => {
    if (!chat || !chat.id) return;

    const currentTitle = typeof chat.title === 'string' ? chat.title : '';
    // Simple prompt-based rename to keep UI minimal
    const nextTitle = window.prompt('Rename chat', currentTitle);
    if (nextTitle == null) return;
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === currentTitle) return;

    try {
      const res = await fetch(`/chats/${encodeURIComponent(chat.id)}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const updated = await res.json();
      if (!updated || !updated.id) return;

      setChats((prev) =>
        prev.map((c) =>
          c.id === updated.id
            ? {
                ...c,
                title: typeof updated.title === 'string' && updated.title
                  ? updated.title
                  : c.title,
                updatedAt: updated.updatedAt ?? c.updatedAt,
              }
            : c
        )
      );
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.error('Failed to rename chat', err);
      }
    }
  };

  const handleDeleteChat = async (chat) => {
    if (!chat || !chat.id) return;

    const confirmed = window.confirm('Delete this chat from history?');
    if (!confirmed) return;

    try {
      const res = await fetch(`/chats/${encodeURIComponent(chat.id)}`, {
        method: 'DELETE',
      });

      if (!res.ok && res.status !== 404 && res.status !== 204) {
        throw new Error(`HTTP ${res.status}`);
      }

      setChats((prev) => {
        const filtered = prev.filter((c) => c.id !== chat.id);

        // If we just deleted the active chat, pick a new one if available
        if (activeChatId === chat.id) {
          const fallback = filtered[0]?.id ?? null;
          setActiveChatId(fallback);
        }

        return filtered;
      });

      setWaitingChatId((current) => (current === chat.id ? null : current));
      setTypingOutChatId((current) => (current === chat.id ? null : current));
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.error('Failed to delete chat', err);
      }
    }
  };

  const handleSelectChat = async (id) => {
    setDraftChat(null);
    setActiveChatId(id);
    setWaitingChatId(null);
    stopTypingOut();

    try {
      const res = await fetch(`/chats/${encodeURIComponent(id)}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const chat = await res.json();
      if (!chat || !chat.id) return;

      setChats((prev) => {
        const others = prev.filter((c) => c.id !== chat.id);
        return [chat, ...others];
      });
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.error('Failed to load chat', err);
      }
    }
  };

  const typeOutAssistantReply = (chatId, replyText, extra = {}) => {
    stopTypingOut();

    const messageId = (Date.now() + 1).toString();
    const createdAt = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: [
                ...(Array.isArray(chat.messages) ? chat.messages : []),
                {
                  id: messageId,
                  role: 'assistant',
                  content: '',
                  createdAt,
                  ...extra,
                },
              ],
            }
          : chat
      )
    );

    setTypingOutChatId(chatId);

    const CHARS_PER_TICK = 2;
    const TICK_MS = 18;
    let i = 0;

    typingTimerRef.current = setInterval(() => {
      i = Math.min(replyText.length, i + CHARS_PER_TICK);
      const partial = replyText.slice(0, i);

      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== chatId) return chat;
          return {
            ...chat,
            messages: chat.messages.map((m) =>
              m.id === messageId ? { ...m, content: partial } : m
            ),
          };
        })
      );

      if (i >= replyText.length) {
        stopTypingOut();
      }
    }, TICK_MS);
  };

  const handleSendMessage = async (content) => {
    const effectiveChatId = draftChat?.id ?? activeChatId;
    if (!effectiveChatId || !content.trim()) return;

    const chatId = effectiveChatId;
    const trimmed = content.trim();

    if (draftChat && draftChat.id === chatId) {
      const createdAt = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      setDraftChat(null);
      setActiveChatId(chatId);

      setChats((prev) => {
        const baseChat = {
          id: chatId,
          title: draftChat.title || 'New chat',
          messages: Array.isArray(draftChat.messages) ? draftChat.messages : [],
        };

        const updatedChat = {
          ...baseChat,
          messages: [
            ...baseChat.messages,
            {
              id: Date.now().toString(),
              role: 'user',
              content: trimmed,
              createdAt,
            },
          ],
        };

        const others = prev.filter((c) => c.id !== chatId);
        return [updatedChat, ...others];
      });
    } else {
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [
                  ...(Array.isArray(chat.messages) ? chat.messages : []),
                  {
                    id: Date.now().toString(),
                    role: 'user',
                    content: trimmed,
                    createdAt: new Date().toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  },
                ],
              }
            : chat
        )
      );
    }

    setWaitingChatId(chatId);

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, mode, chatId }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const reply = typeof data?.reply === 'string' ? data.reply : 'No reply';
      const sources = Array.isArray(data?.sources) ? data.sources : undefined;
      const meta = data && typeof data.chat === 'object' ? data.chat : null;

      if (meta && meta.id) {
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === meta.id
              ? {
                  ...chat,
                  title: typeof meta.title === 'string' && meta.title ? meta.title : chat.title,
                  updatedAt: meta.updatedAt ?? chat.updatedAt,
                }
              : chat
          )
        );
      }

      typeOutAssistantReply(chatId, reply, { sources });
    } catch (err) {
      typeOutAssistantReply(
        chatId,
        `Backend error: ${err?.message ?? 'Unknown error'}`
      );
    } finally {
      setWaitingChatId((current) => (current === chatId ? null : current));
    }
  };

  const persistedActiveChat = chats.find((c) => c.id === activeChatId) ?? chats[0];
  const activeChat = draftChat ?? persistedActiveChat;

  return (
    <div className="flex h-screen bg-black text-[#f3f4f6] text-[15px] leading-relaxed">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((prev) => !prev)}
      />
      <ChatWindow
        chat={activeChat}
        onSendMessage={handleSendMessage}
        isWaiting={waitingChatId === activeChat?.id}
        isBusy={
          waitingChatId === activeChat?.id || typingOutChatId === activeChat?.id
        }
        mode={mode}
        onModeChange={setMode}
      />
    </div>
  );
}

export default App;
