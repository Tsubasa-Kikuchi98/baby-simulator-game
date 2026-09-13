// マウスイベント → 契約 §3 の入力イベント（pressStart / pressEnd / dragStart / dragMove / dragEnd）。
// mousedown → renderer.pickObject で対象決定。draggable なオブジェクト（weight 'light'）と赤ちゃんは
// 6px 以上動いたらドラッグに切り替える。pressStart は mousedown で常に出す（ゲームはオブジェクトでは無視し、
// おもちゃを持った赤ちゃんの 0.5 秒取り上げだけに使う）。
// 重い（動かせない）オブジェクトを引っ張ろうとしたら、ゲームには何も送らず onReject で描画層に「動かない」の揺れを頼む。
// 長押し中にカーソルが対象から外れたら pressEnd。move/up は window で拾い、canvas 外でも終わらせる。

const DRAG_THRESHOLD_PX = 6;

/**
 * @param {object} opts
 * @param {HTMLElement} opts.element  mousedown を受ける要素（canvas / #game）。`canvasEl` も同義
 * @param {import('./render/IRenderer.js').IRenderer} opts.renderer
 * @param {(event: object) => void} opts.onEvent  契約 §3 のイベントを受け取る（通常 game.input）
 * @param {(id: string) => 'hazard'|'item'|'toy'|'goods'|'container'|'baby'|null} [opts.getKind]  対象 id の種別
 * @param {(id: string) => boolean} [opts.isDraggable]  対象をドラッグできるか（object.draggable / 赤ちゃん）。
 *   省略時は getKind が toy / goods / baby のときドラッグ可
 * @param {(id: string) => void} [opts.onReject]  重いものを引っ張ろうとした時（描画層の揺れ用）。
 *   省略時は renderer.playEffect('heavy_nudge', id, {})
 * @param {() => boolean} [opts.isEnabled]  false の間は mousedown を無視（Play 中のみ有効にする等）
 */
export function createInput({ element, canvasEl, renderer, onEvent, getKind, isDraggable, onReject, isEnabled }) {
  const el = element || canvasEl;
  if (!el) throw new Error('createInput: element is required');
  const kindOf = getKind || (() => null);
  const draggable = isDraggable || ((id) => {
    const k = kindOf(id);
    return k === 'toy' || k === 'goods' || k === 'baby';
  });
  const reject = onReject || ((id) => {
    if (renderer && typeof renderer.playEffect === 'function') renderer.playEffect('heavy_nudge', id, {});
  });

  // 進行中の操作。null なら何もしていない
  // { targetId, kind, canDrag, startX, startY, pressActive, dragging, rejected }
  let cur = null;

  function emit(ev) {
    try { onEvent(ev); } catch (e) { console.error('[input] onEvent failed', e); }
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (isEnabled && !isEnabled()) return;
    const id = renderer.pickObject(e.clientX, e.clientY);
    if (id == null) return;
    e.preventDefault();
    if (cur) cancel(e);
    const kind = kindOf(id);
    let canDrag = false;
    try { canDrag = !!draggable(id); } catch (err) { canDrag = false; }
    cur = { targetId: id, kind, canDrag, startX: e.clientX, startY: e.clientY, pressActive: true, dragging: false, rejected: false };
    emit({ type: 'pressStart', targetId: id });
  }

  function onMouseMove(e) {
    if (!cur) return;
    const gp = renderer.toGameCoords(e.clientX, e.clientY);
    if (cur.dragging) {
      emit({ type: 'dragMove', x: gp.x, y: gp.y });
      return;
    }
    const moved = Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) >= DRAG_THRESHOLD_PX;
    if (cur.canDrag && moved) {
      if (cur.pressActive) {
        emit({ type: 'pressEnd' });
        cur.pressActive = false;
      }
      cur.dragging = true;
      emit({ type: 'dragStart', targetId: cur.targetId, x: gp.x, y: gp.y });
      return;
    }
    if (!cur.canDrag && moved && !cur.rejected && cur.kind !== 'baby') {
      // 重いものを引っ張ろうとした：ゲームには送らず、その場で「動かない」揺れ
      cur.rejected = true;
      try { reject(cur.targetId); } catch (err) { /* ignore */ }
    }
    if (cur.pressActive && renderer.pickObject(e.clientX, e.clientY) !== cur.targetId) {
      // 対象から外れた → 長押し中断
      emit({ type: 'pressEnd' });
      cur.pressActive = false;
      if (!cur.canDrag) cur = null;
    }
  }

  function finish(e) {
    if (!cur) return;
    if (cur.dragging) {
      const gp = renderer.toGameCoords(e.clientX, e.clientY);
      emit({ type: 'dragEnd', x: gp.x, y: gp.y });
    } else if (cur.pressActive) {
      emit({ type: 'pressEnd' });
    }
    cur = null;
  }

  function cancel(e) {
    finish(e || { clientX: cur ? cur.startX : 0, clientY: cur ? cur.startY : 0 });
  }

  function onMouseUp(e) {
    if (e.button !== 0) return;
    finish(e);
  }

  function onBlur() {
    cancel();
  }

  function onMouseLeaveWindow(e) {
    // window から出た（relatedTarget 無し）ときだけ終了。canvas 外のドラッグは続ける
    if (e.relatedTarget == null && (e.target === document.documentElement || e.target === document.body)) finish(e);
  }

  el.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);
  document.documentElement.addEventListener('mouseleave', onMouseLeaveWindow);

  return {
    /** テスト・デバッグ用：現在の操作 */
    get current() { return cur; },
    dispose() {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      document.documentElement.removeEventListener('mouseleave', onMouseLeaveWindow);
      cur = null;
    }
  };
}
