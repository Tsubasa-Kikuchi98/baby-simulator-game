// Canvas2D 用の一時演出（§4.8）。時間はレンダラが渡す dt で進める。
// 数字ポップは HUD 側（ui.js）と同じ動き：0.8 秒で上に 20px 移動しながらフェード。

export const POP_SEC = 0.8;
export const POP_RISE_PX = 20;
export const FLASH_SEC = 0.2;

export const POP_COLORS = { good: '#3f9a5a', bad: '#d05a5a', neutral: '#8d8a94' };

// レシピ成立・合成の粒（バースト）。1 粒 = { x, y, vx, vy, t, life, color, size, star }
const BURST_GRAVITY = 90;

export class EffectStore {
  constructor() {
    this.reset();
  }

  reset() {
    this.pops = [];          // { x, y, text, color, t }
    this.bursts = [];        // 粒（下記 addBurst）
    this.flies = [];         // 容れ物・高い場所へ飛んでいく絵文字 { emoji, from, to, t, dur }
    this.flashT = 0;         // 残り秒
    this.timers = new Map(); // key(`${kind}:${id}`) → { t, dur }
  }

  /**
   * 粒のバースト（レシピ成立の sparkle / 合成の星）。rnd は決定性が要らない演出専用なので Math.random でよい。
   * @param {number} x ゲーム座標
   * @param {number} y
   * @param {{ count?: number, color?: string|string[], life?: number, speed?: number, size?: number, star?: boolean }} [opts]
   */
  addBurst(x, y, { count = 18, color = POP_COLORS.good, life = 0.7, speed = 90, size = 3, star = false } = {}) {
    const colors = Array.isArray(color) ? color : [color];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const v = speed * (0.55 + Math.random() * 0.7);
      this.bursts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4,
        t: 0, life: life * (0.7 + Math.random() * 0.5),
        color: colors[i % colors.length], size: size * (0.7 + Math.random() * 0.8), star
      });
    }
  }

  /** 絵文字が from から to へ弧を描いて飛ぶ（捨てた／片付けた。0.3 秒） */
  addFly(emoji, from, to, dur = 0.3) {
    if (!emoji || !from || !to) return;
    this.flies.push({ emoji, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, t: 0, dur });
  }

  /** 演出タイマーを開始（同じ key は上書き） */
  start(kind, id, dur) {
    this.timers.set(`${kind}:${id}`, { t: 0, dur });
  }

  /** 進捗 0..1 を返す。未開始・終了済みなら null */
  progress(kind, id) {
    const e = this.timers.get(`${kind}:${id}`);
    if (!e) return null;
    return Math.min(1, e.t / e.dur);
  }

  addPop(x, y, text, color) {
    this.pops.push({ x, y, text, color, t: 0 });
  }

  flash() {
    this.flashT = FLASH_SEC;
  }

  tick(dt) {
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter(p => p.t < POP_SEC);
    for (const b of this.bursts) {
      b.t += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += BURST_GRAVITY * dt;
    }
    this.bursts = this.bursts.filter(b => b.t < b.life);
    for (const f of this.flies) f.t += dt;
    this.flies = this.flies.filter(f => f.t < f.dur);
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    for (const [key, e] of this.timers) {
      e.t += dt;
      if (e.t >= e.dur) this.timers.delete(key);
    }
  }
}

/** イーズアウト（ポップの上昇・演出の減衰に共用） */
export function easeOut(k) {
  return 1 - (1 - k) * (1 - k);
}
