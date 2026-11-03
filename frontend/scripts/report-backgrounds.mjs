// Draws the report's five ready-made backgrounds (2400×1600 JPEG) and their
// 360×240 thumbnails, into public/report-backgrounds/. They are drawn in code so
// they are our own and can be adjusted; their boxes and colours are in
// src/lib/reportPresets.ts. The canvas package is only needed to run this:
//
//   npm install --no-save @napi-rs/canvas
//   node scripts/report-backgrounds.mjs public/report-backgrounds
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';

const [, , outDir] = process.argv;
const W = 2400;
const H = 1600;
mkdirSync(`${outDir}/thumbs`, { recursive: true });

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvas() {
  const c = createCanvas(W, H);
  return [c, c.getContext('2d')];
}

/** Fine paper grain: thousands of faint specks. */
function grain(g, color, count = 60000, alpha = 0.035) {
  g.save();
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    g.globalAlpha = alpha * (0.4 + rand());
    const s = 0.6 + rand() * 1.6;
    g.fillRect(rand() * W, rand() * H, s, s);
  }
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A ribbon banner with swallowtail ends, centred at (cx, cy). */
function ribbon(g, cx, cy, w, h, fill, edge) {
  const notch = h * 0.42;
  const tail = h * 0.55;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  // Tails behind, a little lower and darker.
  for (const dir of [-1, 1]) {
    const ex = dir < 0 ? x0 : x1;
    g.beginPath();
    g.moveTo(ex - dir * 40, cy - h / 2 + 28);
    g.lineTo(ex + dir * tail, cy - h / 2 + 28);
    g.lineTo(ex + dir * (tail - notch * 0.8), cy + 28);
    g.lineTo(ex + dir * tail, cy + h / 2 + 28);
    g.lineTo(ex - dir * 40, cy + h / 2 + 28);
    g.closePath();
    g.fillStyle = shade(fill, -0.28);
    g.fill();
    g.strokeStyle = edge;
    g.lineWidth = 4;
    g.stroke();
  }
  const grad = g.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  grad.addColorStop(0, shade(fill, 0.12));
  grad.addColorStop(0.5, fill);
  grad.addColorStop(1, shade(fill, -0.15));
  g.beginPath();
  g.moveTo(x0, cy - h / 2);
  g.quadraticCurveTo(cx, cy - h / 2 - 26, x1, cy - h / 2);
  g.lineTo(x1, cy + h / 2);
  g.quadraticCurveTo(cx, cy + h / 2 - 26, x0, cy + h / 2);
  g.closePath();
  g.save();
  g.shadowColor = 'rgba(60,20,0,0.35)';
  g.shadowBlur = 24;
  g.shadowOffsetY = 8;
  g.fillStyle = grad;
  g.fill();
  g.restore();
  g.strokeStyle = edge;
  g.lineWidth = 6;
  g.stroke();
  // A fine inner line.
  g.beginPath();
  g.moveTo(x0 + 16, cy - h / 2 + 14);
  g.quadraticCurveTo(cx, cy - h / 2 - 12, x1 - 16, cy - h / 2 + 14);
  g.lineTo(x1 - 16, cy + h / 2 - 14);
  g.quadraticCurveTo(cx, cy + h / 2 - 40, x0 + 16, cy + h / 2 - 14);
  g.closePath();
  g.lineWidth = 2;
  g.stroke();
}

