import { useEffect, useRef } from 'react';
import MessageList from './MessageList.jsx';
import ChatInput from './ChatInput.jsx';

export default function ChatWindow({
  chat,
  onSendMessage,
  isWaiting = false,
  isBusy = false,
  mode = 'dev_buddy',
  onModeChange,
}) {
  const scrollRef = useRef(null);
  const lastMessageContent = chat?.messages?.[chat.messages.length - 1]?.content;

  useEffect(() => {
    if (!chat || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chat?.id, chat?.messages?.length, lastMessageContent, isWaiting]);

  const hasMessages = chat && chat.messages && chat.messages.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-[#050608] via-[#0a0a0a] to-[#050608]">
      <header className="h-14 border-b border-[#1f2933] px-4 md:px-8 flex items-center justify-between glass-effect-strong shadow-elevated animate-fadeIn">
        <div className="flex-1" />
        <div className="flex flex-1 items-center justify-end gap-2 text-xs text-[#e5e7eb]">
          <button
            type="button"
            className="rounded-full border border-[#374151] bg-gradient-to-r from-[#0a0e14] to-[#0f1419] px-3 py-1.5 text-xs text-[#e5e7eb] hover:border-[#22d3ee] hover:shadow-cyan transition-all duration-300 transform hover:scale-105"
          >
            Share
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#374151] bg-gradient-to-br from-[#1a1f27] to-[#0f1419] text-lg text-[#e5e7eb] hover:border-[#22d3ee] hover:shadow-cyan transition-all duration-300 transform hover:scale-105"
            aria-label="More options"
          >
            ⋯
          </button>
        </div>
      </header>

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 bg-gradient-to-b from-[#050608] via-[#0a0a0a] to-[#050608]"
      >
        {chat ? (
          hasMessages ? (
            <>
              <MessageList messages={chat.messages} />
              {isWaiting && (
                <div className="mx-auto mt-4 flex w-full max-w-2xl justify-start animate-fadeIn">
                  <div className="flex w-full gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0a0e14] to-[#164e63] border border-[#22d3ee]/50 text-[11px] font-medium text-[#e5e7eb]">
                      AI
                    </div>
                    <div className="max-w-[65%] w-fit rounded-2xl px-4 py-2.5 text-[13px] text-[#9ca3af] border border-[#1f2933] bg-gradient-to-r from-[#0a0e14] to-[#0f1419] shadow-cyan">
                      <span className="mr-2">AI is thinking</span>
                      <span className="inline-flex items-center gap-1 align-middle">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] animate-bounce" />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] animate-bounce"
                          style={{ animationDelay: '120ms' }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] animate-bounce"
                          style={{ animationDelay: '240ms' }}
                        />
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center animate-fadeIn">
              <div className="max-w-xl text-center text-[#6b7280]">
                <h2 className="mb-3 text-3xl font-bold bg-gradient-to-r from-[#22d3ee] to-[#0e7490] bg-clip-text text-transparent animate-shimmer">
                  Start a new chat
                </h2>
                <p className="mb-6 text-sm">
                  This is a purely frontend mock of a ChatGPT-like interface. Try one of these
                  prompts:
                </p>
                <div className="grid gap-3 text-left text-sm md:grid-cols-2">
                  {[
                    'Explain React hooks like I am a beginner.',
                    'Give me 3 ideas for a weekend project.',
                    'Help me write a short email to my manager.',
                    'Explain what a large language model is.',
                  ].map((prompt, index) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => onSendMessage && onSendMessage(prompt)}
                      className="rounded-xl border border-[#374151] bg-gradient-to-br from-[#0a0e14] to-[#0f1419] px-4 py-3 text-left text-[#e5e7eb] hover:border-[#22d3ee] hover:shadow-cyan hover:scale-[1.02] transition-all duration-300 transform animate-fadeIn cursor-pointer"
                      style={{ animationDelay: `${index * 0.1}s` }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="h-full flex items-center justify-center text-[#6b7280] text-sm">
            Select or create a chat from the sidebar to get started.
          </div>
        )}
      </main>

      <footer className="border-t border-[#1f2933] glass-effect-strong backdrop-blur px-4 py-3 md:px-6 shadow-elevated">
        <ChatInput
          key={chat?.id ?? 'no-chat'}
          onSend={onSendMessage}
          disabled={!chat || isBusy}
          autoFocus={true}
        />
      </footer>
    </div>
  );
}
