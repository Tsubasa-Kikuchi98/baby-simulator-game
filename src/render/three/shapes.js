// オブジェクトごとのプロシージャル形状（フェーズ2のプレースホルダー）。
//
// これまでは kind ごとの色違いの箱1個だけだったため「全部四角」に見えていた。
// ここではプリミティブの組み合わせで各オブジェクトのシルエットを作る。
// assets/models/<model>.glb が置かれれば ObjectView.setModels がこちらを隠して
// glb を出すので、ここは「glb が来るまでのつなぎ」であって上書きされる前提。
//
// 決定論性：ここは描画層なので rng は不要（形は def から一意に決まる）。乱数は使わない。
import * as THREE from 'three';

// 標準の設置面積・高さの目安（ObjectView の BOX_W / BOX_H と揃える）
const W = 36;
const H = 30;

const METAL = { color: 0xd9dde2, roughness: 0.3, metalness: 0.65 };

/** 形状を組み立てるための小さなビルダ。mat に 'main' を渡すと kind 色（対策で緑になる）を使う */
class Builder {
  constructor(mainMat) {
    this.group = new THREE.Group();
    this.mainMat = mainMat;
    this.mats = [];   // 追加で作ったマテリアル（ObjectView が alpha / emissive をまとめて触る）
    this.geos = [];
    this._cache = new Map();
    this.height = 0;
  }

  mat(spec) {
    if (spec == null || spec === 'main') return this.mainMat;
    const opts = typeof spec === 'number' ? { color: spec } : spec;
    const key = JSON.stringify(opts);
    let m = this._cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.04, ...opts });
      this._cache.set(key, m);
      this.mats.push(m);
    }
    return m;
  }

  add(geo, spec, t = {}) {
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, this.mat(spec));
    mesh.position.set(t.x || 0, t.y || 0, t.z || 0);
    if (t.rx) mesh.rotation.x = t.rx;
    if (t.ry) mesh.rotation.y = t.ry;
    if (t.rz) mesh.rotation.z = t.rz;
    if (t.s) mesh.scale.setScalar(t.s);
    if (t.sx || t.sy || t.sz) mesh.scale.set(t.sx || 1, t.sy || 1, t.sz || 1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  box(w, h, d, spec, t) { return this.add(new THREE.BoxGeometry(w, h, d), spec, t); }
  cyl(rt, rb, h, spec, t, seg = 14) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), spec, t); }
  sph(r, spec, t, wseg = 14, hseg = 10) { return this.add(new THREE.SphereGeometry(r, wseg, hseg), spec, t); }
  torus(r, tube, spec, t, arc = Math.PI * 2) { return this.add(new THREE.TorusGeometry(r, tube, 8, 16, arc), spec, t); }
  cone(r, h, spec, t, seg = 12) { return this.add(new THREE.ConeGeometry(r, h, seg), spec, t); }
}

// ---------------------------------------------------------------- レシピ
// 各関数は Builder を受け取って部品を足すだけ。y=0 が床、+z が手前（カメラ側）。

