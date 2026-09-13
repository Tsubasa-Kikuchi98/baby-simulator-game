// HTML の HUD と各画面（Title / Loading / Tutorial / StageResult / FinalResult）。契約 §7。
// update(state) は毎フレーム呼ばれるので、値が変わった時だけ DOM を触る。
import { cards, DISCLAIMER } from './game/edu.js';
import { TUNING, STAGES } from './game/stages.js';

const COMBO_TEXT_SEC = 1.5;
const LOG_MAX_LINES = 60;   // できごとログの描画上限（古いものから消す）

// Tutorial の操作説明（CONTRACT §9.4 の文言をそのまま。3行以内、操作の紹介に留める）
const TUTORIAL_LINES = [
  '軽いものはドラッグで動かせる。危ないものは高い場所へ、ゴミはゴミ箱へ',
  '安全グッズを重い危険（コンセント・階段…）に重ねると対策。おもちゃ同士を重ねると合成',
  '赤ちゃんもドラッグで移せるが嫌がって危険が増える。ヒヤリ3回で失敗'
];

// Title のリード文：ステージ数・制限時間は stages.js から
function titleLead() {
  const n = STAGES.length;
  const secs = [...new Set(STAGES.map(st => st.timeLimit))];
  const time = secs.length === 1 ? `${secs[0]}秒` : secs.map(x => `${x}秒`).join('・');
  return `ドラッグで動かす・重ねる・高い場所へ。おもちゃを持った赤ちゃんは 0.5 秒押して取り上げ。${time} × ${n}ステージ。`;
}

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function setText(el, value) {
  const v = String(value);
  if (el.__t !== v) { el.__t = v; el.textContent = v; }
}

function setHidden(el, hidden) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

function toggleClass(el, cls, on) {
  if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
}

function formatTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function hiyariMarks(n) {
  let out = '';
  for (let i = 0; i < 3; i++) out += i < n ? '×' : '○';
  return out;
}

