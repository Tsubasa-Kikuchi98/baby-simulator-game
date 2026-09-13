// 描画層インターフェース（§2）。canvas2d / three がこれを実装する。
// gameState の形と playEffect の type/payload は docs/CONTRACT.md を参照。
export class IRenderer {
  /**
   * @param {HTMLElement} container 描画先。中に canvas を作る
   * 実装は constructor({ topInset }) で HUD バンド（main.js の HUD_BAND_PX、CSS の --hud-h と同じ 60px）分だけ
   * 部屋を下げて描く。HUD と部屋が重ならないようにするため両フェーズで共通。
   */
  init(container) {}
  /** ステージ開始前に呼ぶ。素材読み込みが必要なら Promise を返す（フェーズ2）。 */
  loadStage(stage) { return Promise.resolve(); }
  /** 毎フレーム。gameState を読んで描く。 */
  update(gameState, dt) {}
  /** 画面座標 → object.id | baby.id | null。赤ちゃんと toy が重なっている時は赤ちゃんを優先。 */
  pickObject(clientX, clientY) { return null; }
  /** 画面座標 → ゲーム座標 {x, y}（800×540 の平面） */
  toGameCoords(clientX, clientY) { return { x: 0, y: 0 }; }
  /** ゲーム座標 → 画面座標（クライアント座標）。テスト（Playwright）とデバッグに使う */
  toScreenCoords(x, y) { return { x: 0, y: 0 }; }
  /**
   * 因果表現（§4.8）。type:
   *  "fixed" | "removed" | "hiyari" | "respawn" | "play_done" | "combo_warn" | "pickup" | "takeaway"
   *  | "fuss_start" | "fuss_end" | "combo_hiyari" | "bored" | "unbored" | "sat_delta" | "no_toy" | "drop"
   *  | "stage_clear" | "stage_fail" | "screen"（詳細は docs/CONTRACT.md §4）
   */
  playEffect(type, objectId, payload) {}
  /** HUD 外の UI を重ねる場合に使う（フェーズ1は ui.js が HTML で担当するため未使用でもよい） */
  showOverlay(kind, payload) {}
  dispose() {}
}
