// Seeded RNG for CINDERQUAY. Every gameplay roll goes through the rng passed
// in from state — never Math.random() — so a round can be replayed exactly
// from its seed.

// mulberry32: small, fast, well-distributed 32-bit PRNG. Returns a function
// that yields a float in [0, 1) on each call.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform float in [a, b).
export function randRange(rng, a, b) {
  return a + rng() * (b - a);
}

// One element of arr, uniformly at random.
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
