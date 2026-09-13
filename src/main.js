// ループと DI（契約 §7）。__GAME_MODE__（vite define）で描画層・音声層を選ぶ。
import { createGame } from './game/state.js';
import { createRng } from './game/rng.js';
import { STAGES } from './game/stages.js';
import { unverifiedTips } from './game/edu.js';
import { createUI } from './ui.js';
import { createInput } from './input.js';
import { SilentAudio } from './audio/silent.js';
import { WebAudio } from './audio/webaudio.js';
import { Canvas2DRenderer } from './render/canvas2d/Canvas2DRenderer.js';

const MAX_DT = 1 / 20;
// HUD 帯の高さ（style.css の --hud-h と合わせる）。部屋はこの下に letterbox で収める
const HUD_BAND_PX = 60;

// effect type → 音声 name（§9.2 ＋ 追加分）。null を返す effect は無音
function audioNameFor(type, payload) {
  switch (type) {
    case 'fixed':
    case 'removed':
    case 'stored': return 'fix_done';
    case 'trashed': return 'trash';
    case 'recipe_ok': return payload && payload.type === 'toy' ? 'play_done' : null; // fix 型は同時に出る fixed が鳴る
    case 'toy_merged': return 'merge';
    case 'recipe_ng':
    case 'high_full': return 'deny';
    case 'play_done': return 'play_done';
    case 'hiyari':
    case 'combo_hiyari': return 'hiyari';
    case 'combo_warn': return payload && payload.active ? 'combo_warn' : null;
    case 'pickup': return 'pickup';
    case 'takeaway': return 'pickup';
    case 'fuss_start': return 'fuss';
    case 'respawn': return 'respawn';
    case 'mouth_start': return 'mouth';
    case 'mouth_release': return 'relief';
    case 'climb_start': return 'climb';
    case 'climb_fall_safe': return 'fall_safe';
    case 'visitor_enter': return payload && payload.visitorType === 'cat' ? 'cat' : 'visitor';
    case 'visitor_drop': return 'deny';
    case 'cat_take':
    case 'cat_drop': return 'cat';
    case 'stage_clear': return 'clear';
    case 'stage_fail': return 'fail';
    default: return null;
  }
}

function readSeed() {
  try {
    const p = new URLSearchParams(window.location.search).get('seed');
    if (p != null && p !== '' && Number.isFinite(Number(p))) return Number(p) >>> 0;
  } catch (e) { /* ignore */ }
  return Date.now() >>> 0;
}

// ビルド時のモード（vite define）。dev サーバでは ?mode=3d / ?mode=2d で切り替えられる
const BUILD_MODE = typeof __GAME_MODE__ !== 'undefined' ? __GAME_MODE__ : '2d';
const IS_3D_BUILD = BUILD_MODE === '3d';
// 3D 層を読めるのは 3d ビルドか dev サーバのみ（2d 単一ファイルビルドに three を混ぜない）
const CAN_LOAD_3D = IS_3D_BUILD || import.meta.env.DEV;

function gameMode() {
  let override = null;
  try { override = new URLSearchParams(window.location.search).get('mode'); } catch (e) { /* ignore */ }
  if (override === '2d') return '2d';
  if (override === '3d' && CAN_LOAD_3D) return '3d';
  return BUILD_MODE;
}

// 音声層：フェーズ1・2 とも WebAudio（合成音）。assets/audio/*.mp3 を置けばファイル再生に差し替わる。
// AudioContext が使えない環境だけ SilentAudio（ミュートトグルも出さない）
function pickAudio(mode) {
  try {
    // assets/audio を配るのは 3D ビルドだけ。2D（単一ファイル）は合成音のみ
    const a = new WebAudio({ useFiles: mode === '3d' });
    if (a.available) return a;
  } catch (e) { console.warn('[main] WebAudio unavailable, falling back to silent', e); }
  return new SilentAudio();
}

async function pickRenderer(mode) {
  if (CAN_LOAD_3D && mode === '3d') {
    try {
      // フェーズ2：Three.js 描画層。静的パスの import() なので Vite がバンドルする
      const r = await import('./render/three/ThreeRenderer.js');
      return new r.ThreeRenderer({ topInset: HUD_BAND_PX });
    } catch (e) {
      console.warn('[main] 3D renderer unavailable, falling back to Canvas 2D', e);
    }
  }
  return new Canvas2DRenderer({ topInset: HUD_BAND_PX });
}

