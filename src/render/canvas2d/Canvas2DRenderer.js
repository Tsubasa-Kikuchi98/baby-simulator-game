// フェーズ1 描画層：Canvas 2D。gameState（docs/CONTRACT.md §5）を毎フレーム読んで描く。
// 盤面上の因果表現（§4.8 / §9）はここ、HTML の HUD は src/ui.js が担当する。
// v3（§9）：オブジェクトの進捗リングは描かない（取り上げのリングだけ残す）。容れ物（蓋つきゴミ箱）、
// 高い場所・収納先に置かれた hazard（小さく・灰色・✅）、重い家具の印（影＋鍵）、ドラッグ中のドロップ先ヒント。
// v5（§11）：口に入れる（口元の物＋頭上の危険リング）、高い場所の容量 n/2（満杯は赤いヒント）、ダミー（ベージュの角丸）、
// 危険なおもちゃの「！」バッジ、猫（低く速い 4 足。くわえた物を口元に）。
// v6（§12）：面のハザード（床の矩形＋滞在ゲージ）、時限ハザード（薄く描いて予告点滅）、配置コンボ（mover と target を結ぶ警告線）、
// 押して動かせる家具（push。掴める見た目＋「離すと安全」の円）、兄（🧒。渡したおもちゃを持って休む）。
import { IRenderer } from '../IRenderer.js';
import { ROOM, TUNING } from '../../game/stages.js';
import { EffectStore, POP_SEC, POP_RISE_PX, POP_COLORS, easeOut } from './effects.js';
import {
  hintTargets, hintWalls, boredFraction, isStored, isHeavy, findWall, highPlaceCount, wallCapacity, isHighPlaceFull,
  isPushable, isFurnitureClimbable, zoneRects, zoneDwellFraction, activationFraction, placementWarnings, pushTargets
} from '../hints.js';

const FONT_UI = 'system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif';
const FONT_EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const OBJ_R = 20;          // オブジェクトの描画半径
const BABY_R = 18;         // 赤ちゃんの描画半径
const PICK_R_BABY = 22;
const PICK_R_OBJ = 24;
const HELD_LIFT = 20;
const CRAWL_RATE = 8;      // 基準速度（TUNING.BABY_SPEED）で這うときの体の揺れ（rad/s）

const COLORS = {
  letterbox: '#2b2a33',
  floor: '#f4ebdd',
  floorLine: 'rgba(120, 90, 60, 0.07)',
  rug: 'rgba(214, 180, 150, 0.25)', rugEdge: 'rgba(168, 130, 95, 0.40)', rugFringe: 'rgba(168, 130, 95, 0.30)',
  wall: '#cfae8e',
  wallEdge: '#a8825f',
  wallText: '#4d3b2c',
  label: '#4b3f35',
  labelHalo: 'rgba(255,255,255,0.85)',
  hazard: '#ef8a8a', hazardEdge: '#c95d5d',
  item: '#f5b06a', itemEdge: '#d4863a',
  toy: '#7fb4e6', toyEdge: '#4d86c4',
  fixed: '#8fd08f', fixedEdge: '#5ea862',
  ring: '#ffffff', ringTrack: 'rgba(0,0,0,0.12)',
  combo: '#b76ce0',
  skin: '#ffe3cf', skinEdge: '#d9a98a',
  onesie: ['#a9dccf', '#c9bdf0'],
  onesieEdge: ['#6fb3a1', '#9a8ad0'],
  face: '#5a4437',
  moya: 'rgba(120, 110, 150, 0.32)',
  fussBubble: '#e8dcf5', fussBubbleEdge: '#b9a5d8',
  shadow: 'rgba(0,0,0,0.18)',
  heavyShadow: 'rgba(0,0,0,0.30)',
  lock: '#6f6a66', lockInk: '#f4efe8',
  flash: 'rgba(255, 228, 110, 0.5)',
  bored: '#6b7a99', boredTrack: 'rgba(107, 122, 153, 0.22)',
  goods: '#7fd3c4', goodsEdge: '#3f9d8d', goodsInk: '#1f4f47',
  merged: '#ffd45f', mergedGlow: 'rgba(255, 212, 95, 0.55)',
  hint: '#3fb39d', hintFill: 'rgba(63, 179, 157, 0.18)', hintInk: '#1f6b5d',
  hintFull: '#d05a5a', hintFullFill: 'rgba(208, 90, 90, 0.16)', hintFullInk: '#8a2f2f',
  prop: '#e9d9c4', propEdge: '#a8825f', propInk: '#6b4f3a',
  danger: '#d94a4a', dangerTrack: 'rgba(217, 74, 74, 0.2)', dangerGlow: 'rgba(217, 74, 74, 0.45)',
  risk: '#f0902a', riskInk: '#ffffff',
  info: '#5a8fc4',
  catFur: '#9a97a3', catFurDark: '#66626f', catInk: '#3e3b45',
  container: '#a7bfbc', containerEdge: '#5f817e', containerLid: '#7c9c99', containerStripe: 'rgba(0,0,0,0.08)',
  stored: '#cfd5d3', storedEdge: '#8d9795',
  playStart: 'rgba(127, 180, 230, 0.9)',
  sparkle: ['#ffd45f', '#7fd3c4', '#ffffff', '#8fd08f'],
  puff: ['#a7bfbc', '#ffffff', '#7c9c99'],
  mat: '#9fd7a0', matEdge: '#5ea862', matGrid: 'rgba(40, 90, 50, 0.16)', matInk: '#2f6b3a',
  cushion: '#e6bd97', cushionEdge: '#a8825f', cushionInk: '#6b4f3a',
  visitorShirt: '#5f6b8a', visitorShirtEdge: '#3d4761', visitorPants: '#3f4658', visitorSkin: '#f1d2b6', visitorInk: '#3d4761',
  door: 'rgba(255, 250, 235, 0.9)',
  // v6（§12）
  zoneOpen: 'rgba(217, 74, 74, 0.16)', zoneOpenEdge: '#d94a4a', zoneHatch: 'rgba(217, 74, 74, 0.22)', zoneInk: '#8a2f2f',
  zoneFixed: 'rgba(143, 208, 143, 0.16)', zoneFixedEdge: '#5ea862', zoneFixedInk: '#2f6b3a',
  inactive: '#b9b2c4', inactiveInk: '#6a6380',
  push: '#8aa6d6', pushEdge: '#5470a8', pushInk: '#3c4f78',
  placement: '#d94a4a', placementInk: '#8a2f2f',
  siblingShirt: '#e2a35c', siblingShirtEdge: '#b47a37', siblingPants: '#5b6b8a', siblingInk: '#6b4a22'
};
const CLIMB_SCALE = 1.15;   // ソファの上の赤ちゃんは手前なので少し大きく
const MAT_H = 40;           // マットの奥行き（ソファ前の床）
const FALL_SEC = 0.4;       // 転落アニメ
const HOP_SEC = 0.3;        // 自分で降りる
const ITEM_DROP_SEC = 0.3;  // 訪問者が手元から落とす
const VISITOR_HAND_H = 34;  // 訪問者の手の高さ（px、上方向）
const VISITOR_WALK_RATE = 9;
const CAT_RUN_RATE = 22;    // 猫の脚の周期（速い）
const MOUTH_SCALE = 0.55;   // 口元・猫の口の物の縮小率
const RISK_R = 7;           // 危険なおもちゃの「！」バッジ半径
const PROP_W = 46;          // ダミー（角丸）
const PROP_H = 30;
const GOODS_W = 46;        // 安全グッズ（タグ形）の幅
const GOODS_H = 30;
const BIN_W = 34;          // 容れ物（蓋つきゴミ箱）
const BIN_H = 32;

const SIBLING_SCALE = 0.72;   // 兄はおじさんより小さい（子ども）
const SIBLING_HAND_H = 26;    // 兄の手の高さ（渡したおもちゃを持つ位置）

const ZERO_LAYOUT = { w: 0, h: 0, scale: 1, offX: 0, offY: 0 };

export class Canvas2DRenderer extends IRenderer {
  /**
   * @param {object} [opts]
   * @param {number} [opts.topInset=0]  上端に空ける px（HTML の HUD 帯を部屋と重ねないため）
   */
  constructor({ topInset = 0 } = {}) {
    super();
    this.topInset = topInset;
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.dpr = 1;
    this.layout = { ...ZERO_LAYOUT };
    this.stage = null;
    this.lastState = null;
    this.t = 0;                 // 点滅・揺れ用の時計（秒）
    this.fx = new EffectStore();
    this.prevAnim = new Map();  // babyId → anim（着地演出の検出用）
    this.babyPhase = new Map(); // babyId → 這うアニメの位相（baby.speed に従って進む）
    this.boredTotal = new Map(); // toyId → 飽きの総秒数（bored effect の until - elapsed。リングの分母）
    this.babyPrev = new Map();   // babyId → { x, y, climbing }（前フレーム。転落アニメの出発点）
    this.babyFalls = new Map();  // babyId → { from, to|null, t, dur, kind: 'safe'|'hop'|'hiyari' }
    this.itemDrops = [];         // 訪問者が落とした item の落下 { id, from, t, dur }
    this.visitorPhase = new Map(); // visitorId → 歩行の位相
    this.doorFx = null;          // { x, t, dur }（訪問者の出入りの光）
    this.mouthStart = new Map(); // babyId → { start, until }（口に入れた時刻。危険リングの分母）
    this._resizeObserver = null;
    this._onWindowResize = () => this.resize();
  }

  // ---------------------------------------------------------------- lifecycle