/** "#rrggbb" lighter (amount > 0) or darker (< 0). */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)),
  );
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A Greek-key (hồi văn) band along a rectangle's edges, in a band `size` wide. */
function meanderBand(g, x, y, w, h, size, color) {
  const unit = size;
  const drawKey = (px, py, rot) => {
    g.save();
    g.translate(px, py);
    g.rotate(rot);
    const u = unit / 5;
    g.beginPath();
    // One key: a squared spiral.
    g.moveTo(0, u * 4);
    g.lineTo(0, 0);
    g.lineTo(u * 4, 0);
    g.lineTo(u * 4, u * 3);
    g.lineTo(u * 1.5, u * 3);
    g.lineTo(u * 1.5, u * 1.5);
    g.lineTo(u * 2.6, u * 1.5);
    g.stroke();
    g.restore();
  };
  g.save();
  g.strokeStyle = color;
  g.lineWidth = unit / 9;
  g.lineCap = 'square';
  const step = unit;
  for (let px = x + unit; px <= x + w - 2 * unit; px += step) {
    drawKey(px + unit * 0.1, y + unit * 0.1, 0);
    drawKey(px + unit * 0.9, y + h - unit * 0.1, Math.PI);
  }
  for (let py = y + unit; py <= y + h - 2 * unit; py += step) {
    drawKey(x + unit * 0.1, py + unit * 0.9, -Math.PI / 2);
    drawKey(x + w - unit * 0.1, py + unit * 0.1, Math.PI / 2);
  }
  g.restore();
}

/** An auspicious cloud (tường vân): lobes with curled ends. */
function cloud(g, cx, cy, s, fill, line) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.beginPath();
  const lobes = [
    [-60, 10, 34],
    [-18, -14, 42],
    [32, -4, 36],
    [68, 16, 26],
    [10, 24, 34],
    [-38, 28, 26],
  ];
  for (const [x, y, r] of lobes) {
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = line;
  g.lineWidth = 3;
  for (const [x, y, r] of lobes.slice(0, 4)) {
    // A spiral curl in each upper lobe.
    g.beginPath();
    for (let t = 0; t < Math.PI * 3.2; t += 0.1) {
      const rr = (r * 0.75 * t) / (Math.PI * 3.2);
      const px = x + Math.cos(t + Math.PI) * rr;
      const py = y + Math.sin(t + Math.PI) * rr;
      if (t === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  }
  // A trailing tail.
  g.beginPath();
  g.moveTo(-70, 40);
  g.bezierCurveTo(-120, 60, -170, 40, -200, 70);
  g.lineWidth = 5;
  g.stroke();
  g.restore();
}

/** A lotus flower opening upward at (cx, cy), `s` its size. */
function lotus(g, cx, cy, s, light, dark) {
  g.save();
  g.translate(cx, cy);
  const petal = (angle, len, wid, alpha) => {
    g.save();
    g.rotate(angle);
    const grad = g.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, dark);
    grad.addColorStop(1, light);
    g.globalAlpha = alpha;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(wid, -len * 0.35, wid * 0.7, -len * 0.8, 0, -len);
    g.bezierCurveTo(-wid * 0.7, -len * 0.8, -wid, -len * 0.35, 0, 0);
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = shade(dark, -0.2);
    g.globalAlpha = alpha * 0.5;
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  };
  for (const a of [-1.25, 1.25]) petal(a, s * 0.8, s * 0.32, 0.9);
  for (const a of [-0.8, 0.8]) petal(a, s * 0.95, s * 0.36, 0.95);
  for (const a of [-0.38, 0.38]) petal(a, s * 1.05, s * 0.38, 1);
  petal(0, s * 1.12, s * 0.4, 1);
  g.restore();
}

/** A lotus leaf seen from above, tilted. */
function leaf(g, cx, cy, rx, ry, color) {
  g.save();
  g.translate(cx, cy);
  const grad = g.createRadialGradient(0, 0, 4, 0, 0, rx);
  grad.addColorStop(0, shade(color, 0.25));
  grad.addColorStop(1, color);
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0.12, Math.PI * 2 - 0.12);
  g.lineTo(0, 0);
  g.closePath();
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = shade(color, -0.25);
  g.lineWidth = 2;
  for (let a = 0.4; a < Math.PI * 2; a += 0.55) {
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * rx * 0.92, Math.sin(a) * ry * 0.92);
    g.stroke();
  }
  g.restore();
}

function save(c, id) {
  writeFileSync(`${outDir}/${id}.jpg`, c.toBuffer('image/jpeg', 88));
  const t = createCanvas(360, 240);
  const tg = t.getContext('2d');
  tg.drawImage(c, 0, 0, 360, 240);
  writeFileSync(`${outDir}/thumbs/${id}.jpg`, t.toBuffer('image/jpeg', 82));
}

