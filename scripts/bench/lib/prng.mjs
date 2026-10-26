// =============================================================================
// A seeded pseudo-random generator for the benchmark fixtures.
//
// mulberry32: 32 bits of state, one multiply-shift round, and — the only
// property that matters here — the same sequence on every machine and every
// Node version, forever. `Math.random()` would make the synthetic cohort a
// different cohort on every run, and a benchmark whose corpus moves is not a
// benchmark.
//
// Kept in its own module because the cohort generator, the label file and the
// explanation fixtures all draw from it and must not share one stream: each
// constructs its own generator from its own named seed, so adding a student
// cannot shift the wage in an unrelated fixture.
// =============================================================================

/**
 * Fold a string seed into the 32-bit integer mulberry32 wants.
 *
 * FNV-1a rather than a hand-rolled sum: two seed names that differ only by a
 * character transposition ("students" / "studnets") must not collide into the
 * same stream, and a plain character sum does exactly that.
 */
export function seedFromString(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A generator: `rng()` yields [0, 1), plus the helpers the fixtures use. */
export function createRng(seed) {
  let state = (typeof seed === "string" ? seedFromString(seed) : seed) >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** An integer in [min, max], inclusive at both ends. */
  next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  /** One element, or undefined for an empty list. */
  next.pick = (items) => items[Math.floor(next() * items.length)];
  /** True with probability `p`. */
  next.chance = (p) => next() < p;
  /**
   * `count` distinct elements, in the source order.
   *
   * Source order rather than shuffled order on purpose: a fixture diff should
   * read as "this student gained a skill", not as a reshuffle of the whole
   * list, and nothing downstream depends on the order being random.
   */
  next.sample = (items, count) => {
    const wanted = Math.min(count, items.length);
    const chosen = new Set();
    // Bounded: at most 20 draws per wanted element, then fill in order. A
    // rejection loop with no bound is a hang waiting for a bad seed.
    for (let attempts = 0; chosen.size < wanted && attempts < wanted * 20; attempts += 1) {
      chosen.add(next.int(0, items.length - 1));
    }
    for (let index = 0; chosen.size < wanted; index += 1) chosen.add(index);
    return [...chosen].sort((a, b) => a - b).map((index) => items[index]);
  };

  return next;
}
