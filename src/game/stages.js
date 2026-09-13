// ステージ定義データと難易度変数（§5）。ゲームロジック以外からも読み取り専用で参照する。
// 座標系：部屋を 800×540 の平面とみなす（両フェーズ共通）。

export const ROOM = { w: 800, h: 540, cx: 400, cy: 270 };

// 難易度変数。§13.4 の調整対象は BABY_SPEED / SAT_NO_TOY / FUSS_SEC / WEIGHT_TOY / MOOD_SPEED_GAIN の 5 つ。他は固定。
// §13.4 で決定（2026-09-12）：BABY_SPEED 47、SAT_NO_TOY -1.9、FUSS_SEC 5、WEIGHT_TOY 3.0（FIX_SEC_MULT 2.2 は長押し廃止（§9）で削除）。
// あわせて固定値のうち SAT_IDLE を -0.5（満足度経済が構造的に負で satLow 比率が 50〜77% になっていたため）、
// COMBO_ATTRACT を 1.5 に決めた。sim/out/tune.json・sim/out/assert.json を参照。
// v3（CONTRACT §9）以降の MOVE_* / MOOD_SPEED_GAIN は初期値のまま。調整はユーザー判断（sim/assert.js の結果を見て決める）。
// 2026-09-13：難易度が低すぎたため、ユーザー判断で BABY_SPEED を 1.5 倍に（47→70、ステージ3 65→98）。
export const TUNING = {
  // 2026-09-13：ステージ3（CONTRACT §12）は「物量と速度」ではなく「判断の質」で難しくする方針のため、
  // BABY_SPEED_STAGE3 を 98 → 78 に引き下げた（仕掛け側で難度を出す。最終値は sim:assert で確認する）
  BABY_SPEED: 70, BABY_SPEED_STAGE3: 78, BORED_SPEED_MULT: 1.3,
  PLAY_SEC: 3, BORED_SEC_BASE: 30, BORED_SEC_STEP: 10, DROP_AFTER_SEC: 8, TAKEAWAY_BORED_SEC: 3,
  SAT_START: 70, SAT_NO_TOY: -1.9, SAT_IDLE: -0.5, SAT_PLAY_BY_COUNT: [25, 15, 10], SAT_LOW: 40,
  WEIGHT_TOY: 3.0, WEIGHT_TOY_DRAGGED: 5.0, WEIGHT_HAZARD: 1.0, WEIGHT_HAZARD_BORED: 1.5,
  TOUCH_DIST: 28, COMBO_WARN_DIST: 80,
  PICKUP_SAT: -15, TAKEAWAY_SAT: -20, TAKEAWAY_HOLD_SEC: 0.5,
  INTERVENE_REPEAT_SEC: 20, INTERVENE_REPEAT_MULT: 2,
  FUSS_SEC: 5, FUSS_SPEED_MULT: 1.5, FUSS_HAZARD_WEIGHT: 2.0, FUSS_PLAY_SAT: 12,
  COMBO_ATTRACT: 1.5,       // 持っている toy と combo が成立する hazard の重み倍率（§4.4 を観測可能にする。1.5〜3.0）
  // 以下は仕様書の本文に散在する固定値をまとめたもの
  DRAGGED_WEIGHT_SEC: 8,    // ドラッグ直後に toy の重みが上がる秒数
  STUN_SEC: 1,              // ヒヤリ後・抱き上げドロップ後の停止秒数
  STUCK_SEC: 5,             // ほぼ移動していないと見なして目標を再選択する秒数
  RESPAWN_WARN_SEC: 3,      // 再発の予告点滅を始める秒数
  LOADING_MIN_SEC: 2.5,     // Loading 画面の最低表示秒数
  BABY_RADIUS: 14,          // 壁との衝突に使う赤ちゃんの半径
  DROP_COMBINE_DIST: 40,    // ドラッグしたオブジェクトを別のオブジェクトに「重ねた」と見なす距離（レシピ・容れ物判定）
  // ---- 赤ちゃんの動きの自然さ（CONTRACT §9.5）。すべて注入 rng を使う ----
  MOOD_SPEED_GAIN: 0.6,            // moodMult = 1 + GAIN × ((100 − satisfaction)/100)^2。satLow/ぐずり倍率とは最大値を採用
  MOVE_SPEED_K_MIN: 0.55,          // 速度ゆらぎ係数の下限（機嫌が悪いときは MOVE_SPEED_K_MIN_BAD）
  MOVE_SPEED_K_MIN_BAD: 0.8,
  MOVE_SPEED_K_MAX: 1.25,          // 速度ゆらぎ係数の上限
  MOVE_SPEED_RETARGET_SEC: [0.6, 1.5], // 目標速度係数を選び直す間隔
  MOVE_SPEED_FOLLOW: 3,            // 現在係数が目標へ近づく速さ（1/s。3 で約 1 秒で追いつく）
  MOVE_PAUSE_MEAN_SEC: 4,          // 立ち止まりの平均間隔（機嫌が悪いときは 2 倍＝頻度半分）
  MOVE_PAUSE_SEC: [0.4, 1.2],      // 立ち止まりの長さ
  MOVE_PAUSE_RESELECT: 0.3,        // 立ち止まった後に目標を選び直す確率
  MOVE_HEADING_MAX_DEG: 35,        // 直進方向からのオフセット角の上限
  MOVE_HEADING_RETARGET_SEC: [0.5, 1.2], // オフセット角を選び直す間隔
  MOVE_HEADING_FOLLOW: 3,          // オフセット角が目標値へ近づく速さ（1/s）
  MOVE_HEADING_ZERO_DIST: 60,      // 目標との距離がこれ未満ならオフセットを 0 に収束させる
  // ---- ソファ登り（CONTRACT §10.1）。climbable:true の heavy hazard ----
  CLIMB_WEIGHT: 2.0,               // 登れる家具の目標選択 base（toy 3.0・hazard 1.0 の間）
  CLIMB_SEC: 6,                    // 登っている秒数（この後は自分で降りる）
  CLIMB_SAT_PER_SEC: 3,            // 登っている間の満足度回復（/秒）
  CLIMB_FALL_PROB_PER_SEC: 0.06,   // 毎フレーム rng() < これ×dt で転落（6 秒で約 30%）
  CLIMB_BORED_SEC: 20,             // 降りた／落ちた後、家具が候補外になる秒数（boredUntil）
  // ---- 訪問者（CONTRACT §10.2）----
  // 誤飲の猶予（§CONTRACT 11.1）：口に入れそうな物に触れると一定時間くわえ、その後 飲み込む/手放す をランダムに決める
  MOUTH_SEC_MIN: 2.0, MOUTH_SEC_MAX: 4.0, MOUTH_INGEST_PROB: 0.5,
  RISKY_TOY_PROB: 0.5,             // 危険なおもちゃ（ingestible）で遊び終えた後、部品を口に入れる確率
  HIGH_PLACE_CAPACITY: 2,          // 高い場所 1 か所に置ける個数（§11.2）
  CAT_SPEED: 220,                  // 猫の速さ px/s（§11.5）
  CAT_STEALS: 3,                   // 猫が運ぶ回数
  CAT_DROP_NEAR_BABY: 70,          // 赤ちゃんからこの距離あたりに落とす
  CAT_PAUSE_SEC: 0.5,              // 落とした後に立ち止まる秒数
  VISITOR_SPEED: 90,               // 訪問者の歩く速さ（px/秒。壁を無視して waypoint をたどる）
  // ---- ステージ3（CONTRACT §12）。いずれもステージ3にしか現れない機構で、ステージ1・2 の rng 呼び出し列は変えない ----
  WEIGHT_ZONE: 0.8,                // 面のハザードの目標選択 base（toy 3.0・hazard 1.0 より低い＝狙って行く物ではなく通り道として踏む）
  ZONE_DWELL_DEFAULT: 1.5,         // zone.dwellSec 省略時の滞在秒数
  ACTIVATE_WARN_SEC: 3,            // 時限ハザードの予告点滅（描画層が state から導出して使う）
  SIBLING_SPEED: 110,              // 兄の歩く速さ px/s
  SIBLING_INTERVAL_SEC: 7,         // 散らかす間隔
  SIBLING_GIVE_PROB: 0.4,          // 赤ちゃんのそばに散らかす確率（残りは部屋のランダムな床）
  SIBLING_NEAR_BABY: 70,           // 赤ちゃんのそばに置くときの距離
  SIBLING_WANDER_R: 90,            // home の周囲をうろつく半径
  SIBLING_BUSY_SEC: 15             // おもちゃを渡したときにおとなしくなる秒数
};