// 1. Cung đình: imperial red and gold, Greek-key border, ribbon banner.
{
  const [c, g] = canvas();
  const base = g.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, W * 0.62);
  base.addColorStop(0, '#fff8e4');
  base.addColorStop(1, '#efd9a4');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  grain(g, '#8a5a1a');
  // A faint sun of rings and rays behind the tree.
  g.save();
  g.translate(W / 2, H * 0.58);
  g.strokeStyle = 'rgba(184,134,11,0.10)';
  for (let r = 120; r < 640; r += 70) {
    g.lineWidth = r % 140 ? 3 : 7;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 3;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
    g.beginPath();
    g.moveTo(Math.cos(a) * 660, Math.sin(a) * 660);
    g.lineTo(Math.cos(a) * 760, Math.sin(a) * 760);
    g.stroke();
  }
  g.restore();
  // Border: a red band with a gold key pattern, gold lines either side.
  const band = 96;
  g.fillStyle = '#8e1b12';
  g.fillRect(0, 0, W, band + 24);
  g.fillRect(0, H - band - 24, W, band + 24);
  g.fillRect(0, 0, band + 24, H);
  g.fillRect(W - band - 24, 0, band + 24, H);
  meanderBand(g, 24, 24, W - 48, H - 48, band - 6, '#e0b24a');
  g.strokeStyle = '#e0b24a';
  g.lineWidth = 6;
  g.strokeRect(18, 18, W - 36, H - 36);
  g.strokeRect(band + 30, band + 30, W - 2 * (band + 30), H - 2 * (band + 30));
  g.lineWidth = 2;
  g.strokeRect(band + 46, band + 46, W - 2 * (band + 46), H - 2 * (band + 46));
  // Corner medallions.
  for (const [x, y] of [[band + 30, band + 30], [W - band - 30, band + 30], [band + 30, H - band - 30], [W - band - 30, H - band - 30]]) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#e0b24a';
    g.fillRect(-58, -58, 116, 116);
    g.fillStyle = '#8e1b12';
    g.fillRect(-44, -44, 88, 88);
    g.restore();
    g.beginPath();
    g.arc(x, y, 22, 0, Math.PI * 2);
    g.fillStyle = '#e0b24a';
    g.fill();
  }
  ribbon(g, W / 2, 262, 1180, 170, '#a8231a', '#e0b24a');
  save(c, 'cung-dinh');
}

// 2. Sen hồng: soft pink, lotus pond in the lower corners, a delicate rose-gold frame.
{
  const [c, g] = canvas();
  const base = g.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#fffaf7');
  base.addColorStop(1, '#fde4e1');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  grain(g, '#b0636f', 40000, 0.03);
  // Ripples.
  g.strokeStyle = 'rgba(214,120,140,0.16)';
  g.lineWidth = 3;
  for (let i = 0; i < 9; i++) {
    for (const cx of [380, W - 380]) {
      g.beginPath();
      g.ellipse(cx, H - 120, 160 + i * 70, 36 + i * 16, 0, Math.PI, Math.PI * 2);
      g.stroke();
    }
  }
  // Leaves, then flowers and buds, in both lower corners.
  for (const side of [1, -1]) {
    const x0 = side > 0 ? 0 : W;
    const at = (dx) => x0 + side * dx;
    leaf(g, at(250), H - 150, 190, 70, '#6fa58a');
    leaf(g, at(520), H - 90, 150, 52, '#7fb79a');
    leaf(g, at(110), H - 330, 120, 44, '#8cc2a5');
    g.strokeStyle = '#5f8f74';
    g.lineWidth = 7;
    for (const [dx, top] of [[300, H - 420], [450, H - 300], [170, H - 520]]) {
      g.beginPath();
      g.moveTo(at(dx), H);
      g.quadraticCurveTo(at(dx - 30), (H + top) / 2, at(dx), top);
      g.stroke();
    }
    lotus(g, at(300), H - 420, 170, '#ffd3de', '#e2637f');
    lotus(g, at(450), H - 300, 120, '#ffe0e8', '#ea7d96');
    // A bud.
    g.save();
    g.translate(at(170), H - 520);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(40, -40, 20, -110, 0, -130);
    g.bezierCurveTo(-20, -110, -40, -40, 0, 0);
    const bud = g.createLinearGradient(0, 0, 0, -130);
    bud.addColorStop(0, '#e2637f');
    bud.addColorStop(1, '#ffc4d2');
    g.fillStyle = bud;
    g.fill();
    g.restore();
  }
  // Frame: rose-gold double line with rounded corners.
  g.strokeStyle = '#c98a5e';
  g.lineWidth = 5;
  roundRect(g, 60, 60, W - 120, H - 120, 46);
  g.stroke();
  g.lineWidth = 2;
  roundRect(g, 82, 82, W - 164, H - 164, 32);
  g.stroke();
  // A small lotus and fine flourishes above the title.
  lotus(g, W / 2, 175, 60, '#ffd3de', '#e2637f');
  g.strokeStyle = '#c98a5e';
  g.lineWidth = 3;
  for (const dir of [-1, 1]) {
    g.beginPath();
    g.moveTo(W / 2 + dir * 90, 160);
    g.bezierCurveTo(W / 2 + dir * 300, 120, W / 2 + dir * 420, 200, W / 2 + dir * 640, 150);
    g.stroke();
    g.beginPath();
    g.moveTo(W / 2 + dir * 90, 395);
    g.lineTo(W / 2 + dir * 560, 395);
    g.stroke();
  }
  save(c, 'sen-hong');
}