const SHAPES = {
  // ---- 危険（hazard）
  outlet: (b) => {                       // コンセント：壁付きの薄いプレート＋差込口2つ
    b.box(22, 26, 5, 'main', { y: 13, z: -6 });
    b.box(4, 9, 2, 0x3a3338, { y: 16, z: -3.6, x: -4.5 });
    b.box(4, 9, 2, 0x3a3338, { y: 16, z: -3.6, x: 4.5 });
    b.box(26, 3, 12, 0xbfb2a4, { y: 1.5, z: 0 });   // 巾木
    b.height = 26;
  },
  kettle: (b) => {                       // 電気ケトル：胴＋注ぎ口＋取っ手＋フタつまみ
    b.cyl(11, 12.5, 22, 'main', { y: 11 });
    b.cyl(12.5, 12.5, 2.5, 0xf0e6dc, { y: 23 });
    b.sph(2.6, 0xf0e6dc, { y: 25 });
    b.cyl(2.2, 3.6, 12, 'main', { x: 11, y: 18, rz: -0.7 });   // 注ぎ口
    b.torus(6, 1.6, 0x6b5a52, { x: -12, y: 15, ry: Math.PI / 2 }, Math.PI);
    b.cyl(13, 13, 2, 0x8d7f76, { y: 1 });                      // 台座
    b.height = 26;
  },
  knife: (b) => {                        // 包丁：まな板の上の刃＋柄（寝かせ切りだと真上から見えないので少し起こす）
    b.box(34, 2.5, 22, 0xe4d9c8, { y: 1.2, x: -2 });           // まな板
    b.box(26, 2.6, 9, METAL, { y: 7, x: 4, rz: 0.12 });
    b.box(14, 6.5, 7.5, 0x6b4a33, { y: 5.2, x: -14, rz: 0.12 });
    b.height = 11;
  },
  drawer: (b) => {                       // 引き出し：2段の前板＋取っ手
    b.box(34, H, 30, 'main', { y: H / 2 });
    for (const y of [8, 21]) {
      b.box(29, 10, 1.6, 0xf1e6d8, { y, z: 15.4 });
      b.box(12, 1.8, 1.6, 0x8d7f76, { y, z: 16.4 });
    }
    b.height = H;
  },
  trash: (b) => {                        // ゴミ箱（フタは ObjectView が別に乗せる）
    b.cyl(14, 11, H, 'main', { y: H / 2 });
    b.torus(13.5, 1, 0x8d7f76, { y: H - 3, rx: Math.PI / 2 });
    b.height = H;
  },
  medicine: (b) => {                     // 薬：薬びん＋キャップ
    b.cyl(8, 8, 17, 'main', { y: 8.5 });
    b.cyl(6, 6, 4, 0xf2ede4, { y: 19 });
    b.box(11, 7, 0.6, 0xfaf5ec, { y: 9, z: 8.2 });             // ラベル
    b.height = 21;
  },
  stairs: (b) => {                       // 階段：3段
    for (let i = 0; i < 3; i++) {
      b.box(30, 9, 26 - i * 8, 'main', { y: 4.5 + i * 9, z: -i * 4 });
    }
    b.height = 27;
  },
  table: (b) => {                        // テーブルの角：天板＋脚2本（角が手前に来る向き）
    b.box(34, 3.5, 34, 'main', { y: 24 });
    b.box(3.5, 24, 3.5, 0x9a7b5c, { y: 12, x: 13, z: 13 });
    b.box(3.5, 24, 3.5, 0x9a7b5c, { y: 12, x: -13, z: 13 });
    b.height = 26;
  },
  detergent: (b) => {                    // 洗剤ボトル：胴＋肩＋ノズル
    b.box(15, 20, 11, 'main', { y: 10 });
    b.cyl(4.5, 7, 5, 'main', { y: 22 });
    b.cyl(3.2, 3.2, 5, 0xe8eef0, { y: 26 });
    b.box(7, 3, 2, 0xe8eef0, { y: 26.5, z: 4 });               // トリガー
    b.box(11, 9, 0.6, 0xfaf5ec, { y: 10, z: 5.8 });
    b.height = 29;
  },

  // ---- 落ちている物（item）
  battery: (b) => {                      // ボタン電池：立てて置く（寝かせると小さすぎて見えない）
    b.cyl(9, 9, 4.5, METAL, { y: 9, rx: Math.PI / 2, rz: 0.1 });
    b.cyl(5.5, 5.5, 5, 0xb9c0c6, { y: 9, rx: Math.PI / 2, rz: 0.1 });
    b.box(6, 3, 5, 0x8d7f76, { y: 1.5 });                      // 転がり止めの台
    b.height = 18;
  },
  grocery: (b) => {                      // 買い物袋：口の開いた袋＋持ち手
    b.box(20, 18, 13, 'main', { y: 9, sx: 1, sy: 1 });
    b.box(22, 3, 15, 'main', { y: 18 });
    b.torus(4.5, 1.2, 'main', { y: 21, z: 4, rx: 0.25 }, Math.PI);
    b.torus(4.5, 1.2, 'main', { y: 21, z: -4, rx: -0.25 }, Math.PI);
    b.height = 24;
  },
  cigarette: (b) => {                    // たばこ：灰皿に載った吸いさし
    b.cyl(9, 8, 4, 0xd9d3c8, { y: 2 });
    b.cyl(2.6, 2.6, 18, 0xf7f4ee, { y: 6, x: 4, rz: Math.PI / 2 - 0.2 });
    b.cyl(2.7, 2.7, 7, 0xc8a05a, { y: 4.2, x: -8, rz: Math.PI / 2 - 0.2 });
    b.height = 10;
  },
  coin: (b) => {                         // 小銭：立てかけた2枚
    b.cyl(7.5, 7.5, 1.8, { color: 0xd8c07a, roughness: 0.35, metalness: 0.6 }, { y: 7.5, x: -4, rx: Math.PI / 2, rz: 0.15 });
    b.cyl(7, 7, 1.8, { color: 0xc9ccd1, roughness: 0.35, metalness: 0.6 }, { y: 7, x: 6, z: 4, rx: Math.PI / 2, rz: -0.2 });
    b.height = 15;
  },
  pills: (b) => {                        // 薬のシート：立てかけた台紙＋ふくらみ
    b.box(24, 16, 2, 0xdfe4e8, { y: 8, z: -2, rx: -0.5 });
    for (const x of [-7, 0, 7]) for (const yy of [5, 11]) b.sph(3.2, 'main', { x, y: yy, z: 1.4 + (yy - 5) * 0.5, sz: 0.6 }, 10, 6);
    b.height = 17;
  },

  // ---- おもちゃ（toy）
  spoon: (b) => {                        // 金属のスプーン：柄を少し起こしてすくい部を見せる
    b.cyl(1.9, 1.9, 22, METAL, { y: 5, x: 7, rz: Math.PI / 2 - 0.25 });
    b.sph(6.5, METAL, { x: -8, y: 3, sy: 0.4, sz: 0.8 });
    b.height = 9;
  },
  ball: (b) => {                         // ボール：球＋模様の帯
    b.sph(11, 'main', { y: 11 }, 18, 14);
    b.torus(11.1, 1.3, 0xf7f4ee, { y: 11, rx: Math.PI / 2 });
    b.torus(11.1, 1.3, 0xf7f4ee, { y: 11, rx: Math.PI / 2, ry: Math.PI / 2 });
    b.height = 22;
  },
  blocks: (b) => {                       // 積み木：立方体3つ
    b.box(11, 11, 11, 'main', { x: -6, y: 5.5, ry: 0.2 });
    b.box(11, 11, 11, 0xf0b46a, { x: 6, y: 5.5, z: 3, ry: -0.3 });
    b.box(11, 11, 11, 0xe98f8f, { x: -1, y: 16.5, ry: 0.5 });
    b.height = 22;
  },
  bear: (b) => {                         // ぬいぐるみ：胴＋頭＋耳＋手足
    b.sph(9, 'main', { y: 9, sy: 1.05 });
    b.sph(6.5, 'main', { y: 21 });
    b.sph(2.6, 0xe0b48f, { x: -5, y: 25.5 });
    b.sph(2.6, 0xe0b48f, { x: 5, y: 25.5 });
    b.sph(2.6, 0x4a3b30, { y: 20, z: 6.2, sz: 0.7 }, 8, 6);    // 鼻
    b.sph(3.5, 'main', { x: -8.5, y: 5, z: 3 }, 8, 6);
    b.sph(3.5, 'main', { x: 8.5, y: 5, z: 3 }, 8, 6);
    b.height = 28;
  },
  puzzle: (b) => {                       // ジグソーパズル：箱＋はみ出たピース
    b.box(28, 7, 22, 'main', { y: 3.5 });
    b.box(9, 3, 9, 0xf0b46a, { y: 8.5, x: -5, z: -2, ry: 0.3 });
    b.box(8, 3, 8, 0x8fd08f, { y: 8.5, x: 6, z: 4, ry: -0.4 });
    b.box(7, 3, 7, 0xe98f8f, { y: 5, x: 16, z: -7, ry: 0.8 });
    b.height = 12;
  },
  cloth: (b) => {                        // 布：たたんだ層を少しずらして重ねる
    for (let i = 0; i < 4; i++) b.box(26 - i * 3, 3.4, 19 - i * 2, 'main', { y: 1.7 + i * 3.4, ry: 0.14 * i });
    b.height = 14;
  },
  music_blocks: (b) => {                 // 合成：音の出る積み木
    SHAPES.blocks(b);
    b.torus(7, 1, { color: 0xffd45f, roughness: 0.3, metalness: 0.5 }, { y: 27, rx: Math.PI / 2 });
    b.height = 30;
  },
  bear_tower: (b) => {                   // 合成：くまの積み木タワー
    b.box(13, 8, 13, 0xf0b46a, { y: 4 });
    b.box(11, 8, 11, 0xe98f8f, { y: 12 });
    b.sph(6, 'main', { y: 22 });
    b.sph(2.4, 0xe0b48f, { x: -4.5, y: 26 });
    b.sph(2.4, 0xe0b48f, { x: 4.5, y: 26 });
    b.height = 29;
  },

  // ---- ダミー（prop）
  cushion: (b) => {                      // クッション：角の丸いふくらんだ塊
    b.sph(14, 'main', { y: 7.5, sy: 0.55, sz: 0.9 }, 16, 10);
    b.torus(11, 1.6, 'main', { y: 7.5, rx: Math.PI / 2, sz: 0.5 });
    b.height = 16;
  },
  magazine: (b) => {                     // 雑誌：重ねた本体＋開いた表紙
    b.box(26, 5, 20, 0xfaf5ec, { y: 2.5 });
    b.box(27, 2, 21, 'main', { y: 6 });
    b.box(15, 1.6, 20, 'main', { y: 9, x: 8, rz: -0.4 });
    b.height = 12;
  },
  slippers: (b) => {                     // スリッパ：2足ぶん
    for (const [x, z, ry] of [[-8, -4, 0.15], [8, 4, -0.2]]) {
      b.sph(10, 'main', { x, y: 3, z, sy: 0.36, sz: 0.55, ry }, 12, 8);
      b.box(11, 7, 9, 'main', { x: x - 3, y: 4.5, z, ry });
    }
    b.height = 11;
  },

  // ---- 安全グッズ（goods）
  cover: (b) => {                        // コンセントカバー：立てかけたプレート＋ツメ
    b.box(22, 17, 4, 'main', { y: 9, z: -2, rx: -0.35 });
    b.box(16, 10, 2, 0xf2ede4, { y: 9.5, z: 1, rx: -0.35 });
    b.box(3.5, 5, 4, 'main', { y: 3, z: 6, x: -5 });
    b.box(3.5, 5, 4, 'main', { y: 3, z: 6, x: 5 });
    b.height = 18;
  },
  lock: (b) => {                         // チャイルドロック：立ち上がったベルト＋バックル
    b.box(22, 4, 8, 'main', { y: 2 });
    b.box(4, 14, 8, 'main', { y: 10, x: 8, rz: -0.25 });
    b.box(10, 8, 10, 0xf2ede4, { y: 6, x: -6 });
    b.box(6, 5, 6, 0x6b7a99, { y: 11.5, x: -6 });
    b.height = 16;
  },
  trashlock: (b) => {                    // ゴミ箱ロック：南京錠型（本体＋つる）
    b.box(14, 13, 8, 'main', { y: 6.5 });
    b.torus(6, 2, { color: 0xc9ccd1, roughness: 0.35, metalness: 0.6 }, { y: 13 }, Math.PI);
    b.cyl(2.4, 2.4, 3, 0x6b7a99, { y: 7, z: 4.6, rx: Math.PI / 2 });
    b.height = 20;
  },
  tie: (b) => {                          // コード留め：巻いたコード＋留め具
    b.torus(11, 3, 'main', { y: 3.2, rx: Math.PI / 2 });
    b.torus(10, 3, 'main', { y: 8.4, rx: Math.PI / 2 });
    b.box(7, 6, 7, 0x6b7a99, { y: 6, x: 10 });
    b.height = 13;
  },
  gate: (b) => {                         // ベビーゲート：枠＋格子
    b.box(3, 26, 3, 'main', { x: -15, y: 13 });
    b.box(3, 26, 3, 'main', { x: 15, y: 13 });
    b.box(33, 3, 3, 'main', { y: 24.5 });
    b.box(33, 3, 3, 'main', { y: 2 });
    for (const x of [-7.5, 0, 7.5]) b.box(2, 22, 2, 0xf2ede4, { x, y: 13 });
    b.height = 27;
  },
  guard: (b) => {                        // コーナーガード：L 字
    b.box(22, 10, 7, 'main', { y: 5, x: 8, z: -8 });
    b.box(7, 10, 22, 'main', { y: 5, x: -8, z: 3 });
    b.height = 11;
  },
  mat: (b) => {                          // ジョイントマット：凹凸のある正方形パネル（2枚重ね）
    b.box(30, 5, 30, 'main', { y: 2.5 });
    for (const [x, z] of [[16, 0], [-16, 0], [0, 16], [0, -16]]) b.box(x ? 4 : 10, 5, x ? 10 : 4, 'main', { x, y: 2.5, z });
    b.box(28, 5, 28, 0xbfe0b8, { y: 7.5, ry: 0.12 });
    b.height = 10;
  },
  // ---- v6（CONTRACT §12）：ステージ3「夕方のリビング」
  window: (b) => {                       // 窓：サッシ枠＋ガラス（薄い水色）＋クレセント錠。壁際に立てる
    b.box(40, 34, 4, 0xbfd8e6, { y: 19, z: -6 });                    // ガラス
    b.box(42, 3, 5, 'main', { y: 36, z: -6 });                       // 上枠
    b.box(42, 3, 5, 'main', { y: 2.5, z: -6 });                      // 下枠
    b.box(3, 34, 5, 'main', { y: 19, z: -6, x: -20 });
    b.box(3, 34, 5, 'main', { y: 19, z: -6, x: 20 });
    b.box(2, 34, 4.5, 'main', { y: 19, z: -5.6 });                   // 中桟
    b.cyl(2.4, 2.4, 4, 0x9aa3ad, { y: 17, z: -2.5, rx: Math.PI / 2 });
    b.height = 38;
  },
  balcony: (b) => {                      // ベランダ柵：手すり＋縦格子＋床のしきい
    b.box(44, 3, 4, 'main', { y: 30, z: -6 });
    b.box(44, 2.5, 4, 'main', { y: 16, z: -6 });
    for (const x of [-18, -9, 0, 9, 18]) b.box(2.2, 30, 2.2, 'main', { x, y: 15, z: -6 });
    b.box(46, 3, 12, 0xbfb2a4, { y: 1.5, z: -1 });
    b.height = 32;
  },
  chair: (b) => {                        // 椅子：座面＋背もたれ＋脚4本（踏み台になる）
    b.box(26, 3.5, 26, 'main', { y: 18 });
    b.box(26, 20, 3, 'main', { y: 29, z: -11 });
    for (const [x, z] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) b.box(3, 18, 3, 0x9a7b5c, { x, y: 9, z });
    b.height = 40;
  },
  crate: (b) => {                        // 収納ケース：フタつきの箱＋帯（踏み台になる）
    b.box(34, 24, 26, 'main', { y: 12 });
    b.box(36, 3, 28, 0xe7dccd, { y: 25 });
    b.box(35, 3, 27, 0x9a8f80, { y: 15.5 });
    b.height = 27;
  },
  rice_cooker: (b) => {                  // 炊飯器：胴＋フタ＋蒸気口（湯気は particles / 2D の粒）
    b.cyl(13, 14, 18, 'main', { y: 9 });
    b.cyl(14, 14, 3.5, 0xf0e6dc, { y: 19.5 });
    b.cyl(4, 4, 3, 0xd9dde2, { y: 22.5 });
    b.box(10, 6, 1.5, 0x3a3338, { y: 10, z: 14 });                   // 操作パネル
    b.height = 25;
  },
  stove: (b) => {                        // コンロ：天板＋五徳2口＋つまみ
    b.box(40, 8, 30, 0x4a464f, { y: 4 });
    for (const x of [-10, 10]) {
      b.cyl(7, 7, 1.6, 0x2f2b33, { x, y: 8.6 });
      b.torus(6.5, 1.1, 'main', { x, y: 9.6, rx: Math.PI / 2 });
    }
    b.cyl(2.4, 2.4, 3, 0xd9dde2, { y: 5, z: 16, rx: Math.PI / 2 });
    b.height = 12;
  },
  puddle: (b) => {                       // こぼれた水（zone の中央マーカー）：平たい水面＋しずく
    b.sph(13, { color: 0x8fc6e6, roughness: 0.15, metalness: 0.25 }, { y: 1.2, sy: 0.12, sz: 0.85 }, 16, 8);
    b.sph(5, { color: 0xaddcf2, roughness: 0.15, metalness: 0.25 }, { x: 11, y: 1, z: 6, sy: 0.16 }, 10, 6);
    b.height = 4;
  },
  heater: (b) => {                       // ヒーター（zone の中央マーカー）：本体＋前面グリル
    b.box(34, 20, 14, 'main', { y: 10 });
    for (const y of [7, 12, 17]) b.box(30, 2, 1.5, 0xffb27a, { y, z: 7.4 });
    b.box(36, 2.5, 16, 0x8d7f76, { y: 1.2 });
    b.height = 22;
  },
  towel: (b) => {                        // タオル：たたんだ層＋巻いた一本
    for (let i = 0; i < 3; i++) b.box(26 - i * 3, 4, 18 - i * 2, 'main', { y: 2 + i * 4, ry: 0.08 * i });
    b.cyl(4.5, 4.5, 20, 0xf2ede4, { y: 17, rz: Math.PI / 2 });
    b.height = 21;
  },
  heater_guard: (b) => {                 // ヒーターガード：コの字の柵
    b.box(36, 22, 2.5, 'main', { y: 11, z: -9 });
    b.box(2.5, 22, 18, 'main', { y: 11, x: -17 });
    b.box(2.5, 22, 18, 'main', { y: 11, x: 17 });
    for (const x of [-8, 0, 8]) b.box(2, 18, 2, 0xf2ede4, { x, y: 11, z: -9 });
    b.height = 24;
  },
  window_lock: (b) => {                  // まどの補助錠：サッシに付ける小さなレバー錠
    b.box(12, 16, 7, 'main', { y: 8 });
    b.box(5, 9, 4, 0xd9dde2, { y: 17, rz: 0.4 });
    b.box(16, 3, 9, 0xf2ede4, { y: 1.5 });
    b.height = 22;
  }
};
// 同じ形でよいもの（id 違いの複製）。SHAPES の定義後にまとめて割り当てる
SHAPES.balcony_lock = SHAPES.window_lock;
SHAPES.lock_b = SHAPES.lock;

