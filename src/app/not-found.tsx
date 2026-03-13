import Link from "next/link";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center px-4 text-center"
    >
      <h1 className="font-[family-name:var(--font-display)] text-6xl font-bold text-[var(--ink-strong)]">
        404
      </h1>
      <p className="mt-3 text-lg text-[var(--muted)]">
        Page not found. It may have been moved or doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white
                   transition hover:bg-[var(--accent-strong)]"
      >
        Back to Home
      </Link>
    </main>
  );
}
