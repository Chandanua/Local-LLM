import { useState } from 'react';

export default function Sidebar({
  chats,
  activeChatId,
  onNewChat,
  onSelectChat,
  onRenameChat,
  onDeleteChat,
  isOpen,
  onToggle,
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const trimmedSearch = searchTerm.trim().toLowerCase();
  const filteredChats = trimmedSearch
    ? chats.filter((chat) => {
      const title = (chat.title || '').toLowerCase();
      const lastMessage =
        chat.messages && chat.messages.length > 0
          ? chat.messages[chat.messages.length - 1]
          : null;
      const lastContent = (lastMessage?.content || '').toLowerCase();

      return (
        title.includes(trimmedSearch) ||
        lastContent.includes(trimmedSearch)
      );
    })
    : chats;

  return (
    <div
      className={`flex flex-col border-r border-[#1f2933] bg-gradient-to-b from-[#050505] via-[#0a0a0a] to-[#050505] shadow-elevated transition-all duration-300 ease-out ${isOpen ? 'w-64' : 'w-14'
        }`}
      style={{
        boxShadow: '4px 0 20px rgba(0, 0, 0, 0.5)',
      }}
    >
      <div className="flex items-center gap-2 px-3 py-3 border-b border-[#1f2933] bg-gradient-to-r from-[#0a0e14] to-[#0f1419]">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#374151] bg-gradient-to-br from-[#1a1f27] to-[#0f1419] text-xs text-[#e5e7eb] hover:bg-gradient-to-br hover:from-[#22d3ee]/20 hover:to-[#a78bfa]/20 hover:border-[#22d3ee] hover:shadow-cyan transition-all duration-300 transform hover:scale-105 active:scale-95"
          aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <span className="text-lg leading-none">≡</span>
        </button>
        {isOpen && (
          <div className="flex-1 animate-fadeIn">
            <h1 className="text-sm font-bold tracking-tight bg-gradient-to-r from-[#22d3ee] to-[#0e7490] bg-clip-text text-transparent animate-shimmer">
              My ChatGPT UI
            </h1>
          </div>
        )}
      </div>

      {isOpen ? (
        <>
          <div className="px-3 py-3 border-b border-[#1f2933] space-y-2 bg-gradient-to-b from-[#0a0e14] to-transparent animate-fadeIn">
            <button
              onClick={onNewChat}
              className="group flex w-full items-center justify-center gap-2 rounded-3xl bg-gradient-to-r from-[#164e63] to-[#22d3ee] px-3 py-2.5 text-sm font-bold text-white shadow-cyan hover:shadow-cyan transition-all duration-300 transform hover:scale-[1.02] active:scale-95 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
              <span className="text-lg leading-none relative z-10">＋</span>
              <span className="relative z-10">New chat</span>
            </button>
            <div className="flex w-full items-center gap-2 rounded-xl border border-[#374151] bg-gradient-to-r from-[#0a0e14] to-[#0f1419] px-3 py-2 text-xs text-[#e5e7eb] focus-within:border-[#22d3ee] focus-within:shadow-cyan transition-all duration-300">
              <span className="h-5 w-5 rounded-full bg-gradient-to-br from-[#22d3ee]/20 to-[#a78bfa]/20 border border-[#374151] flex items-center justify-center text-[11px]">
                🔍
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search chats"
                className="flex-1 bg-transparent text-[11px] placeholder:text-[#6b7280] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-3 space-y-2">
            <p className="px-2 text-[11px] font-bold uppercase tracking-wider text-[#6b7280]">
              Your chats
            </p>
            {filteredChats.map((chat, index) => {
              const lastMessage =
                chat.messages && chat.messages.length > 0
                  ? chat.messages[chat.messages.length - 1]
                  : null;
              const timeLabel = lastMessage?.createdAt ?? '';

              return (
                <div key={chat.id} className="group rounded-md">
                  <button
                    onClick={() => onSelectChat(chat.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${chat.id === activeChatId
                      ? 'bg-[#111827] text-[#f9fafb]'
                      : 'text-[#e5e7eb] hover:bg-[#0b1120]'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-[13px]">
                        {chat.title}
                      </span>
                      {timeLabel && (
                        <span className="flex-shrink-0 text-[10px] text-[#6b7280]">
                          {timeLabel}
                        </span>
                      )}
                    </div>
                    {lastMessage && (
                      <p className="mt-0.5 text-[11px] text-[#6b7280] truncate">
                        {lastMessage.role === 'user' ? 'You: ' : 'AI: '}
                        {lastMessage.content}
                      </p>
                    )}
                  </button>
                  <div className="flex items-center justify-end gap-2 px-3 pb-1 opacity-0 translate-y-[4px] group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                    <button
                      type="button"
                      onClick={() => onRenameChat && onRenameChat(chat)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[#0e7490] to-[#22d3ee] text-[11px] font-bold text-black shadow-cyan hover:shadow-[0_0_20px_rgba(34,211,238,0.8)] hover:scale-110 active:scale-90 transition-all duration-300"
                      aria-label="Rename chat"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteChat && onDeleteChat(chat)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[#1a1f27] to-[#0f1419] border border-[#374151] text-[11px] text-[#f87171] hover:bg-gradient-to-br hover:from-[#dc2626] hover:to-[#b91c1c] hover:text-white hover:shadow-[0_0_20px_rgba(248,113,113,0.8)] hover:scale-110 active:scale-90 transition-all duration-300"
                      aria-label="Delete chat"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}
            {chats.length === 0 && (
              <p className="text-xs text-[#6b7280] px-3">No chats yet. Start a new one.</p>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center gap-2 px-1 py-3">
          <button
            onClick={onNewChat}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0e7490] to-[#22d3ee] text-white text-xl font-bold leading-none shadow-cyan hover:shadow-cyan hover:scale-110 active:scale-90 transition-all duration-300"
            title="New chat"
          >
            ＋
          </button>
        </div>
      )}
    </div>
  );
}
