// 音声層インターフェース（§2, §9.2）。silent / webaudio がこれを実装する。
export class IAudio {
  /** ユーザー操作後に呼ぶ（AudioContext はここで初めて生成する） */
  init() {}
  /**
   * name: click | fix_done | play_done | hiyari | combo_warn | pickup | fuss | respawn | clear | fail
   *     | deny | trash | merge | mouth | relief | climb | fall_safe | visitor | cat
   */
  play(name) {}
  /** name: bgm_main | bgm_bored。レイヤーとして重ねられる（bgm_main + bgm_bored） */
  startBgm(name) {}
  /** name を省略すると全レイヤーを止める */
  stopBgm(name) {}
  setMuted(bool) {}
  isMuted() { return false; }
}