// 3. Mây ngọc: jade green, auspicious clouds, a framed plaque for the title.
{
  const [c, g] = canvas();
  const base = g.createRadialGradient(W / 2, H * 0.55, 200, W / 2, H / 2, W * 0.6);
  base.addColorStop(0, '#f6fbf4');
  base.addColorStop(1, '#d7e8dc');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  grain(g, '#2c5e4e', 50000, 0.03);
  // Clouds, faint, around the edges.
  const clouds = [
    [360, 420, 1.6], [W - 360, 420, -1.6], [300, H - 300, 1.3], [W - 300, H - 300, -1.3],
    [760, 260, 0.9], [W - 760, 260, -0.9], [W / 2, H - 230, 1.1],
  ];
  for (const [x, y, s] of clouds) {
    g.save();
    g.translate(x, y);
    g.scale(Math.sign(s), 1);
    cloud(g, 0, 0, Math.abs(s), 'rgba(60,130,105,0.10)', 'rgba(40,100,80,0.22)');
    g.restore();
  }
  // Border: dark jade band with gold lines and cloud corners.
  const band = 70;
  g.fillStyle = '#1f5f4f';
  for (const [x, y, w, h] of [[0, 0, W, band], [0, H - band, W, band], [0, 0, band, H], [W - band, 0, band, H]]) g.fillRect(x, y, w, h);
  g.strokeStyle = '#d9b45a';
  g.lineWidth = 5;
  g.strokeRect(band - 12, band - 12, W - 2 * (band - 12), H - 2 * (band - 12));
  g.lineWidth = 2;
  g.strokeRect(band + 8, band + 8, W - 2 * (band + 8), H - 2 * (band + 8));
  g.strokeRect(22, 22, W - 44, H - 44);
  for (const [x, y, sx, sy] of [[band + 70, band + 60, 1, 1], [W - band - 70, band + 60, -1, 1], [band + 70, H - band - 60, 1, -1], [W - band - 70, H - band - 60, -1, -1]]) {
    g.save();
    g.translate(x, y);
    g.scale(sx * 0.7, sy * 0.7);
    cloud(g, 0, 0, 1, 'rgba(217,180,90,0.9)', '#1f5f4f');
    g.restore();
  }
  // Plaque (hoành phi) for the title.
  const pw = 1160;
  const ph = 210;
  const px = W / 2 - pw / 2;
  const py = 150;
  g.save();
  g.shadowColor = 'rgba(0,40,30,0.35)';
  g.shadowBlur = 26;
  g.shadowOffsetY = 10;
  roundRect(g, px, py, pw, ph, 26);
  const plaque = g.createLinearGradient(0, py, 0, py + ph);
  plaque.addColorStop(0, '#2b7462');
  plaque.addColorStop(1, '#174c3f');
  g.fillStyle = plaque;
  g.fill();
  g.restore();
  g.strokeStyle = '#d9b45a';
  g.lineWidth = 7;
  roundRect(g, px, py, pw, ph, 26);
  g.stroke();
  g.lineWidth = 2;
  roundRect(g, px + 16, py + 16, pw - 32, ph - 32, 16);
  g.stroke();
  save(c, 'may-ngoc');
}