// 全 combo の明示列挙（§4.4）。各ステージは stage.combos に有効なものだけを持つ。
export const ALL_COMBOS = [
  { toy: 'spoon', hazard: 'outlet',    ignoresFix: true,  label: 'スプーン × コンセント' },
  { toy: 'ball',  hazard: 'stairs',    ignoresFix: false, label: 'ボール × 階段' },
  { toy: 'cloth', hazard: 'detergent', ignoresFix: false, label: '布 × 洗剤' },
  { toy: 'ball',  hazard: 'kettle',    ignoresFix: false, label: 'ボール × ケトル' },
  { toy: 'ball',  hazard: 'window',    ignoresFix: false, label: 'ボール × 窓' }
];

// weight: 'light' はドラッグで動かせる（床に置き直す・高い場所へ移す・ゴミ箱へ捨てる）。'heavy' は動かせず、対応する安全グッズ（レシピ）でのみ対策できる
function hazard(id, label, accident, fix, emoji, x, y, weight, extra = {}) {
  return { id, kind: 'hazard', label, accident, fix, emoji, model: id, fixedModel: `${id}_fixed`, x, y, weight, draggable: weight === 'light', respawnSec: null, ...extra };
}
function item(id, label, accident, fix, emoji, x, y, respawnSec = null) {
  return { id, kind: 'item', label, accident, fix, emoji, model: id, fixedModel: null, x, y, weight: 'light', draggable: true, respawnSec };
}
function toy(id, label, emoji, x, y, extra = {}) {
  return { id, kind: 'toy', label, accident: null, fix: null, emoji, model: id, fixedModel: null, x, y, weight: 'light', draggable: true, respawnSec: null, ...extra };
}
// 安全グッズ（kind 'goods'）。ドラッグして対応する hazard に重ねると即時に対策できる（レシピ）。for: 対策できる hazard id
function goods(id, label, emoji, x, y, forIds) {
  return { id, kind: 'goods', label, accident: null, fix: null, emoji, model: id, fixedModel: null, x, y, weight: 'light', draggable: true, respawnSec: null, for: forIds };
}
// 登れる家具（kind 'hazard'、heavy、climbable:true）。接触でヒヤリにはならず「登る」。登っている間に転落するとヒヤリ（転落）。
// 対策グッズ（マット）で fixed にすると転落しても怪我にならない
function climbable(id, label, fix, emoji, x, y, extra = {}) {
  return { id, kind: 'hazard', label, accident: '転落', fix, emoji, model: id, fixedModel: `${id}_fixed`, x, y, weight: 'heavy', draggable: false, respawnSec: null, climbable: true, ...extra };
}
// 面のハザード（CONTRACT §12.1）。x, y は矩形の中心。赤ちゃんが矩形内に dwellSec 秒とどまるとヒヤリになる。
// 接触（点）ではヒヤリにならない（findHiyariContact は zone を除外する）。動かせず、対応する goods でのみ対策できる。
// respawnSec があれば fixed になってからその秒数で open に戻る（また水がこぼれる）
function zone(id, label, accident, fix, emoji, x, y, { w, h, dwellSec = null, respawnSec = null } = {}) {
  return {
    id, kind: 'hazard', zone: true, area: { w, h }, dwellSec, label, accident, fix, emoji,
    model: id, fixedModel: `${id}_fixed`, x, y, weight: 'heavy', draggable: false, respawnSec
  };
}
// 押して動かせる家具（CONTRACT §12.3）。heavy と light の中間で、draggable は自動導出せず明示的に true。
// 赤ちゃんの目標にならず、接触してもヒヤリにならない。高い場所・容れ物・レシピのいずれにも入らず、常に床へ落ちる
function pushable(id, label, emoji, x, y) {
  return {
    id, kind: 'hazard', label, accident: null, fix: null, emoji, model: id, fixedModel: null,
    x, y, weight: 'push', draggable: true, respawnSec: null
  };
}
// ダミー（kind 'prop'）。おもちゃでも危険でもない軽い物（クッション・雑誌など）。赤ちゃんは無視する。ドラッグできるが何も起きない。
// 高い場所に置くと容量を消費する（§11.2）
function prop(id, label, emoji, x, y) {
  return { id, kind: 'prop', label, accident: null, fix: null, emoji, model: id, fixedModel: null, x, y, weight: 'light', draggable: true, respawnSec: null };
}
// 容れ物（kind 'container'）。item / toy / goods をドラッグして重ねると捨てられる（消える）。動かせない。危険ではない
function container(id, label, emoji, x, y) {
  return { id, kind: 'container', label, accident: null, fix: null, emoji, model: id, fixedModel: null, x, y, weight: 'heavy', draggable: false, respawnSec: null, container: true };
}

