"use client";

export default function TypingIndicator() {
  return (
    <div className="flex gap-3" role="status" aria-label="Sage is typing">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(249,115,22,0.18),rgba(255,255,255,0.92))] text-sm font-bold text-[var(--accent-strong)] shadow-[0_12px_28px_rgba(16,37,62,0.12)]">
        S
      </div>
      <div className="rounded-[1.4rem] rounded-bl-md border border-white/55 bg-[rgba(255,255,255,0.82)] px-4 py-3 backdrop-blur">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--muted)] animate-bounce [animation-delay:0ms]" />
          <span className="h-2 w-2 rounded-full bg-[var(--muted)] animate-bounce [animation-delay:150ms]" />
          <span className="h-2 w-2 rounded-full bg-[var(--muted)] animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
