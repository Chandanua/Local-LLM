import { useEffect, useRef, useState } from 'react';

export default function ChatInput({ onSend, disabled, autoFocus = false }) {
  const [value, setValue] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedModel, setSelectedModel] = useState('dev_buddy');
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (autoFocus && !disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus, disabled]);

  const autoResizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 160; // px, roughly 8-10 lines
    const newHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${newHeight}px`;
  };

  useEffect(() => {
    if (disabled) {
      setIsLocked(false);
      setIsMenuOpen(false);
    }
  }, [disabled]);

  const handleSend = async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isLocked) return;
    setIsLocked(true);

    if (attachments.length > 0) {
      try {
        const formData = new FormData();
        attachments.forEach((att) => {
          if (att.file) {
            formData.append('files', att.file, att.name);
          }
        });

        const res = await fetch('/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok && typeof console !== 'undefined') {
          console.error('Attachment upload failed with status', res.status);
        }
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.error('Attachment upload error', err);
        }
      }
    }

    let finalText = trimmed;
    if (attachments.length > 0) {
      const summaryLines = attachments.map((att, index) => {
        const kind = att.kind === 'screenshot' ? 'screenshot' : 'file';
        return `${index + 1}. (${kind}) ${att.name}`;
      });
      const header = 'Attachments:';
      finalText = `${header}\n${summaryLines.join('\n')}\n\n${trimmed}`;
    }

    onSend(finalText);
    setValue('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setTimeout(() => {
      setIsLocked(false);
    }, 400);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (value) {
        e.preventDefault();
        setValue('');
        setIsLocked(false);
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePlusClick = () => {
    if (disabled) return;
    setIsMenuOpen((prev) => !prev);
  };

  const handleFilesSelected = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const now = Date.now();
    setAttachments((prev) => [
      ...prev,
      ...files.map((file, index) => ({
        id: `${now}-${index}-${file.name}`,
        name: file.name,
        size: file.size,
        type: file.type,
        kind: 'file',
        file,
      })),
    ]);
    event.target.value = '';
    setIsMenuOpen(false);
  };

  const handleRemoveAttachment = (id) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  const handlePaste = (event) => {
    if (!event.clipboardData) return;

    const files = Array.from(event.clipboardData.files || []).filter((file) =>
      file.type.startsWith('image/')
    );

    if (!files.length) return;

    event.preventDefault();
    const now = Date.now();
    setAttachments((prev) => [
      ...prev,
      ...files.map((file, index) => ({
        id: `${now}-paste-${index}-${file.name || 'screenshot'}`,
        name: file.name || `pasted-screenshot-${now}.png`,
        size: file.size,
        type: file.type,
        kind: 'screenshot',
        file,
      })),
    ]);
  };

  const handleTextareaChange = (e) => {
    setValue(e.target.value);
    autoResizeTextarea();
  };

  const handleTakeScreenshot = async () => {
    if (disabled || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setIsMenuOpen(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise((resolve) => {
        if (video.readyState >= 2) {
          resolve();
        } else {
          video.onloadeddata = () => resolve();
        }
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      const blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      video.pause();
      stream.getTracks().forEach((t) => t.stop());
      if (!blob) {
        setIsMenuOpen(false);
        return;
      }
      const file = new File([blob], `screenshot-${Date.now()}.png`, {
        type: 'image/png',
      });
      const now = Date.now();
      setAttachments((prev) => [
        ...prev,
        {
          id: `${now}-screenshot`,
          name: file.name,
          size: file.size,
          type: file.type,
          kind: 'screenshot',
          file,
        },
      ]);
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.error('Screenshot capture failed', error);
      }
    } finally {
      setIsMenuOpen(false);
    }
  };

  const handleMicClick = () => {
    if (disabled || isLocked) return;

    const trimmed = value.trim();

    // If there's already text, keep the existing behavior: send on click.
    if (trimmed) {
      handleSend();
      return;
    }

    const SpeechRecognition =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

    if (!SpeechRecognition) {
      // Fallback: behave like the old button (attempt to send).
      handleSend();
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.continuous = false;

      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((r) => r[0]?.transcript || '')
          .join(' ')
          .trim();

        if (transcript) {
          setValue((prev) => {
            const next = prev ? `${prev} ${transcript}` : transcript;
            // Defer resizing until after React updates the DOM.
            setTimeout(autoResizeTextarea, 0);
            return next;
          });
        }
        setIsRecording(false);
      };

      recognition.onerror = () => {
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }

    const recognition = recognitionRef.current;

    if (isRecording) {
      try {
        recognition.stop();
      } catch (err) {
        // ignore stop errors
      }
      return;
    }

    try {
      setIsRecording(true);
      recognition.start();
    } catch (err) {
      setIsRecording(false);
    }
  };

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-2xl flex flex-col gap-1">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11px] text-[#e5e7eb] animate-fadeIn">
            {attachments.map((att) => (
              <button
                key={att.id}
                type="button"
                onClick={() => handleRemoveAttachment(att.id)}
                className="flex items-center gap-1.5 rounded-3xl border border-[#374151] bg-gradient-to-r from-[#0a0e14] to-[#0f1419] px-3 py-1 hover:border-[#22d3ee] hover:shadow-cyan transition-all duration-300 transform hover:scale-105"
              >
                <span className="text-[9px] font-bold uppercase text-[#22d3ee]">
                  {att.kind === 'screenshot' ? 'SC' : 'FILE'}
                </span>
                <span className="max-w-[140px] truncate">{att.name}</span>
                <span className="text-[#9ca3af] text-[12px] font-bold">×</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex w-full items-center gap-3 rounded-3xl border border-[#374151] bg-gradient-to-r from-[#0a0e14] via-[#0f1419] to-[#0a0e14] px-3 py-2 shadow-lg focus-within:border-[#22d3ee] focus-within:shadow-cyan transition-all duration-300">
          {/* Model Selector Button - Inside Textbox */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
              className="flex items-center gap-1 px-2 py-1 rounded-xl bg-[#0f1419] border border-[#374151] text-[#9ca3af] text-xs hover:border-[#22d3ee] hover:text-[#22d3ee] transition-all duration-300"
            >
              <span className="max-w-[120px] truncate">{selectedModel.replace('_', ' ')}</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            {isModelMenuOpen && (
              <div className="absolute left-0 bottom-full mb-2 z-20 w-56 rounded-2xl border border-[#374151]/90 glass-effect-strong py-2 text-xs text-[#e5e7eb] shadow-elevated backdrop-blur-xl animate-scaleIn">
                <div className="pointer-events-none absolute left-4 -bottom-1.5 h-3 w-3 rotate-45 border-l border-b border-[#374151]/80 glass-effect transform rotate-45" />
                {[
                  { value: 'mentor', label: 'Mentor Mode' },
                  { value: 'code_reviewer', label: 'Code Reviewer Mode' },
                  { value: 'debugger', label: 'Debugger Mode' },
                  { value: 'optimizer', label: 'Optimizer Mode' },
                  { value: 'dev_buddy', label: 'Dev Buddy Mode' }
                ].map((model) => (
                  <button
                    key={model.value}
                    type="button"
                    onClick={() => {
                      setSelectedModel(model.value);
                      setIsModelMenuOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 hover:bg-[#1a1f27] transition-colors ${selectedModel === model.value ? 'bg-[#0f1419] text-[#22d3ee]' : ''
                      }`}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[#374151] bg-gradient-to-br from-[#1a1f27] via-[#0a0e14] to-[#0f1419] text-lg font-bold text-[#22d3ee] shadow-cyan transition-all duration-300 hover:scale-110 hover:shadow-[0_0_30px_rgba(34,211,238,0.7)] active:scale-95 ${isMenuOpen
                ? 'rotate-45 text-[#22d3ee] shadow-[0_0_30px_rgba(34,211,238,0.9)] scale-110'
                : ''
                }`}
              disabled={disabled}
              onClick={handlePlusClick}
            >
              <span className="mt-[-2px]">+</span>
            </button>
            {isMenuOpen && !disabled && (
              <div className="absolute left-0 bottom-full mb-2 z-20 w-56 rounded-3xl border border-[#374151]/90 glass-effect-strong py-2 text-xs text-[#e5e7eb] shadow-elevated backdrop-blur-xl animate-scaleIn">
                <div className="pointer-events-none absolute left-4 -bottom-1.5 h-3 w-3 rotate-45 border-l border-b border-[#374151]/80 glass-effect" />
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gradient-to-r hover:from-[#22d3ee]/10 hover:to-transparent transition-all duration-300"
                  onClick={() => {
                    if (fileInputRef.current) fileInputRef.current.click();
                  }}
                >
                  <span className="text-[16px]">📎</span>
                  <span className="font-medium">Add media (file/image)</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gradient-to-r hover:from-[#22d3ee]/10 hover:to-transparent transition-all duration-300"
                  onClick={handleTakeScreenshot}
                >
                  <span className="text-[16px]">📸</span>
                  <span className="font-medium">Take screenshot</span>
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
          </div>
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none bg-transparent px-1 py-1 text-sm text-[#f3f4f6] placeholder:text-[#6b7280] focus:outline-none overflow-y-auto"
            rows={1}
            placeholder={disabled ? 'Select a chat to start messaging' : 'Ask anything'}
            value={value}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={handleMicClick}
            disabled={disabled || isLocked}
            className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0e7490] to-[#22d3ee] text-sm font-medium text-white shadow-cyan transition-all duration-300 hover:shadow-cyan hover:scale-110 active:scale-90 ${isRecording
              ? 'bg-gradient-to-br from-[#dc2626] to-[#b91c1c] shadow-[0_0_20px_rgba(220,38,38,0.8)] animate-pulse scale-110'
              : 'disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
          >
            🎤
          </button>
        </div>
      </div>
    </div>
  );
}