  init(container) {
    this.container = container;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(container);
    }
    window.addEventListener('resize', this._onWindowResize);
    this.resize();
  }

  loadStage(stage) {
    this.stage = stage;
    this.fx.reset();
    this.prevAnim.clear();
    this.babyPhase.clear();
    this.boredTotal.clear();
    this.babyPrev.clear();
    this.babyFalls.clear();
    this.itemDrops = [];
    this.visitorPhase.clear();
    this.doorFx = null;
    this.mouthStart.clear();
    return Promise.resolve();
  }

  dispose() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    window.removeEventListener('resize', this._onWindowResize);
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = null;
    this.ctx = null;
  }

  showOverlay() { /* フェーズ1は ui.js が HTML で担当 */ }

  // ---------------------------------------------------------------- layout / coords

  resize() {
    if (!this.canvas || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    const top = Math.min(this.topInset, h * 0.3);
    const availH = Math.max(1, h - top);
    const scale = Math.min(w / ROOM.w, availH / ROOM.h);
    this.layout = {
      w, h, scale,
      offX: (w - ROOM.w * scale) / 2,
      offY: top + (availH - ROOM.h * scale) / 2
    };
  }

  /** 画面（client）座標 → ゲーム座標 */
  toGameCoords(clientX, clientY) {
    const rect = this.canvas ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const { scale, offX, offY } = this.layout;
    return {
      x: (clientX - rect.left - offX) / scale,
      y: (clientY - rect.top - offY) / scale
    };
  }

  /** ゲーム座標 → 画面（client）座標。テスト（Playwright）と input が使う */
  toScreenCoords(x, y) {
    const rect = this.canvas ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const { scale, offX, offY } = this.layout;
    return {
      x: rect.left + offX + x * scale,
      y: rect.top + offY + y * scale
    };
  }

  /** 画面座標 → baby.id | object.id | null。赤ちゃん優先。持たれている物（手・口元・猫）・removed・used（グッズ）・収納済みは無視 */
  pickObject(clientX, clientY) {
    const s = this.lastState;
    if (!s) return null;
    const p = this.toGameCoords(clientX, clientY);
    let best = null;
    let bestD = Infinity;
    for (const b of s.babies || []) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d <= PICK_R_BABY && d < bestD) { best = b.id; bestD = d; }
    }
    if (best) return best;
    for (const o of s.objects || []) {
      if (o.state === 'removed' || o.state === 'used') continue;
      if (o.carriedBy != null) continue;
      if (o.zone) continue;              // 面のハザード（§12.1）は掴めない。床に載っている物の当たり判定を奪わないため
      if (isStored(o)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d <= PICK_R_OBJ && d < bestD) { best = o.id; bestD = d; }
    }
    return best;
  }

  // ---------------------------------------------------------------- effects

  playEffect(type, objectId, payload = {}) {
    const s = this.lastState;
    const obj = s && objectId != null ? s.objects.find(o => o.id === objectId) : null;
    const baby = s && objectId != null ? s.babies.find(b => b.id === objectId) : null;
    switch (type) {
      case 'fixed':
        this.fx.start('fixdone', objectId, 0.6);
        // 高い場所へ移した：置いた所で小さな粒
        if (payload.via === 'high' && obj) this.fx.addBurst(obj.x, obj.y, { count: 10, color: COLORS.puff, life: 0.45, speed: 60, size: 2.6 });
        if (payload.via === 'store' && payload.into) this.fx.start('lidpop', payload.into, 0.4);
        break;
      case 'removed':
        this.fx.start('fixdone', objectId, 0.6);
        break;
      case 'trashed':
      case 'stored': {
        // 消える：粒のパフ＋絵文字が容れ物／棚へ飛んでいく（0.3 秒）
        const from = obj ? { x: obj.x, y: obj.y } : { x: ROOM.cx, y: ROOM.cy };
        const to = this._intoPos(payload.into, from, s);
        this.fx.addBurst(from.x, from.y, { count: 12, color: COLORS.puff, life: 0.5, speed: 70, size: 3 });
        if (obj && obj.emoji) this.fx.addFly(obj.emoji, from, to, 0.3);
        if (type === 'trashed' && payload.into) this.fx.start('lidpop', payload.into, 0.4);
        break;
      }
      case 'heavy_nudge':
        // 重いものを引っ張ろうとした（input が出す描画層ローカルの効果）：小さく揺れて「動かない」
        this.fx.start('nudge', objectId, 0.35);
        if (obj) this.fx.addPop(obj.x, obj.y - OBJ_R - 6, '動かない', POP_COLORS.neutral);
        break;
      case 'respawn':
        this.fx.start('bounce', objectId, 0.45);
        break;
      case 'hiyari': {
        this.fx.flash();
        // ソファからの転落（登っていた赤ちゃんがヒヤリ）：spawn に戻る前に 0.4 秒の落下アニメ
        const prev = payload.babyId != null ? this.babyPrev.get(payload.babyId) : null;
        if (prev && prev.climbing) {
          const wl = findWall(s && s.stage, prev.climbing);
          const to = wl ? { x: prev.x, y: wl.y + wl.h + TUNING.BABY_RADIUS + 2 } : { x: prev.x, y: prev.y + 50 };
          this.babyFalls.set(payload.babyId, { from: { x: prev.x, y: prev.y }, to, t: 0, dur: FALL_SEC, kind: 'hiyari' });
        }
        break;
      }
      case 'combo_hiyari':
        if (payload.ignoresFix) this.fx.start('shake', objectId, 0.5);
        break;
      case 'climb_start': {
        // 登った：小さな sparkle と「ごきげん」の上矢印ポップ
        const b = payload.babyId != null && s ? s.babies.find(x => x.id === payload.babyId) : null;
        if (b) {
          this.fx.addBurst(b.x, b.y - 6, { count: 12, color: COLORS.sparkle, life: 0.6, speed: 70, size: 2.8, star: true });
          this.fx.addPop(b.x, b.y - BABY_R - 22, '↑ ごきげん', POP_COLORS.good);
        }
        break;
      }
      case 'climb_fall_safe': {
        // マットの上へ落ちた：ソファの上（前フレーム位置）から今の床位置へ落下し、小さくバウンド。フラッシュ無し
        const prev = payload.babyId != null ? this.babyPrev.get(payload.babyId) : null;
        if (prev) this.babyFalls.set(payload.babyId, { from: { x: prev.x, y: prev.y }, to: null, t: 0, dur: FALL_SEC, kind: 'safe' });
        break;
      }
      case 'climb_end': {
        // 自分で降りる：短いホップ
        const prev = payload.babyId != null ? this.babyPrev.get(payload.babyId) : null;
        if (prev) this.babyFalls.set(payload.babyId, { from: { x: prev.x, y: prev.y }, to: null, t: 0, dur: HOP_SEC, kind: 'hop' });
        break;
      }
      case 'visitor_enter':
      case 'visitor_leave': {
        // 出入り口（部屋の左右の端）がふわっと明るくなる
        const vis = s && s.visitors ? s.visitors.find(v => v.id === objectId) : null;
        const x = vis ? (vis.x < ROOM.cx ? 0 : ROOM.w) : ROOM.w;
        this.doorFx = { x, t: 0, dur: 0.5 };
        break;
      }
      case 'visitor_drop': {
        // 訪問者の手元から item が床へ落ちる（0.3 秒）。落ち切ったら小さな埃
        const vis = s && s.visitors ? s.visitors.find(v => v.id === payload.visitorId) : null;
        const to = obj ? { x: obj.x, y: obj.y } : this._payloadPos(payload, null);
        const from = vis ? { x: vis.x + (vis.dirX || 0) * 8, y: vis.y - VISITOR_HAND_H } : { x: to.x, y: to.y - VISITOR_HAND_H };
        this.itemDrops = this.itemDrops.filter(d => d.id !== objectId);
        this.itemDrops.push({ id: objectId, from, t: 0, dur: ITEM_DROP_SEC });
        break;
      }
      case 'mouth_start': {
        // 口に入れた：頭上に「！」、危険リングの開始時刻を覚える（残り時間で縮む）
        const b = payload.babyId != null && s ? s.babies.find(x => x.id === payload.babyId) : null;
        if (b) {
          const until = payload.until != null ? payload.until : (b.mouthing ? b.mouthing.until : (s.elapsed || 0) + TUNING.MOUTH_SEC_MAX);
          this.mouthStart.set(b.id, { start: s.elapsed || 0, until });
          this.fx.addPop(b.x, b.y - BABY_R - 30, '！', POP_COLORS.bad);
          this.fx.start('mouthPop', b.id, 0.35);
        }
        break;
      }
      case 'mouth_release': {
        // 手放した：口元から足元へ滑り落ち、「ほっ」（info 色）
        const b = payload.babyId != null && s ? s.babies.find(x => x.id === payload.babyId) : null;
        const from = b ? this._mouthPos(b) : (obj ? { x: obj.x, y: obj.y - 18 } : null);
        if (obj && from) {
          this.itemDrops = this.itemDrops.filter(d => d.id !== objectId);
          this.itemDrops.push({ id: objectId, from, t: 0, dur: ITEM_DROP_SEC, quiet: true });
          this.fx.start('drop', objectId, 0.4);
        }
        if (b) {
          this.fx.addPop(b.x, b.y - BABY_R - 26, 'ほっ', COLORS.info);
          this.mouthStart.delete(b.id);
        }
        break;
      }
      case 'high_full': {
        // 高い場所が満杯：物が跳ね返って床に落ち、「もう置けない」
        this.fx.start('bounce', objectId, 0.45);
        if (obj) {
          const wl = findWall(s && s.stage, payload.into);
          if (wl) {
            // wall の縁から手前の床へ落ちてくる小アニメ
            const fromY = Math.max(wl.y, Math.min(wl.y + wl.h, obj.y));
            const fromX = Math.max(wl.x, Math.min(wl.x + wl.w, obj.x));
            this.itemDrops = this.itemDrops.filter(d => d.id !== objectId);
            this.itemDrops.push({ id: objectId, from: { x: fromX, y: fromY }, t: 0, dur: ITEM_DROP_SEC, quiet: true });
          }
          this.fx.addPop(obj.x, obj.y - OBJ_R - 8, 'もう置けない', POP_COLORS.bad);
        }
        break;
      }
      case 'cat_take': {
        // 猫がくわえた：小さなパフ
        if (obj) this.fx.addBurst(obj.x, obj.y, { count: 8, color: COLORS.puff, life: 0.4, speed: 50, size: 2.4 });
        break;
      }
      case 'cat_drop': {
        // 猫が置いた：口元から床へ小さくホップし、着地でパフ
        const cat = s && s.visitors ? s.visitors.find(v => v.type === 'cat' && v.active) : null;
        const to = obj ? { x: obj.x, y: obj.y } : this._payloadPos(payload, null);
        const from = cat ? this._catMouthPos(cat) : { x: to.x, y: to.y - 12 };
        this.itemDrops = this.itemDrops.filter(d => d.id !== objectId);
        this.itemDrops.push({ id: objectId, from, t: 0, dur: ITEM_DROP_SEC });
        this.fx.start('drop', objectId, 0.4);
        break;
      }
      case 'play_done': {
        const amt = payload.amount ?? 0;
        const pos = this._toyPopPos(obj, s);
        this.fx.addPop(pos.x, pos.y - OBJ_R - 6, (amt >= 0 ? '+' : '−') + Math.abs(amt), amt >= 0 ? POP_COLORS.good : POP_COLORS.bad);
        break;
      }
      case 'drop':
        this.fx.start('drop', objectId, 0.4);
        break;
      case 'pickup':
        if (baby) this.fx.start('lift', objectId, 0.25);
        break;
      case 'takeaway':
        if (payload.toyId) this.fx.start('drop', payload.toyId, 0.4);
        break;
      case 'fuss_start':
        this.fx.start('fussPop', objectId, 0.4);
        break;
      case 'bored':
        // 飽き表示のリングの分母（until - elapsed）。取り上げ（3 秒）と通常（30 秒〜）で違う
        if (payload.until != null && s) this.boredTotal.set(objectId, Math.max(0.1, payload.until - (s.elapsed || 0)));
        break;
      case 'unbored':
        this.boredTotal.delete(objectId);
        break;
      case 'play_start':
        this.fx.start('playstart', objectId, 0.5);
        break;
      case 'recipe_ok': {
        // 成立：ドロップ位置で sparkle（中央のラベルは ui.js）
        const pos = this._payloadPos(payload, obj);
        this.fx.addBurst(pos.x, pos.y, { count: 22, color: COLORS.sparkle, life: 0.8, speed: 110, size: 3.2, star: true });
        break;
      }
      case 'recipe_ng': {
        // 不成立：グッズが小さく震え、灰色の × がポップ
        if (payload.a) this.fx.start('gshake', payload.a, 0.4);
        const pos = this._payloadPos(payload, obj);
        this.fx.addPop(pos.x, pos.y - OBJ_R - 4, '×', POP_COLORS.neutral);
        break;
      }
      case 'toy_merged': {
        // 合成：新しい toy がスケールバウンスで現れ、星が散る
        this.fx.start('popin', objectId, 0.55);
        const pos = this._payloadPos(payload, obj);
        this.fx.addBurst(pos.x, pos.y, { count: 16, color: [COLORS.merged, '#ffffff'], life: 0.9, speed: 120, size: 4.5, star: true });
        break;
      }
      // ---- v6（§12.6）。state から導出できるもの（zone の矩形・滞在割合・時限の残り・配置コンボの成立）は
      // update() 側で毎フレーム描く。ここは「その瞬間に一度だけ起きたこと」だけ
      case 'activate': {
        // 時限ハザードが ON になった：湯気のような粒＋「熱くなった！」
        this.fx.start('activate', objectId, 0.7);
        if (obj) {
          this.fx.addBurst(obj.x, obj.y - 6, { count: 14, color: COLORS.puff, life: 0.6, speed: 55, size: 3 });
          this.fx.addPop(obj.x, obj.y - OBJ_R - 8, '熱くなった！', POP_COLORS.bad);
        }
        break;
      }
      case 'zone_enter': {
        // 面のハザードに入った（滞在の進捗リングは state から毎フレーム描く）。入った合図だけ出す
        this.fx.start('zoneenter', objectId, 0.6);
        const b = payload.babyId != null && s ? s.babies.find(x => x.id === payload.babyId) : null;
        if (b) this.fx.addPop(b.x, b.y - BABY_R - 26, '！', POP_COLORS.bad);
        break;
      }
      case 'placement_warn': {
        // 配置コンボの成立／解除。成立中の線と警告表示は state から毎フレーム描くので、ここは切り替わりの合図だけ
        if (payload.active) {
          // 成立中は毎フレームのリングと「踏み台！ 登れる」ラベルが出ているので、ポップは重ねない
          this.fx.start('shake', objectId, 0.5);
        } else if (obj) {
          this.fx.addPop(obj.x, obj.y + OBJ_R + 18, '離れた', POP_COLORS.good);
          this.fx.addBurst(obj.x, obj.y, { count: 8, color: COLORS.sparkle, life: 0.5, speed: 60, size: 2.6, star: true });
        }
        break;
      }
      case 'sibling_busy': {
        // 兄におもちゃを渡した：兄の手元で sparkle
        const vis = s && s.visitors ? s.visitors.find(v => v.id === payload.visitorId) : null;
        if (vis) {
          this.fx.addBurst(vis.x, vis.y - SIBLING_HAND_H, { count: 14, color: COLORS.sparkle, life: 0.7, speed: 80, size: 3, star: true });
          this.fx.addPop(vis.x, vis.y - 46, 'わたした', POP_COLORS.good);
        }
        break;
      }
      case 'sibling_free': {
        // 兄が飽きた：おもちゃが手元から床へ落ちる
        const vis = s && s.visitors ? s.visitors.find(v => v.id === payload.visitorId) : null;
        if (obj) {
          const from = vis ? { x: vis.x, y: vis.y - SIBLING_HAND_H } : { x: obj.x, y: obj.y - SIBLING_HAND_H };
          this.itemDrops = this.itemDrops.filter(d => d.id !== objectId);
          this.itemDrops.push({ id: objectId, from, t: 0, dur: ITEM_DROP_SEC });
        }
        if (vis) this.fx.addPop(vis.x, vis.y - 46, 'あきた', POP_COLORS.bad);
        break;
      }
      default:
        // combo_warn / sat_delta / no_toy / stage_* は state から毎フレーム描く
        break;
    }
  }

  _payloadPos(payload, obj) {
    if (payload && Number.isFinite(payload.x) && Number.isFinite(payload.y)) return { x: payload.x, y: payload.y };
    if (obj) return { x: obj.x, y: obj.y };
    return { x: ROOM.cx, y: ROOM.cy };
  }

  /** `into`（object id または wall の model）の位置。wall なら from を矩形の内側にクランプした点 */
  _intoPos(into, from, s) {
    if (into == null || !s) return from;
    const o = (s.objects || []).find(x => x.id === into);
    if (o) return { x: o.x, y: o.y - 10 };
    const w = findWall(s.stage, into);
    if (w) {
      const pad = Math.min(16, w.w / 2, w.h / 2);
      return {
        x: Math.max(w.x + pad, Math.min(w.x + w.w - pad, from.x)),
        y: Math.max(w.y + pad, Math.min(w.y + w.h - pad, from.y))
      };
    }
    return from;
  }

  _toyPopPos(obj, s) {
    if (!obj) return { x: ROOM.cx, y: ROOM.cy };
    if (obj.carriedBy != null && s) {
      const b = s.babies.find(bb => bb.id === obj.carriedBy);
      if (b) return { x: b.x + 18, y: b.y + 6 };
    }
    return { x: obj.x, y: obj.y };
  }

  /** 赤ちゃんの口元（ゲーム座標） */
  _mouthPos(b) {
    const lift = (b.anim === 'held' || b.isHeld) ? HELD_LIFT : 0;
    return { x: b.x + 3, y: b.y - lift - 1 };
  }

  /** 猫の口元（進行方向の先端） */
  _catMouthPos(v) {
    const dir = (v.dirX || 0) >= 0 ? 1 : -1;
    return { x: v.x + dir * 20, y: v.y - 6 };
  }

  // ---------------------------------------------------------------- update / draw

  update(state, dt = 0) {
    this.lastState = state;
    if (state && state.stage && state.stage !== this.stage) this.stage = state.stage;
    this.t += dt;
    this.fx.tick(dt);
    this._detectLanding(state);
    this._advanceBabyPhases(state, dt);
    this._advanceVisitorPhases(state, dt);
    this._tickFalls(state, dt);

    const ctx = this.ctx;
    if (!ctx) { this._rememberBabies(state); return; }
    const { w, h, scale, offX, offY } = this.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.letterbox;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, ROOM.w, ROOM.h);
    ctx.clip();

    this._drawFloor(ctx);
    const stage = state && state.stage;
    if (stage) {
      const warn = this._comboWarnSets(state);
      warn.hints = hintTargets(state);
      this._drawZones(ctx, state, warn);
      this._drawWalls(ctx, stage.walls || [], hintWalls(state), state);
      this._drawMats(ctx, state);
      this._drawPushTargets(ctx, state);
      this._drawPlacementLinks(ctx, warn);
      // ドラッグ中のものは最後（最前面）に描く
      let dragged = null;
      for (const o of state.objects || []) {
        if (state.drag && state.drag.targetId === o.id) { dragged = o; continue; }
        this._drawObject(ctx, o, state, warn);
      }
      // 猫（低い）は赤ちゃんより奥に
      for (const v of state.visitors || []) if (v.active && v.type === 'cat') this._drawVisitor(ctx, v, state);
      // 登っている赤ちゃんは（ソファの上＝手前なので）他の赤ちゃんの後に描く
      const babies = state.babies || [];
      for (const b of babies) if (!b.climbing) this._drawBaby(ctx, b, state, warn);
      for (const b of babies) if (b.climbing) this._drawBaby(ctx, b, state, warn);
      // 訪問者（背が高い＝オブジェクトより手前）
      for (const v of state.visitors || []) if (v.active && v.type !== 'cat') this._drawVisitor(ctx, v, state);
      if (dragged) this._drawObject(ctx, dragged, state, warn);
      this._drawBursts(ctx);
      this._drawFlies(ctx);
      this._drawPops(ctx);
      this._drawDoor(ctx);
    }
    ctx.restore();
    this._rememberBabies(state);

    if (this.fx.flashT > 0) {
      ctx.globalAlpha = this.fx.flashT / 0.2;
      ctx.fillStyle = COLORS.flash;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  _detectLanding(state) {
    if (!state || !state.babies) return;
    for (const b of state.babies) {
      const prev = this.prevAnim.get(b.id);
      if (prev === 'held' && b.anim !== 'held') this.fx.start('land', b.id, 0.3);
      this.prevAnim.set(b.id, b.anim);
    }
  }

  /** 這うアニメの位相：baby.speed（実効速度）に比例して進める。止まっている間は進まない */
  _advanceBabyPhases(state, dt) {
    if (!state || !state.babies) return;
    const base = TUNING.BABY_SPEED || 1;
    for (const b of state.babies) {
      let ph = this.babyPhase.get(b.id) || 0;
      if (b.anim === 'crawl') {
        const k = Math.max(0.3, Math.min(2.5, (b.speed || base) / base));
        ph += dt * CRAWL_RATE * k;
      }
      this.babyPhase.set(b.id, ph);
    }
  }

  /** 訪問者の歩行位相：active で動いている間だけ進む */
  _advanceVisitorPhases(state, dt) {
    if (!state || !state.visitors) return;
    for (const v of state.visitors) {
      if (!v.active) continue;
      const moving = Math.abs(v.dirX || 0) + Math.abs(v.dirY || 0) > 0.01;
      const rate = v.type === 'cat' ? CAT_RUN_RATE : VISITOR_WALK_RATE;
      this.visitorPhase.set(v.id, (this.visitorPhase.get(v.id) || 0) + (moving ? dt * rate : 0));
    }
  }

  /** 転落・ホップ・item の落下・出入り口の光を進める */
  _tickFalls(state, dt) {
    for (const [id, f] of this.babyFalls) {
      f.t += dt;
      if (f.t >= f.dur) this.babyFalls.delete(id);
    }
    for (let i = this.itemDrops.length - 1; i >= 0; i--) {
      const d = this.itemDrops[i];
      d.t += dt;
      if (d.t >= d.dur) {
        const o = state && state.objects ? state.objects.find(x => x.id === d.id) : null;
        if (o && !d.quiet) this.fx.addBurst(o.x, o.y + 6, { count: 8, color: COLORS.puff, life: 0.4, speed: 45, size: 2.4 });
        this.itemDrops.splice(i, 1);
      }
    }
    if (this.doorFx) {
      this.doorFx.t += dt;
      if (this.doorFx.t >= this.doorFx.dur) this.doorFx = null;
    }
  }

  /** 前フレームの赤ちゃん位置（転落アニメの出発点。playEffect 時点で state は既に更新済みなので自前で持つ） */
  _rememberBabies(state) {
    if (!state || !state.babies) return;
    for (const b of state.babies) this.babyPrev.set(b.id, { x: b.x, y: b.y, climbing: b.climbing || null });
  }

  /** combo 予告中の hazard id と toy id の集合（state から導出。同位相で点滅） */
  _comboWarnSets(state) {
    const hazards = new Set();
    const toys = new Set();
    for (const b of state.babies || []) {
      if (b.comboWarnHazardId) {
        hazards.add(b.comboWarnHazardId);
        if (b.carrying) toys.add(b.carrying);
      }
    }
    const placement = placementWarnings(state);
    return {
      hazards, toys, on: Math.sin(this.t * 10) > 0,
      placement, placementTargets: new Set(placement.map(p => p.targetId))
    };
  }

  _drawFloor(ctx) {
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, ROOM.w, ROOM.h);
    // 床板の目
    ctx.strokeStyle = COLORS.floorLine;
    ctx.lineWidth = 1;
    for (let y = 0; y <= ROOM.h; y += 45) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ROOM.w, y); ctx.stroke();
    }
    for (let x = 0; x <= ROOM.w; x += 90) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ROOM.h); ctx.stroke();
    }
    // 中央のラグ。面のハザード（§12.1）の矩形と紛れないよう、縁取り・内側の線・房で「敷物」だと分かるようにする
    const rx = ROOM.cx - 130;
    const ry = ROOM.cy - 80;
    ctx.fillStyle = COLORS.rug;
    roundRect(ctx, rx, ry, 260, 160, 18);
    ctx.fill();
    ctx.strokeStyle = COLORS.rugEdge;
    ctx.lineWidth = 3;
    roundRect(ctx, rx, ry, 260, 160, 18);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    roundRect(ctx, rx + 10, ry + 10, 240, 140, 12);
    ctx.stroke();
    ctx.strokeStyle = COLORS.rugFringe;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let fy = ry + 14; fy < ry + 160 - 10; fy += 12) {
      ctx.moveTo(rx - 6, fy); ctx.lineTo(rx, fy);
      ctx.moveTo(rx + 260, fy); ctx.lineTo(rx + 266, fy);
    }
    ctx.stroke();
  }

  /**
   * 面のハザード（§12.1）：床に矩形を描く。`open` は警告色の半透明＋斜線、`fixed` は淡色。
   * 赤ちゃんが中にいる間は滞在割合（zoneDwellFraction）をリングとゲージで見せる。
   * 対策後に再発する zone（こぼれた水）は、respawnAt が近づくと縁が点滅する。
   */
  _drawZones(ctx, state, warn) {
    const elapsed = state.elapsed || 0;
    for (const z of zoneRects(state)) {
      const x = z.x - z.w / 2;
      const y = z.y - z.h / 2;
      const open = z.state === 'open';
      const inactive = z.state === 'inactive';
      const hinted = !!(warn && warn.hints && warn.hints.has(z.id));
      const frac = open ? zoneDwellFraction(state, z.id) : 0;

      ctx.save();
      roundRect(ctx, x, y, z.w, z.h, 12);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = open ? COLORS.zoneOpen : COLORS.zoneFixed;
      if (inactive) ctx.globalAlpha = 0.5;
      ctx.fillRect(x, y, z.w, z.h);
      if (open) {
        // 斜線（危険の面であることを床の模様と区別する）
        ctx.strokeStyle = COLORS.zoneHatch;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = -z.h; i < z.w; i += 14) {
          ctx.moveTo(x + i, y + z.h);
          ctx.lineTo(x + i + z.h, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // 縁：open は脈打つ実線、fixed は淡い破線。再発予告中は速く点滅
      const respawnSoon = !open && z.obj.respawnAt != null && z.obj.respawnAt - elapsed <= TUNING.RESPAWN_WARN_SEC;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * (respawnSoon ? 12 : 4));
      ctx.strokeStyle = open ? COLORS.zoneOpenEdge : COLORS.zoneFixedEdge;
      ctx.lineWidth = open ? 2.5 : 2;
      ctx.globalAlpha = open ? 0.45 + 0.4 * pulse : (respawnSoon ? 0.35 + 0.5 * pulse : 0.5);
      if (!open) ctx.setLineDash([7, 6]);
      roundRect(ctx, x, y, z.w, z.h, 12);
      ctx.stroke();
      ctx.restore();

      // ドラッグ中のヒント（タオル → こぼれた水）：内側にもう一本、脈打つ破線
      if (hinted) {
        const k = 0.5 + 0.5 * Math.sin(this.t * 6);
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.45 * k;
        ctx.strokeStyle = COLORS.hint;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -this.t * 30;
        ctx.shadowColor = COLORS.hint;
        ctx.shadowBlur = 4 + 8 * k;
        roundRect(ctx, x + 4, y + 4, z.w - 8, z.h - 8, 10);
        ctx.stroke();
        ctx.restore();
      }

      // 中央：絵文字＋ラベル（対策済みは ✅）
      ctx.save();
      ctx.globalAlpha = open ? 0.9 : 0.75;
      this._drawEmoji(ctx, z.emoji, z.x, z.y - 6, 22);
      ctx.restore();
      this._drawLabel(ctx, z.label, z.x, z.y + 8, open ? COLORS.zoneInk : COLORS.zoneFixedInk);
      if (!open && !inactive) this._drawEmoji(ctx, '✅', z.x + 20, z.y - 16, 16);

      // 滞在の進捗（危険リングと足元のゲージ）
      if (frac > 0) {
        this._drawDangerRing(ctx, z.x, z.y - 30, 13, frac);
        const gw = Math.min(z.w - 20, 90);
        const gx = z.x - gw / 2;
        const gy = z.y + z.h / 2 - 12;
        ctx.save();
        ctx.fillStyle = COLORS.dangerTrack;
        roundRect(ctx, gx, gy, gw, 6, 3);
        ctx.fill();
        ctx.fillStyle = COLORS.danger;
        roundRect(ctx, gx, gy, Math.max(2, gw * frac), 6, 3);
        ctx.fill();
        ctx.restore();
      }
      this._drawFixDone(ctx, z.x, z.y, z.id);
    }
  }

  /** 成立中の配置コンボ（§12.3）：mover と target を警告色の破線で結び、中点にラベルを出す */
  _drawPlacementLinks(ctx, warn) {
    const list = (warn && warn.placement) || [];
    if (!list.length) return;
    const k = 0.5 + 0.5 * Math.sin(this.t * 8);
    for (const p of list) {
      const dx0 = p.target.x - p.mover.x;
      const dy0 = p.target.y - p.mover.y;
      const len0 = Math.max(1, Math.hypot(dx0, dy0));
      // ほとんど接している（＝両端のアイコンが隣り合っている）ときは線を描かない。target のリングで足りる
      if (len0 - 2 * (OBJ_R + 14) < 10) continue;
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.45 * k;
      ctx.strokeStyle = COLORS.placement;
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 6]);
      ctx.lineDashOffset = -this.t * 40;
      ctx.shadowColor = COLORS.dangerGlow;
      ctx.shadowBlur = 6 + 8 * k;
      // 両端をオブジェクトの縁で止める（アイコン・ラベルの上に線を重ねない）
      const dx = p.target.x - p.mover.x;
      const dy = p.target.y - p.mover.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const trim = Math.min(len / 2 - 1, OBJ_R + 14);
      ctx.beginPath();
      ctx.moveTo(p.mover.x + (dx / len) * trim, p.mover.y + (dy / len) * trim);
      ctx.lineTo(p.target.x - (dx / len) * trim, p.target.y - (dy / len) * trim);
      ctx.stroke();
      ctx.restore();
      // 中点のラベルは出さない：target のリングと短いラベル 1 つに集約する（壁ラベル・オブジェクト名との三重表示を避ける）
    }
  }

  /** push をドラッグ中：「ここから離すと安全」の円（今は踏み台なら赤、離れていれば緑） */
  _drawPushTargets(ctx, state) {
    const list = pushTargets(state);
    if (!list.length) return;
    const k = 0.5 + 0.5 * Math.sin(this.t * 5);
    for (const t of list) {
      const danger = t.active;
      ctx.save();
      ctx.globalAlpha = (danger ? 0.55 : 0.4) + 0.3 * k;
      ctx.strokeStyle = danger ? COLORS.placement : COLORS.hint;
      ctx.fillStyle = danger ? COLORS.hintFullFill : COLORS.hintFill;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -this.t * 25;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.need, 0, Math.PI * 2);
      ctx.globalAlpha *= 0.35;
      ctx.fill();
      ctx.globalAlpha = (danger ? 0.55 : 0.4) + 0.3 * k;
      ctx.stroke();
      ctx.restore();
      if (t.fixed) continue;
      this._drawLabel(ctx, danger ? 'この中は踏み台になる' : 'ここまで離せば安全', t.x, t.y + t.need + 2, danger ? COLORS.placementInk : COLORS.hintInk);
    }
  }

  /**
   * 壁（家具）。highPlace の wall はラベル横に `n/容量`（§11.2）、ドラッグ中はヒント（脈打つ破線と「高い場所へ」）。
   * 満杯なら「満」を付け、ヒントは赤く薄く（置けない）
   */
  _drawWalls(ctx, walls, hinted, state) {
    for (const wl of walls) {
      ctx.fillStyle = COLORS.wall;
      ctx.strokeStyle = COLORS.wallEdge;
      ctx.lineWidth = 2;
      roundRect(ctx, wl.x, wl.y, wl.w, wl.h, 6);
      ctx.fill();
      ctx.stroke();
      const full = !!(wl.highPlace && state && isHighPlaceFull(state, wl));
      const isHint = !!(hinted && hinted.has(wl.model));
      if (isHint) {
        const k = 0.5 + 0.5 * Math.sin(this.t * 6);
        ctx.save();
        ctx.fillStyle = full ? COLORS.hintFullFill : COLORS.hintFill;
        ctx.globalAlpha = full ? 0.5 : 0.6 + 0.4 * k;
        roundRect(ctx, wl.x, wl.y, wl.w, wl.h, 6);
        ctx.fill();
        ctx.globalAlpha = full ? 0.5 : 0.55 + 0.45 * k;
        ctx.strokeStyle = full ? COLORS.hintFull : COLORS.hint;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = full ? 0 : -this.t * 30;
        ctx.shadowColor = full ? COLORS.hintFull : COLORS.hint;
        ctx.shadowBlur = full ? 0 : 4 + 8 * k;
        roundRect(ctx, wl.x + 2.5, wl.y + 2.5, wl.w - 5, wl.h - 5, 5);
        ctx.stroke();
        ctx.restore();
      }
      let label = wl.label || '';
      if (wl.highPlace && state) {
        const n = highPlaceCount(state, wl);
        const cap = wallCapacity(wl);
        label = `${label ? label + ' ' : ''}${n}/${cap}${full ? ' 満' : ''}`;
      }
      const hintText = full ? '満：もう置けない' : '↑ 高い場所へ';
      const hintInk = full ? COLORS.hintFullInk : COLORS.hintInk;
      if (label) {
        this._wallText(ctx, wl, label, isHint ? -8 : 0, `12px ${FONT_UI}`, full ? COLORS.hintFullInk : COLORS.wallText);
        if (isHint) this._wallText(ctx, wl, hintText, 8, `bold 11px ${FONT_UI}`, hintInk);
      } else if (isHint) {
        this._wallText(ctx, wl, hintText, 0, `bold 11px ${FONT_UI}`, hintInk);
      }
    }
  }

  /** 壁の中央に文字（縦長なら 90° 回転）。dy は文字の並び方向に直交するオフセット */
  _wallText(ctx, wl, text, dy, font, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(wl.x + wl.w / 2, wl.y + wl.h / 2);
    const vertical = wl.h > wl.w * 1.4;
    if (vertical) ctx.rotate(-Math.PI / 2);
    ctx.fillText(text, 0, dy);
    ctx.restore();
  }

  _kindColors(o) {
    if (isStored(o)) return [COLORS.stored, COLORS.storedEdge];
    if (o.kind === 'hazard' && o.state === 'fixed') return [COLORS.fixed, COLORS.fixedEdge];
    if (o.kind === 'hazard') return [COLORS.hazard, COLORS.hazardEdge];
    if (o.kind === 'item') return [COLORS.item, COLORS.itemEdge];
    if (o.kind === 'goods') return [COLORS.goods, COLORS.goodsEdge];
    if (o.kind === 'container') return [COLORS.container, COLORS.containerEdge];
    if (o.kind === 'prop') return [COLORS.prop, COLORS.propEdge];
    return [COLORS.toy, COLORS.toyEdge];
  }

  _drawObject(ctx, o, state, warn) {
    const elapsed = state.elapsed || 0;

    if (o.state === 'removed') {
      // 再発予告：出現位置（定義位置 spawnX/spawnY。捨てた場所ではない）で点線が点滅
      if (o.respawnAt != null && o.respawnAt - elapsed <= TUNING.RESPAWN_WARN_SEC) {
        const rx = typeof o.spawnX === 'number' ? o.spawnX : o.x;
        const ry = typeof o.spawnY === 'number' ? o.spawnY : o.y;
        const on = Math.sin(this.t * 12) > 0;
        ctx.save();
        ctx.globalAlpha = on ? 0.75 : 0.25;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = COLORS.itemEdge;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rx, ry, OBJ_R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // 片付け直後の緑リング
      this._drawFixDone(ctx, o.x, o.y, o.id);
      return;
    }
    // 使い終わった安全グッズは消える（成立の演出は hazard 側と粒で出る）
    if (o.state === 'used') return;
    // 赤ちゃんが持っている toy／口に入れている物は _drawBaby が、猫がくわえている物は _drawCat が描く。
    // 兄が持っているおもちゃ（carriedBy = 訪問者 id）は _drawSibling が描く
    if (o.carriedBy != null) return;
    // 面のハザード（§12.1）は床の矩形として _drawZones が描く
    if (o.zone) return;
    // 高い場所・収納先に置かれた hazard：小さく灰色に ✅
    if (isStored(o)) { this._drawStored(ctx, o, state); return; }
    // 登れる家具（ソファ）：前縁の小さなクッション。fixed ならマット（_drawMats）に ✅。
    // 窓・ベランダのように配置コンボで一時的に climbable になるものはここでは扱わない（§12.3）
    if (isFurnitureClimbable(o)) { this._drawClimbable(ctx, o, state, warn); return; }

    let x = o.x;
    let y = o.y;
    if (state.drag && state.drag.targetId === o.id) {
      x = state.drag.x;
      y = state.drag.y;
    }
    let sc = 1;
    let dy = 0;
    let dx = 0;
    // 訪問者の手元から落ちてくる（visitor_drop）：手の高さから床へ加速しながら落ちる
    const vdrop = this.itemDrops.find(d => d.id === o.id);
    if (vdrop) {
      const k = Math.min(1, vdrop.t / vdrop.dur);
      dx += (vdrop.from.x - x) * (1 - k);
      dy += (vdrop.from.y - y) * (1 - k * k);
    }
    const bounce = this.fx.progress('bounce', o.id);
    if (bounce != null) {
      sc = 1 + 0.25 * Math.sin(Math.PI * bounce);
      dy = -10 * Math.sin(Math.PI * bounce);
    }
    // 合成で生まれた直後：スケールバウンス（0 → 1.3 → 1）
    const popin = this.fx.progress('popin', o.id);
    if (popin != null) {
      const k = easeOut(popin);
      sc *= Math.max(0.05, k * (1 + 0.45 * Math.sin(Math.PI * Math.min(1, popin * 1.4))));
    }
    // レシピ不成立：グッズが小さく震える
    const gshake = this.fx.progress('gshake', o.id);
    if (gshake != null) dx = Math.sin(gshake * 40) * 4 * (1 - gshake);
    // 重いものを引っ張った：「動かない」の小さな揺れ
    const nudge = this.fx.progress('nudge', o.id);
    if (nudge != null) dx += Math.sin(nudge * 32) * 3 * (1 - nudge);
    // 合成 toy は少し大きく
    if (o.merged) sc *= 1.15;

    this._drawDropRing(ctx, x, y, o.id);

    ctx.save();
    ctx.translate(x + dx, y + dy);
    ctx.scale(sc, sc);

    const dragging = state.drag && state.drag.targetId === o.id;
    if (dragging) {
      ctx.fillStyle = COLORS.shadow;
      ctx.beginPath();
      ctx.ellipse(4, 10, OBJ_R * 0.9, OBJ_R * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(0, -8);
    }

    const [fill, edge] = this._kindColors(o);
    const bored = o.kind === 'toy' && o.state === 'bored';
    const isGoods = o.kind === 'goods';
    const isBin = o.kind === 'container';
    const isProp = o.kind === 'prop';
    const isPush = isPushable(o);
    const heavyFurniture = o.kind === 'hazard' && isHeavy(o);
    // 時限ハザード（§12.2）：まだ危険ではないが来る。薄く描き、ACTIVATE_WARN_SEC 以内は点滅させる
    const actFrac = activationFraction(state, o);
    const inactive = actFrac != null;
    const actWarn = inactive && actFrac < 1;
    const actBlink = 0.5 + 0.5 * Math.sin(this.t * 12);

    // 合成 toy：柔らかい金色のグロー（特別なものだと分かるように）
    if (o.merged) {
      ctx.save();
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.t * 3);
      ctx.strokeStyle = COLORS.merged;
      ctx.lineWidth = 3;
      ctx.shadowColor = COLORS.mergedGlow;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(0, 0, OBJ_R + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ヒント：ドラッグ中のもののドロップ先（グッズの相手・合成相手・収納先・容れ物）を、やわらかく脈打つ輪で示す
    const hinted = !!(warn.hints && warn.hints.has(o.id));
    if (hinted) {
      const k = 0.5 + 0.5 * Math.sin(this.t * 6);
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.45 * k;
      ctx.strokeStyle = COLORS.hint;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.t * 30;
      ctx.shadowColor = COLORS.hint;
      ctx.shadowBlur = 6 + 8 * k;
      ctx.beginPath();
      ctx.arc(0, 0, OBJ_R + 9 + 3 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 遊び開始の短いハイライト
    const ps = this.fx.progress('playstart', o.id);
    if (ps != null) {
      ctx.save();
      ctx.globalAlpha = 1 - ps;
      ctx.strokeStyle = COLORS.playStart;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, OBJ_R + 3 + 14 * easeOut(ps), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 押して動かせる家具（§12.3）：床に脈打つ破線の楕円と左右の矢印。重い家具（鍵）と区別して「掴める」と伝える
    if (isPush) {
      const k = 0.5 + 0.5 * Math.sin(this.t * 4);
      ctx.save();
      ctx.globalAlpha = dragging ? 0.9 : 0.5 + 0.35 * k;
      ctx.strokeStyle = COLORS.pushEdge;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.t * 20;
      ctx.beginPath();
      ctx.ellipse(0, OBJ_R * 0.7, OBJ_R * 1.25, OBJ_R * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      for (const dir of [-1, 1]) {
        const ax = dir * (OBJ_R * 1.25 + 5);
        ctx.beginPath();
        ctx.moveTo(ax - dir * 4, OBJ_R * 0.7 - 4);
        ctx.lineTo(ax + dir * 2, OBJ_R * 0.7);
        ctx.lineTo(ax - dir * 4, OBJ_R * 0.7 + 4);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 重い家具：濃く広い影（床に据え付けられている印）
    if (heavyFurniture || isBin) {
      ctx.save();
      ctx.fillStyle = COLORS.heavyShadow;
      ctx.beginPath();
      ctx.ellipse(0, OBJ_R * 0.6, OBJ_R * 1.15, OBJ_R * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.globalAlpha = inactive ? (actWarn ? 0.4 + 0.4 * actBlink : 0.4) : (bored ? 0.5 : 1);
    ctx.fillStyle = inactive ? COLORS.inactive : fill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    if (isGoods) {
      // 安全グッズ：角丸のタグ（左に穴、右に絵文字）
      roundRect(ctx, -GOODS_W / 2, -GOODS_H / 2, GOODS_W, GOODS_H, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.floor;
      ctx.beginPath();
      ctx.arc(-GOODS_W / 2 + 8, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.goodsEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this._drawEmoji(ctx, o.emoji, 5, 1, 18);
    } else if (isBin) {
      this._drawBin(ctx, o, hinted);
    } else if (isProp) {
      // ダミー（§11.3）：落ち着いたベージュの角丸に絵文字。リング・バッジは無し
      roundRect(ctx, -PROP_W / 2, -PROP_H / 2, PROP_W, PROP_H, 8);
      ctx.fill();
      ctx.stroke();
      this._drawEmoji(ctx, o.emoji, 0, 1, 18);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, OBJ_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      this._drawEmoji(ctx, o.emoji, 0, 1, 20);
      // 容れ物にもなる hazard（ゴミ箱）：小さな蓋
      if (o.container) this._drawLid(ctx, 0, -OBJ_R - 2, 26, hinted);
      // 危険なおもちゃ（§11.4）：右上に小さなオレンジの「！」
      if (o.kind === 'toy' && o.ingestible) this._drawRiskBadge(ctx, OBJ_R * 0.72, -OBJ_R * 0.72);
    }
    ctx.globalAlpha = 1;

    // 重い家具（未対策）：小さな鍵の印 →「動かせない。グッズで対策」
    if (heavyFurniture && o.state !== 'fixed') this._drawLock(ctx, -OBJ_R * 0.8, OBJ_R * 0.62, 8);

    // ラベル（グッズは色付き文字で「道具」だと分かるように）。
    // 壁（家具）と同じ model 名を持つ hazard（窓・ベランダ柵）は壁のラベルと二重になるので出さない
    const onWall = !!findWall(state.stage, o.id);
    const placementWarn = !!(warn.placementTargets && warn.placementTargets.has(o.id));
    if (isGoods) this._drawLabel(ctx, o.label, 0, GOODS_H / 2 + 4, COLORS.goodsInk);
    else if (isBin) this._drawLabel(ctx, o.label, 0, BIN_H / 2 + 4);
    else if (isProp) this._drawLabel(ctx, o.label, 0, PROP_H / 2 + 4, COLORS.propInk);
    else if (placementWarn) this._drawBadge(ctx, '踏み台！ 登れる', 0, OBJ_R + 20, COLORS.placementInk);
    else if (!onWall) this._drawLabel(ctx, o.label, 0, OBJ_R + 4);

    // 時限ハザード（§12.2）：残り時間の破線リングと「まもなく」。対策済みの見た目（緑＋✅）とは区別する
    if (inactive) {
      const remain = Math.max(0, (o.activeAt || 0) - (state.elapsed || 0));
      ctx.save();
      ctx.globalAlpha = actWarn ? 0.5 + 0.5 * actBlink : 0.6;
      ctx.strokeStyle = actWarn ? COLORS.danger : COLORS.inactive;
      ctx.lineWidth = actWarn ? 3 : 2;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -this.t * 16;
      ctx.beginPath();
      ctx.arc(0, 0, OBJ_R + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      this._drawLabel(ctx, actWarn ? `まもなく！ ${remain.toFixed(1)}秒` : `あと ${Math.ceil(remain)}秒`,
        0, OBJ_R + 17, actWarn ? COLORS.zoneInk : COLORS.inactiveInk);
    }

    // 押して動かせる家具：ラベルの下に操作のヒント
    if (isPush) this._drawLabel(ctx, '押せる', 0, OBJ_R + 17, COLORS.pushInk);

    // ✅（対策済み hazard）。ignoresFix の combo ヒヤリで一瞬揺れる
    if (o.kind === 'hazard' && o.state === 'fixed') {
      let sx = 0;
      const shake = this.fx.progress('shake', o.id);
      if (shake != null) sx = Math.sin(shake * 40) * 5 * (1 - shake);
      this._drawEmoji(ctx, '✅', OBJ_R * 0.7 + sx, -OBJ_R * 0.7, 15);
    }

    // 飽き表示（bored toy）：半透明 +「あきた」+ 残り時間のリング
    if (bored) this._drawBored(ctx, o, elapsed, 0, 0, OBJ_R);

    // combo 予告：同期点滅リング
    if (warn.hazards.has(o.id) || warn.toys.has(o.id)) this._drawComboRing(ctx, 0, 0, OBJ_R + 4, warn.on);

    // 配置コンボ（§12.3）の target：踏み台になっている＝登れる。強い警告リングと文字
    if (warn.placementTargets && warn.placementTargets.has(o.id)) {
      const k = 0.5 + 0.5 * Math.sin(this.t * 8);
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * k;
      ctx.strokeStyle = COLORS.placement;
      ctx.lineWidth = 4;
      ctx.shadowColor = COLORS.dangerGlow;
      ctx.shadowBlur = 6 + 10 * k;
      ctx.beginPath();
      ctx.arc(0, 0, OBJ_R + 10 + 2 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    this._drawFixDone(ctx, x, y, o.id);
  }

  /** 登れる家具の壁矩形（wall.model === object id）。無ければ家具位置を中心にした代替矩形 */
  _climbWall(stage, o) {
    return findWall(stage, o.id) || { x: o.x - 100, y: o.y - 84, w: 200, h: 70, model: o.id };
  }

  /** マット：climbable な hazard が fixed のとき、家具の前の床に緑のジョイントマット（幅は家具と同じ、奥行き MAT_H） */
  _drawMats(ctx, state) {
    for (const o of state.objects || []) {
      if (!isFurnitureClimbable(o) || o.state !== 'fixed') continue;
      const wl = this._climbWall(state.stage, o);
      const mx = wl.x;
      const my = wl.y + wl.h;
      const mw = wl.w;
      ctx.save();
      ctx.fillStyle = COLORS.mat;
      ctx.strokeStyle = COLORS.matEdge;
      ctx.lineWidth = 2;
      roundRect(ctx, mx, my, mw, MAT_H, 6);
      ctx.fill();
      ctx.stroke();
      // ジョイントの目（40px タイル）
      ctx.strokeStyle = COLORS.matGrid;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let gx = mx + 40; gx < mx + mw - 1; gx += 40) { ctx.moveTo(gx, my + 3); ctx.lineTo(gx, my + MAT_H - 3); }
      ctx.moveTo(mx + 3, my + MAT_H / 2); ctx.lineTo(mx + mw - 3, my + MAT_H / 2);
      ctx.stroke();
      ctx.restore();
      this._drawLabel(ctx, 'マット', mx + mw / 2, my + MAT_H / 2 - 7, COLORS.matInk);
    }
  }

  /** 登れる家具（ソファ）の object：open の間は前縁に小さなクッション＋「登れる」。fixed ならマット右端に ✅ */
  _drawClimbable(ctx, o, state, warn) {
    const elapsed = state.elapsed || 0;
    const wl = this._climbWall(state.stage, o);
    if (o.state === 'fixed') {
      let sx = 0;
      const shake = this.fx.progress('shake', o.id);
      if (shake != null) sx = Math.sin(shake * 40) * 5 * (1 - shake);
      const cx = wl.x + wl.w - 18;
      const cy = wl.y + wl.h + MAT_H / 2;
      this._drawEmoji(ctx, '✅', cx + sx, cy, 17);
      this._drawFixDone(ctx, o.x, o.y + 6, o.id);
      return;
    }
    let dx = 0;
    const nudge = this.fx.progress('nudge', o.id);
    if (nudge != null) dx = Math.sin(nudge * 32) * 3 * (1 - nudge);
    const resting = o.boredUntil != null && o.boredUntil > elapsed;   // 降りた直後は候補外（薄く）
    const hinted = !!(warn.hints && warn.hints.has(o.id));
    ctx.save();
    ctx.translate(o.x + dx, o.y);
    if (hinted) {
      const k = 0.5 + 0.5 * Math.sin(this.t * 6);
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.45 * k;
      ctx.strokeStyle = COLORS.hint;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.t * 30;
      ctx.shadowColor = COLORS.hint;
      ctx.shadowBlur = 6 + 8 * k;
      roundRect(ctx, -26 - 3 * k, -16 - 3 * k, 52 + 6 * k, 32 + 6 * k, 10);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = resting ? 0.6 : 1;
    // クッション（角丸・中央にボタン）
    ctx.fillStyle = COLORS.cushion;
    ctx.strokeStyle = COLORS.cushionEdge;
    ctx.lineWidth = 2;
    roundRect(ctx, -17, -9, 34, 18, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.cushionEdge;
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = resting ? 0.5 : 0.85;
    this._drawLabel(ctx, hinted ? 'マットを敷く' : '登れる', 0, 11, hinted ? COLORS.hintInk : COLORS.cushionInk);
    ctx.restore();
    if (warn.hazards.has(o.id)) this._drawComboRing(ctx, o.x, o.y, OBJ_R + 4, warn.on);
    this._drawFixDone(ctx, o.x, o.y, o.id);
  }

  /** 訪問者。type で分岐：'cat' は低く速い 4 足（_drawCat）、'sibling' は小さい人型（_drawSibling）、それ以外（既定 'uncle'）は背の高い人型 */
  _drawVisitor(ctx, v, state) {
    if (v.type === 'cat') { this._drawCat(ctx, v, state); return; }
    if (v.type === 'sibling') { this._drawSibling(ctx, v, state); return; }
    const ph = this.visitorPhase.get(v.id) || 0;
    const bob = Math.abs(Math.sin(ph)) * 2.5;
    const dirX = v.dirX || 0;
    const lean = Math.max(-1, Math.min(1, dirX)) * 0.06;
    const swing = Math.sin(ph);

    // 影
    ctx.save();
    ctx.fillStyle = COLORS.shadow;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.ellipse(v.x, v.y + 5, 17, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(v.x, v.y - bob);
    ctx.rotate(lean);
    // 脚（歩行で前後に）
    ctx.fillStyle = COLORS.visitorPants;
    roundRect(ctx, -10 + swing * 2, -8, 8, 14, 3);
    ctx.fill();
    roundRect(ctx, 2 - swing * 2, -8, 8, 14, 3);
    ctx.fill();
    // 体（シャツ）
    ctx.fillStyle = COLORS.visitorShirt;
    ctx.strokeStyle = COLORS.visitorShirtEdge;
    ctx.lineWidth = 2;
    roundRect(ctx, -14, -48, 28, 44, 10);
    ctx.fill();
    ctx.stroke();
    // 腕（進行方向側が前に振れる）
    ctx.save();
    ctx.translate(dirX >= 0 ? 12 : -12, -42);
    ctx.rotate((dirX >= 0 ? 1 : -1) * swing * 0.35);
    ctx.fillStyle = COLORS.visitorShirt;
    roundRect(ctx, -3.5, 0, 7, 24, 3.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.visitorSkin;
    ctx.beginPath();
    ctx.arc(0, 26, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 頭（絵文字。後ろに薄い丸で読みやすく）
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(0, -58, 14, 0, Math.PI * 2);
    ctx.fill();
    this._drawEmoji(ctx, v.emoji || '🧔', 0, -57, 28);
    ctx.restore();

    this._drawLabel(ctx, v.label || 'おじさん', v.x, v.y + 12, COLORS.visitorInk);
  }


  /**
   * 兄（§12.4）：おじさんより小さい人型（🧒）。ステージ終了まで居座り、周期的に小物を散らかす。
   * おもちゃを渡されている間（busyUntil > elapsed）は動かず、そのおもちゃを手元に持ち、
   * 頭上に残り時間のリングを出す（＝いつまた散らかし始めるかが分かる）。
   */
  _drawSibling(ctx, v, state) {
    const elapsed = state.elapsed || 0;
    const busyLeft = v.busyUntil != null ? Math.max(0, v.busyUntil - elapsed) : 0;
    const busy = busyLeft > 0;
    const ph = this.visitorPhase.get(v.id) || 0;
    const bob = busy ? Math.abs(Math.sin(this.t * 2)) * 1.2 : Math.abs(Math.sin(ph)) * 2.2;
    const dirX = v.dirX || 0;
    const swing = busy ? 0 : Math.sin(ph);

    // 影
    ctx.save();
    ctx.fillStyle = COLORS.shadow;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.ellipse(v.x, v.y + 4, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(v.x, v.y - bob);
    ctx.scale(SIBLING_SCALE, SIBLING_SCALE);
    ctx.rotate(Math.max(-1, Math.min(1, dirX)) * 0.05);
    // 脚
    ctx.fillStyle = COLORS.siblingPants;
    roundRect(ctx, -10 + swing * 2, -8, 8, 14, 3);
    ctx.fill();
    roundRect(ctx, 2 - swing * 2, -8, 8, 14, 3);
    ctx.fill();
    // 体
    ctx.fillStyle = COLORS.siblingShirt;
    ctx.strokeStyle = COLORS.siblingShirtEdge;
    ctx.lineWidth = 2;
    roundRect(ctx, -14, -46, 28, 42, 10);
    ctx.fill();
    ctx.stroke();
    // 腕
    ctx.save();
    ctx.translate(dirX >= 0 ? 12 : -12, -40);
    ctx.rotate((dirX >= 0 ? 1 : -1) * swing * 0.3);
    ctx.fillStyle = COLORS.siblingShirt;
    roundRect(ctx, -3.5, 0, 7, 22, 3.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.visitorSkin;
    ctx.beginPath();
    ctx.arc(0, 24, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 頭（絵文字）
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(0, -54, 13, 0, Math.PI * 2);
    ctx.fill();
    this._drawEmoji(ctx, v.emoji || '🧒', 0, -53, 26);
    ctx.restore();

    // 渡したおもちゃ（carriedBy = 訪問者 id）は手元に描く。_drawObject は carriedBy != null を描かない
    if (v.carrying) {
      const toy = (state.objects || []).find(x => x.id === v.carrying);
      if (toy && toy.state !== 'removed') this._drawMiniObject(ctx, toy, v.x + 12, v.y - SIBLING_HAND_H - bob, MOUTH_SCALE);
    }
    // おとなしくしている残り時間（尽きると床に戻してまた散らかし始める）
    if (busy) {
      const total = Math.max(0.1, TUNING.SIBLING_BUSY_SEC || busyLeft);
      this._drawRing(ctx, v.x, v.y - 52, 9, Math.max(0, Math.min(1, busyLeft / total)));
      this._drawEmoji(ctx, '🎵', v.x + 16, v.y - 56, 14);
    }
    this._drawLabel(ctx, busy ? `${v.label || 'お兄ちゃん'}（あそび中）` : (v.label || 'お兄ちゃん'), v.x, v.y + 10, COLORS.siblingInk);
  }

  /**
   * 猫（§11.5）：低く細長い体・4 本の速い脚・しっぽ・🐈 の頭。dirX の向きを向く。くわえている物（visitor.carrying）を口元に描く。
   * 触れない（pickObject の対象外）
   */
  _drawCat(ctx, v, state) {
    const ph = this.visitorPhase.get(v.id) || 0;
    const dir = (v.dirX || 0) >= 0 ? 1 : -1;
    const moving = Math.abs(v.dirX || 0) + Math.abs(v.dirY || 0) > 0.01;
    const run = moving ? Math.sin(ph) : 0;
    const bob = moving ? Math.abs(Math.cos(ph)) * 1.6 : 0;
    const cx = v.x;
    const cy = v.y;

    // 影
    ctx.save();
    ctx.fillStyle = COLORS.shadow;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 22, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy - bob);
    ctx.scale(dir, 1);            // 進行方向を向く（右向きが基準）
    // しっぽ（後ろ。走ると上下に振れる）
    ctx.strokeStyle = COLORS.catFurDark;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-14, -4);
    ctx.quadraticCurveTo(-26, -6 - run * 3, -30, -16 + Math.sin(this.t * 4) * 2);
    ctx.stroke();
    // 脚（4 本。前後で位相をずらし、速く動く）
    ctx.fillStyle = COLORS.catFurDark;
    const legs = [[-9, 1], [-5, -1], [6, -1], [10, 1]];
    for (let i = 0; i < legs.length; i++) {
      const [lx, sign] = legs[i];
      const sw = run * sign * 4;
      roundRect(ctx, lx - 2 + sw, 0, 4, 9, 2);
      ctx.fill();
    }
    // 体（細長い）
    ctx.fillStyle = COLORS.catFur;
    ctx.strokeStyle = COLORS.catFurDark;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -4, 17, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 頭（前。絵文字。後ろに薄い丸で読みやすく）
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(16, -9, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(dir, 1);            // 絵文字は反転させない
    this._drawEmoji(ctx, v.emoji || '🐈', 16 * dir, -9, 20);
    ctx.restore();

    // くわえている物（口元に小さく）
    if (v.carrying) {
      const o = (state.objects || []).find(x => x.id === v.carrying);
      if (o && o.state !== 'removed') {
        const m = this._catMouthPos(v);
        this._drawMiniObject(ctx, o, m.x, m.y - bob, MOUTH_SCALE);
      }
    }
    this._drawLabel(ctx, v.label || 'ねこ', cx, cy + 12, COLORS.catInk);
  }

  /** 物を小さく描く（口元・猫の口）。kind 色の丸に絵文字。prop は角丸 */
  _drawMiniObject(ctx, o, x, y, sc) {
    const [fill, edge] = this._kindColors(o);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.fillStyle = fill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2.5;
    if (o.kind === 'prop') {
      roundRect(ctx, -PROP_W / 2, -PROP_H / 2, PROP_W, PROP_H, 8);
    } else if (o.kind === 'goods') {
      roundRect(ctx, -GOODS_W / 2, -GOODS_H / 2, GOODS_W, GOODS_H, 9);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, OBJ_R, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    this._drawEmoji(ctx, o.emoji, 0, 1, 20);
    ctx.restore();
  }

  /** 危険なおもちゃの「！」バッジ（オレンジの丸に白い「！」） */
  _drawRiskBadge(ctx, x, y) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.risk;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, RISK_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.riskInk;
    ctx.font = `bold ${Math.round(RISK_R * 1.5)}px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('！', x, y + 0.5);
    ctx.restore();
  }

  /** 訪問者の出入り：部屋の端がふわっと明るくなる */
  _drawDoor(ctx) {
    const d = this.doorFx;
    if (!d) return;
    const k = Math.min(1, d.t / d.dur);
    const w = 70;
    const x0 = d.x === 0 ? 0 : ROOM.w - w;
    const g = ctx.createLinearGradient(d.x === 0 ? 0 : ROOM.w, 0, d.x === 0 ? w : ROOM.w - w, 0);
    g.addColorStop(0, COLORS.door);
    g.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.7;
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, w, ROOM.h);
    ctx.restore();
  }

  /** 蓋つきゴミ箱（kind 'container'）。ヒント中・捨てた直後は蓋が持ち上がる */
  _drawBin(ctx, o, hinted) {
    const w = BIN_W;
    const hgt = BIN_H;
    ctx.fillStyle = COLORS.container;
    ctx.strokeStyle = COLORS.containerEdge;
    ctx.lineWidth = 2;
    // 本体（少し末広がりの台形）
    ctx.beginPath();
    ctx.moveTo(-w / 2, -hgt / 2 + 6);
    ctx.lineTo(w / 2, -hgt / 2 + 6);
    ctx.lineTo(w / 2 - 3, hgt / 2 - 3);
    ctx.quadraticCurveTo(w / 2 - 3, hgt / 2, w / 2 - 6, hgt / 2);
    ctx.lineTo(-w / 2 + 6, hgt / 2);
    ctx.quadraticCurveTo(-w / 2 + 3, hgt / 2, -w / 2 + 3, hgt / 2 - 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 縦の筋
    ctx.strokeStyle = COLORS.containerStripe;
    ctx.lineWidth = 2;
    for (const sx of [-8, 0, 8]) {
      ctx.beginPath(); ctx.moveTo(sx, -hgt / 2 + 11); ctx.lineTo(sx, hgt / 2 - 5); ctx.stroke();
    }
    this._drawLid(ctx, 0, -hgt / 2 + 2, w + 8, hinted, o.id);
  }

  /** 蓋（中心 x, 下端 y, 幅 w）。hinted なら脈打って持ち上がり、lidpop（捨てた直後）はぱたんと開く */
  _drawLid(ctx, x, y, w, hinted, id) {
    let lift = 0;
    if (hinted) lift = 2 + 2 * (0.5 + 0.5 * Math.sin(this.t * 6));
    const pop = id != null ? this.fx.progress('lidpop', id) : null;
    if (pop != null) lift += 6 * Math.sin(Math.PI * pop);
    ctx.save();
    ctx.fillStyle = COLORS.containerLid;
    ctx.strokeStyle = COLORS.containerEdge;
    ctx.lineWidth = 2;
    roundRect(ctx, x - w / 2, y - 8 - lift, w, 8, 4);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 9 - lift, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** 小さな鍵（据え付けの印） */
  _drawLock(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = COLORS.lock;
    ctx.strokeStyle = COLORS.lock;
    ctx.lineWidth = 1.6;
    // 掛け金
    ctx.beginPath();
    ctx.arc(0, -s * 0.35, s * 0.42, Math.PI, 0);
    ctx.stroke();
    // 本体
    roundRect(ctx, -s * 0.62, -s * 0.35, s * 1.24, s * 0.95, 2);
    ctx.fill();
    ctx.fillStyle = COLORS.lockInk;
    ctx.beginPath();
    ctx.arc(0, s * 0.1, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 収納済みの hazard：置いた場所（壁の上／収納先の脇）に小さく灰色で、✅ を付けて描く */
  _drawStored(ctx, o, state) {
    const intoObj = (state.objects || []).find(x => x.id === o.storedIn);
    // 収納先がオブジェクト（引き出しなど）なら、重ならないよう少し左上に寄せる
    const dx = intoObj ? -16 : 0;
    const dy = intoObj ? -18 : 0;
    const sc = intoObj ? 0.6 : 0.78;
    ctx.save();
    ctx.translate(o.x + dx, o.y + dy);
    ctx.scale(sc, sc);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = COLORS.stored;
    ctx.strokeStyle = COLORS.storedEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, OBJ_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    this._drawEmoji(ctx, o.emoji, 0, 1, 20);
    ctx.globalAlpha = 1;
    let sx = 0;
    const shake = this.fx.progress('shake', o.id);
    if (shake != null) sx = Math.sin(shake * 40) * 5 * (1 - shake);
    this._drawEmoji(ctx, '✅', OBJ_R * 0.75 + sx, -OBJ_R * 0.75, 17);
    if (!intoObj) this._drawLabel(ctx, o.label, 0, OBJ_R + 4, COLORS.storedEdge);
    ctx.restore();
    this._drawFixDone(ctx, o.x + dx, o.y + dy, o.id);
  }

  /** 飽きの表示：文字「あきた」（上）と、boredUntil までの残り割合を示す小さなリング */
  _drawBored(ctx, o, elapsed, x, y, r) {
    const frac = boredFraction(o, elapsed, this.boredTotal.get(o.id));

    ctx.save();
    // リング（薄い軌道 + 残り分の弧。時計回りに減っていく）
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.boredTrack;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.stroke();
    if (frac > 0) {
      ctx.strokeStyle = COLORS.bored;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }
    // 文字
    ctx.font = `bold 12px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.labelHalo;
    const ty = y - r - 9 + Math.sin(this.t * 2.5) * 1;
    ctx.strokeText('あきた', x, ty);
    ctx.fillStyle = COLORS.bored;
    ctx.fillText('あきた', x, ty);
    ctx.restore();
  }

  _drawFixDone(ctx, x, y, id) {
    const k = this.fx.progress('fixdone', id);
    if (k == null) return;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = COLORS.fixedEdge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, OBJ_R + 4 + 18 * easeOut(k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawDropRing(ctx, x, y, id) {
    const k = this.fx.progress('drop', id);
    if (k == null) return;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.7;
    ctx.strokeStyle = COLORS.toyEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y + 6, (OBJ_R + 14 * easeOut(k)), (OBJ_R + 14 * easeOut(k)) * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** 進捗リング。v3 では赤ちゃんの取り上げ長押し（0.5 秒）だけに使う */
  _drawRing(ctx, x, y, r, progress) {
    const p = Math.max(0, Math.min(1, progress));
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = COLORS.ringTrack;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.ring;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.stroke();
    ctx.restore();
  }

  /** 口に入れている間の危険リング（赤）。frac = 残り時間の割合（1 → 0 で縮む） */
  _drawDangerRing(ctx, x, y, r, frac) {
    const blink = 0.75 + 0.25 * Math.sin(this.t * 10);
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.dangerTrack;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (frac > 0) {
      ctx.globalAlpha = blink;
      ctx.strokeStyle = COLORS.danger;
      ctx.lineCap = 'round';
      ctx.shadowColor = COLORS.dangerGlow;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      // 中の「！」
      ctx.shadowBlur = 0;
      ctx.fillStyle = COLORS.danger;
      ctx.font = `bold ${Math.round(r * 1.3)}px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('！', x, y + 0.5);
    }
    ctx.restore();
  }

  _drawComboRing(ctx, x, y, r, on) {
    ctx.save();
    ctx.globalAlpha = on ? 0.95 : 0.25;
    ctx.strokeStyle = COLORS.combo;
    ctx.lineWidth = 4;
    ctx.shadowColor = COLORS.combo;
    ctx.shadowBlur = on ? 10 : 0;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawEmoji(ctx, emoji, x, y, size) {
    if (!emoji) return;
    ctx.font = `${size}px ${FONT_EMOJI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(emoji, x, y);
  }

  /** 白地のバッジに乗せた文字（床の目地や線に負けない。配置コンボの警告など「読ませたい 1 行」用） */
  _drawBadge(ctx, text, x, y, color = COLORS.placementInk) {
    if (!text) return;
    ctx.save();
    ctx.font = `bold 11px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(255, 252, 246, 0.94)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x - w / 2, y - 2, w, 16, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  _drawLabel(ctx, text, x, y, color = COLORS.label) {
    if (!text) return;
    ctx.font = `11px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.labelHalo;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // ---------------------------------------------------------------- baby

  _drawBaby(ctx, b, state, warn) {
    const idx = Math.max(0, (state.babies || []).indexOf(b));
    const held = b.anim === 'held' || b.isHeld;
    const lift = held ? HELD_LIFT : 0;
    const t = this.t;
    const ph = this.babyPhase.get(b.id) || 0;
    const climbing = !!b.climbing || b.anim === 'climb';

    let bob = 0;
    let wobble = 0;
    let sx = 1;
    let sy = 1;
    let headDx = 0;     // きょろきょろ（idle）：頭が左右に振れる
    let headTilt = 0;

    // 描画位置。転落／ホップ中（babyFalls）はソファの上（from）から床（to）への弧に置き換える
    let bx = b.x;
    let by = b.y;
    let shadowY = by;                  // 影は床（着地点）に残す
    let airborne = 0;                  // 0..1：高いほど影を小さく
    const fall = this.babyFalls.get(b.id);
    if (fall) {
      const k = Math.min(1, fall.t / fall.dur);
      const to = fall.to || { x: b.x, y: b.y };
      if (fall.kind === 'hop') {
        bx = fall.from.x + (to.x - fall.from.x) * k;
        by = fall.from.y + (to.y - fall.from.y) * k - Math.sin(Math.PI * k) * 14;
        airborne = Math.sin(Math.PI * k);
      } else {
        // 転落：0.75 までで加速しながら落ち、残りでバウンド（safe はマットの上で少し大きく）
        const kf = Math.min(1, k / 0.75);
        bx = fall.from.x + (to.x - fall.from.x) * kf;
        by = fall.from.y + (to.y - fall.from.y) * kf * kf;
        airborne = 1 - kf;
        if (k > 0.75) {
          const kb = (k - 0.75) / 0.25;
          const amp = fall.kind === 'safe' ? 9 : 4;
          by -= Math.sin(Math.PI * kb) * amp;
          sx *= 1 + 0.16 * (1 - kb);
          sy *= 1 - 0.16 * (1 - kb);
        }
      }
      shadowY = to.y;
    } else if (climbing) {
      // ソファの上：手前なので少し大きく
      sx *= CLIMB_SCALE;
      sy *= CLIMB_SCALE;
    }

    switch (b.anim) {
      case 'crawl':
        // 這う揺れは baby.speed に従う位相で（速いほど速く、止まれば止まる）
        bob = Math.sin(ph) * 1.5; sx = 1 + Math.sin(ph) * 0.03; sy = 1 - Math.sin(ph) * 0.03;
        break;
      case 'climb': {
        // ソファの上でごきげんに跳ねる
        const hop = Math.abs(Math.sin(t * 5 + idx));
        bob = -hop * 3;
        sx *= 1 + hop * 0.04; sy *= 1 - hop * 0.04;
        break;
      }
      case 'idle': {
        bob = Math.sin(t * 3) * 1;
        const look = Math.sin(t * 1.7 + idx * 2.1);
        headDx = look * 3.2;
        headTilt = look * 0.14;
        break;
      }
      case 'play': sx = 1 + Math.sin(t * 12) * 0.06; sy = 1 - Math.sin(t * 12) * 0.06; break;
      case 'fuss': wobble = Math.sin(t * 14) * 3; break;
      case 'held': sx = 1.08; sy = 1.08; break;
      case 'mouth': bob = Math.sin(t * 6) * 0.8; headTilt = Math.sin(t * 3) * 0.06; break;
      default: break;
    }
    const mouthing = !!b.mouthing;
    const land = this.fx.progress('land', b.id);
    if (land != null) {
      const k = Math.sin(Math.PI * land);
      sx *= 1 + 0.18 * k;
      sy *= 1 - 0.18 * k;
    }
    const liftK = this.fx.progress('lift', b.id);
    const liftNow = liftK != null ? lift * easeOut(liftK) : lift;

    // 影（抱き上げ中は床に残る）
    ctx.save();
    ctx.fillStyle = COLORS.shadow;
    ctx.globalAlpha = held ? 0.28 : 0.18;
    const shW = (held ? BABY_R * 0.75 : BABY_R * 0.95) * (1 - 0.45 * airborne);
    ctx.beginPath();
    ctx.ellipse(bx, shadowY + BABY_R * 0.7, shW, shW * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // モヤモヤ（満足度低下: 3、ぐずり: 6）
    const nMoya = b.fussing ? 6 : (b.satLow ? 3 : 0);
    if (nMoya > 0) {
      ctx.save();
      ctx.fillStyle = COLORS.moya;
      for (let i = 0; i < nMoya; i++) {
        const a = t * (b.fussing ? 1.8 : 1.1) + (i * Math.PI * 2) / nMoya;
        const rr = 28 + Math.sin(t * 2.3 + i) * 4;
        const mx = bx + Math.cos(a) * rr;
        const my = by - liftNow + Math.sin(a) * rr * 0.7 - 4;
        ctx.beginPath();
        ctx.arc(mx, my, 6 + Math.sin(t * 3 + i * 1.7) * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(bx + wobble, by - liftNow + bob);
    ctx.scale(sx, sy);

    // 体（ロンパース）
    ctx.fillStyle = COLORS.onesie[idx % 2];
    ctx.strokeStyle = COLORS.onesieEdge[idx % 2];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 5, BABY_R * 0.85, BABY_R * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 頭（idle ではきょろきょろ）
    ctx.save();
    ctx.translate(headDx, 0);
    if (headTilt) { ctx.translate(0, -7); ctx.rotate(headTilt); ctx.translate(0, 7); }
    ctx.fillStyle = COLORS.skin;
    ctx.strokeStyle = COLORS.skinEdge;
    ctx.beginPath();
    ctx.arc(0, -7, BABY_R * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 前髪
    ctx.strokeStyle = '#8a6a55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-3, -19); ctx.quadraticCurveTo(0, -23, 3, -18);
    ctx.stroke();

    // 顔
    ctx.fillStyle = COLORS.face;
    ctx.strokeStyle = COLORS.face;
    ctx.lineWidth = 1.5;
    if (b.anim === 'stun') {
      ctx.beginPath(); ctx.moveTo(-6, -10); ctx.lineTo(-2, -6); ctx.moveTo(-2, -10); ctx.lineTo(-6, -6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -10); ctx.lineTo(6, -6); ctx.moveTo(6, -10); ctx.lineTo(2, -6); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -2, 2, 0, Math.PI * 2); ctx.stroke();
    } else {
      const eyeDx = b.anim === 'idle' ? headDx * 0.35 : 0;
      ctx.beginPath(); ctx.arc(-4 + eyeDx, -8, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4 + eyeDx, -8, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      if (mouthing || b.anim === 'mouth') {
        // 口を開けている（物をくわえる）
        ctx.arc(0, -2, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = '#a0463f';
        ctx.fill();
        ctx.fillStyle = COLORS.face;
      } else if (b.fussing || b.anim === 'fuss') {
        ctx.moveTo(-3, -1); ctx.lineTo(3, -1);
      } else if (b.anim === 'play' || b.anim === 'held' || b.anim === 'climb') {
        ctx.arc(0, -3, 3, 0.15 * Math.PI, 0.85 * Math.PI);
      } else {
        ctx.arc(0, -3, 2.4, 0.2 * Math.PI, 0.8 * Math.PI);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();

    // 停止中（stun）：頭上に小さな星が回る
    if (b.anim === 'stun') {
      ctx.save();
      ctx.fillStyle = '#e0b84a';
      ctx.font = `bold 11px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 3; i++) {
        const a = t * 5 + (i * Math.PI * 2) / 3;
        ctx.fillText('✦', bx + Math.cos(a) * 14, by - liftNow - 26 + Math.sin(a) * 4);
      }
      ctx.restore();
    }

    // ぐずり：頭上の不機嫌アイコン（小さな吹き出し + への字口）
    if (b.fussing || b.anim === 'fuss') {
      const pop = this.fx.progress('fussPop', b.id);
      const s = pop != null ? 1 + 0.4 * Math.sin(Math.PI * pop) : 1;
      ctx.save();
      ctx.translate(bx + 14, by - liftNow - 30 + Math.sin(t * 4) * 1.5);
      ctx.scale(s, s);
      ctx.fillStyle = COLORS.fussBubble;
      ctx.strokeStyle = COLORS.fussBubbleEdge;
      ctx.lineWidth = 1.5;
      roundRect(ctx, -11, -9, 22, 18, 6);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 8); ctx.lineTo(-9, 13); ctx.lineTo(-2, 9); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#6b5a8a';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-2, -1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, -3); ctx.lineTo(2, -1); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 6, 3, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
      ctx.restore();
    }

    // 持っている toy（赤ちゃんの脇に小さく）
    if (b.carrying) {
      const toy = (state.objects || []).find(o => o.id === b.carrying);
      if (toy && toy.state !== 'removed') {
        const tx = bx + 18;
        const ty = by - liftNow + 8;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(0.75, 0.75);
        if (toy.merged) {
          ctx.save();
          ctx.strokeStyle = COLORS.merged;
          ctx.lineWidth = 3;
          ctx.shadowColor = COLORS.mergedGlow;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(0, 0, OBJ_R + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = toy.state === 'bored' ? 0.5 : 1;
        ctx.fillStyle = COLORS.toy;
        ctx.strokeStyle = COLORS.toyEdge;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, OBJ_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        this._drawEmoji(ctx, toy.emoji, 0, 1, 20);
        ctx.globalAlpha = 1;
        if (toy.ingestible) this._drawRiskBadge(ctx, OBJ_R * 0.72, -OBJ_R * 0.72);
        if (toy.state === 'bored') this._drawBored(ctx, toy, state.elapsed || 0, 0, 0, OBJ_R);
        if (warn.toys.has(toy.id)) this._drawComboRing(ctx, 0, 0, OBJ_R + 4, warn.on);
        ctx.restore();
      }
    }

    // 口に入れている物（§11.1）：口元に小さく、頭上に残り時間で縮む赤い危険リング
    if (mouthing) {
      const mo = (state.objects || []).find(o => o.id === b.mouthing.objectId);
      const mp = this._mouthPos(b);
      if (mo && mo.state !== 'removed') this._drawMiniObject(ctx, mo, bx + (mp.x - b.x), by - liftNow + bob + (mp.y - b.y), MOUTH_SCALE);
      const elapsed = state.elapsed || 0;
      const until = b.mouthing.until != null ? b.mouthing.until : elapsed;
      let rec = this.mouthStart.get(b.id);
      if (!rec || rec.until !== until) {
        // effect を見逃した（または until が変わった）：今を開始時刻にして分母を MOUTH_SEC_MAX で補う
        rec = { start: Math.min(elapsed, until - (TUNING.MOUTH_SEC_MAX || 4)), until };
        this.mouthStart.set(b.id, rec);
      }
      const total = Math.max(0.05, rec.until - rec.start);
      const frac = Math.max(0, Math.min(1, (until - elapsed) / total));
      const pop = this.fx.progress('mouthPop', b.id);
      const rs = pop != null ? 1 + 0.5 * Math.sin(Math.PI * pop) : 1;
      this._drawDangerRing(ctx, bx, by - liftNow - BABY_R - 18, 9 * rs, frac);
    } else if (this.mouthStart.has(b.id)) {
      this.mouthStart.delete(b.id);
    }

    // 取り上げ長押し（0.5 秒）の進捗リング
    let hold = b.holdProgress || 0;
    if (state.press && state.press.targetId === b.id && state.press.needSec > 0) {
      hold = Math.max(hold, state.press.elapsed / state.press.needSec);
    }
    if (hold > 0) this._drawRing(ctx, bx, by - liftNow, BABY_R + 8, hold);
  }

  // ---------------------------------------------------------------- bursts / flies / pops

  _drawBursts(ctx) {
    if (this.fx.bursts.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of this.fx.bursts) {
      const k = Math.min(1, b.t / b.life);
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = b.color;
      if (b.star) {
        ctx.font = `bold ${Math.round(b.size * 3.2)}px ${FONT_UI}`;
        ctx.fillText('✦', b.x, b.y);
      } else {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size * (1 - 0.4 * k), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** 捨てた／片付けた絵文字が容れ物・棚へ弧を描いて飛ぶ */
  _drawFlies(ctx) {
    if (this.fx.flies.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.fx.flies) {
      const k = Math.min(1, f.t / f.dur);
      const e = easeOut(k);
      const x = f.from.x + (f.to.x - f.from.x) * e;
      const y = f.from.y + (f.to.y - f.from.y) * e - Math.sin(Math.PI * k) * 22;
      ctx.globalAlpha = 1 - 0.7 * k * k;
      ctx.font = `${Math.round(20 * (1 - 0.5 * k))}px ${FONT_EMOJI}`;
      ctx.fillStyle = '#000';
      ctx.fillText(f.emoji, x, y);
    }
    ctx.restore();
  }

  _drawPops(ctx) {
    if (this.fx.pops.length === 0) return;
    ctx.save();
    ctx.font = `bold 18px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const p of this.fx.pops) {
      const k = Math.min(1, p.t / POP_SEC);
      ctx.globalAlpha = 1 - k;
      const y = p.y - POP_RISE_PX * easeOut(k);
      ctx.lineWidth = 4;
      ctx.strokeStyle = COLORS.labelHalo;
      ctx.strokeText(p.text, p.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
    }
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
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