// ---------------------------------------------------------------- 壁（家具）の飾り
// 壁は従来どおり箱（ThreeRenderer._makeWall）で、ここはその上に載せるディテールだけを作る。
// 座標は**箱の中心**が原点（x: ±w/2、y: ±WALL_H/2、z: ±h/2）。glb が来たら箱ごと隠れる（mesh の子にする）。
const WALL_SHAPES = {
  window: (b, w, h, wh) => {             // 窓：白い枠とガラス（手前の面）
    b.box(w - 16, wh - 16, 2, 0xd4e6f0, { y: 0, z: h / 2 + 1 });
    b.box(w - 12, 4, 4, 0xf7f2e8, { y: wh / 2 - 8, z: h / 2 + 1 });
    b.box(w - 12, 4, 4, 0xf7f2e8, { y: -wh / 2 + 8, z: h / 2 + 1 });
    b.box(4, wh - 12, 4, 0xf7f2e8, { z: h / 2 + 1 });
  },
  balcony: (b, w, h, wh) => {            // ベランダ：手すりと縦格子
    b.box(w - 8, 3, 4, 0xe7dccd, { y: wh / 2 + 2, z: h / 2 });
    for (let x = -w / 2 + 14; x <= w / 2 - 14; x += 22) b.box(2.5, 14, 2.5, 0xe7dccd, { x, y: wh / 2 - 5, z: h / 2 });
  },
  counter: (b, w, h, wh) => {            // カウンター：天板の縁
    b.box(w, 4, h + 6, 0xe7dccd, { y: wh / 2 + 1 });
  },
  shelf: (b, w, h, wh) => {              // 棚：横板2枚（手前の面）
    for (const y of [-wh / 6, wh / 6]) b.box(w + 2, 3, h - 8, 0xbfa98a, { y });
  }
};