// 4. Tối giản: modern minimal, warm white with navy lines and faint geometry.
{
  const [c, g] = canvas();
  g.fillStyle = '#f8f7f3';
  g.fillRect(0, 0, W, H);
  grain(g, '#1d2b4f', 25000, 0.02);
  g.save();
  g.strokeStyle = 'rgba(29,43,79,0.06)';
  for (let r = 160; r < 900; r += 90) {
    g.lineWidth = 2;
    g.beginPath();
    g.arc(W - 120, 120, r, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(120, H - 120, r * 0.8, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = 'rgba(201,162,74,0.10)';
  g.beginPath();
  g.arc(W - 330, 300, 170, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.strokeStyle = '#1d2b4f';
  g.lineWidth = 3;
  g.strokeRect(70, 70, W - 140, H - 140);
  g.lineWidth = 1;
  g.strokeRect(88, 88, W - 176, H - 176);
  // Gold accent rule under the title, and small corner ticks.
  g.strokeStyle = '#c9a24a';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(W / 2 - 180, 395);
  g.lineTo(W / 2 + 180, 395);
  g.stroke();
  g.lineWidth = 3;
  for (const [x, y, sx, sy] of [[70, 70, 1, 1], [W - 70, 70, -1, 1], [70, H - 70, 1, -1], [W - 70, H - 70, -1, -1]]) {
    g.beginPath();
    g.moveTo(x + sx * 40, y + sy * 40);
    g.lineTo(x + sx * 140, y + sy * 40);
    g.moveTo(x + sx * 40, y + sy * 40);
    g.lineTo(x + sx * 40, y + sy * 140);
    g.stroke();
  }
  save(c, 'toi-gian');
}

// 5. Hoàng hôn: modern warm gradient, a soft sun behind the title, layered hills below.
{
  const [c, g] = canvas();
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#fff4e6');
  sky.addColorStop(0.6, '#ffe9dc');
  sky.addColorStop(1, '#ffd9c7');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const sun = g.createRadialGradient(W / 2, 250, 20, W / 2, 250, 520);
  sun.addColorStop(0, 'rgba(255,176,102,0.55)');
  sun.addColorStop(0.45, 'rgba(255,190,130,0.25)');
  sun.addColorStop(1, 'rgba(255,200,150,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);
  // Hills, back to front.
  const hills = [
    ['rgba(240,150,120,0.30)', H - 300, 140, 0.0016],
    ['rgba(214,110,96,0.32)', H - 210, 110, 0.0023],
    ['rgba(150,70,90,0.30)', H - 120, 80, 0.0031],
  ];
  hills.forEach(([color, base, amp, freq], i) => {
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const y = base - amp * (0.55 * Math.sin(x * freq + i * 1.7) + 0.45 * Math.sin(x * freq * 2.3 + i));
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  });
  // A few birds.
  g.strokeStyle = 'rgba(122,46,34,0.45)';
  g.lineWidth = 4;
  for (const [x, y, s] of [[W - 520, 300, 1], [W - 450, 340, 0.8], [W - 600, 360, 0.7], [470, 330, 0.8]]) {
    g.beginPath();
    g.moveTo(x - 30 * s, y);
    g.quadraticCurveTo(x - 14 * s, y - 16 * s, x, y);
    g.quadraticCurveTo(x + 14 * s, y - 16 * s, x + 30 * s, y);
    g.stroke();
  }
  grain(g, '#7a2e22', 30000, 0.02);
  // A thin white frame.
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 6;
  roundRect(g, 54, 54, W - 108, H - 108, 30);
  g.stroke();
  save(c, 'hoang-hon');
}
console.log('done');
