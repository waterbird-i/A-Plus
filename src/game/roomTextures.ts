import { DynamicTexture, Texture, type Scene } from '@babylonjs/core';
import { DeterministicRng, type StringTable } from '../core';

/**
 * 教室里所有「画出来」的东西：水磨石地面、黑板粉笔字、考场规则、黑板报、钟面、窗外。
 * 文字一律从 String Table 取；这里只决定怎么画。
 */
const SANS = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const HAND = '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif SC", serif';

function ctxOf(t: DynamicTexture): CanvasRenderingContext2D {
  return t.getContext() as CanvasRenderingContext2D;
}

export function terrazzoTexture(scene: Scene): DynamicTexture {
  const size = 1024;
  const t = new DynamicTexture('tex.floor', { width: size, height: size }, scene, true);
  const g = ctxOf(t);
  const rng = new DeterministicRng(77);
  g.fillStyle = '#cdc5b6';
  g.fillRect(0, 0, size, size);
  const chips = ['#9c948a', '#ebe5da', '#7d766e', '#b7ad9c', '#dcd2c2', '#6f8a86', '#a7806a'];
  for (let i = 0; i < 6500; i++) {
    g.fillStyle = chips[rng.next(chips.length)]!;
    g.beginPath();
    g.arc(rng.nextFloat() * size, rng.nextFloat() * size, 0.8 + rng.nextFloat() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // 两块 60 cm 的地砖一张图；缝要深一点，低多边形的画面靠这种线条立住。
  g.fillStyle = 'rgba(96, 88, 78, 0.6)';
  for (const p of [0, size / 2]) {
    g.fillRect(p - 2, 0, 4, size);
    g.fillRect(0, p - 2, size, 4);
  }
  t.update();
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  return t;
}

/** 粉笔字：叠几层带抖动的半透明笔画，再用黑板色点掉一些颗粒。 */
function chalk(g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, rng: DeterministicRng): void {
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  for (let i = 0; i < 4; i++) {
    g.globalAlpha = 0.34;
    g.fillText(text, x + (rng.nextFloat() - 0.5) * 5, y + (rng.nextFloat() - 0.5) * 5);
  }
  g.globalAlpha = 1;
  const w = g.measureText(text).width;
  g.fillStyle = 'rgba(38, 73, 59, 0.55)';
  for (let i = 0; i < w * 1.4; i++) g.fillRect(x - w / 2 + rng.nextFloat() * w, y - 70 + rng.nextFloat() * 140, 2, 2);
}

export function drawBlackboard(t: DynamicTexture, title: string, header: string): void {
  const g = ctxOf(t);
  const { width: W, height: H } = t.getSize();
  const rng = new DeterministicRng(5);
  g.fillStyle = '#26493b';
  g.fillRect(0, 0, W, H);
  // 上节课没擦干净的粉笔灰。
  for (let i = 0; i < 30; i++) {
    g.fillStyle = 'rgba(230, 240, 230, ' + (0.02 + rng.nextFloat() * 0.045).toFixed(3) + ')';
    g.beginPath();
    g.ellipse(rng.nextFloat() * W, rng.nextFloat() * H, 60 + rng.nextFloat() * 240, 18 + rng.nextFloat() * 60, rng.nextFloat() * 0.6 - 0.3, 0, Math.PI * 2);
    g.fill();
  }
  chalk(g, title, W / 2, H * 0.36, 'bold 150px ' + SANS, '#f3f3ea', rng);
  chalk(g, header, W / 2, H * 0.7, '92px ' + SANS, '#f6e27f', rng);
  g.strokeStyle = 'rgba(243, 243, 234, 0.5)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(W * 0.3, H * 0.52);
  g.lineTo(W * 0.7, H * 0.53);
  g.stroke();
  t.update();
}

/** 逐字折行（中文没有空格可断）。返回下一行的 y。 */
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  let line = '';
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxWidth && line.length > 0) {
      g.fillText(line, x, y);
      line = ch;
      y += lineHeight;
    } else line += ch;
  }
  if (line.length > 0) {
    g.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

/**
 * 考场规则（被撕掉一角）。hidden = 第六条：死过一次之后，最下面多了一行手写的红字。
 */
export function drawRules(t: DynamicTexture, table: StringTable, hidden: boolean): void {
  const g = ctxOf(t);
  const { width: W, height: H } = t.getSize();
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#f2eee2';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(W - 84, 0);
  g.lineTo(W - 52, 34);
  g.lineTo(W - 70, 58);
  g.lineTo(W - 30, 80);
  g.lineTo(W, 108);
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.closePath();
  g.fill();
  g.fillStyle = '#b8282a';
  g.fillRect(0, 0, W - 96, 14);
  g.fillStyle = 'rgba(240, 214, 120, 0.55)';
  g.fillRect(18, 22, 70, 26);
  g.fillRect(18, H - 48, 70, 26);
  g.fillRect(W - 88, H - 48, 70, 26);

  g.fillStyle = '#b8282a';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = 'bold 56px ' + SANS;
  g.fillText(table.get('rule.wall.title'), W / 2, 104);
  g.fillStyle = '#1e1c1a';
  g.textAlign = 'left';
  g.font = '27px ' + SANS;
  let y = 170;
  for (let i = 1; i <= 5; i++) y = wrap(g, table.get('rule.wall.0' + i), 44, y, W - 88, 38) + 14;
  g.fillStyle = '#6d675e';
  g.textAlign = 'right';
  g.font = '24px ' + SANS;
  g.fillText(table.get('rule.wall.footer'), W - 40, H - 70);
  if (hidden) {
    g.save();
    g.translate(48, y + 26);
    g.rotate(-0.035);
    g.fillStyle = '#9e1515';
    g.textAlign = 'left';
    g.font = '30px ' + HAND;
    wrap(g, table.get('rule.wall.hidden_06'), 0, 0, W - 110, 40);
    g.restore();
  }
  t.update();
}

/** 后墙的黑板报：没有字，只有色块、花边和画 —— 从座位上本来也看不清。 */
export function drawBoardNewspaper(t: DynamicTexture): void {
  const g = ctxOf(t);
  const { width: W, height: H } = t.getSize();
  const rng = new DeterministicRng(11);
  g.fillStyle = '#2a4d40';
  g.fillRect(0, 0, W, H);
  const colors = ['#f6d65b', '#f28b82', '#7fd1ae', '#8ab4f8', '#fbbc75', '#d7aefb', '#ffffff'];
  // 花边
  for (let x = 0; x < W; x += 34) {
    g.fillStyle = colors[(x / 34) % colors.length | 0]!;
    g.beginPath();
    g.arc(x + 17, 14, 11, 0, Math.PI * 2);
    g.arc(x + 17, H - 14, 11, 0, Math.PI * 2);
    g.fill();
  }
  // 标题块、几栏「文字」、太阳、花。
  g.fillStyle = '#f28b82';
  g.fillRect(W * 0.34, 44, W * 0.32, 70);
  for (let col = 0; col < 3; col++) {
    const x = 60 + col * (W - 120) / 3;
    g.strokeStyle = colors[col + 1]!;
    g.lineWidth = 5;
    g.strokeRect(x, 140, (W - 120) / 3 - 40, H - 200);
    g.fillStyle = 'rgba(255,255,255,0.72)';
    for (let r = 0; r < 7; r++) {
      const len = 0.5 + rng.nextFloat() * 0.45;
      g.fillRect(x + 20, 172 + r * 30, ((W - 120) / 3 - 80) * len, 7);
    }
  }
  g.fillStyle = '#f6d65b';
  g.beginPath();
  g.arc(W - 90, 80, 42, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillRect(W - 90 + Math.cos(a) * 56 - 5, 80 + Math.sin(a) * 56 - 5, 10, 10);
  }
  for (let i = 0; i < 5; i++) {
    const x = 90 + i * 46;
    const y = 90 + (i % 2) * 18;
    g.fillStyle = colors[i % colors.length]!;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      g.beginPath();
      g.arc(x + Math.cos(a) * 12, y + Math.sin(a) * 12, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f6d65b';
    g.beginPath();
    g.arc(x, y, 7, 0, Math.PI * 2);
    g.fill();
  }
  t.update();
}

export function drawClockFace(t: DynamicTexture): void {
  const g = ctxOf(t);
  const { width: S } = t.getSize();
  const c = S / 2;
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#f7f5ee';
  g.beginPath();
  g.arc(c, c, c - 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#26262a';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    g.save();
    g.translate(c + Math.sin(a) * (c - 16), c - Math.cos(a) * (c - 16));
    g.rotate(a);
    g.fillRect(big ? -3 : -1, big ? -10 : -5, big ? 6 : 2, big ? 20 : 10);
    g.restore();
  }
  g.font = 'bold ' + Math.round(S * 0.12) + 'px ' + SANS;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let h = 1; h <= 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    g.fillText(String(h), c + Math.sin(a) * (c - 50), c - Math.cos(a) * (c - 50));
  }
  t.update();
}

/** 窗外：夏天的天、对面那栋教学楼、一排樟树。画在一张远处的板子上，自发光。 */
export function drawSky(t: DynamicTexture): void {
  const g = ctxOf(t);
  const { width: W, height: H } = t.getSize();
  const rng = new DeterministicRng(3);
  const sky = g.createLinearGradient(0, 0, 0, H * 0.7);
  sky.addColorStop(0, '#6fb6e8');
  sky.addColorStop(1, '#d9eef5');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 7; i++) {
    const x = rng.nextFloat() * W;
    const y = 40 + rng.nextFloat() * H * 0.3;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.ellipse(x + k * 34, y + (k % 2) * 8, 46, 20, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 对面的教学楼。
  const bx = W * 0.22;
  const bw = W * 0.56;
  const by = H * 0.36;
  g.fillStyle = '#efe3c8';
  g.fillRect(bx, by, bw, H - by);
  g.fillStyle = '#d9c9a8';
  g.fillRect(bx, by, bw, 14);
  for (let floor = 0; floor < 6; floor++) {
    for (let i = 0; i < 14; i++) {
      g.fillStyle = rng.nextFloat() < 0.15 ? '#9fc3d6' : '#5d7f93';
      g.fillRect(bx + 20 + i * (bw - 40) / 14, by + 34 + floor * 46, (bw - 40) / 14 - 14, 26);
    }
  }
  // 樟树。
  for (let i = 0; i < 26; i++) {
    const x = (i / 25) * W;
    const r = 60 + rng.nextFloat() * 50;
    g.fillStyle = i % 3 === 0 ? '#3f7d45' : i % 3 === 1 ? '#4c9150' : '#356b3b';
    g.beginPath();
    g.arc(x, H * 0.72 + rng.nextFloat() * 30, r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#2f5f35';
  g.fillRect(0, H * 0.8, W, H * 0.2);
  t.update();
}
