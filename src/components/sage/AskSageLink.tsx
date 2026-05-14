"use client";

import Link from "next/link";
import { ChatCircle } from "@phosphor-icons/react";

interface AskSageLinkProps {
  prompt: string;
  label?: string;
  className?: string;
  variant?: "button" | "subtle" | "ghost";
}

const variantStyles: Record<NonNullable<AskSageLinkProps["variant"]>, string> = {
  button: "primary-button px-4 py-2.5 text-sm",
  subtle:
    "rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm text-[var(--ink-strong)] hover:bg-[var(--surface-interactive)]",
  ghost:
    "rounded-full px-3 py-2 text-sm text-[var(--accent-secondary)] hover:bg-[var(--surface-muted)]",
};

export default function AskSageLink({
  prompt,
  label = "Ask Sage",
  className = "",
  variant = "subtle",
}: AskSageLinkProps) {
  return (
    <Link
      href={`/chat?prompt=${encodeURIComponent(prompt)}`}
      prefetch={false}
      className={`inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap font-semibold transition ${variantStyles[variant]} ${className}`}
    >
      <ChatCircle size={17} weight="bold" />
      {label}
    </Link>
  );
}
