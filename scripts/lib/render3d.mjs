/**
 * Tiny headless renderer for documentation pictures: z-buffered triangles
 * with flat two-sided shading and depth-tested feature lines, 2× supersampled,
 * written as PNG. No WebGL, no dependencies beyond node:zlib.
 */
import { deflateSync } from "node:zlib";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => mul(a, 1 / Math.hypot(...a));

/**
 * Camera looking at a sphere (center, radius) from direction `dir`
 * (pointing from the target toward the eye), sized to fit.
 */
export function fitCamera(center, radius, dir, { fovDeg = 30, up = [0, 0, 1], pad = 1.08 } = {}) {
  const fov = (fovDeg * Math.PI) / 180;
  const dist = (radius * pad) / Math.sin(fov / 2);
  return { eye: add(center, mul(unit(dir), dist)), target: center, up, fov };
}

/** Bounding sphere (centroid-based) of a list of points. */
export function boundingSphere(points) {
  const c = mul(points.reduce(add, [0, 0, 0]), 1 / points.length);
  return { center: c, radius: Math.sqrt(Math.max(...points.map((p) => dot(sub(p, c), sub(p, c))))) };
}

/**
 * @param {{ tris: {pts:number[][], color:number[]}[], lines: {a:number[], b:number[], color:number[]}[] }} scene
 * @param {{ eye:number[], target:number[], up:number[], fov:number }} cam
 * @returns {Buffer} PNG bytes
 */
export function renderPng(scene, cam, { width = 900, height = 680, ss = 2, background = [250, 249, 245], lineWidth = 1.2 } = {}) {
  const W = width * ss, H = height * ss;
  const f = unit(sub(cam.target, cam.eye));
  let r = cross(f, cam.up);
  if (Math.hypot(...r) < 1e-6) r = cross(f, [0, 1, 0]);
  r = unit(r);
  const u = cross(r, f);
  const focal = H / 2 / Math.tan(cam.fov / 2);
  const near = 1e-3;
  const light = unit(add(add(mul(f, -1), mul(u, 0.7)), mul(r, -0.45)));

  const color = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) color.set(background, i * 3);
  const zbuf = new Float32Array(W * H); // stores 1/z, 0 = empty

  const project = (p) => {
    const d = sub(p, cam.eye), z = dot(d, f);
    return [W / 2 + (dot(d, r) / z) * focal, H / 2 - (dot(d, u) / z) * focal, 1 / z, z];
  };

  for (const t of scene.tris) {
    const [a, b, c] = t.pts;
    let n = cross(sub(b, a), sub(c, a));
    const nl = Math.hypot(...n);
    if (nl < 1e-12) continue;
    n = mul(n, 1 / nl);
    if (dot(n, sub(cam.eye, a)) < 0) n = mul(n, -1);
    const shade = 0.42 + 0.58 * Math.max(0, dot(n, light));
    const col = t.color.map((x) => x * shade);
    const P = [a, b, c].map(project);
    if (P.some((q) => q[3] < near)) continue;
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area;
        const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const iz = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2];
        const k = y * W + x;
        if (iz <= zbuf[k]) continue;
        zbuf[k] = iz;
        color[k * 3] = col[0];
        color[k * 3 + 1] = col[1];
        color[k * 3 + 2] = col[2];
      }
    }
  }

  // Lines: drawn where they are at (or a hair behind) the visible surface.
  const lw = lineWidth * ss, half = lw / 2;
  for (const l of scene.lines) {
    const A = project(l.a), B = project(l.b);
    if (A[3] < near || B[3] < near) continue;
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const x = A[0] + (B[0] - A[0]) * s, y = A[1] + (B[1] - A[1]) * s, iz = A[2] + (B[2] - A[2]) * s;
      for (let oy = -half; oy <= half; oy++) {
        for (let ox = -half; ox <= half; ox++) {
          const xx = Math.round(x + ox), yy = Math.round(y + oy);
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const k = yy * W + xx;
          if (zbuf[k] && iz < zbuf[k] * (1 - 2.5e-3)) continue;
          color.set(l.color, k * 3);
        }
      }
    }
  }

  // Downsample and encode.
  const out = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    out[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) s += color[((y * ss + sy) * W + x * ss + sx) * 3 + ch];
        out[y * (width * 3 + 1) + 1 + x * 3 + ch] = Math.max(0, Math.min(255, Math.round(s / (ss * ss))));
      }
    }
  }
  return png(width, height, out);
}

function png(width, height, raw) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