// 合成で生まれるおもちゃの定義（x, y はレシピ成立時のドロップ位置）。
// satPlay: 遊び回数ごとの満足度回復（省略時 TUNING.SAT_PLAY_BY_COUNT）。weight: 目標選択の base（省略時 TUNING.WEIGHT_TOY）
export const MERGED_TOYS = {
  music_blocks: toy('music_blocks', '音の出る積み木', '🎶', 0, 0, { satPlay: [35, 20, 12], targetWeight: 4.5, merged: true }),
  bear_tower:   toy('bear_tower',   'くまの積み木タワー', '🏰', 0, 0, { satPlay: [35, 20, 12], targetWeight: 4.5, merged: true })
};

// レシピ（組み合わせ）。a と b は object id（順不同）。ドラッグ中の a を b の上（距離 < DROP_COMBINE_DIST）に落とすと成立。
//  type 'fix'   : goods を hazard に使う → hazard が即 fixed、goods は消える（'used'）
//  type 'store' : 軽い hazard を別のオブジェクトに収納する → a が fixed（例：包丁を引き出しへ）
//  type 'toy'   : toy と toy を合成 → 両方消えて result のおもちゃがその場に生まれる
export const ALL_RECIPES = [
  { id: 'cover_outlet',    a: 'cover',     b: 'outlet', type: 'fix',   label: 'コンセントカバー → コンセント' },
  { id: 'guard_table',     a: 'guard',     b: 'table',  type: 'fix',   label: 'コーナーガード → テーブルの角' },
  { id: 'lock_drawer',     a: 'lock',      b: 'drawer', type: 'fix',   label: 'チャイルドロック → 引き出し' },
  { id: 'tie_kettle',      a: 'tie',       b: 'kettle', type: 'fix',   label: 'コード留め → 電気ケトル' },
  { id: 'gate_stairs',     a: 'gate',      b: 'stairs', type: 'fix',   label: 'ベビーゲート → 階段' },
  { id: 'trashlock_trash', a: 'trashlock', b: 'trash',  type: 'fix',   label: 'ゴミ箱ロック → ゴミ箱' },
  { id: 'knife_drawer',    a: 'knife',     b: 'drawer', type: 'store', label: '包丁 → 引き出しに収納' },
  { id: 'mat_sofa',        a: 'mat',       b: 'sofa',   type: 'fix',   label: 'ジョイントマット → ソファの前' },
  { id: 'music_blocks',    a: 'blocks',    b: 'drum',   type: 'toy',   result: 'music_blocks', label: '積み木 × たいこ → 音の出る積み木' },
  { id: 'bear_tower',      a: 'blocks',    b: 'bear',   type: 'toy',   result: 'bear_tower',   label: '積み木 × ぬいぐるみ → くまの積み木タワー' },
  // ---- ステージ3（CONTRACT §12）----
  { id: 'winlock_window',  a: 'window_lock',  b: 'window',      type: 'fix', label: 'まどの補助錠 → 窓' },
  { id: 'balclock_balcony', a: 'balcony_lock', b: 'balcony',    type: 'fix', label: 'ベランダの補助錠 → ベランダ柵' },
  { id: 'towel_puddle',    a: 'towel',        b: 'puddle',      type: 'fix', label: 'タオル → こぼれた水' },
  { id: 'hguard_heater',   a: 'heater_guard', b: 'heater',      type: 'fix', label: 'ヒーターガード → ヒーターの前' },
  { id: 'tie_cooker',      a: 'tie',          b: 'rice_cooker', type: 'fix', label: 'コード留め → 炊飯器' },
  // チャイルドロックは 2 個あり、どちらをコンロと引き出しのどちらに使ってもよい（資源の配分を迫る）
  { id: 'lock_stove',      a: 'lock',         b: 'stove',       type: 'fix', label: 'チャイルドロック → コンロ' },
  { id: 'lockb_stove',     a: 'lock_b',       b: 'stove',       type: 'fix', label: 'チャイルドロック → コンロ' },
  { id: 'lockb_drawer',    a: 'lock_b',       b: 'drawer',      type: 'fix', label: 'チャイルドロック → 引き出し' }
];
function recipesFor(objects) {
  const ids = new Set(objects.map(o => o.id));
  return ALL_RECIPES.filter(r => ids.has(r.a) && ids.has(r.b));
}

