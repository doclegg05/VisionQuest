import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONFETTI_PARTICLES_PER_BURST, createConfettiEngine } from "./confetti";

function fakeCanvas() {
  const calls = { clearRect: 0, fillRect: 0 };
  const ctx = {
    fillStyle: "",
    clearRect: () => { calls.clearRect += 1; },
    fillRect: () => { calls.fillRect += 1; },
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { canvas: canvas as unknown as HTMLCanvasElement, calls };
}

function fakeFrames() {
  let nextId = 1;
  const queue = new Map<number, () => void>();
  const cancelled: number[] = [];
  return {
    requestFrame: (cb: () => void) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancelFrame: (id: number) => {
      cancelled.push(id);
      queue.delete(id);
    },
    run: () => {
      const pending = [...queue.values()];
      queue.clear();
      for (const cb of pending) cb();
    },
    pending: () => queue.size,
    cancelled,
  };
}

// Deterministic LCG so particle velocities never depend on Math.random.
function seededRandom(seed = 7) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const viewport = () => ({ width: 100, height: 100 });

function engineWith(frames: ReturnType<typeof fakeFrames>, canvas: HTMLCanvasElement | null) {
  return createConfettiEngine({
    getCanvas: () => canvas,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    random: seededRandom(),
    getViewport: viewport,
  });
}

describe("createConfettiEngine (F36: per-instance state)", () => {
  it("keeps particles per engine so a burst on one never lands on another", () => {
    const frames = fakeFrames();
    const a = engineWith(frames, fakeCanvas().canvas);
    const b = engineWith(frames, fakeCanvas().canvas);

    a.burst(50, 50);
    assert.equal(a.particleCount(), CONFETTI_PARTICLES_PER_BURST);
    assert.equal(b.particleCount(), 0, "engine B must not see engine A's particles");
    assert.equal(b.isAnimating(), false);

    b.burst(50, 50);
    assert.equal(a.particleCount(), CONFETTI_PARTICLES_PER_BURST);
    assert.equal(b.particleCount(), CONFETTI_PARTICLES_PER_BURST);
    assert.equal(frames.pending(), 2, "each engine drives its own frame loop");
  });

  it("restarts cleanly for a second celebration after the first one finishes", () => {
    const frames = fakeFrames();
    const { canvas, calls } = fakeCanvas();
    const engine = engineWith(frames, canvas);

    engine.burst(50, 50);
    let guard = 0;
    while (engine.isAnimating() && guard < 5000) {
      frames.run();
      guard += 1;
    }
    assert.equal(engine.isAnimating(), false, "first celebration should finish");
    assert.equal(engine.particleCount(), 0);
    const clearsAfterFirst = calls.clearRect;
    assert.ok(clearsAfterFirst > 0, "canvas is cleared when the first celebration ends");

    engine.burst(20, 20);
    assert.equal(engine.isAnimating(), true, "second celebration starts a fresh loop");
    assert.equal(engine.particleCount(), CONFETTI_PARTICLES_PER_BURST, "second burst starts from an empty set");
    assert.equal(frames.pending(), 1);
  });

  it("dispose cancels the pending frame and drops every particle", () => {
    const frames = fakeFrames();
    const { canvas, calls } = fakeCanvas();
    const engine = engineWith(frames, canvas);

    engine.burst(50, 50);
    frames.run();
    const drawsBeforeDispose = calls.fillRect;
    assert.equal(frames.pending(), 1);

    engine.dispose();
    assert.equal(frames.cancelled.length, 1, "the queued frame is cancelled");
    assert.equal(frames.pending(), 0);
    assert.equal(engine.particleCount(), 0);
    assert.equal(engine.isAnimating(), false);

    frames.run();
    assert.equal(calls.fillRect, drawsBeforeDispose, "nothing draws after dispose");
  });

  it("does nothing when there is no canvas to draw on", () => {
    const frames = fakeFrames();
    const engine = engineWith(frames, null);
    engine.burst(10, 10);
    assert.equal(engine.particleCount(), 0);
    assert.equal(engine.isAnimating(), false);
    assert.equal(frames.pending(), 0);
  });
});
