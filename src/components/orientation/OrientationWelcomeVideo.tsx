export default function OrientationWelcomeVideo() {
  return (
    <section
      aria-labelledby="orientation-welcome-title"
      className="surface-section mb-6 overflow-hidden p-5 sm:p-6"
    >
      <div className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent-secondary)]">
          Meet Sage
        </p>
        <h2 id="orientation-welcome-title" className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
          Welcome to VisionQuest
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          Watch this one-minute introduction whenever you like. It is here to help you get oriented and does not replace any required orientation steps.
        </p>
      </div>

      <video
        className="mt-5 aspect-video w-full rounded-xl bg-black shadow-sm"
        controls
        playsInline
        preload="metadata"
      >
        <source src="/media/sage-welcome-orientation.mp4" type="video/mp4" />
        <track
          kind="captions"
          src="/media/sage-welcome-orientation.vtt"
          srcLang="en"
          label="English"
          default
        />
        Your browser does not support the welcome video. You can download it below.
      </video>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <a
          href="/media/sage-welcome-orientation.mp4"
          download
          className="font-semibold text-[var(--accent-secondary)] hover:underline"
        >
          Download the welcome video
        </a>
        <details className="text-[var(--ink-muted)]">
          <summary className="cursor-pointer font-semibold text-[var(--accent-secondary)] hover:underline">
            Read the welcome transcript
          </summary>
          <div className="mt-3 max-w-3xl space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-6">
            <p>Welcome to VisionQuest — your starting point for building a path toward your goals.</p>
            <p>Through SPOKES, you&apos;ll have the support, skills, and structure to move forward — whether you&apos;re preparing for work, continuing your education, or building more stability for yourself and your family.</p>
            <p>I&apos;m Sage. I&apos;m here to guide you, answer your questions, and help you stay on track.</p>
            <p>Your Dashboard is your home base. Set goals that matter to you, track your progress, and always see what comes next.</p>
            <p>Together, we&apos;ll find the courses and opportunities that fit your goals — and keep you moving toward your SPOKES Ready to Work Certification.</p>
            <p>And whenever you need me, just tap my symbol to start a chat.</p>
            <p>One clear next step at a time. Every step you take matters — and you don&apos;t have to figure it out alone.</p>
            <p>Welcome to VisionQuest. Let&apos;s begin building your path forward.</p>
          </div>
        </details>
      </div>
    </section>
  );
}