// walls の highPlace:true は「高い場所」。軽い hazard を落とすと fixed（届かない所へ移した）、item/toy/goods を落とすと removed（片付けた）
const livingWalls = [
  { x: 300, y: 0,   w: 200, h: 70,  model: 'sofa',     label: 'ソファ',   highPlace: false },
  { x: 0,   y: 200, w: 70,  h: 140, model: 'tv_stand', label: 'テレビ台', highPlace: true, capacity: 2 },
  { x: 730, y: 60,  w: 70,  h: 160, model: 'shelf',    label: '棚',       highPlace: true, capacity: 2 }
];
const kitchenWalls = [
  { x: 0,   y: 0,   w: 800, h: 60,  model: 'counter', label: 'カウンター', highPlace: true, capacity: 2 },
  { x: 330, y: 380, w: 180, h: 70,  model: 'island',  label: 'アイランド', highPlace: false },
  { x: 720, y: 80,  w: 70,  h: 100, model: 'fridge',  label: '冷蔵庫',     highPlace: false }
];

const kitchenObjects = () => [
  hazard('outlet', 'コンセント',  '感電',   'コンセントカバー',   '🔌', 100, 100, 'heavy'),
  hazard('kettle', '電気ケトル',  'やけど', 'カウンターの奥へ',   '🫖', 330, 95,  'light'),
  hazard('knife',  '包丁',        '切創',   '引き出しに収納',     '🔪', 500, 95,  'light'),
  hazard('drawer', '引き出し',    '指はさみ', 'チャイルドロック', '🗄️', 420, 470, 'heavy'),
  hazard('trash',  'ゴミ箱',      '誤飲',   'ゴミ箱ロック',       '🗑️', 720, 330, 'heavy', { container: true }),
  hazard('medicine', '薬',        '誤飲',   '高い場所へ移す',     '💊', 300, 250, 'light'),
  item('battery', 'ボタン電池',   '誤飲', 'ゴミ箱に捨てる', '🔋', 200, 300, 25),
  item('grocery', '床の買い物袋', '窒息', 'ゴミ箱に捨てる', '🛍️', 620, 300, 20),
  toy('spoon',  '金属のスプーン', '🥄', 150, 450),
  toy('ball',   'ボール',         '⚽', 650, 450),
  toy('blocks', '積み木',         '🟦', 250, 180),
  toy('bear',   'ぬいぐるみ',     '🧸', 560, 200),
  toy('puzzle', 'ジグソーパズル', '🧩', 560, 340, { ingestible: true, riskLabel: '小さなピース' }),
  prop('cushion',  'クッション', '🟫', 150, 250),
  prop('magazine', '雑誌',       '📖', 660, 240),
  goods('cover',     'コンセントカバー', '🩹', 600, 120, ['outlet']),
  goods('lock',      'チャイルドロック', '🔒', 100, 380, ['drawer']),
  goods('tie',       'コード留め',       '🪢', 600, 400, ['kettle']),
  goods('trashlock', 'ゴミ箱ロック',     '🔐', 250, 480, ['trash'])
];

