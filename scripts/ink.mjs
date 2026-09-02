// 今日山色 — a generative ink landscape, one per day.
// Port of the header painter from 听风闲语 (defiabell.github.io): same seed → same picture.
// Zero DOM dependencies; renders with @napi-rs/canvas and writes PNGs into assets/.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';

// ---- deterministic randomness (xmur3 hash + mulberry32) ----
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hexToRgb = (hex) => {
  const s = hex.trim().replace('#', '');
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;

// ---- 1-D value noise + fbm: where the ridgelines come from ----
function valueNoise1D(rng) {
  const lattice = [];
  const at = (i) => { while (lattice.length <= i) lattice.push(rng()); return lattice[i]; };
  return (x) => { const i = Math.floor(x); const f = x - i; const s = f * f * (3 - 2 * f); return at(i) * (1 - s) + at(i + 1) * s; };
}
function fbm(rng, octaves) {
  const layers = Array.from({ length: octaves }, () => valueNoise1D(rng));
  return (x) => { let v = 0, amp = 0.5, freq = 1, norm = 0; for (const n of layers) { v += n(x * freq) * amp; norm += amp; amp *= 0.5; freq *= 2.1; } return v / norm; };
}
// mist: destination-out bands/blobs wash the ink back toward paper
function eraseBand(ctx, w, y0, y1, strength) {
  ctx.save(); ctx.globalCompositeOperation = 'destination-out';
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, `rgba(0,0,0,${strength})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, y0, w, y1 - y0); ctx.restore();
}
function eraseBlob(ctx, x, y, r, strength) {
  ctx.save(); ctx.globalCompositeOperation = 'destination-out';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

export function paintScene(ctx, w, h, seed, pal, opts = {}) {
  const rng = mulberry32(seed);
  const { ink, paper, seal, moon, night } = pal;
  const mini = !!opts.mini;
  ctx.clearRect(0, 0, w, h);
  const waterY = h * (0.72 + rng() * 0.06);
  const layerCount = mini ? 2 : 3 + Math.floor(rng() * 2);

  // sky: stars and a moon at night; by day, sometimes a pale red sun
  if (night) {
    const starN = (mini ? 8 : 18) + Math.floor(rng() * (mini ? 8 : 20));
    for (let i = 0; i < starN; i++) { ctx.fillStyle = rgba(moon, 0.15 + rng() * 0.4); ctx.beginPath(); ctx.arc(rng() * w, rng() * h * 0.5, 0.4 + rng() * 0.7, 0, Math.PI * 2); ctx.fill(); }
    const mx = w * (0.1 + rng() * 0.8), my = h * (0.13 + rng() * 0.1), mr = h * (0.06 + rng() * 0.03);
    const glow = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 4);
    glow.addColorStop(0, rgba(moon, 0.28)); glow.addColorStop(1, rgba(moon, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(mx, my, mr * 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(moon, 0.95); ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    if (rng() < 0.5) eraseBlob(ctx, mx + mr * 0.55, my - mr * 0.3, mr * 0.95, 0.9);
  } else if (rng() < 0.35) {
    const sx = w * (0.12 + rng() * 0.76), sy = h * (0.14 + rng() * 0.1), sr = h * (0.055 + rng() * 0.025);
    ctx.fillStyle = rgba(seal, 0.16); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
  }

  // mountains, far to near
  let nearRidge = null;
  for (let k = 0; k < layerCount; k++) {
    const depth = layerCount === 1 ? 1 : k / (layerCount - 1);
    const col = mix(ink, paper, night ? 0.82 - depth * 0.32 : 0.72 - depth * 0.6);
    const ridgeNoise = fbm(rng, 4), envNoise = fbm(rng, 2);
    const footY = waterY - depth * h * 0.02 + (rng() - 0.5) * h * 0.04;
    const ampPx = h * (0.58 - depth * 0.22) * (0.85 + rng() * 0.4);
    const cycles = 2.2 + rng() * 2, xoff = rng() * 8, eoff = rng() * 8, capY = h * 0.09;
    const ridgeAt = (x) => { const xn = x / w; const shape = Math.pow(ridgeNoise(xn * cycles + xoff), 1.4); const env = envNoise(xn * 1.2 + eoff); return Math.max(footY - shape * (0.42 + env * 0.95) * ampPx, capY); };
    const top = footY - ampPx;
    const grad = ctx.createLinearGradient(0, Math.max(top, capY), 0, waterY);
    grad.addColorStop(0, rgba(col, night ? 0.6 : 0.88)); grad.addColorStop(1, rgba(col, night ? 0.08 : 0.1));
    ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(0, ridgeAt(0));
    for (let x = 2; x <= w; x += 2) ctx.lineTo(x, ridgeAt(x));
    ctx.lineTo(w, waterY); ctx.lineTo(0, waterY); ctx.closePath(); ctx.fill();
    // dry-brush flecks along the ridge
    for (let x = 0; x <= w; x += 5) {
      if (rng() < 0.55) continue;
      const y = ridgeAt(x); if (y > waterY - h * 0.05) continue;
      const slope = (ridgeAt(x + 4) - ridgeAt(x - 4)) / 8;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan(slope));
      ctx.fillStyle = rgba(col, 0.08 + rng() * 0.14); ctx.beginPath(); ctx.ellipse(0, rng() * 3 - 1, 3 + rng() * 8, 1 + rng() * 1.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (k < layerCount - 1 && rng() < 0.75) { const y0 = h * (0.36 + rng() * 0.18); eraseBand(ctx, w, y0, y0 + h * (0.1 + rng() * 0.12), 0.35 + rng() * 0.2); }
    if (k === layerCount - 1) nearRidge = ridgeAt;
  }
  eraseBand(ctx, w, waterY - h * 0.05, waterY + h * 0.06, 0.4 + rng() * 0.15);
  const blobN = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < blobN; i++) eraseBlob(ctx, rng() * w, h * (0.4 + rng() * 0.22), h * (0.12 + rng() * 0.14), 0.28 + rng() * 0.22);

  // moss dots on the nearest ridge
  if (nearRidge && !mini) {
    const darkest = mix(ink, paper, night ? 0.3 : 0.04), dotAlpha = night ? 0.12 : 0.25;
    const clusterN = 4 + Math.floor(rng() * 5);
    for (let c = 0; c < clusterN; c++) {
      const cx = rng() * w, cy = nearRidge(cx); if (cy > waterY - h * 0.07) continue;
      const dotN = 3 + Math.floor(rng() * 7);
      for (let i = 0; i < dotN; i++) { ctx.fillStyle = rgba(darkest, dotAlpha + rng() * (night ? 0.15 : 0.35)); ctx.beginPath(); ctx.arc(cx + (rng() - 0.5) * 22, cy + rng() * 10 - 2, 0.7 + rng() * 1.4, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  // water
  const waterCol = mix(ink, paper, 0.5);
  const strokeN = (mini ? 6 : 14) + Math.floor(rng() * (mini ? 5 : 12));
  for (let i = 0; i < strokeN; i++) { const t = rng() * rng(); const y = waterY + t * (h - waterY) * 0.85 + 2; const len = (1 - t) * (30 + rng() * 70) + 12; ctx.fillStyle = rgba(waterCol, 0.05 + (1 - t) * 0.09); ctx.fillRect(rng() * (w - len), y, len, 1 + rng() * 0.6); }
  // a lone boat, in about four paintings out of ten
  if (!mini && rng() < 0.42) {
    const bx = w * (0.18 + rng() * 0.64), by = waterY + (h - waterY) * (0.2 + rng() * 0.3), bw = 9 + rng() * 4;
    const dark = mix(ink, paper, 0.08);
    ctx.fillStyle = rgba(dark, 0.85); ctx.beginPath(); ctx.moveTo(bx - bw, by); ctx.quadraticCurveTo(bx, by + bw * 0.55, bx + bw, by); ctx.quadraticCurveTo(bx, by + bw * 0.18, bx - bw, by); ctx.fill();
    ctx.beginPath(); ctx.arc(bx - bw * 0.15, by - 3.2, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx - bw * 0.15, by - 2); ctx.quadraticCurveTo(bx + 1.5, by - 1, bx + 2.5, by); ctx.quadraticCurveTo(bx - 2.5, by + 0.5, bx - bw * 0.15, by - 2); ctx.fill();
    ctx.strokeStyle = rgba(dark, 0.7); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(bx + 1.5, by - 6); ctx.lineTo(bx + 3.5, by + 4); ctx.stroke();
    for (let i = 0; i < 3; i++) { ctx.fillStyle = rgba(dark, 0.12 - i * 0.03); ctx.fillRect(bx - bw * (0.8 - i * 0.2), by + 3 + i * 3, bw * (1.6 - i * 0.4), 1); }
  }
  // birds
  if (!mini && rng() < 0.65) {
    const flockN = 1 + Math.floor(rng() * 4), fx = w * (0.15 + rng() * 0.7), fy = h * (0.12 + rng() * 0.16);
    ctx.strokeStyle = rgba(mix(ink, paper, 0.15), 0.6); ctx.lineWidth = 1;
    for (let i = 0; i < flockN; i++) { const x = fx + (rng() - 0.5) * 70, y = fy + (rng() - 0.5) * 26, s = 2.6 + rng() * 2.2; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.8, x, y); ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.8, x + s, y); ctx.stroke(); }
  }
  // paper grain
  const grainN = mini ? 0 : Math.floor(w * 0.12);
  for (let i = 0; i < grainN; i++) { ctx.fillStyle = rgba(ink, 0.015 + rng() * 0.02); ctx.beginPath(); ctx.arc(rng() * w, rng() * h, 0.4 + rng() * 0.8, 0, Math.PI * 2); ctx.fill(); }
  // the seal
  if (mini) return;
  const s = 15, px = w - s - 14, py = h - s - 14;
  ctx.save(); ctx.translate(px + s / 2, py + s / 2); ctx.rotate(-0.05);
  ctx.fillStyle = rgba(seal, 0.88);
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, 2); ctx.fill(); } else { ctx.fillRect(-s / 2, -s / 2, s, s); }
  ctx.strokeStyle = 'rgba(245,239,226,.8)'; ctx.lineWidth = 1; ctx.strokeRect(-s / 2 + 2.5, -s / 2 + 2.5, s - 5, s - 5);
  ctx.beginPath(); ctx.moveTo(0, -s / 2 + 2.5); ctx.lineTo(0, s / 2 - 2.5); ctx.stroke(); ctx.restore();
}

// ---- palettes: the blog's paper/ink tokens, day and night ----
const DAY = { paper: hexToRgb('#F1F3EF'), ink: hexToRgb('#23262B'), seal: hexToRgb('#C0392F'), moon: hexToRgb('#EFE9D6'), night: false };
const NIGHT = { paper: hexToRgb('#161B26'), ink: hexToRgb('#E8E6DD'), seal: hexToRgb('#D8574B'), moon: hexToRgb('#EFE9D6'), night: true };

function todayInShanghai() {
  if (process.env.INK_DATE) return process.env.INK_DATE;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function render(pal, file, date) {
  const W = 830, H = 180, DPR = 2;
  // paint the scene on its own layer (the painter clears and erases through to transparency),
  // then lay it on paper: the PNG has no page behind it, so the paper tone must be baked in
  const scene = createCanvas(W * DPR, H * DPR);
  const sctx = scene.getContext('2d');
  sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  paintScene(sctx, W, H, hashSeed(`feng-ink:${date}#0`), pal);
  const canvas = createCanvas(W * DPR, H * DPR);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = rgba(pal.paper, 1); ctx.fillRect(0, 0, W * DPR, H * DPR);
  ctx.drawImage(scene, 0, 0);
  writeFileSync(file, canvas.toBuffer('image/png'));
  console.log(`wrote ${file} (${date}${pal.night ? ', night' : ''})`);
}

const date = todayInShanghai();
mkdirSync('assets', { recursive: true });
render(DAY, 'assets/ink-today.png', date);
render(NIGHT, 'assets/ink-today-dark.png', date);
writeFileSync('assets/ink-date.txt', date + '\n');