WALL_SHAPES.tv_stand = (b, w, h, wh) => { // テレビ台：黒い画面
  b.box(Math.min(w, h) * 0.2 + 6, wh * 0.6, 3, 0x2f2b33, { y: wh * 0.15, x: w > h ? 0 : w / 2 + 1, z: w > h ? h / 2 + 1 : 0, ry: w > h ? 0 : Math.PI / 2 });
};
WALL_SHAPES.sofa = (b, w, h, wh) => {     // ソファ：座面のクッション3つ
  for (const x of [-w / 3, 0, w / 3]) b.box(w / 3.6, 8, h - 14, 0xe0b48f, { x, y: wh / 2 + 2 });
};

/**
 * 壁（家具）の飾りを組み立てる。無ければ null。
 * @param {object} wall stage.walls の要素
 * @param {number} wallH 壁の高さ（箱の高さ）
 * @returns {{ group, mats, geos } | null}  group は壁の箱（中心が原点）の子として add する
 */
export function buildWallShape(wall, wallH) {
  const recipe = WALL_SHAPES[wall && wall.model];
  if (!recipe) return null;
  const b = new Builder(new THREE.MeshStandardMaterial({ color: 0xe7dccd, roughness: 0.8, metalness: 0 }));
  b.mats.push(b.mainMat);
  recipe(b, wall.w, wall.h, wallH);
  return { group: b.group, mats: b.mats, geos: b.geos };
}