const twinsObjects = () => [
  hazard('outlet',    'コンセント',   '感電',   'コンセントカバー', '🔌', 40,  500, 'heavy'),
  hazard('stairs',    '階段',         '転落',   'ベビーゲート',     '🪜', 760, 500, 'heavy'),
  hazard('table',     'テーブルの角', '打撲',   'コーナーガード',   '🪑', 760, 300, 'heavy'),
  hazard('detergent', '洗剤ボトル',   '誤飲',   '高い棚へ移す',     '🧴', 40,  40,  'light'),
  hazard('drawer',    '引き出し',     '指はさみ', 'チャイルドロック', '🗄️', 760, 40, 'heavy'),
  climbable('sofa', 'ソファ', 'ジョイントマット', '🛋️', 400, 84),
  item('battery', 'ボタン電池', '誤飲', 'ゴミ箱に捨てる', '🔋', 40, 120, 20),
  container('bin', 'フタ付きゴミ箱', '🗑️', 600, 480),
  toy('ball',   'ボール',         '⚽', 300, 400),
  toy('bear',   'ぬいぐるみ',     '🧸', 560, 180),
  toy('blocks', '積み木',         '🟦', 200, 420),
  toy('spoon',  '金属のスプーン', '🥄', 650, 200),
  toy('cloth',  '布',             '🧣', 450, 420),
  toy('puzzle', 'ジグソーパズル', '🧩', 300, 330, { ingestible: true, riskLabel: '小さなピース' }),
  prop('cushion',  'クッション', '🟫', 150, 480),
  prop('slippers', 'スリッパ',   '🥿', 680, 400),
  goods('cover', 'コンセントカバー', '🩹', 600, 120, ['outlet']),
  goods('gate',  'ベビーゲート',     '🚧', 300, 470, ['stairs']),
  goods('guard', 'コーナーガード',   '🧽', 160, 300, ['table']),
  goods('lock',  'チャイルドロック', '🔒', 450, 150, ['drawer']),
  goods('mat',   'ジョイントマット', '🟩', 250, 150, ['sofa'])
];