async function boot() {
  const unverified = unverifiedTips();
  if (unverified.length) {
    console.warn(`[edu] verified:false の豆知識 ${unverified.length} 件（表示前に出典確認が必要）:`, unverified.map(t => t.id));
  }

  const seed = readSeed();
  const game = createGame({ rng: createRng(seed) });
  const gameEl = document.getElementById('game');
  const uiEl = document.getElementById('ui');
  const logEl = document.getElementById('log');

  const mode = gameMode();
  const renderer = await pickRenderer(mode);
  const audio = pickAudio(mode);
  renderer.init(gameEl);

  const ui = createUI({
    container: uiEl,
    game,
    onAction: (action) => game.dispatch(action),
    // ミュートトグルは音のある層のときだけ出す（SilentAudio なら非表示）
    audio: audio instanceof SilentAudio ? null : audio,
    logContainer: logEl
  });

  const input = createInput({
    element: gameEl,
    renderer,
    onEvent: (ev) => {
      // ドラッグ開始 / 長押し開始のクリック音（§9.2 の click）
      if (ev.type === 'pressStart') audio.play('click');
      game.input(ev);
    },
    getKind: (id) => {
      const s = game.state;
      if (s.babies && s.babies.some(b => b.id === id)) return 'baby';
      const o = s.objects && s.objects.find(x => x.id === id);
      return o ? o.kind : null;
    },
    // ドラッグできるのは赤ちゃんと weight 'light'（draggable:true）のオブジェクトだけ（契約 §9.2）
    isDraggable: (id) => {
      const s = game.state;
      if (s.babies && s.babies.some(b => b.id === id)) return true;
      const o = s.objects && s.objects.find(x => x.id === id);
      return !!(o && o.draggable === true);
    },
    // 重いものを引っ張ろうとしたら描画層だけで「動かない」揺れ（ゲームには送らない）
    onReject: (id) => { renderer.playEffect('heavy_nudge', id, {}); audio.play('deny'); },
    isEnabled: () => game.state.screen === 'play'
  });

  // AudioContext は初回のユーザー操作後に生成する（§9.2）。pointerdown / click のどちらが先でも一度だけ
  let audioReady = false;
  const initAudio = () => {
    if (audioReady) return;
    audioReady = true;
    try { audio.init(); } catch (e) { /* ignore */ }
    window.removeEventListener('pointerdown', initAudio);
    window.removeEventListener('click', initAudio);
    // 既に Play 中なら BGM を始める
    if (game.state.screen === 'play') audio.startBgm('bgm_main');
  };
  window.addEventListener('pointerdown', initAudio);
  window.addEventListener('click', initAudio);

  // BGM：Play に入ったら bgm_main、出たら停止
  // BGM：Play に入ったら bgm_main。満足度が低い間は bgm_bored を重ねる（§9.2）
  let bgmScreen = null;
  let boredLayer = false;
  function watchBgm(state) {
    if (state.screen !== bgmScreen) {
      bgmScreen = state.screen;
      if (state.screen === 'play') { if (audioReady) audio.startBgm('bgm_main'); }
      else { audio.stopBgm(); boredLayer = false; }
    }
    if (state.screen !== 'play' || !audioReady) return;
    const bored = !!(state.babies && state.babies.some(b => b.satLow));
    if (bored === boredLayer) return;
    boredLayer = bored;
    if (bored) audio.startBgm('bgm_bored'); else audio.stopBgm('bgm_bored');
  }

  // Loading に入ったら描画層に素材を読ませ、終わったら assetsReady
  let prevScreen = null;
  let loadingToken = 0;
  function watchLoading(state) {
    if (state.screen === 'loading' && prevScreen !== 'loading') {
      const token = ++loadingToken;
      // Loading 中の state.stage は前ステージのままなので stageIndex から引く
      const stage = STAGES[state.stageIndex] || state.stage || STAGES[0];
      Promise.resolve()
        .then(() => renderer.loadStage(stage))
        .catch((e) => console.warn('[main] loadStage failed', e))
        .then(() => {
          if (token === loadingToken && game.state.screen === 'loading') game.dispatch({ type: 'assetsReady' });
        });
    }
    prevScreen = state.screen;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
    last = now;

    const effects = game.update(dt) || [];
    for (const ef of effects) {
      const { type, objectId, payload } = ef;
      renderer.playEffect(type, objectId, payload);
      ui.onEffect(type, objectId, payload);
      const name = audioNameFor(type, payload);
      if (name) audio.play(name);
    }
    watchLoading(game.state);
    watchBgm(game.state);
    renderer.update(game.state, dt);
    ui.update(game.state);
    requestAnimationFrame(frame);
  }
  watchLoading(game.state);
  requestAnimationFrame(frame);

  // Playwright / デバッグ用
  window.__game = game;
  window.__renderer = renderer;
  window.__ui = ui;
  window.__input = input;
  window.__seed = seed;
  window.__audio = audio;
  window.__mode = mode;
}

boot().catch((e) => {
  console.error('[main] boot failed', e);
  const uiEl = document.getElementById('ui');
  if (uiEl) {
    const p = document.createElement('p');
    p.className = 'boot-error';
    p.textContent = '起動に失敗しました。コンソールを確認してください。';
    uiEl.appendChild(p);
  }
});
