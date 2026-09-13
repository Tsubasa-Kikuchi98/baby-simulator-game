// 音声層インターフェース（§2, §9.2）。silent / webaudio がこれを実装する。
export class IAudio {
  /** ユーザー操作後に呼ぶ（AudioContext はここで初めて生成する） */
  init() {}
  /** name: click | fix_done | play_done | hiyari | combo_warn | pickup | fuss | respawn | clear | fail */
  play(name) {}
  /** name: bgm_main | bgm_bored */
  startBgm(name) {}
  stopBgm() {}
  setMuted(bool) {}
  isMuted() { return false; }
}
