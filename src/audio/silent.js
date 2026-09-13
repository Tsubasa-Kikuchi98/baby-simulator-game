// フェーズ1：音なし実装
import { IAudio } from './IAudio.js';
export class SilentAudio extends IAudio {
  constructor() { super(); this.muted = false; }
  init() {}
  play() {}
  startBgm() {}
  stopBgm() {}
  setMuted(b) { this.muted = !!b; }
  isMuted() { return this.muted; }
}
