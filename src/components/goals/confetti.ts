/**
 * Per-instance confetti engine (F36 / FE-01). Each engine owns its own
 * particle list and frame handle, so two celebrations, or two mounted
 * components, cannot overwrite each other's animation state. Particles are
 * replaced, never mutated, on every frame.
 */

export interface ConfettiEngineOptions {
  getCanvas: () => HTMLCanvasElement | null;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (id: number) => void;
  random?: () => number;
  getViewport?: () => { width: number; height: number };
}

export interface ConfettiEngine {
  /** Spawn a burst at viewport coordinates and start the loop if idle. */
  burst(x: number, y: number): void;
  /** Cancel the pending frame and drop every particle. Call on unmount. */
  dispose(): void;
  particleCount(): number;
  isAnimating(): boolean;
}

interface Particle {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly color: string;
  readonly size: number;
  readonly rotation: number;
  readonly rotationSpeed: number;
}

export const CONFETTI_PARTICLES_PER_BURST = 40;

const COLORS = ["#37b550", "#2a8a3c", "#007baf", "#d3b257", "#ad8806"];
const GRAVITY = 0.2;
const FRICTION = 0.97;
const UPWARD_BIAS = 2.5;

function spawn(x: number, y: number, random: () => number): Particle {
  const angle = random() * Math.PI * 2;
  const speed = 3 + random() * 5;
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - UPWARD_BIAS,
    color: COLORS[Math.floor(random() * COLORS.length)],
    size: 5 + random() * 5,
    rotation: random() * Math.PI * 2,
    rotationSpeed: -0.1 + random() * 0.2,
  };
}

function step(p: Particle): Particle {
  return {
    ...p,
    x: p.x + p.vx,
    y: p.y + p.vy,
    vy: p.vy + GRAVITY,
    vx: p.vx * FRICTION,
    rotation: p.rotation + p.rotationSpeed,
  };
}

function onScreen(p: Particle, width: number, height: number): boolean {
  return p.y <= height && p.x >= 0 && p.x <= width;
}

function draw(ctx: CanvasRenderingContext2D, p: Particle) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.fillStyle = p.color;
  ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
  ctx.restore();
}

export function createConfettiEngine(options: ConfettiEngineOptions): ConfettiEngine {
  const requestFrame = options.requestFrame ?? ((callback) => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((id) => window.cancelAnimationFrame(id));
  const random = options.random ?? Math.random;
  const getViewport = options.getViewport ?? (() => ({ width: window.innerWidth, height: window.innerHeight }));

  let particles: readonly Particle[] = [];
  let frameId: number | null = null;

  function target(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    const canvas = options.getCanvas();
    const ctx = canvas?.getContext("2d") ?? null;
    return canvas && ctx ? { canvas, ctx } : null;
  }

  function frame() {
    frameId = null;
    const current = target();
    if (!current) {
      particles = [];
      return;
    }
    const { canvas, ctx } = current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.map(step).filter((p) => onScreen(p, canvas.width, canvas.height));
    for (const p of particles) draw(ctx, p);
    if (particles.length > 0) {
      frameId = requestFrame(frame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  return {
    burst(x, y) {
      const current = target();
      if (!current) return;
      const { width, height } = getViewport();
      current.canvas.width = width;
      current.canvas.height = height;
      particles = [
        ...particles,
        ...Array.from({ length: CONFETTI_PARTICLES_PER_BURST }, () => spawn(x, y, random)),
      ];
      if (frameId === null) frameId = requestFrame(frame);
    },
    dispose() {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      particles = [];
      const current = target();
      current?.ctx.clearRect(0, 0, current.canvas.width, current.canvas.height);
    },
    particleCount: () => particles.length,
    isAnimating: () => frameId !== null,
  };
}
