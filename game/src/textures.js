// CINDERQUAY procedural textures — every texture is drawn on a canvas at
// build time. No network, no external files. Neutral-grey bases are used
// for container / concrete / crate so the palette colour multiplies cleanly.
import * as THREE from 'three';

// Deterministic RNG so the yard looks the same on every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, repeat) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

// ---- ground: asphalt yard 65.2 x 49.2 m, markings painted in -------------
// Canvas mapping: x = (wx + 32.6) * sx, y = (wz + 24.6) * sz. For the +y face
// of BoxGeometry, canvas top row is the north edge (-z), so no flip needed.
export const GROUND_W = 65.2;
export const GROUND_D = 49.2;

export function createGroundTexture() {
  const W = 1024, H = 768;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(1337);
  const sx = W / GROUND_W, sz = H / GROUND_D;
  const X = (wx) => (wx + GROUND_W / 2) * sx;
  const Z = (wz) => (wz + GROUND_D / 2) * sz;

  // Asphalt base — clearly lighter than the old flat #33302e.
  g.fillStyle = '#4a4640';
  g.fillRect(0, 0, W, H);

  // Large soft patches (repairs / wear).
  for (let i = 0; i < 26; i++) {
    const px = rnd() * W, py = rnd() * H, r = 40 + rnd() * 130;
    const grad = g.createRadialGradient(px, py, 0, px, py, r);
    const dark = rnd() > 0.5;
    grad.addColorStop(0, dark ? 'rgba(38,35,32,0.10)' : 'rgba(96,90,82,0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
  }

  // Aggregate speckle.
  for (let i = 0; i < 9000; i++) {
    const v = rnd();
    g.fillStyle = v > 0.6 ? 'rgba(150,140,128,0.10)'
      : v > 0.3 ? 'rgba(20,18,16,0.12)' : 'rgba(120,112,100,0.08)';
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }

  // Cracks: jagged dark random walks.
  g.strokeStyle = 'rgba(28,26,23,0.55)';
  for (let i = 0; i < 16; i++) {
    let px = rnd() * W, py = rnd() * H;
    let ang = rnd() * Math.PI * 2;
    g.lineWidth = 1 + rnd() * 1.6;
    g.beginPath(); g.moveTo(px, py);
    const steps = 6 + Math.floor(rnd() * 10);
    for (let s = 0; s < steps; s++) {
      ang += (rnd() - 0.5) * 1.4;
      px += Math.cos(ang) * (8 + rnd() * 18);
      py += Math.sin(ang) * (8 + rnd() * 18);
      g.lineTo(px, py);
    }
    g.stroke();
  }

  // Tyre marks: dark translucent S-curves down the three lanes.
  g.strokeStyle = 'rgba(22,20,18,0.16)';
  g.lineCap = 'round';
  for (const laneX of [-20, 0, 20]) {
    for (let k = 0; k < 4; k++) {
      const off = (rnd() - 0.5) * 1.6;
      g.lineWidth = 5 + rnd() * 6;
      g.beginPath();
      for (let wz = -14; wz <= 18; wz += 2) {
        const wx = laneX + off + Math.sin(wz * 0.35 + k) * 0.35;
        if (wz === -14) g.moveTo(X(wx), Z(wz)); else g.lineTo(X(wx), Z(wz));
      }
      g.stroke();
    }
  }

  // Oil stains.
  for (let i = 0; i < 12; i++) {
    const px = rnd() * W, py = rnd() * H, r = 12 + rnd() * 30;
    const grad = g.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, 'rgba(15,14,12,0.22)');
    grad.addColorStop(1, 'rgba(15,14,12,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
  }

  // ---- painted markings (worn yellow) ------------------------------------
  const YELLOW = 'rgba(201,154,46,0.85)';
  g.fillStyle = YELLOW;
  g.strokeStyle = YELLOW;

  // Lane centre lines: dashed, x = -20 / 0 / 20, z -12..16.
  for (const laneX of [-20, 0, 20]) {
    for (let wz = -12; wz < 16; wz += 4.4) {
      g.fillRect(X(laneX - 0.18), Z(wz), 0.36 * sx, 2.2 * sz);
    }
  }
  // Connector dashes: z = 8 and z = -6, x -15..15.
  for (const cz of [8, -6]) {
    for (let wx = -15; wx < 15; wx += 4) {
      g.fillRect(X(wx), Z(cz - 0.18), 2 * sx, 0.36 * sz);
    }
  }
  // Site pads: outline + faint fill + team centre square + stencil letter.
  function sitePad(cx, cz, teamColor, letter) {
    const s = 6.8, half = s / 2;
    g.fillStyle = 'rgba(201,154,46,0.07)';
    g.fillRect(X(cx - half), Z(cz - half), s * sx, s * sz);
    g.lineWidth = 0.3 * sx;
    g.strokeRect(X(cx - half), Z(cz - half), s * sx, s * sz);
    g.fillStyle = teamColor;
    g.globalAlpha = 0.8;
    g.fillRect(X(cx - 1.1), Z(cz - 1.1), 2.2 * sx, 2.2 * sz);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(30,24,20,0.75)';
    g.font = `bold ${Math.round(1.7 * sx)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, X(cx), Z(cz) + 1);
  }
  sitePad(-22, -14, '#ff8c2e', 'A');
  sitePad(22, -14, '#2ec4b6', 'B');
  // Spawn zone strips.
  g.fillStyle = 'rgba(255,140,46,0.8)';
  g.fillRect(X(-8.5), Z(20 - 0.25), 17 * sx, 0.5 * sz);
  g.fillStyle = 'rgba(46,196,182,0.8)';
  g.fillRect(X(-8.5), Z(-20 - 0.25), 17 * sx, 0.5 * sz);

  // Light wear pass over everything so paint looks used, not fresh.
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = 'rgba(74,70,64,0.10)';
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3);
  }

  return toTexture(c);
}

// ---- container: vertical corrugation ribs + rust + stencil ----------------
export function createContainerTexture() {
  const W = 256, H = 256;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(4242);
  g.fillStyle = '#c9c9c9';
  g.fillRect(0, 0, W, H);

  // Corrugated ribs: vertical stripes, shadow / highlight / mid.
  for (let x = 0; x < W; x += 16) {
    g.fillStyle = '#9d9d9d'; g.fillRect(x, 0, 3, H);
    g.fillStyle = '#e4e4e4'; g.fillRect(x + 3, 0, 5, H);
    g.fillStyle = '#b5b5b5'; g.fillRect(x + 8, 0, 8, H);
  }
  // Top + bottom rails.
  g.fillStyle = '#8f8f8f';
  g.fillRect(0, 0, W, 14); g.fillRect(0, H - 14, W, 14);
  g.fillStyle = '#6f6f6f';
  for (let x = 8; x < W; x += 32) {
    g.beginPath(); g.arc(x, 7, 2.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x, H - 7, 2.5, 0, Math.PI * 2); g.fill();
  }
  // Rust streaks dripping from the top rail.
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W, len = 20 + rnd() * 90, w = 3 + rnd() * 6;
    const grad = g.createLinearGradient(0, 14, 0, 14 + len);
    grad.addColorStop(0, 'rgba(122,72,38,0.35)');
    grad.addColorStop(1, 'rgba(122,72,38,0)');
    g.fillStyle = grad;
    g.fillRect(x, 14, w, len);
  }
  // Rust blotches near the bottom.
  for (let i = 0; i < 8; i++) {
    const px = rnd() * W, py = H - 14 - rnd() * 50, r = 6 + rnd() * 16;
    const grad = g.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, 'rgba(110,62,30,0.28)');
    grad.addColorStop(1, 'rgba(110,62,30,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
  }
  // Stencil: unit number + capacity, faded.
  g.fillStyle = 'rgba(235,235,235,0.75)';
  g.font = 'bold 17px monospace';
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('CQRU 482 110-7', 22, 96);
  g.font = '13px monospace';
  g.fillStyle = 'rgba(235,235,235,0.55)';
  g.fillText('MAX 30 480 KG', 22, 122);
  g.fillText('TARE  2 240 KG', 22, 142);
  // Corner castings.
  g.fillStyle = '#7c7c7c';
  g.fillRect(0, 0, 16, 16); g.fillRect(W - 16, 0, 16, 16);
  g.fillRect(0, H - 16, 16, 16); g.fillRect(W - 16, H - 16, 16, 16);

  return toTexture(c);
}

// ---- concrete: panel seams + stains (neutral, tinted by palette) ---------
export function createConcreteTexture() {
  const W = 256, H = 256;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(777);
  g.fillStyle = '#b8b3ac';
  g.fillRect(0, 0, W, H);

  for (let i = 0; i < 2200; i++) {
    const v = rnd();
    g.fillStyle = v > 0.5 ? 'rgba(90,84,76,0.08)' : 'rgba(230,225,215,0.08)';
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // Panel seams (2 x 2 panels) + tie holes.
  g.strokeStyle = '#6e6862';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, W - 3, H - 3);
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.fillStyle = '#5d5750';
  for (const [x, y] of [[32, 32], [224, 32], [32, 224], [224, 224], [128, 32], [128, 224], [32, 128], [224, 128]]) {
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
  }
  // Damp stains from the bottom.
  for (let i = 0; i < 7; i++) {
    const px = rnd() * W, py = H - rnd() * 70, r = 20 + rnd() * 45;
    const grad = g.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, 'rgba(70,64,56,0.14)');
    grad.addColorStop(1, 'rgba(70,64,56,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
  }
  // Hairline crack.
  g.strokeStyle = 'rgba(60,55,48,0.5)';
  g.lineWidth = 1.2;
  g.beginPath();
  let px = 40 + rnd() * 60, py = 0;
  g.moveTo(px, py);
  while (py < H) { py += 14 + rnd() * 16; px += (rnd() - 0.5) * 26; g.lineTo(px, py); }
  g.stroke();

  return toTexture(c);
}

// ---- crate: wood planks + frame (neutral, tinted by palette) -------------
export function createCrateTexture() {
  const W = 256, H = 256;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(99);
  g.fillStyle = '#cdbfa4';
  g.fillRect(0, 0, W, H);

  // Horizontal planks.
  for (let y = 0; y < H; y += 64) {
    g.fillStyle = y % 128 === 0 ? '#c4b493' : '#d3c5ab';
    g.fillRect(0, y, W, 64);
    // Wood grain strokes.
    g.strokeStyle = 'rgba(122,100,66,0.20)';
    g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const gy = y + 6 + rnd() * 52;
      g.beginPath(); g.moveTo(0, gy);
      g.bezierCurveTo(W * 0.3, gy + (rnd() - 0.5) * 8, W * 0.7, gy + (rnd() - 0.5) * 8, W, gy);
      g.stroke();
    }
    g.fillStyle = '#7a6a4e';
    g.fillRect(0, y, W, 3);
  }
  // Frame border + diagonal brace.
  g.fillStyle = '#a08a64';
  g.fillRect(0, 0, W, 16); g.fillRect(0, H - 16, W, 16);
  g.fillRect(0, 0, 16, H); g.fillRect(W - 16, 0, 16, H);
  g.save();
  g.translate(W / 2, H / 2); g.rotate(Math.PI / 4);
  g.fillStyle = 'rgba(160,138,100,0.55)';
  g.fillRect(-W * 0.75, -9, W * 1.5, 18);
  g.restore();
  // Nails.
  g.fillStyle = '#4a4034';
  for (const [x, y] of [[10, 10], [W - 10, 10], [10, H - 10], [W - 10, H - 10], [10, 128], [W - 10, 128]]) {
    g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
  }

  return toTexture(c);
}

// ---- radial glow (sun sprite, lamp glow, beacon glow) ---------------------
export function createGlowTexture() {
  const S = 128;
  const [c, g] = makeCanvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return toTexture(c);
}

// ---- horizon haze band: transparent top -> warm haze at the bottom --------
export function createHazeTexture() {
  const W = 32, H = 128;
  const [c, g] = makeCanvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(216,130,70,0)');
  grad.addColorStop(0.55, 'rgba(216,130,70,0.20)');
  grad.addColorStop(1, 'rgba(216,130,70,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  return toTexture(c);
}
