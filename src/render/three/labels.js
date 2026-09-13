// 3D のラベルを Sprite ではなく HTML の div で描く層（フェーズ2のみ）。
//
// なぜ DOM か：Sprite は 512px のテクスチャを画面上 70px 程度まで縮小するため、
// 1文字 9px 前後・ミップマップ無しで潰れていた。div ならデバイス解像度のまま描かれ、
// 距離に関係なく一定の px サイズで読める。
//
// 使い方は Sprite とほぼ互換にしてある（DomLabel は Object3D なので従来どおり
// group に add し、.visible / .position / .material.opacity をそのまま操作できる）。
// LabelLayer.update() を renderer.render() の後に呼ぶと、その時点のワールド行列を
// 投影して div の位置・表示を決める。
//
// 重なり対策：毎フレーム矩形の重なりを見て、優先度の低いラベルを間引く（§落とし穴の
// 「描画層は state を読むだけ」は維持。ここは state を一切触らない）。
import * as THREE from 'three';

const STYLE_ID = 'g3d-label-style';
const CSS = `
/* isolation:isolate … 中の .g3d-label の z-index をこの中に閉じ込める。
   これが無いと個々のラベルがルートの重なり順に参加し、#ui の結果画面より前に出てしまう。
   層そのものは z-index を持たず、DOM 順（#game < #ui）で HUD・各画面の下に入る */
.g3d-labels { position: absolute; overflow: hidden; pointer-events: none; isolation: isolate; }
.g3d-label {
  position: absolute; left: 0; top: 0; white-space: nowrap;
  font: 700 12px/1.25 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  color: #4b3f35; background: rgba(255, 252, 246, 0.92);
  border: 1px solid rgba(120, 96, 72, 0.28); border-radius: 7px;
  padding: 1px 6px 2px; box-shadow: 0 1px 3px rgba(60, 40, 20, 0.22);
  will-change: transform, opacity;
}
.g3d-label--wall {
  font-size: 13px; color: #4d3b2c;
  background: rgba(255, 246, 232, 0.9); border-color: rgba(120, 96, 72, 0.35);
}
.g3d-label--hover {
  background: #fffdf8; border-color: rgba(90, 143, 196, 0.85);
  box-shadow: 0 2px 7px rgba(40, 70, 110, 0.3);
}
.g3d-label--alert { color: #8a2f2f; border-color: rgba(208, 90, 90, 0.7); }
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

/** 親をたどって visible が全て true か（group.visible = false の隠しに追随するため） */
function effectivelyVisible(obj) {
  for (let o = obj; o; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}

/**
 * Sprite 互換のラベル。Object3D なのでシーングラフに乗り、ワールド行列は three が更新する。
 * material は互換シム（opacity だけ意味を持つ）。
 */
export class DomLabel extends THREE.Object3D {
  constructor(layer, text, { variant = 'object', color = null, priority = 0 } = {}) {
    super();
    this.isDomLabel = true;
    this.layer = layer;
    this.priority = priority;
    this.material = { opacity: 1, map: null, needsUpdate: false, dispose() {} };

    const el = layer.doc.createElement('div');
    el.className = `g3d-label${variant === 'wall' ? ' g3d-label--wall' : ''}`;
    if (color) el.style.color = color;
    this.el = el;
    this.baseClass = el.className;
    this._w = 0;
    this._h = 0;
    this._text = null;
    this._alert = false;
    this._shown = false;
    el.style.opacity = '0';
    layer.root.appendChild(el);
    layer.labels.add(this);
    this.setText(text);
  }

  /** @param {string} text @param {{alert?: boolean}} opts alert は満杯などの警告色 */
  setText(text, { alert = false } = {}) {
    if (text === this._text && alert === this._alert) return;
    this._text = text;
    this._alert = alert;
    this.el.textContent = text;
    this.el.className = this.baseClass + (alert ? ' g3d-label--alert' : '');
    this._w = 0; // 次の update で測り直す
  }

  dispose() {
    this.layer.labels.delete(this);
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (this.parent) this.parent.remove(this);
  }
}

export class LabelLayer {
  /** @param {HTMLElement} container キャンバスと同じ親 */
  constructor(container) {
    this.doc = container.ownerDocument || document;
    ensureStyle(this.doc);
    this.labels = new Set();
    this.root = this.doc.createElement('div');
    this.root.className = 'g3d-labels';
    container.appendChild(this.root);
    this.enabled = true;
    this.hoverId = null;      // ThreeRenderer が毎フレーム入れる object/baby id
    this.dragId = null;
    this._v = new THREE.Vector3();
    this._items = [];
    this._placed = [];
  }

  create(text, opts) {
    return new DomLabel(this, text, opts);
  }

  /** キャンバスと同じ矩形に合わせる（resize から呼ぶ） */
  setViewport(topPx, widthPx, heightPx) {
    Object.assign(this.root.style, {
      left: '0px', top: `${topPx}px`, width: `${widthPx}px`, height: `${heightPx}px`
    });
    this._vw = widthPx;
    this._vh = heightPx;
  }

  /**
   * 投影して div を配置する。renderer.render() の後に呼ぶこと（ワールド行列が確定しているため）。
   * @param {THREE.Camera} camera
   */
  update(camera) {
    const vw = this._vw || 0;
    const vh = this._vh || 0;
    const items = this._items;
    items.length = 0;

    for (const lb of this.labels) {
      const opacity = lb.material.opacity;
      if (!this.enabled || opacity <= 0.02 || !effectivelyVisible(lb)) { this._hide(lb); continue; }
      lb.getWorldPosition(this._v).project(camera);
      if (this._v.z >= 1) { this._hide(lb); continue; }  // カメラ後方
      const x = ((this._v.x + 1) / 2) * vw;
      const y = ((1 - this._v.y) / 2) * vh;
      if (x < -120 || x > vw + 120 || y < -40 || y > vh + 40) { this._hide(lb); continue; }
      if (!lb._w) { lb._w = lb.el.offsetWidth; lb._h = lb.el.offsetHeight; }
      const owner = lb.ownerId;
      const hover = owner != null && owner === this.hoverId;
      const drag = owner != null && owner === this.dragId;
      items.push({ lb, x, y, opacity, hover, rank: (hover ? 100 : 0) + (drag ? 50 : 0) + lb.priority });
    }

    // 優先度 → 手前（画面下）ほど優先。同点は id 順にせず y で決まるので毎フレーム安定する
    items.sort((a, b) => (b.rank - a.rank) || (b.y - a.y));

    const placed = this._placed;
    placed.length = 0;
    for (const it of items) {
      const { lb } = it;
      const w = lb._w || 40;
      const h = lb._h || 16;
      const l = it.x - w / 2;
      const t = it.y - h / 2;
      let clash = false;
      for (const p of placed) {
        if (l < p.r && l + w > p.l && t < p.b && t + h > p.t) { clash = true; break; }
      }
      // ホバー／ドラッグ中のものは必ず出す（重なっても最前面）
      if (clash && it.rank < 50) { this._hide(lb); continue; }
      if (!clash) placed.push({ l, r: l + w, t, b: t + h });
      this._show(lb, l, t, it.opacity, it.hover, it.rank);
    }
  }

  _show(lb, l, t, opacity, hover, rank) {
    const el = lb.el;
    const tf = `translate3d(${Math.round(l)}px, ${Math.round(t)}px, 0)`;
    if (el.style.transform !== tf) el.style.transform = tf;
    const op = opacity.toFixed(2);
    if (el.style.opacity !== op) el.style.opacity = op;
    if (hover !== lb._hover) {
      lb._hover = hover;
      el.className = lb.baseClass + (lb._alert ? ' g3d-label--alert' : '') + (hover ? ' g3d-label--hover' : '');
    }
    const z = rank >= 50 ? '3' : '1';
    if (el.style.zIndex !== z) el.style.zIndex = z;
    lb._shown = true;
  }

  _hide(lb) {
    if (!lb._shown) return;
    lb.el.style.opacity = '0';
    lb._shown = false;
  }

  dispose() {
    for (const lb of [...this.labels]) lb.dispose();
    this.labels.clear();
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}