/**
 * def に対応する形状を組み立てる。レシピが無ければ null（ObjectView は従来の箱にフォールバック）。
 * @param {object} def stage.objects の定義
 * @param {THREE.Material} mainMat kind 色のマテリアル（対策時に色が変わる。形状の主要部に使う）
 * @returns {{ group: THREE.Group, mats: THREE.Material[], geos: THREE.BufferGeometry[], height: number } | null}
 */
export function buildShape(def, mainMat) {
  const recipe = SHAPES[def.model || def.id];
  if (!recipe) return null;
  const b = new Builder(mainMat);
  recipe(b);
  const h = b.height || H;
  // 視認性の補正：部屋 800x540 を1画面に収めるカメラだと、実寸どおりの小物（電池・スプーン等）は
  // 数 px にしかならない。背の低いものほど大きく見せて、箱だった頃と同程度の存在感に揃える。
  // 上限 1.5 は、隣のオブジェクトと重ならない範囲で実測して決めた
  const k = Math.min(1.5, Math.max(1, H / Math.max(10, h)));
  if (k > 1) b.group.scale.setScalar(k);
  return { group: b.group, mats: b.mats, geos: b.geos, height: h * k };
}

export function hasShape(def) {
  return !!SHAPES[def.model || def.id];
}

export function disposeShape(shape) {
  if (!shape) return;
  if (shape.group.parent) shape.group.parent.remove(shape.group);
  for (const g of shape.geos) g.dispose();
  for (const m of shape.mats) m.dispose();
}