function signed(n) {
  const v = Math.round(n);
  return (v >= 0 ? '+' : '−') + Math.abs(v);
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container  #ui
 * @param {object} opts.game            createGame() の戻り値（state 参照用）
 * @param {(action: {type: string}) => void} opts.onAction  ボタン → dispatch
 * @param {object|null} [opts.audio]  IAudio（setMuted / isMuted）。null なら ミュートトグルを出さない（フェーズ1）
 * @param {HTMLElement|null} [opts.logContainer]  できごとログ（#log）。null なら描かない
 */
export function createUI({ container, game, onAction, audio = null, logContainer = null }) {
  container.classList.add('ui-root');

  // ---------------------------------------------------------------- mute toggle（§9.2。Title と HUD）
  const muteButtons = new Set();
  function refreshMute() {
    const muted = !!(audio && audio.isMuted());
    for (const b of muteButtons) {
      setText(b, muted ? '🔇' : '🔈');
      b.setAttribute('aria-pressed', String(muted));
      b.title = muted ? 'ミュート中（クリックで音を出す）' : '音あり（クリックでミュート）';
    }
  }
  function muteButton(extraClass = '') {
    if (!audio) return null;
    const b = h('button', `mute-btn ${extraClass}`.trim());
    b.type = 'button';
    b.dataset.action = 'mute';
    b.setAttribute('aria-label', 'ミュート');
    // 画面の再描画で外れた古いボタンは忘れる（Title は毎回作り直される）
    for (const old of muteButtons) if (!old.isConnected && old !== b) muteButtons.delete(old);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.setMuted(!audio.isMuted());
      refreshMute();
    });
    muteButtons.add(b);
    refreshMute();
    return b;
  }

  // ---------------------------------------------------------------- HUD
  const hud = h('div', 'hud');
  hud.hidden = true;
  const hudTop = h('div', 'hud-top');
  const hudLeft = h('div', 'hud-left');
  const hudStage = h('div', 'hud-stage');
  const hudTime = h('div', 'hud-time');
  hudLeft.append(hudTime, hudStage);
  const hudBabies = h('div', 'hud-babies');
  const hudHiyari = h('div', 'hud-hiyari');
  hudHiyari.setAttribute('aria-label', 'ヒヤリ');
  hudTop.append(hudLeft, hudBabies, hudHiyari);
  const hudMute = muteButton('mute-btn-hud');
  if (hudMute) hudTop.append(hudMute);
  hud.append(hudTop);

  const centerText = h('div', 'center-text');
  centerText.hidden = true;
  let comboUntil = 0;

  // ---------------------------------------------------------------- できごとログ（右列。新しいものを上に積む）
  const logEl = logContainer || null;
  let logList = null;
  let logEmpty = null;
  let logRendered = 0;        // state.log のうち描画済みの件数
  if (logEl) {
    logEl.replaceChildren();
    const head = h('div', 'log-head');
    head.append(h('h2', 'log-title', 'できごと'));
    const legend = h('div', 'log-legend');
    legend.append(h('span', 'lg-bad', 'ヒヤリ・不満'), h('span', 'lg-good', 'うまくいった'), h('span', 'lg-info', 'その他'));
    head.append(legend);
    logList = h('div', 'log-list');
    logList.setAttribute('role', 'log');
    logList.setAttribute('aria-live', 'polite');
    logEmpty = h('p', 'log-empty', 'プレイ中のできごと（ヒヤリの理由・うまくいった対策）がここに流れます。');
    logList.append(logEmpty);
    logEl.append(head, logList);
  }

  function logLine(entry) {
    const line = h('div', `log-line tone-${entry.tone || 'info'}`);
    line.append(h('span', 'log-t', formatTime(entry.t || 0)), h('span', 'log-text', entry.text || ''));
    return line;
  }

  function updateLog(state) {
    if (!logList) return;
    const log = Array.isArray(state.log) ? state.log : [];
    if (log.length < logRendered) {
      // 新しいステージ開始などでログが縮んだ → 描き直す
      logList.replaceChildren(logEmpty);
      logRendered = 0;
    }
    if (log.length === logRendered) return;
    const frag = document.createDocumentFragment();
    // 新しい順に prepend したいので、新規分を逆順で断片に積む
    for (let i = log.length - 1; i >= logRendered; i--) frag.append(logLine(log[i]));
    logRendered = log.length;
    if (logEmpty.parentNode === logList) logEmpty.remove();
    logList.prepend(frag);
    while (logList.childElementCount > LOG_MAX_LINES) logList.lastElementChild.remove();
    logList.scrollTop = 0;
  }

  // ---------------------------------------------------------------- overlays
  const overlays = {};
  for (const name of ['title', 'loading', 'tutorial', 'stageResult', 'finalResult']) {
    const ov = h('div', `overlay overlay-${name}`);
    ov.dataset.screen = name;
    ov.hidden = true;
    overlays[name] = ov;
  }
  container.append(hud, centerText, ...Object.values(overlays));

  // Loading の進行インジケータは毎フレーム更新するので参照を保持する
  let loadingFill = null;
  let loadingPct = -1;

  function button(label, actionType, extraClass = '') {
    const b = h('button', `btn ${extraClass}`.trim(), label);
    b.type = 'button';
    b.dataset.action = actionType;
    b.addEventListener('click', () => onAction({ type: actionType }));
    return b;
  }

  function tipBlock(tip, cls = 'tip') {
    const wrap = h('div', cls);
    if (!tip) return wrap;
    wrap.dataset.tipId = tip.id || '';
    wrap.append(h('p', 'tip-text', tip.text || ''));
    if (tip.source) wrap.append(h('p', 'tip-source', tip.source));
    return wrap;
  }

  function cardBlock(card) {
    const c = h('section', 'edu-card');
    if (!card) return c;
    c.dataset.cardId = card.id || '';
    c.append(h('h3', 'card-title', card.title));
    if (Array.isArray(card.bullets) && card.bullets.length) {
      const ul = h('ul', 'card-bullets');
      for (const b of card.bullets) ul.append(h('li', null, b));
      c.append(ul);
    }
    if (card.body) c.append(h('p', 'card-body', card.body));
    if (card.source) c.append(h('p', 'card-source', card.source));
    c.append(h('p', 'card-disclaimer', DISCLAIMER));
    return c;
  }

  function renderTitle(ov) {
    ov.replaceChildren();
    const panel = h('div', 'panel panel-title');
    panel.append(
      h('p', 'eyebrow', 'おうちの安全パズル'),
      h('h1', 'title', 'ベビーセーフ・ルーム'),
      h('p', 'lead', titleLead()),
      button('はじめる', 'start', 'btn-primary')
    );
    const mute = muteButton('mute-btn-title');
    if (mute) panel.append(mute);
    ov.append(panel);
  }

  function renderLoading(ov, state) {
    ov.replaceChildren();
    const panel = h('div', 'panel panel-loading');
    panel.append(h('p', 'eyebrow', 'よみこみ中'));
    panel.append(tipBlock(state.tip, 'tip tip-large'));
    const bar = h('div', 'progress');
    loadingFill = h('div', 'progress-fill');
    bar.append(loadingFill);
    loadingPct = -1;
    panel.append(bar);
    ov.append(panel);
  }

  function renderTutorial(ov, state) {
    ov.replaceChildren();
    const panel = h('div', 'panel panel-tutorial');
    panel.append(h('p', 'eyebrow', 'そうさ'));
    const ul = h('ul', 'tutorial-lines');
    for (const line of TUTORIAL_LINES.slice(0, 3)) ul.append(h('li', null, line));
    panel.append(ul);
    panel.append(button('OK', 'tutorialOk', 'btn-primary'));
    panel.append(tipBlock(state.tutorialTip, 'tip tip-footer'));
    ov.append(panel);
  }

  /** できごと：失敗なら「失敗の原因」、クリアなら短いまとめ（＋ヒヤリがあれば上位 3 件） */
  function eventsBlock(r, state, cleared) {
    const sec = h('section', `result-events ${cleared ? 'is-clear' : 'is-fail'}`);
    const causes = Array.isArray(r.hiyariCauses) ? r.hiyariCauses : [];
    const causeList = (list) => {
      const ul = h('ul', 'events-list');
      for (const c of list) {
        const li = h('li', null, `${c.label || c.objectId}${c.accident ? `（${c.accident}）` : ''}× ${c.count ?? 1}`);
        if (c.combo) li.append(h('span', 'events-combo', `くみあわせ：${c.combo}`));
        ul.append(li);
      }
      return ul;
    };
    if (!cleared) {
      sec.append(h('h3', 'events-title', '失敗の原因'));
      if (causes.length) {
        sec.append(h('p', 'events-summary', `ヒヤリ ${r.hiyari ?? state.hiyari ?? 0}回。近づいてしまったもの：`));
        sec.append(causeList(causes));
      } else {
        sec.append(h('p', 'events-summary', 'ヒヤリが3回になりました。'));
      }
      sec.append(h('p', 'events-note', '右の「できごと」欄に、時間順の記録が残っています。'));
      return sec;
    }
    sec.append(h('h3', 'events-title', 'できごと'));
    const objects = state.objects || [];
    const log = Array.isArray(r.log) ? r.log : (Array.isArray(state.log) ? state.log : []);
    const fixedCount = objects.filter(o => o.kind === 'hazard' && o.state === 'fixed').length;
    const hazardCount = objects.filter(o => o.kind === 'hazard').length;
    const mergeCount = Math.max(objects.filter(o => o.merged).length, log.filter(e => e.kind === 'toy_merged').length);
    const bits = [`あそび ${r.playCount ?? state.playCount ?? 0}回`, `危険な場所の対策 ${fixedCount}${hazardCount ? `/${hazardCount}` : ''}件`];
    if (mergeCount > 0) bits.push(`おもちゃの合成 ${mergeCount}回`);
    sec.append(h('p', 'events-summary', bits.join('　')));
    if (causes.length) {
      sec.append(h('p', 'events-note', `ヒヤリになったもの（多い順）：`));
      sec.append(causeList(causes.slice(0, 3)));
    } else {
      sec.append(h('p', 'events-note', 'ヒヤリなし。落ち着いて対策できました。'));
    }
    return sec;
  }

  function renderStageResult(ov, state) {
    ov.replaceChildren();
    const r = state.result || {};
    const panel = h('div', 'panel panel-result');
    const cleared = !!r.cleared;
    panel.append(h('p', 'eyebrow', state.stage ? `ステージ${state.stageIndex + 1}/${STAGES.length} ${state.stage.name}` : ''));
    panel.append(h('h2', `result-title ${cleared ? 'is-clear' : 'is-fail'}`, cleared ? 'クリア' : '失敗'));

    const facts = h('p', 'result-facts');
    const bits = [`ヒヤリ ${r.hiyari ?? state.hiyari ?? 0}回`, `あそび ${r.playCount ?? state.playCount ?? 0}回`];
    if (!cleared && r.failAtSec != null) bits.push(`${Math.round(r.failAtSec)}秒で終了`);
    facts.textContent = bits.join('　');
    panel.append(facts);

    const bd = r.breakdown || {};
    const table = h('dl', 'score-table');
    const row = (k, v, cls = '') => {
      const dt = h('dt', cls, k);
      const dd = h('dd', cls, String(v));
      table.append(dt, dd);
    };
    row('ヒヤリ猶予', bd.hiyariBonus ?? 0);
    row('あそび', bd.playBonus ?? 0);
    row('対策完了タイム', bd.timeBonus ?? 0);
    row('スコア', r.score ?? 0, 'total');
    panel.append(table);

    panel.append(eventsBlock(r, state, cleared));

    const card = cards[r.eduCardId] || (state.stage ? cards[state.stage.eduCardId] : null);
    panel.append(cardBlock(card));

    panel.append(cleared ? button('つぎへ', 'next', 'btn-primary') : button('もういちど', 'retry', 'btn-primary'));
    ov.append(panel);
  }

  function renderFinalResult(ov, state) {
    ov.replaceChildren();
    const panel = h('div', 'panel panel-final');
    panel.append(h('p', 'eyebrow', 'おつかれさまでした'));
    panel.append(h('h2', 'result-title', '合計スコア'));
    panel.append(h('p', 'total-score', String(state.totalScore ?? 0)));
    panel.append(cardBlock(cards.summary));
    panel.append(button('タイトルへ', 'toTitle', 'btn-primary'));
    ov.append(panel);
  }

  const renderers = {
    title: renderTitle,
    loading: renderLoading,
    tutorial: renderTutorial,
    stageResult: renderStageResult,
    finalResult: renderFinalResult
  };

  // ---------------------------------------------------------------- HUD rows per baby
  const rows = new Map(); // babyId → { root, fill, bar, fuss, notoy, pops, value }

  function ensureRow(baby, index) {
    let row = rows.get(baby.id);
    if (row) return row;
    const root = h('div', 'sat-row');
    root.dataset.babyId = baby.id;
    const name = h('span', 'sat-name', `赤ちゃん${index + 1}`);
    const bar = h('div', 'sat-bar');
    const fill = h('div', 'sat-fill');
    bar.append(fill);
    const notoy = h('span', 'notoy-icon', 'あそべるものがない');
    notoy.hidden = true;
    const fuss = h('span', 'fuss-badge');
    fuss.hidden = true;
    const pops = h('span', 'pop-area');
    root.append(name, bar, pops, notoy, fuss);
    hudBabies.append(root);
    row = { root, fill, bar, fuss, notoy, pops, value: -1 };
    rows.set(baby.id, row);
    return row;
  }

  function syncRows(state) {
    const ids = new Set();
    (state.babies || []).forEach((b, i) => {
      ids.add(b.id);
      ensureRow(b, i);
    });
    for (const [id, row] of rows) {
      if (!ids.has(id)) { row.root.remove(); rows.delete(id); }
    }
  }

  function updateHud(state) {
    setText(hudStage, state.stage ? `ステージ${state.stageIndex + 1}/${STAGES.length}　${state.stage.name}` : '');
    setText(hudTime, formatTime(state.timeLeft ?? 0));
    setText(hudHiyari, hiyariMarks(state.hiyari || 0));
    toggleClass(hudHiyari, 'is-danger', (state.hiyari || 0) >= 2);

    syncRows(state);
    for (const b of state.babies || []) {
      const row = rows.get(b.id);
      const v = Math.round(Math.max(0, Math.min(100, b.satisfaction ?? 0)));
      if (row.value !== v) {
        row.value = v;
        row.fill.style.width = `${v}%`;
      }
      toggleClass(row.bar, 'is-low', b.satisfaction < TUNING.SAT_LOW);
      toggleClass(row.bar, 'is-notoy', !!state.noToy);
      setHidden(row.notoy, !state.noToy);
      const fussing = !!b.fussing;
      setHidden(row.fuss, !fussing);
      if (fussing) setText(row.fuss, `ぐずり ${Math.max(0, Math.ceil((b.fussUntil || 0) - (state.elapsed || 0)))}秒`);
    }
  }

  // ---------------------------------------------------------------- pops (HUD)
  function addPop(row, amount) {
    if (!row) return;
    const el = h('span', `pop ${amount >= 0 ? 'is-good' : 'is-bad'}`, signed(amount));
    row.pops.append(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 1200);
  }

  // ---------------------------------------------------------------- public API
  let lastScreen = null;
  let lastResultRef = null;

  function update(state) {
    if (!state) return;
    const screen = state.screen;
    const screenChanged = screen !== lastScreen;
    // StageResult は同じ画面でも result が差し替わったら再描画
    const resultChanged = screen === 'stageResult' && state.result !== lastResultRef;
    if (screenChanged || resultChanged) {
      lastScreen = screen;
      lastResultRef = state.result;
      for (const [name, ov] of Object.entries(overlays)) {
        const show = name === screen;
        if (show) renderers[name](ov, state);
        else if (!ov.hidden) ov.replaceChildren();
        setHidden(ov, !show);
      }
      if (screen === 'play') {
        for (const row of rows.values()) row.pops.replaceChildren();
      }
      if (screen !== 'play') { comboUntil = 0; setHidden(centerText, true); }
    }

    setHidden(hud, screen !== 'play');
    if (screen === 'play') updateHud(state);
    updateLog(state);

    if (screen === 'loading' && loadingFill) {
      const min = TUNING.LOADING_MIN_SEC || 2.5;
      const pct = Math.round(Math.min(1, (state.loading?.elapsed || 0) / min) * 100);
      if (pct !== loadingPct) { loadingPct = pct; loadingFill.style.width = `${pct}%`; }
    }

    if (comboUntil && Date.now() >= comboUntil) {
      comboUntil = 0;
      setHidden(centerText, true);
    }
  }

  /** 中央テキスト（combo ヒヤリは紫、レシピ成立は緑）を 1.5 秒表示 */
  function showCenterText(text, good) {
    setText(centerText, text);
    toggleClass(centerText, 'is-good', good);
    setHidden(centerText, false);
    centerText.classList.remove('is-pop');
    void centerText.offsetWidth;
    centerText.classList.add('is-pop');
    comboUntil = Date.now() + COMBO_TEXT_SEC * 1000;
  }

  function onEffect(type, objectId, payload = {}) {
    switch (type) {
      case 'sat_delta': {
        const row = rows.get(objectId);
        addPop(row, payload.amount ?? 0);
        if (row && payload.reason === 'play' && (payload.amount ?? 0) > 0) {
          row.bar.classList.remove('is-glow');
          // reflow で再アニメーション
          void row.bar.offsetWidth;
          row.bar.classList.add('is-glow');
        }
        break;
      }
      case 'combo_hiyari':
        showCenterText(payload.label || '', false);
        break;
      case 'recipe_ok':
        showCenterText(payload.label || (payload.type === 'toy' ? 'あわせた！' : '対策できた！'), true);
        break;
      case 'hiyari':
        hudHiyari.classList.remove('is-hit');
        void hudHiyari.offsetWidth;
        hudHiyari.classList.add('is-hit');
        break;
      default:
        break;
    }
  }

  function dispose() {
    container.replaceChildren();
    if (logEl) logEl.replaceChildren();
    rows.clear();
    muteButtons.clear();
  }

  return { update, onEffect, dispose, refreshMute, elements: { hud, hudTime, hudHiyari, hudStage, centerText, overlays, log: logEl } };
}