// 無神経なおじさん（§CONTRACT 10.2）。at 秒に path の先頭から現れ、drops の各オブジェクトを path の途中で床に落として、末尾で退場する。
// drops は item（軽い・誤飲）。落とす位置は path 上を等間隔に進んだ地点（実装は state.js）
const uncleDrops = () => [
  item('cigarette', 'たばこ',   '誤飲', 'ゴミ箱に捨てる', '🚬', 0, 0, null),
  item('coin',      '小銭',     '誤飲', 'ゴミ箱に捨てる', '🪙', 0, 0, null),
  item('pills',     '薬のシート', '誤飲', '高い場所へ移す', '💊', 0, 0, null)
];
const twinsVisitor = { id: 'uncle', type: 'uncle', label: 'おじさん', emoji: '🧔', at: 10, path: [{ x: 840, y: 400 }, { x: 620, y: 380 }, { x: 400, y: 150 }, { x: 180, y: 400 }, { x: -60, y: 420 }], drops: uncleDrops() };
// 猫（§CONTRACT 11.5）。終盤に現れ、床の軽い物をくわえて赤ちゃんの近くに運ぶ。entry/exit は部屋の外
const twinsCat = { id: 'cat', type: 'cat', label: 'ねこ', emoji: '🐈', at: 27, entry: { x: 840, y: 480 }, exit: { x: -60, y: 480 } };

// ---- ステージ3「夕方のリビング」（CONTRACT §12.5）------------------------------------
// 窓とベランダが上辺の左右にあり、その手前に踏み台になる家具（椅子・収納ケース）が最初から置いてある。
// 中央上のカウンターには時間差で熱くなる炊飯器とコンロ。床には水たまりとヒーターの前（面のハザード）。
const eveningWalls = [
  { x: 40,  y: 0,   w: 220, h: 44,  model: 'window',   label: '窓',         highPlace: false },
  { x: 300, y: 0,   w: 200, h: 50,  model: 'counter',  label: 'カウンター', highPlace: true, capacity: 1 },
  { x: 540, y: 0,   w: 220, h: 44,  model: 'balcony',  label: 'ベランダ',   highPlace: false },
  { x: 0,   y: 220, w: 64,  h: 150, model: 'shelf',    label: '棚',         highPlace: true, capacity: 2 },
  { x: 736, y: 220, w: 64,  h: 150, model: 'tv_stand', label: 'テレビ台',   highPlace: true, capacity: 2 },
  { x: 300, y: 470, w: 200, h: 70,  model: 'sofa',     label: 'ソファ',     highPlace: false }
];

