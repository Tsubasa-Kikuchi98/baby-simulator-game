// Three.js 描画層のための Canvas テクスチャ／Sprite ヘルパ。
// ラベル・進捗リング（取り上げ用／口に入れる危険リング）・数字ポップ・「あきた」・不機嫌アイコン・✅・鍵・「！」バッジ・絵文字・床のテクスチャをここで作る。
import * as THREE from 'three';

export const FONT_UI = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
export const FONT_EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export const COLORS = {
  background: 0x2b2a33,
  floor: '#f4ebdd',
  floorLine: 'rgba(120, 90, 60, 0.09)',
  rug: 'rgba(214, 180, 150, 0.32)',
  wall: 0xcfae8e,
  wallText: '#4d3b2c',
  label: '#4b3f35',
  labelHalo: 'rgba(255,255,255,0.9)',
  hazard: 0xef8a8a, hazardTop: '#f6a9a9',
  item: 0xf5b06a, itemTop: '#f9c890',
  toy: 0x7fb4e6, toyTop: '#a4cbef',
  toyBored: 0xa9bccd,
  goods: 0x7fd3c4, goodsTop: '#a6e4d9', goodsInk: '#1f4f47',
  container: 0xa7bfbc, containerTop: '#c3d6d3', containerLid: 0x5f817e,
  cushion: 0xe6bd97, cushionTop: '#efd2b4', cushionInk: '#6b4f3a',
  mat: 0x9fd7a0,
  visitorShirt: 0x5f6b8a, visitorPants: 0x3f4658, visitorSkin: 0xf1d2b6, visitorInk: '#3d4761',
  catFur: 0x9a97a3, catFurDark: 0x66626f, catInk: '#3e3b45',
  prop: 0xe9d9c4, propTop: '#f1e4d3', propInk: '#6b4f3a',
  danger: '#d94a4a', dangerTrack: 'rgba(217, 74, 74, 0.25)',
  risk: '#f0902a',
  hintFull: 0xd05a5a, hintFullInk: '#8a2f2f',
  info: '#5a8fc4',
  stored: 0xbfc7c5, storedTop: '#d5dbd9',
  heavyPlate: 0x6f6863,
  puff: 0x9fb8b5,
  merged: 0xffd45f, mergedGlow: '#ffd45f',
  hint: 0x3fb39d,
  playStart: 0x7fb4e6,
  sparkle: 0xffd45f,
  fixed: 0x8fd08f, fixedTop: '#b3e0b3',
  fixedParticle: 0x5ea862,
  combo: 0xb76ce0,
  skin: 0xffe3cf,
  onesie: [0xa9dccf, 0xc9bdf0],
  face: 0x5a4437,
  moya: 0x7a6e96,
  shadow: 0x000000,
  star: '#e0b84a',
  bored: '#6b7a99',
  boredTrack: 'rgba(107, 122, 153, 0.25)',
  good: '#3f9a5a',
  bad: '#d05a5a',
  ring: '#ffffff',
  ringTrack: 'rgba(0,0,0,0.18)'
};

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(canvas, { mipmaps = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = mipmaps;
  return tex;
}

/** Sprite（常に手前に描く UI 的なもの）。w,h はワールド単位 */
export function makeSprite(texture, w, h, { depthTest = false, renderOrder = 10, opacity = 1 } = {}) {
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest, depthWrite: false, opacity });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(w, h, 1);
  sp.renderOrder = renderOrder;
  return sp;
}

export function disposeSprite(sp) {
  if (!sp) return;
  if (sp.material) {
    if (sp.material.map) sp.material.map.dispose();
    sp.material.dispose();
  }
  if (sp.parent) sp.parent.remove(sp);
}

function fitFont(ctx, text, family, weight, maxPx, maxWidth) {
  let px = maxPx;
  for (; px >= 12; px -= 2) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return px;
}

