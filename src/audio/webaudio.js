// フェーズ2：Web Audio API 実装（§9.2）
// - assets/audio/<name>.mp3（または .ogg）があればそれを再生。無ければ OscillatorNode の合成音で代替
// - AudioContext は init()（初回ユーザー操作後）まで生成しない
// - ミュート設定は localStorage に保存
import { IAudio } from './IAudio.js';

const STORAGE_KEY = 'babysafe.muted';
const FILE_BASE = './assets/audio/';
const EXTS = ['mp3', 'ogg'];

// 合成音の定義：[{ type, freq, endFreq?, dur, gain, delay? }, ...]  toy-like, soft, not scary
const SYNTH = {
  click:      [{ type: 'square',   freq: 880,  dur: 0.06, gain: 0.08 }],
  fix_done:   [{ type: 'sine', freq: 660, dur: 0.15, gain: 0.15 }, { type: 'sine', freq: 990, dur: 0.3, gain: 0.15, delay: 0.12 }],
  play_done:  [{ type: 'triangle', freq: 523, dur: 0.15, gain: 0.15 }, { type: 'triangle', freq: 659, dur: 0.15, gain: 0.15, delay: 0.15 }, { type: 'triangle', freq: 784, dur: 0.35, gain: 0.15, delay: 0.3 }],
  hiyari:     [{ type: 'sine', freq: 220, endFreq: 160, dur: 0.4, gain: 0.18 }],
  combo_warn: [{ type: 'square', freq: 440, dur: 0.08, gain: 0.08 }, { type: 'square', freq: 440, dur: 0.08, gain: 0.08, delay: 0.15 }],
  pickup:     [{ type: 'sine', freq: 392, endFreq: 523, dur: 0.2, gain: 0.12 }],
  fuss:       [{ type: 'sawtooth', freq: 180, endFreq: 150, dur: 0.4, gain: 0.1 }],
  respawn:    [{ type: 'triangle', freq: 330, endFreq: 440, dur: 0.25, gain: 0.12 }, { type: 'triangle', freq: 440, dur: 0.2, gain: 0.1, delay: 0.25 }],
  clear:      [{ type: 'triangle', freq: 523, dur: 0.25, gain: 0.15 }, { type: 'triangle', freq: 659, dur: 0.25, gain: 0.15, delay: 0.25 }, { type: 'triangle', freq: 784, dur: 0.25, gain: 0.15, delay: 0.5 }, { type: 'triangle', freq: 1046, dur: 0.8, gain: 0.15, delay: 0.75 }],
  fail:       [{ type: 'sine', freq: 392, dur: 0.4, gain: 0.15 }, { type: 'sine', freq: 330, dur: 0.4, gain: 0.15, delay: 0.4 }, { type: 'sine', freq: 262, dur: 1.0, gain: 0.15, delay: 0.8 }]
};

// 合成 BGM：明るいアルペジオのループ（歌なし）
const BGM_NOTES = {
  bgm_main:  [523, 659, 784, 659, 587, 784, 880, 784],
  bgm_bored: [262, 311, 262, 233]
};

export class WebAudio extends IAudio {
  constructor() {
    super();
    this.ctx = null;
    this.master = null;
    this.buffers = new Map();   // name -> AudioBuffer | null（null = ファイルなし）
    this.bgm = null;            // { name, stop() }
    this.muted = false;
    try { this.muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { /* ignore */ }
    this.available = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  }

  init() {
    if (this.ctx || !this.available) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    // ファイルの事前読み込み（無ければ null を記録して合成音にフォールバック）
    for (const name of [...Object.keys(SYNTH), ...Object.keys(BGM_NOTES)]) this._loadFile(name);
  }

  async _loadFile(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    this.buffers.set(name, undefined); // loading
    for (const ext of EXTS) {
      try {
        const res = await fetch(`${FILE_BASE}${name}.${ext}`);
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) continue; // dev server の index フォールバックを除外
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(name, buf);
        console.info(`[audio] loaded ${name}.${ext}`);
        return buf;
      } catch (_) { /* try next */ }
    }
    this.buffers.set(name, null);
    return null;
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const buf = this.buffers.get(name);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master);
      src.start();
      return;
    }
    const def = SYNTH[name];
    if (!def) return;
    const t0 = this.ctx.currentTime;
    for (const n of def) this._tone(n, t0 + (n.delay || 0));
  }

  _tone({ type, freq, endFreq, dur, gain }, at) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  startBgm(name) {
    if (!this.ctx) return;
    if (this.bgm && this.bgm.name === name) return;
    this.stopBgm();
    const buf = this.buffers.get(name);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0.35;
      src.connect(g).connect(this.master);
      src.start();
      this.bgm = { name, stop: () => { try { src.stop(); } catch (_) {} } };
      return;
    }
    const notes = BGM_NOTES[name];
    if (!notes) return;
    // 合成 BGM：setInterval で 1 拍ずつ鳴らす
    const g = this.ctx.createGain();
    g.gain.value = name === 'bgm_bored' ? 0.05 : 0.07;
    g.connect(this.master);
    let i = 0;
    const beat = name === 'bgm_bored' ? 0.5 : 0.28;
    const timer = setInterval(() => {
      if (this.muted) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const eg = this.ctx.createGain();
      osc.type = name === 'bgm_bored' ? 'sine' : 'triangle';
      osc.frequency.value = notes[i++ % notes.length];
      eg.gain.setValueAtTime(0.0001, t);
      eg.gain.linearRampToValueAtTime(1, t + 0.02);
      eg.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.9);
      osc.connect(eg).connect(g);
      osc.start(t);
      osc.stop(t + beat);
    }, beat * 1000);
    this.bgm = { name, stop: () => { clearInterval(timer); g.disconnect(); } };
  }

  stopBgm() {
    if (this.bgm) { this.bgm.stop(); this.bgm = null; }
  }

  setMuted(b) {
    this.muted = !!b;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    try { localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0'); } catch (_) { /* ignore */ }
  }

  isMuted() { return this.muted; }
}
