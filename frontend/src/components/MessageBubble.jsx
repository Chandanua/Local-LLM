import { useState } from 'react';

export default function MessageBubble({
  message,
  isFirstInGroup = true,
  showTimestamp = true,
}) {
  const isUser = message.role === 'user';
  const timestamp = message.createdAt;
  const sources = Array.isArray(message.sources) ? message.sources : null;
  const hasSources = !isUser && sources && sources.length > 0;

  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={`flex w-full flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`flex w-full gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'
          }`}
      >
        {isFirstInGroup ? (
          <div
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold shadow-md ${isUser
              ? 'bg-gradient-to-br from-[#374151] to-[#1f2937] text-[#e5e7eb] border border-[#4b5563]'
              : 'bg-gradient-to-br from-[#22d3ee]/30 to-[#a78bfa]/30 text-[#f9fafb] border border-[#22d3ee]/50 shadow-cyan'
              }`}
          >
            {isUser ? 'U' : 'AI'}
          </div>
        ) : (
          <div className="h-9 w-9 flex-shrink-0" />
        )}
        <div
          className={`max-w-[65%] w-fit rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words shadow-md transition-all duration-300 hover:shadow-lg animate-fadeIn relative group ${isUser
            ? 'bg-gradient-to-br from-[#1a1f27] to-[#0f1419] text-[#f9fafb] border border-[#374151] hover:border-[#4b5563]'
            : 'bg-gradient-to-br from-[#0a0e14] to-[#0f1419] text-[#e5e7eb] border border-[#374151] hover:border-[#22d3ee]/50'
            }`}
        >
          {message.content}
          {!isUser && (
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-all duration-300 p-1.5 rounded-lg bg-gradient-to-br from-[#0a0e14] to-[#0f1419] border border-[#374151] hover:border-[#22d3ee] hover:shadow-cyan transform hover:scale-110 active:scale-95"
              title={copied ? 'Copied!' : 'Copy message'}
            >
              {copied ? (
                <svg className="w-4 h-4 text-[#22d3ee]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-[#9ca3af] hover:text-[#22d3ee]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
      {hasSources && (
        <div className="w-full pl-11 animate-fadeIn">
          <div className="mt-2 max-w-[65%] rounded-xl border border-[#374151] bg-gradient-to-br from-[#0a0e14]/90 to-[#0f1419]/90 px-3 py-2.5 text-xs text-[#9ca3af] shadow-md backdrop-blur">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#22d3ee]">
              Sources
            </div>
            <div className="space-y-1.5">
              {sources.map((src, index) => {
                const fileLabel = src?.file || 'Unknown file';
                const kindLabel = src?.kind || 'document';
                const rawPreview = typeof src?.preview === 'string' ? src.preview : '';
                const trimmedPreview = rawPreview.trim();
                const previewText =
                  trimmedPreview.length > 0
                    ? trimmedPreview.length > 200
                      ? `${trimmedPreview.slice(0, 200)}…`
                      : trimmedPreview
                    : 'No preview available.';

                return (
                  <details
                    key={`${fileLabel}-${index}`}
                    className="group rounded-lg border border-transparent px-2 py-1.5 text-[11px] hover:border-[#22d3ee]/50 hover:bg-[#0a0e14]/50 cursor-pointer transition-all duration-300"
                  >
                    <summary className="flex list-none items-center justify-between gap-2 text-[11px] text-[#e5e7eb]">
                      <span className="truncate font-medium">{fileLabel}</span>
                      <span className="flex items-center gap-1 text-[10px] text-[#9ca3af]">
                        <span className="rounded-full border border-[#374151] px-1.5 py-0.5 uppercase tracking-wide">
                          {kindLabel}
                        </span>
                        <span className="text-[#6b7280] group-open:rotate-180 transition-transform">
                          ▾
                        </span>
                      </span>
                    </summary>
                    <div className="mt-1.5 whitespace-pre-wrap break-words text-[11px] text-[#d1d5db]">
                      {previewText}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {showTimestamp && timestamp && (
        <div
          className={`text-[10px] text-[#6b7280] ${isUser ? 'pr-11 text-right' : 'pl-11 text-left'
            }`}
        >
          {timestamp}
        </div>
      )}
    </div>
  );
}