/** 縁取り付きテキスト（中央揃え） */
export function drawHaloText(ctx, text, x, y, { px = 40, color = COLORS.label, halo = COLORS.labelHalo, weight = 'bold', family = FONT_UI, lineWidth = 8, baseline = 'middle' } = {}) {
  ctx.font = `${weight} ${px}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** オブジェクト名ラベル（512×96 → 推奨ワールドサイズ 96×18。文字が高さの 7 割を占める） */
export function makeLabelTexture(text, { color = COLORS.label } = {}) {
  const c = makeCanvas(512, 96);
  const ctx = c.getContext('2d');
  const px = fitFont(ctx, text, FONT_UI, 'bold', 66, 490);
  drawHaloText(ctx, text, 256, 50, { px, color, lineWidth: 10 });
  return canvasTexture(c);
}

/** 箱の上面：kind 色の上に絵文字（128×128） */
export function makeTopTexture(emoji, bg) {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 128);
  // ほんの少し内側に濃い縁（箱っぽさ）
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 122, 122);
  if (emoji) {
    ctx.font = `84px ${FONT_EMOJI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(emoji, 64, 70);
  }
  const tex = canvasTexture(c, { mipmaps: true });
  return tex;
}

/** 進捗リング（128×128）。update(progress) で描き直す。色を渡せば飽きの残り時間リングにも使う */
export class RingTexture {
  constructor({ color = COLORS.ring, track = COLORS.ringTrack, lineWidth = 14, shadow = true, center = null } = {}) {
    this.canvas = makeCanvas(128, 128);
    this.ctx = this.canvas.getContext('2d');
    this.texture = canvasTexture(this.canvas);
    this.color = color;
    this.track = track;
    this.lineWidth = lineWidth;
    this.shadow = shadow;
    this.center = center;      // 中央に描く文字（危険リングの「！」）
    this.last = -1;
    this.update(0);
  }

