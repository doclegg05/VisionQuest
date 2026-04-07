"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";

// ─── Types ──────────────────────────────────────────────────────────────────

interface MountainProgressProps {
  readinessScore: number;
  readinessBreakdown: ReadinessBreakdown;
  level: number;
}

interface Milestone {
  key: keyof ReadinessBreakdown;
  label: string;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
  life: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MILESTONES: Milestone[] = [
  { key: "orientation",    label: "Base Camp",       x: 0.22, y: 0.88 },
  { key: "goalPlanning",   label: "First Ridge",     x: 0.30, y: 0.72 },
  { key: "bhagAchieved",   label: "Tree Line",       x: 0.40, y: 0.56 },
  { key: "certifications", label: "Rocky Face",      x: 0.52, y: 0.40 },
  { key: "portfolio",      label: "Above Clouds",    x: 0.56, y: 0.26 },
  { key: "consistency",    label: "Summit",           x: 0.50, y: 0.10 },
];

const SKY_PALETTES = [
  { stop: 0,   top: [10, 22, 40],   bottom: [26, 42, 74] },   // night
  { stop: 30,  top: [26, 42, 74],   bottom: [61, 79, 124] },   // pre-dawn
  { stop: 50,  top: [50, 80, 140],  bottom: [135, 160, 200] }, // dawn
  { stop: 75,  top: [74, 124, 184], bottom: [170, 210, 235] }, // day
  { stop: 100, top: [135, 206, 235], bottom: [240, 194, 127] }, // golden
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function lerpColor(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function getSkyColors(score: number): { top: string; bottom: string } {
  let lower = SKY_PALETTES[0];
  let upper = SKY_PALETTES[SKY_PALETTES.length - 1];
  for (let i = 0; i < SKY_PALETTES.length - 1; i++) {
    if (score >= SKY_PALETTES[i].stop && score <= SKY_PALETTES[i + 1].stop) {
      lower = SKY_PALETTES[i];
      upper = SKY_PALETTES[i + 1];
      break;
    }
  }
  const t = upper.stop === lower.stop ? 0 : (score - lower.stop) / (upper.stop - lower.stop);
  return {
    top: lerpColor(lower.top, upper.top, t),
    bottom: lerpColor(lower.bottom, upper.bottom, t),
  };
}

function getPointOnPath(t: number, points: { x: number; y: number }[]): { x: number; y: number } {
  const n = points.length - 1;
  const seg = Math.min(Math.floor(t * n), n - 1);
  const local = t * n - seg;
  return {
    x: points[seg].x + (points[seg + 1].x - points[seg].x) * local,
    y: points[seg].y + (points[seg + 1].y - points[seg].y) * local,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MountainProgress({
  readinessScore,
  readinessBreakdown,
  level,
}: MountainProgressProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const sizeRef = useRef({ w: 800, h: 320 });
  const scoreRef = useRef(readinessScore);
  const animScoreRef = useRef(readinessScore);
  const particlesRef = useRef<Particle[]>([]);
  const reducedMotion = useRef(false);
  const [activeMilestone, setActiveMilestone] = useState<Milestone | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Keep score ref in sync
  scoreRef.current = readinessScore;

  // ─── Resize ─────────────────────────────────────────────────────────────

  const handleResize = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const h = rect.width < 640 ? 200 : rect.width < 768 ? 260 : 320;

    sizeRef.current = { w: rect.width, h };
    canvas.width = rect.width * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  // ─── Init particles ───────────────────────────────────────────────────

  function initParticles(w: number, h: number): Particle[] {
    const particles: Particle[] = [];
    const count = w < 640 ? 8 : 16;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: h * 0.15 + Math.random() * h * 0.35,
        vx: 0.15 + Math.random() * 0.3,
        vy: (Math.random() - 0.5) * 0.05,
        alpha: 0.08 + Math.random() * 0.12,
        size: 30 + Math.random() * 50,
        life: Math.random() * 1000,
      });
    }
    return particles;
  }

  // ─── Draw functions ───────────────────────────────────────────────────

  function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, score: number) {
    const { top, bottom } = getSkyColors(score);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, score: number, t: number) {
    if (score > 55) return;
    const alpha = Math.max(0, (55 - score) / 55);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    const seed = 42;
    for (let i = 0; i < 30; i++) {
      const px = ((seed * (i + 1) * 137) % 1000) / 1000 * w;
      const py = ((seed * (i + 1) * 239) % 1000) / 1000 * h * 0.5;
      const twinkle = reducedMotion.current ? 0.7 : 0.4 + 0.6 * Math.sin(t * 0.02 + i * 1.7);
      ctx.globalAlpha = alpha * twinkle;
      ctx.beginPath();
      ctx.arc(px, py, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFarMountains(ctx: CanvasRenderingContext2D, w: number, h: number) {
    // Far ridge 1
    ctx.fillStyle = "rgba(40,55,90,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.55);
    ctx.quadraticCurveTo(w * 0.15, h * 0.35, w * 0.3, h * 0.45);
    ctx.quadraticCurveTo(w * 0.45, h * 0.55, w * 0.6, h * 0.4);
    ctx.quadraticCurveTo(w * 0.75, h * 0.28, w * 0.85, h * 0.42);
    ctx.lineTo(w, h * 0.5);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Far ridge 2
    ctx.fillStyle = "rgba(30,45,75,0.4)";
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.6);
    ctx.quadraticCurveTo(w * 0.2, h * 0.5, w * 0.35, h * 0.55);
    ctx.quadraticCurveTo(w * 0.55, h * 0.62, w * 0.7, h * 0.48);
    ctx.quadraticCurveTo(w * 0.9, h * 0.38, w, h * 0.55);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }

  function drawMainMountain(ctx: CanvasRenderingContext2D, w: number, h: number) {
    // Mountain body
    const grad = ctx.createLinearGradient(w * 0.5, h * 0.05, w * 0.5, h);
    grad.addColorStop(0, "rgb(70,85,110)");
    grad.addColorStop(0.3, "rgb(55,70,95)");
    grad.addColorStop(0.7, "rgb(40,55,75)");
    grad.addColorStop(1, "rgb(28,40,60)");
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(w * 0.08, h);
    ctx.lineTo(w * 0.20, h * 0.65);
    ctx.quadraticCurveTo(w * 0.30, h * 0.45, w * 0.40, h * 0.30);
    ctx.quadraticCurveTo(w * 0.45, h * 0.15, w * 0.50, h * 0.06);
    ctx.quadraticCurveTo(w * 0.55, h * 0.15, w * 0.60, h * 0.28);
    ctx.quadraticCurveTo(w * 0.70, h * 0.45, w * 0.80, h * 0.60);
    ctx.lineTo(w * 0.92, h);
    ctx.closePath();
    ctx.fill();

    // Snow cap
    ctx.fillStyle = "rgba(220,230,245,0.85)";
    ctx.beginPath();
    ctx.moveTo(w * 0.44, h * 0.20);
    ctx.quadraticCurveTo(w * 0.47, h * 0.10, w * 0.50, h * 0.06);
    ctx.quadraticCurveTo(w * 0.53, h * 0.10, w * 0.56, h * 0.20);
    ctx.quadraticCurveTo(w * 0.52, h * 0.22, w * 0.48, h * 0.22);
    ctx.closePath();
    ctx.fill();
  }

  function drawTrail(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    points: { x: number; y: number }[],
    progress: number,
  ) {
    // Draw the full trail path (faded)
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw the completed portion (bright)
    if (progress > 0) {
      const litGrad = ctx.createLinearGradient(0, h, 0, 0);
      litGrad.addColorStop(0, "rgba(255,200,100,0.8)");
      litGrad.addColorStop(1, "rgba(255,255,200,0.9)");
      ctx.strokeStyle = litGrad;
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgba(255,200,100,0.4)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);

      const totalSegs = points.length - 1;
      const litSegs = progress * totalSegs;

      for (let i = 1; i <= Math.min(Math.ceil(litSegs), totalSegs); i++) {
        if (i <= Math.floor(litSegs)) {
          ctx.lineTo(points[i].x, points[i].y);
        } else {
          const frac = litSegs - Math.floor(litSegs);
          const px = points[i - 1].x + (points[i].x - points[i - 1].x) * frac;
          const py = points[i - 1].y + (points[i].y - points[i - 1].y) * frac;
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function drawMilestones(
    ctx: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    breakdown: ReadinessBreakdown,
    t: number,
  ) {
    for (let i = 0; i < MILESTONES.length; i++) {
      const m = MILESTONES[i];
      const dim = breakdown[m.key];
      const complete = dim.score >= dim.max;
      const px = points[i].x;
      const py = points[i].y;

      if (complete) {
        // Glow
        const pulse = reducedMotion.current ? 1 : 0.85 + 0.15 * Math.sin(t * 0.03 + i);
        ctx.shadowColor = "rgba(255,200,80,0.6)";
        ctx.shadowBlur = 10 * pulse;
        ctx.fillStyle = "rgba(255,210,100,0.95)";
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (dim.score > 0) {
        // Partial — amber outline with fill proportional to progress
        ctx.strokeStyle = "rgba(255,200,100,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.stroke();
        // Partial fill
        const pct = dim.score / dim.max;
        ctx.fillStyle = `rgba(255,210,100,${0.3 + pct * 0.5})`;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Not started — dim outline
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = complete ? "rgba(255,230,160,0.9)" : "rgba(255,255,255,0.45)";
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(m.label, px + 10, py + 4);
    }
  }

  function drawClimber(
    ctx: CanvasRenderingContext2D,
    pos: { x: number; y: number },
    t: number,
  ) {
    const bob = reducedMotion.current ? 0 : Math.sin(t * 0.04) * 2;
    const cx = pos.x;
    const cy = pos.y + bob - 12;

    // Flag pole
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 12);
    ctx.lineTo(cx, cy - 4);
    ctx.stroke();

    // Flag
    ctx.fillStyle = "rgba(255,120,50,0.9)";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx + 10, cy - 1);
    ctx.lineTo(cx, cy + 2);
    ctx.closePath();
    ctx.fill();

    // Glow
    ctx.shadowColor = "rgba(255,150,50,0.5)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(255,180,80,0.3)";
    ctx.beginPath();
    ctx.arc(cx, cy + 4, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], w: number) {
    for (const p of particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = "rgba(220,230,245,0.6)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size, p.size * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      if (!reducedMotion.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.life += 1;
        if (p.x > w + p.size) {
          p.x = -p.size;
          p.y = p.y + (Math.random() - 0.5) * 20;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawScoreBadge(ctx: CanvasRenderingContext2D, w: number, h: number, score: number, lvl: number) {
    const bx = 16;
    const by = h - 16;
    // Background
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.roundRect(bx, by - 38, 90, 42, 12);
    ctx.fill();
    // Score
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(score)}%`, bx + 10, by - 10);
    // Label
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "600 9px system-ui, sans-serif";
    ctx.fillText(`LVL ${lvl} READINESS`, bx + 10, by + 2);
  }

  // ─── Animation loop ───────────────────────────────────────────────────

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mql.matches;
    const handler = (e: MediaQueryListEvent) => { reducedMotion.current = e.matches; };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    handleResize();
    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);

    particlesRef.current = initParticles(sizeRef.current.w, sizeRef.current.h);

    let t = 0;
    function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { w, h } = sizeRef.current;
      t += 1;

      // Lerp animated score toward target
      const target = scoreRef.current;
      animScoreRef.current += (target - animScoreRef.current) * 0.02;
      const score = animScoreRef.current;
      const progress = Math.max(0, Math.min(1, score / 100));

      // Scale milestone positions
      const points = MILESTONES.map((m) => ({ x: m.x * w, y: m.y * h }));

      // Draw all layers
      ctx.clearRect(0, 0, w, h);
      drawSky(ctx, w, h, score);
      drawStars(ctx, w, h, score, t);
      drawFarMountains(ctx, w, h);
      drawMainMountain(ctx, w, h);
      drawParticles(ctx, particlesRef.current, w);
      drawTrail(ctx, w, h, points, progress);
      drawMilestones(ctx, points, readinessBreakdown, t);

      const climberPos = getPointOnPath(progress, points);
      drawClimber(ctx, climberPos, t);
      drawScoreBadge(ctx, w, h, score, level);

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readinessBreakdown, level]);

  // ─── Hit detection for tooltips ───────────────────────────────────────

  const handlePointer = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
      const clientY = "touches" in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const { w, h } = sizeRef.current;

      let found: Milestone | null = null;
      for (const m of MILESTONES) {
        const dx = m.x * w - mx;
        const dy = m.y * h - my;
        if (dx * dx + dy * dy < 20 * 20) {
          found = m;
          setTooltipPos({ x: m.x * w, y: m.y * h });
          break;
        }
      }
      setActiveMilestone(found);
    },
    [],
  );

  const handleLeave = useCallback(() => setActiveMilestone(null), []);

  // ─── Compute completed count ──────────────────────────────────────────

  const completedCount = MILESTONES.filter(
    (m) => readinessBreakdown[m.key].score >= readinessBreakdown[m.key].max,
  ).length;

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative w-full select-none">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Mountain climb progress: ${Math.round(readinessScore)}% complete. ${completedCount} of 6 milestones reached.`}
        className="block w-full rounded-[1.5rem]"
        onMouseMove={handlePointer}
        onTouchStart={handlePointer}
        onMouseLeave={handleLeave}
      />

      {/* Tooltip overlay */}
      {activeMilestone && (
        <div
          className="pointer-events-none absolute z-10 rounded-xl border border-white/20 bg-[rgba(10,20,40,0.85)] px-3 py-2 text-xs text-white shadow-lg"
          style={{
            top: tooltipPos.y,
            left: tooltipPos.x,
            transform: "translate(-50%, -120%)",
          }}
        >
          <p className="font-semibold">{activeMilestone.label}</p>
          <p className="mt-0.5 text-white/60">
            {readinessBreakdown[activeMilestone.key].score} / {readinessBreakdown[activeMilestone.key].max} pts
          </p>
        </div>
      )}

      {/* Screen reader text */}
      <div className="sr-only">
        <h3>Mountain Climb Progress</h3>
        <p>Overall readiness: {Math.round(readinessScore)}%</p>
        <ul>
          {MILESTONES.map((m) => {
            const dim = readinessBreakdown[m.key];
            return (
              <li key={m.key}>
                {m.label}: {dim.score}/{dim.max} points
                {dim.score >= dim.max ? " (complete)" : ""}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