const eveningObjects = () => [
  // 窓・ベランダ：単体では登れない。踏み台（chair / crate）が近くにあるときだけ登れる（placementCombos）。
  // 転落は severity 2（1 回でヒヤリ 2）＝実質致命的
  hazard('window',  '窓',           '転落', 'まどの補助錠',       '🪟', 150, 56, 'heavy', { climbableWhen: 'placement', severity: 2 }),
  hazard('balcony', 'ベランダ柵',   '転落', 'ベランダの補助錠',   '🏙️', 650, 56, 'heavy', { climbableWhen: 'placement', severity: 2 }),
  pushable('chair', '椅子',           '🪑', 150, 130),
  pushable('crate', '収納ケース',     '📦', 650, 130),
  // 時限（§12.2）：activeAt 秒に熱くなる。それまでは触れても何も起きないが、先回りして対策できる
  hazard('rice_cooker', '炊飯器の蒸気', 'やけど', 'コード留めで奥へ',   '🍚', 350, 62, 'heavy', { activeAt: 16 }),
  hazard('stove',       'コンロ',       'やけど', 'チャイルドロック',   '🔥', 450, 62, 'heavy', { activeAt: 30 }),
  // 面（§12.1）：踏んで一定時間とどまるとヒヤリ。水たまりは拭いてもまたこぼれる
  zone('puddle', 'こぼれた水',   '転倒',   'タオルで拭く',     '💧', 400, 320, { w: 140, h: 100, dwellSec: 1.5, respawnSec: 24 }),
  zone('heater', 'ヒーターの前', 'やけど', 'ヒーターガード',   '🔥', 140, 485, { w: 120, h: 100, dwellSec: 1.2 }),
  hazard('outlet',    'コンセント', '感電',     'コンセントカバー', '🔌', 36,  400, 'heavy'),
  hazard('drawer',    '引き出し',   '指はさみ', 'チャイルドロック', '🗄️', 700, 430, 'heavy'),
  hazard('detergent', '洗剤ボトル', '誤飲',     '高い棚へ移す',     '🧴', 110, 180, 'light'),
  item('battery', 'ボタン電池', '誤飲', 'ゴミ箱に捨てる', '🔋', 400, 200, 22),
  container('bin', 'フタ付きゴミ箱', '🗑️', 240, 430),
  toy('ball',   'ボール',         '⚽', 250, 250),
  toy('blocks', '積み木',         '🟦', 560, 300),
  toy('bear',   'ぬいぐるみ',     '🧸', 330, 420),
  toy('cloth',  '布',             '🧣', 620, 420),
  toy('spoon',  '金属のスプーン', '🥄', 200, 350),
  toy('puzzle', 'ジグソーパズル', '🧩', 480, 180, { ingestible: true, riskLabel: '小さなピース' }),
  prop('cushion',  'クッション', '🟫', 560, 480),
  prop('magazine', '雑誌',       '📖', 230, 100),
  goods('window_lock',  'まどの補助錠',     '🔏', 330, 250, ['window']),
  goods('balcony_lock', 'ベランダの補助錠', '🔏', 470, 250, ['balcony']),
  goods('towel',        'タオル',           '🧻', 620, 210, ['puddle']),
  goods('heater_guard', 'ヒーターガード',   '🚧', 300, 200, ['heater']),
  goods('tie',          'コード留め',       '🪢', 400, 130, ['rice_cooker']),
  goods('lock',         'チャイルドロック', '🔒', 520, 400, ['stove', 'drawer']),
  goods('lock_b',       'チャイルドロック', '🔒', 710, 255, ['stove', 'drawer']),
  goods('cover',        'コンセントカバー', '🩹', 90,  350, ['outlet'])
];