  update(progress) {
    const p = Math.max(0, Math.min(1, progress));
    const q = Math.round(p * 64) / 64;
    if (q === this.last) return;
    this.last = q;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 128, 128);
    ctx.lineWidth = this.lineWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.track;
    ctx.beginPath();
    ctx.arc(64, 64, 50, 0, Math.PI * 2);
    ctx.stroke();
    if (q > 0) {
      ctx.strokeStyle = this.color;
      ctx.shadowColor = this.shadow ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0)';
      ctx.shadowBlur = this.shadow ? 6 : 0;
      ctx.beginPath();
      ctx.arc(64, 64, 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (this.center) {
      ctx.fillStyle = this.color;
      ctx.font = `bold 60px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.center, 64, 68);
    }
    this.texture.needsUpdate = true;
  }

  dispose() { this.texture.dispose(); }
}

/** 数字ポップ（+25 / −15）。256×96 → 推奨 40×15 */
export function makePopTexture(text, color) {
  const c = makeCanvas(256, 96);
  const ctx = c.getContext('2d');
  drawHaloText(ctx, text, 128, 50, { px: 64, color, lineWidth: 12 });
  return canvasTexture(c);
}

/** 「あきた」（256×96 → 推奨 32×12）。飽きた toy の上に出す */
export function makeAkitaTexture() {
  const c = makeCanvas(256, 96);
  const ctx = c.getContext('2d');
  drawHaloText(ctx, 'あきた', 128, 50, { px: 60, color: COLORS.bored, lineWidth: 12 });
  return canvasTexture(c);
}

/** ✅（96×96 → 推奨 14×14） */
export function makeCheckTexture() {
  const c = makeCanvas(96, 96);
  const ctx = c.getContext('2d');
  ctx.font = `76px ${FONT_EMOJI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#3f9a5a';
  ctx.fillText('✅', 48, 52);
  return canvasTexture(c);
}

/** 鍵（据え付けの印。96×96 → 推奨 11×11）。重い家具の脇に置く */
export function makeLockTexture() {
  const c = makeCanvas(96, 96);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#6f6a66';
  ctx.fillStyle = '#6f6a66';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(48, 40, 20, Math.PI, 0);
  ctx.stroke();
  roundRect(ctx, 16, 40, 64, 46, 8);
  ctx.fill();
  ctx.fillStyle = '#f4efe8';
  ctx.beginPath();
  ctx.arc(48, 61, 7, 0, Math.PI * 2);
  ctx.fill();
  return canvasTexture(c);
}

/** 絵文字 1 文字の Sprite 用（96×96 → 推奨 18×18）。捨てた／片付けたものが飛んでいく演出に使う */
export function makeEmojiTexture(emoji) {
  const c = makeCanvas(96, 96);
  const ctx = c.getContext('2d');
  ctx.font = `72px ${FONT_EMOJI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(emoji || '?', 48, 52);
  return canvasTexture(c);
}

/** 不機嫌アイコン：吹き出し＋への字口（128×128 → 推奨 18×18） */
export function makeGrumpyTexture() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8dcf5';
  ctx.strokeStyle = '#b9a5d8';
  ctx.lineWidth = 6;
  roundRect(ctx, 12, 10, 104, 84, 26);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(40, 92); ctx.lineTo(28, 118); ctx.lineTo(62, 94); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#6b5a8a';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  // 眉（つり上がり）
  ctx.beginPath(); ctx.moveTo(36, 40); ctx.lineTo(54, 50); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(92, 40); ctx.lineTo(74, 50); ctx.stroke();
  // 口（への字）
  ctx.beginPath(); ctx.arc(64, 82, 16, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
  return canvasTexture(c);
}

/** 星（PointsMaterial 用、64×64） */
export function makeStarTexture(color = COLORS.star) {
  const c = makeCanvas(64, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  const cx = 32, cy = 32, ro = 28, ri = 11;
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
  return canvasTexture(c);
}

/** 柔らかい丸（パーティクル用、32×32） */
export function makeDotTexture() {
  const c = makeCanvas(32, 32);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return canvasTexture(c);
}

/** 床（800×540 の 2 倍解像度）。Canvas2D 版と同じ板目とラグ */
export function makeFloorTexture(roomW, roomH) {
  const S = 2;
  const c = makeCanvas(roomW * S, roomH * S);
  const ctx = c.getContext('2d');
  ctx.scale(S, S);
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, 0, roomW, roomH);
  ctx.strokeStyle = COLORS.floorLine;
  ctx.lineWidth = 1.5;
  for (let y = 0; y <= roomH; y += 45) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(roomW, y); ctx.stroke(); }
  for (let x = 0; x <= roomW; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, roomH); ctx.stroke(); }
  ctx.fillStyle = COLORS.rug;
  roundRect(ctx, roomW / 2 - 130, roomH / 2 - 80, 260, 160, 18);
  ctx.fill();
  const tex = canvasTexture(c, { mipmaps: true });
  return tex;
}

/** ジョイントマットの上面（緑・40px タイルの目）。w:h は敷く矩形と同じ比で（既定 200×40 → 512×104） */
export function makeMatTexture(w = 200, h = 40) {
  const S = Math.max(1, Math.floor(512 / w));
  const c = makeCanvas(w * S, h * S);
  const ctx = c.getContext('2d');
  ctx.scale(S, S);
  ctx.fillStyle = '#9fd7a0';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(40, 90, 50, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let gx = 40; gx < w - 1; gx += 40) { ctx.moveTo(gx, 2); ctx.lineTo(gx, h - 2); }
  ctx.moveTo(2, h / 2); ctx.lineTo(w - 2, h / 2);
  ctx.stroke();
  ctx.strokeStyle = '#5ea862';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  return canvasTexture(c, { mipmaps: true });
}

/** 壁（家具）の上面ラベル：512×128 → 推奨 (w, w/4) 程度。color で満杯（赤）などに変えられる */
export function makeWallLabelTexture(text, { color = COLORS.wallText } = {}) {
  const c = makeCanvas(512, 128);
  const ctx = c.getContext('2d');
  const px = fitFont(ctx, text, FONT_UI, '600', 56, 470);
  drawHaloText(ctx, text, 256, 66, { px, color, halo: 'rgba(255,245,230,0.75)', weight: '600', lineWidth: 6 });
  return canvasTexture(c);
}

/** 危険なおもちゃの「！」バッジ（オレンジの丸に白い「！」。96×96 → 推奨 10×10） */
export function makeRiskBadgeTexture() {
  const c = makeCanvas(96, 96);
  const ctx = c.getContext('2d');
  ctx.fillStyle = COLORS.risk;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(48, 48, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 60px ${FONT_UI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('！', 48, 52);
  return canvasTexture(c);
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