// 兄が散らかす小物（§12.4）。id はすべて別（同じ id を 2 度落とすと findObject が破綻する）
const siblingLitter = () => [
  item('marble',  'ビー玉',           '誤飲', 'ゴミ箱に捨てる', '🔮', 0, 0, null),
  item('lego',    'レゴのブロック',   '誤飲', 'ゴミ箱に捨てる', '🧱', 0, 0, null),
  item('ohajiki', 'おはじき',         '誤飲', 'ゴミ箱に捨てる', '🟡', 0, 0, null),
  item('cap',     'ペットボトルのフタ', '誤飲', 'ゴミ箱に捨てる', '🧢', 0, 0, null)
];
// 兄（§12.4）。at 秒に入ってきてステージ終了まで居座り、周期的に小物を散らかす。
// おもちゃをドラッグして渡すと SIBLING_BUSY_SEC の間おとなしくなる（その間そのおもちゃは赤ちゃんが使えない）
const eveningSibling = {
  id: 'brother', type: 'sibling', label: 'お兄ちゃん', emoji: '🧒', at: 4,
  entry: { x: -60, y: 300 }, home: { x: 560, y: 340 }, litter: siblingLitter(), max: 4
};
const eveningCat = { id: 'cat', type: 'cat', label: 'ねこ', emoji: '🐈', at: 38, entry: { x: 840, y: 500 }, exit: { x: -60, y: 500 } };

// 配置コンボ（§12.3）。明示列挙（combos と同じ方針で動的生成しない）。開始時点で chair×window と crate×balcony が成立している
const eveningPlacementCombos = [
  { id: 'chair_window',  mover: 'chair', target: 'window',  dist: 90, label: '椅子 × 窓' },
  { id: 'chair_balcony', mover: 'chair', target: 'balcony', dist: 90, label: '椅子 × ベランダ柵' },
  { id: 'crate_window',  mover: 'crate', target: 'window',  dist: 90, label: '収納ケース × 窓' },
  { id: 'crate_balcony', mover: 'crate', target: 'balcony', dist: 90, label: '収納ケース × ベランダ柵' }
];

export const STAGES = [
  {
    id: 1, name: 'キッチン', timeLimit: 45, babies: 1,
    babySpawns: [{ x: 400, y: 270 }],
    walls: kitchenWalls,
    objects: kitchenObjects(),
    combos: ALL_COMBOS.filter(c => (c.toy === 'spoon' && c.hazard === 'outlet') || (c.toy === 'ball' && c.hazard === 'kettle')),
    recipes: recipesFor(kitchenObjects()),
    visitors: [],
    // CONTRACT §12.5：やけどカード（burn）は炊飯器・コンロが出るステージ3へ移し、
    // ボタン電池のあるキッチンには battery カードを出す
    eduCardId: 'battery'
  },
  {
    id: 2, name: '双子', timeLimit: 45, babies: 2,
    babySpawns: [{ x: 360, y: 270 }, { x: 440, y: 270 }],
    walls: livingWalls,
    objects: twinsObjects(),
    combos: ALL_COMBOS.filter(c => c.hazard !== 'kettle'),
    recipes: recipesFor(twinsObjects()),
    visitors: [twinsVisitor, twinsCat],
    eduCardId: 'combo'
  },
  {
    id: 3, name: '夕方のリビング', timeLimit: 60, babies: 1,
    babySpawns: [{ x: 400, y: 250 }],
    walls: eveningWalls,
    objects: eveningObjects(),
    combos: ALL_COMBOS.filter(c => (c.toy === 'spoon' && c.hazard === 'outlet') ||
      (c.toy === 'ball' && c.hazard === 'window') || (c.toy === 'cloth' && c.hazard === 'detergent')),
    recipes: recipesFor(eveningObjects()),
    placementCombos: eveningPlacementCombos,
    visitors: [eveningSibling, eveningCat],
    eduCardId: 'burn'
  }
];

export function getStage(index) {
  return STAGES[index];
}

// ステージ index に応じた赤ちゃんの基準速度。tuning を渡すと（sim の上書き用）その値を使う
export function baseSpeedFor(stage, tuning = TUNING) {
  return stage.id === 3 ? tuning.BABY_SPEED_STAGE3 : tuning.BABY_SPEED;
}
