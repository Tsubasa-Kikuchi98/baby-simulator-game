// フェーズ2 描画層：Three.js。gameState（docs/CONTRACT.md §5）を毎フレーム読んで描く。
// 座標：ゲーム (x, y) → 部屋グループ内の (x, 0, y)。部屋グループ自体を (-400, 0, -270) に置き、
// ワールド原点が部屋の中心になるようにする（toGameCoords / toScreenCoords / pickObject はこれを前提）。
// 盤面上の因果表現（§4.8 / §9）はここ、HTML の HUD は src/ui.js。
// v3（§9）：オブジェクトの進捗リングは描かない（取り上げのリングだけ BabyView に残す）。容れ物、高い場所（highPlace の
// wall 上面のヒント板）、収納済み hazard（壁の上・収納先の上に小さく灰色で ✅）、重い家具の台座＋鍵、捨てた絵文字の飛び。
// v5（§11）：口に入れる（口元の物＋頭上の危険リング）、高い場所の容量 n/2（満杯は赤いヒント板）、ダミー、危険なおもちゃの「！」、猫（CatView）。
import * as THREE from 'three';
import { IRenderer } from '../IRenderer.js';
import { ROOM, TUNING } from '../../game/stages.js';
import { EffectStore, POP_SEC, POP_RISE_PX, POP_COLORS, easeOut } from '../canvas2d/effects.js';
import {
  COLORS, makeFloorTexture, makeSprite, makeCheckTexture, makeAkitaTexture,
  makeGrumpyTexture, makePopTexture, makeLockTexture, makeEmojiTexture, makeMatTexture, makeRiskBadgeTexture, disposeSprite
} from './textures.js';
import { ParticleSystem } from './particles.js';
import { AssetCache, fitModel, countVertices, disposeObject } from './assets.js';
import { ObjectView, BOX_H } from './ObjectView.js';
import { BabyView } from './BabyView.js';
import { VisitorView, CatView } from './VisitorView.js';
import { LabelLayer } from './labels.js';
import { hintTargets, hintWalls, boredFraction, isStored, findWall, highPlaceCount, wallCapacity, isHighPlaceFull } from '../hints.js';

const WALL_H = 60;
const MAT_D = 40;                        // マットの奥行き（家具の前の床）
const MAT_H = 2;                         // マットの厚み
const FALL_SEC = 0.4;                    // 転落アニメ
const HOP_SEC = 0.3;                     // 自分で降りる
const ITEM_DROP_SEC = 0.3;               // 訪問者が手元から落とす
const CAM_ELEV = (60 * Math.PI) / 180;   // 斜め上 60°
const CAM_FOV = 36;
const CAM_MARGIN = 0.965;                // NDC でこの範囲に部屋を収める
const MAX_DPR = 2;
const LOAD_TIMEOUT_MS = 8000;
const VERTEX_BUDGET = 100000;
const FLASH_SEC = 0.2;
const DRAG_LIFT = 8;
const COMBO_PULSE = 10;
const STORED_SCALE = 0.7;                // 収納済み hazard の縮小率
const FLY_SEC = 0.3;                     // 捨てた／片付けた絵文字が飛ぶ時間

export class ThreeRenderer extends IRenderer {
  /**
   * @param {object} [opts]
   * @param {number} [opts.topInset=0]  上端に空ける px（HTML の HUD 帯と部屋を重ねない）
   */
  constructor({ topInset = 0 } = {}) {
    super();
    this.isThreeRenderer = true;
    this.topInset = topInset;
    this.container = null;
    this.renderer = null;
    this.canvas = null;
    this.flashEl = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.background);
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 10, 6000);
    this.camTarget = new THREE.Vector3(0, 0, 0);
    this.room = new THREE.Group();
    this.room.position.set(-ROOM.cx, 0, -ROOM.cy);
    this.scene.add(this.room);
    this.stageGroup = null;
    this.floor = null;
    this.floorTex = null;
    this.lights = [];

    this.assets = new AssetCache();
    this.shared = null;                 // 共有テクスチャ（init で作る）
    this.particles = null;
    this.objects = new Map();           // id → ObjectView
    this.babies = new Map();            // id → BabyView
    this.visitors = new Map();          // id → VisitorView（state.visitors。触れない）
    this.mats = new Map();              // climbable object id → マットの Mesh（fixed のとき見せる）
    this.babyPrev = new Map();          // babyId → { x, y, climbing }（前フレーム。転落アニメの出発点）
    this.babyFalls = new Map();         // babyId → { from: Vector3, to: Vector3|null, t, dur, kind: 'safe'|'hop'|'hiyari' }
    this.mouthStart = new Map();        // babyId → { start, until }（口に入れた時刻。危険リングの分母）
    this.walls = [];                    // { mesh, label, model }

    this.stage = null;
    this.lastState = null;
    this.t = 0;
    this.fx = new EffectStore();
    this.pops = [];                     // { sprite, t, x, y, z }
    this.flies = [];                    // { sprite, from: Vector3, to: Vector3, t }（trashed / stored）
    this.prevAnim = new Map();
    this.fixedSeen = new Map();         // id → bool（fixed 遷移検出）
    this.boredTotal = new Map();        // toyId → 飽きの総秒数（bored effect の until - elapsed）

    this.raycaster = new THREE.Raycaster();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._ndc = new THREE.Vector2();
    this.lastGame = { x: ROOM.cx, y: ROOM.cy };
    this._orbitKeep = new Set();       // 今フレーム使った星の key

    this._resizeObserver = null;
    this._onWindowResize = () => this.resize();
    this._size = { w: 1, h: 1, top: 0 };
  }

  // ---------------------------------------------------------------- lifecycle

  init(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // ソフトウェア GL（SwiftShader / llvmpipe：ヘッドレステスト等）ではシャドウを軽くする
    this.softwareGL = detectSoftwareGL(renderer);
    renderer.setPixelRatio(this.softwareGL ? 1 : Math.min(MAX_DPR, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = this.softwareGL ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    renderer.setClearColor(COLORS.background, 1);
    // トーンマッピング：明部の白飛びを抑えて陰影の階調を残す（箱でも立体に見せるため）。
    // UI 的な Sprite は toneMapped:false（textures.js の makeSprite）なので色が転ばない
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    this.renderer = renderer;
    const canvas = renderer.domElement;
    canvas.className = 'game-canvas game-canvas-3d';
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: `${this.topInset}px`, width: '100%', display: 'block' });
    container.appendChild(canvas);
    this.canvas = canvas;

    // ヒヤリの黄フラッシュ（全画面）。HTML で重ねる
    const flash = document.createElement('div');
    flash.className = 'hiyari-flash';
    Object.assign(flash.style, {
      position: 'absolute', inset: '0', background: 'rgb(255, 228, 110)', opacity: '0',
      pointerEvents: 'none', transition: 'none'
    });
    container.appendChild(flash);
    this.flashEl = flash;

    // ラベルは HTML の div レイヤー（labels.js）。Sprite 縮小によるボケを避けるため
    this.labelLayer = new LabelLayer(container);
    this.shared = { checkTex: makeCheckTexture(), akitaTex: makeAkitaTexture(), grumpyTex: makeGrumpyTexture(), lockTex: makeLockTexture(), riskTex: makeRiskBadgeTexture(), labels: this.labelLayer };

    // ホバー中の id はラベルの優先表示にだけ使う（state には一切触らない）
    this._hoverPos = null;
    this._onPointerMove = (e) => { this._hoverPos = { x: e.clientX, y: e.clientY }; };
    canvas.addEventListener('mousemove', this._onPointerMove);
    canvas.addEventListener('mouseleave', () => { this._hoverPos = null; this.hoverId = null; });
    this.particles = new ParticleSystem(this.room);
    this._buildLights();
    this._buildFloor();

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(container);
    }
    window.addEventListener('resize', this._onWindowResize);
    this.resize();
  }

  /** ステージの素材を読み、部屋を組む。glb が無ければプレースホルダー。 */
  async loadStage(stage) {
    const jobs = this._buildStage(stage);
    await withTimeout(Promise.allSettled(jobs), LOAD_TIMEOUT_MS);
    const n = countVertices(this.scene);
    console.info('[three] vertices:', n);
    if (n > VERTEX_BUDGET) console.warn(`[three] vertex count ${n} exceeds budget ${VERTEX_BUDGET}`);
    this.vertexCount = n;
  }

  /** 同期でプレースホルダーを組み、モデル読み込みの Promise 群を返す */
  _buildStage(stage) {
    this.stage = stage;
    this._clearStage();
    this.stageGroup = new THREE.Group();
    this.room.add(this.stageGroup);
    const jobs = [];
    for (const wall of stage.walls || []) {
      const entry = this._makeWall(wall);
      jobs.push(this.assets.load(wall.model).then((g) => { if (g) this._swapWallModel(entry, g); }));
    }
    for (const def of stage.objects || []) {
      const view = this._ensureObject(def);
      jobs.push(Promise.all([this.assets.load(def.model), this.assets.load(def.fixedModel)])
        .then(([g, f]) => view.setModels(g, f)));
    }
    const nBabies = stage.babies || 1;
    for (let i = 0; i < nBabies; i++) {
      const spawn = (stage.babySpawns && (stage.babySpawns[i] || stage.babySpawns[0])) || { x: ROOM.cx, y: ROOM.cy };
      const view = this._ensureBaby({ id: `baby${i}`, x: spawn.x, y: spawn.y }, i);
      jobs.push(this.assets.load('baby').then((g) => view.setModel(g)));
    }
    return jobs;
  }

  _clearStage() {
    for (const v of this.objects.values()) v.dispose();
    this.objects.clear();
    for (const v of this.babies.values()) v.dispose();
    this.babies.clear();
    for (const v of this.visitors.values()) v.dispose();
    this.visitors.clear();
    for (const m of this.mats.values()) { if (m.parent) m.parent.remove(m); m.geometry.dispose(); disposeMats(m.material); }
    this.mats.clear();
    this.babyPrev.clear();
    this.babyFalls.clear();
    this.mouthStart.clear();
    for (const w of this.walls) {
      disposeSprite(w.label);
      w.mesh.geometry.dispose();
      w.mesh.material.dispose();
      if (w.hint) { w.hint.geometry.dispose(); w.hint.material.dispose(); }
      if (w.model) disposeObject(w.model);
    }
    this.walls = [];
    if (this.stageGroup) {
      this.room.remove(this.stageGroup);
      this.stageGroup = null;
    }
    this.fx.reset();
    this.prevAnim.clear();
    this.fixedSeen.clear();
    this.boredTotal.clear();
    this._clearPops();
    this._clearFlies();
    if (this.particles) this.particles.reset();
    if (this.flashEl) this.flashEl.style.opacity = '0';
  }

  dispose() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    window.removeEventListener('resize', this._onWindowResize);
    this._clearStage();
    if (this.particles) this.particles.dispose();
    if (this.floor) {
      this.room.remove(this.floor);
      this.floor.geometry.dispose();
      this.floor.material.dispose();
      this.floorTex.dispose();
    }
    if (this.shared) for (const [k, t] of Object.entries(this.shared)) { if (k !== 'labels') t.dispose(); }
    for (const l of this.lights) { if (l.dispose) l.dispose(); this.scene.remove(l); }
    if (this.renderer) {
      this.renderer.dispose();
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
    if (this.canvas && this._onPointerMove) this.canvas.removeEventListener('mousemove', this._onPointerMove);
    if (this.labelLayer) { this.labelLayer.dispose(); this.labelLayer = null; }
    if (this.flashEl && this.flashEl.parentNode) this.flashEl.parentNode.removeChild(this.flashEl);
    this.renderer = null;
    this.canvas = null;
  }

  showOverlay() { /* HTML の ui.js が担当 */ }

  // ---------------------------------------------------------------- scene building

  _buildLights() {
    // 以前は AmbientLight 0.95 だけで全方向を一様に持ち上げていたため陰影が潰れ、
    // どの面も同じ明るさ＝「板」に見えていた。環境光を落として
    // 半球光（空＝暖色／床＝床の反射色）で方向性を与え、主光源の陰影を効かせる。
    const ambient = new THREE.AmbientLight(0xffffff, 0.30);
    const hemi = new THREE.HemisphereLight(0xfff0dc, 0xb99b78, 0.75);
    hemi.position.set(0, 600, 0);
    const dir = new THREE.DirectionalLight(0xfff3e2, 1.65);
    dir.position.set(-260, 560, 240);
    dir.target.position.set(0, 0, 0);
    dir.castShadow = true;
    const shadowRes = this.softwareGL ? 1024 : 2048;
    dir.shadow.mapSize.set(shadowRes, shadowRes);
    const sc = dir.shadow.camera;
    sc.left = -540; sc.right = 540; sc.top = 420; sc.bottom = -420;
    sc.near = 50; sc.far = 1500;
    dir.shadow.bias = -0.0005;
    dir.shadow.normalBias = 1.0;
    // 主光源の反対側から弱い補助光。輪郭が背景に溶けないようにする
    const fill = new THREE.DirectionalLight(0xd8e4ff, 0.35);
    fill.position.set(340, 300, -280);
    this.scene.add(ambient, hemi, dir, dir.target, fill);
    this.lights = [ambient, hemi, dir, fill];
  }

  _buildFloor() {
    this.floorTex = makeFloorTexture(ROOM.w, ROOM.h);
    if (this.renderer) this.floorTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const geo = new THREE.PlaneGeometry(ROOM.w, ROOM.h);
    const mat = new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.95, metalness: 0 });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(ROOM.cx, 0, ROOM.cy);
    floor.receiveShadow = true;
    this.room.add(floor);
    this.floor = floor;
  }

  _makeWall(wall) {
    const geo = new THREE.BoxGeometry(wall.w, WALL_H, wall.h);
    const mat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(wall.x + wall.w / 2, WALL_H / 2, wall.y + wall.h / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.stageGroup.add(mesh);
    let label = null;
    if (wall.label) {
      // 高い場所はラベルに n/容量（＋満）が付いて長くなるので広めに
      label = this.labelLayer.create(wall.label, { variant: 'wall', priority: 1 });
      label.position.set(wall.x + wall.w / 2, WALL_H + 10, wall.y + wall.h / 2);
      this.stageGroup.add(label);
    }
    // 高い場所：上面にヒント板（軽いものをドラッグ中に脈打つ）
    let hint = null;
    if (wall.highPlace) {
      const hg = new THREE.PlaneGeometry(Math.max(4, wall.w - 6), Math.max(4, wall.h - 6));
      const hm = new THREE.MeshBasicMaterial({ color: COLORS.hint, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
      hint = new THREE.Mesh(hg, hm);
      hint.rotation.x = -Math.PI / 2;
      hint.position.set(wall.x + wall.w / 2, WALL_H + 0.6, wall.y + wall.h / 2);
      hint.renderOrder = 3;
      hint.visible = false;
      this.stageGroup.add(hint);
    }
    const entry = { def: wall, mesh, label, model: null, hint, labelText: wall.label || '', labelFull: false };
    this.walls.push(entry);
    return entry;
  }

  _swapWallModel(entry, gltf) {
    const { def } = entry;
    const model = fitModel(gltf.scene, { maxW: def.w, maxH: WALL_H + 20, maxD: def.h });
    model.position.set(def.x + def.w / 2, 0, def.y + def.h / 2);
    this.stageGroup.add(model);
    entry.mesh.visible = false;
    entry.model = model;
  }

  _ensureObject(def) {
    let v = this.objects.get(def.id);
    if (v) return v;
    if (!this.stageGroup) { this.stageGroup = new THREE.Group(); this.room.add(this.stageGroup); }
    v = new ObjectView(def, this.shared);
    this.stageGroup.add(v.group);
    this.objects.set(def.id, v);
    return v;
  }

  _ensureBaby(def, index) {
    let v = this.babies.get(def.id);
    if (v) return v;
    if (!this.stageGroup) { this.stageGroup = new THREE.Group(); this.room.add(this.stageGroup); }
    v = new BabyView(def, index, this.shared);
    this.stageGroup.add(v.group);
    this.babies.set(def.id, v);
    return v;
  }

  // ---------------------------------------------------------------- layout / coords

  resize() {
    if (!this.renderer || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const top = Math.min(this.topInset, Math.floor(h * 0.3));
    const availH = Math.max(1, h - top);
    this.canvas.style.top = `${top}px`;
    this.canvas.style.height = `${availH}px`;
    this.renderer.setSize(w, availH, false);
    if (this.labelLayer) this.labelLayer.setViewport(top, w, availH);
    this._size = { w, h: availH, top };
    this.camera.aspect = w / availH;
    this._fitCamera();
  }

  /** 部屋全体（壁の高さ込み）が画面に収まる距離をカメラに与える */
  _fitCamera() {
    const cam = this.camera;
    const dir = new THREE.Vector3(0, Math.sin(CAM_ELEV), Math.cos(CAM_ELEV));
    const hw = ROOM.w / 2;
    const hd = ROOM.h / 2;
    const corners = [
      [-hw, 0, -hd], [hw, 0, -hd], [-hw, 0, hd], [hw, 0, hd],
      [-hw, WALL_H, -hd], [hw, WALL_H, -hd], [-hw, WALL_H, hd], [hw, WALL_H, hd]
    ];
    const target = this.camTarget.set(0, 0, 0);
    const v = this._v;
    const place = (d) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    };
    const bounds = () => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of corners) {
        v.set(c[0], c[1], c[2]).project(cam);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      return { minX, maxX, minY, maxY };
    };
    let d = 1000;
    for (let iter = 0; iter < 3; iter++) {
      let lo = 200, hi = 6000;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        place(mid);
        const b = bounds();
        const fits = Math.max(-b.minX, b.maxX, -b.minY, b.maxY) <= CAM_MARGIN;
        if (fits) hi = mid; else lo = mid;
      }
      d = hi;
      place(d);
      // 上下中央に寄せる：NDC の中心ずれをカメラの up 方向の平行移動に換算
      const b = bounds();
      const yc = (b.minY + b.maxY) / 2;
      const shift = yc * d * Math.tan((cam.fov * Math.PI) / 360);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      target.addScaledVector(up, shift);
    }
    place(d);
    this.camDist = d;
  }

  _clientToNdc(clientX, clientY) {
    const rect = this.canvas ? this.canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
    this._ndc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    );
    return this._ndc;
  }

  /** 画面（client）座標 → ゲーム座標。床平面 y=0 との交点 */
  toGameCoords(clientX, clientY) {
    if (!this.canvas) return { ...this.lastGame };
    this.raycaster.setFromCamera(this._clientToNdc(clientX, clientY), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, this._v);
    if (!hit) return { ...this.lastGame };
    const x = clamp(hit.x + ROOM.cx, 0, ROOM.w);
    const y = clamp(hit.z + ROOM.cy, 0, ROOM.h);
    this.lastGame = { x, y };
    return { x, y };
  }

  /** ゲーム座標（床上）→ 画面（client）座標 */
  toScreenCoords(x, y) {
    const rect = this.canvas ? this.canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
    const v = this._v.set(x - ROOM.cx, 0, y - ROOM.cy).project(this.camera);
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height
    };
  }

  /** 画面座標 → baby.id | object.id | null。赤ちゃん優先。持たれている物（手・口元・猫）・removed・used（グッズ）・収納済みは無視 */
  pickObject(clientX, clientY) {
    const s = this.lastState;
    if (!s || !this.canvas) return null;
    this.raycaster.setFromCamera(this._clientToNdc(clientX, clientY), this.camera);
    const babyMeshes = [];
    for (const b of s.babies || []) {
      const v = this.babies.get(b.id);
      if (v) babyMeshes.push(...v.pickMeshes);
    }
    let hits = this.raycaster.intersectObjects(babyMeshes, false);
    let id = idFromHits(hits);
    if (id) return id;
    const objMeshes = [];
    for (const o of s.objects || []) {
      if (o.state === 'removed' || o.state === 'used') continue;
      if (o.carriedBy != null) continue;
      if (isStored(o)) continue;
      const v = this.objects.get(o.id);
      if (v) objMeshes.push(v.pickMesh);
    }
    hits = this.raycaster.intersectObjects(objMeshes, false);
    id = idFromHits(hits);
    return id || null;
  }

  // ---------------------------------------------------------------- effects

  playEffect(type, objectId, payload = {}) {
    const s = this.lastState;
    const obj = s && objectId != null ? (s.objects || []).find(o => o.id === objectId) : null;
    const baby = s && objectId != null ? (s.babies || []).find(b => b.id === objectId) : null;
    switch (type) {
      case 'fixed':
      case 'removed': {
        const v = this.objects.get(objectId);
        if (v && this.particles) {
          const p = v.group.position;
          const high = type === 'fixed' && payload.via === 'high';
          this.particles.burst(this._v.set(p.x, (high ? WALL_H : 0) + BOX_H * 0.6, p.z), high ? { count: 18, color: COLORS.puff, life: 0.5, size: 6 } : {});
        }
        if (type === 'fixed' && payload.via === 'store' && payload.into) this.fx.start('lidpop', payload.into, 0.4);
        this.fx.start('fixdone', objectId, 0.6);
        break;
      }
      case 'trashed':
      case 'stored': {
        // 消える：粒のパフ＋絵文字が容れ物／棚へ飛ぶ（0.3 秒）
        const v = this.objects.get(objectId);
        const from = v ? this._v.set(v.group.position.x, v.body.position.y + BOX_H * 0.6, v.group.position.z).clone()
          : new THREE.Vector3(obj ? obj.x : ROOM.cx, BOX_H * 0.6, obj ? obj.y : ROOM.cy);
        if (this.particles) this.particles.burst(from, { count: 16, color: COLORS.puff, life: 0.5, size: 6 });
        const to = this._intoPos(payload.into, from, s);
        if (obj && obj.emoji) this._startFly(obj.emoji, from, to);
        if (type === 'trashed' && payload.into) this.fx.start('lidpop', payload.into, 0.4);
        break;
      }
      case 'heavy_nudge':
        // 重いものを引っ張ろうとした（input が出す描画層ローカルの効果）：小さく揺れて「動かない」
        this.fx.start('nudge', objectId, 0.35);
        if (obj) this._addPop(obj.x, BOX_H + 24, obj.y, '動かない', POP_COLORS.neutral);
        break;
      case 'respawn':
        this.fx.start('bounce', objectId, 0.45);
        break;
      case 'hiyari': {
        this.fx.flash();
        // ソファからの転落（登っていた赤ちゃんがヒヤリ）：spawn に戻る前に 0.4 秒の落下アニメ（壁の天面 → 家具前の床）
        const prev = payload.babyId != null ? this.babyPrev.get(payload.babyId) : null;
        if (prev && prev.climbing) {
          const wl = findWall(s && s.stage, prev.climbing);
          const to = wl ? new THREE.Vector3(prev.x, 0, wl.y + wl.h + TUNING.BABY_RADIUS + 2) : new THREE.Vector3(prev.x, 0, prev.y + 50);
          this.babyFalls.set(payload.babyId, { from: new THREE.Vector3(prev.x, WALL_H, prev.y), to, t: 0, dur: FALL_SEC, kind: 'hiyari' });
        }
        break;
      }
      case 'combo_hiyari':
        if (payload.ignoresFix) this.fx.start('shake', objectId, 0.5);
        break;
      case 'climb_start': {
        // 登った：天面で小さな sparkle と「ごきげん」ポップ
        const b = payload.babyId != null && s ? (s.babies || []).find(x => x.id === payload.babyId) : null;
        if (b) {
          if (this.particles) this.particles.burst(this._v.set(b.x, WALL_H + 12, b.y), { count: 14, color: COLORS.sparkle, life: 0.6, size: 6 });
          this._addPop(b.x, WALL_H + 44, b.y, '↑ ごきげん', POP_COLORS.good);
        }
        break;
      }
      case 'climb_fall_safe': {
        // マットの上へ落ちた：天面（前フレーム位置）から今の床位置へ落下し、小さくバウンド。フラッシュ無し
        const prev = payload.babyId != null ? this.babyPrev.get(payload.babyId) : null;
        if (prev) this.babyFalls.set(payload.babyId, { from: new THREE.Vector3(prev.x, WALL_H, prev.y), to: null, t: 0, dur: FALL_SEC, kind: 'safe' });
        break;
      }
      case 'climb_end': {
        // 自分で降りる：短いホップ
        const prev = payload.babyId != null ? this.babyPrev.get(payload.babyId) : null;
        if (prev) this.babyFalls.set(payload.babyId, { from: new THREE.Vector3(prev.x, WALL_H, prev.y), to: null, t: 0, dur: HOP_SEC, kind: 'hop' });
        break;
      }
      case 'visitor_enter':
      case 'visitor_leave': {
        // 出入り：足元に小さな埃
        const vis = s && s.visitors ? s.visitors.find(v => v.id === objectId) : null;
        if (vis && this.particles) {
          const x = clamp(vis.x, 6, ROOM.w - 6);
          this.particles.burst(this._v.set(x, 4, vis.y), { count: 10, color: COLORS.puff, life: 0.45, size: 6 });
        }
        break;
      }
      case 'visitor_drop': {
        // 訪問者の手元から item が床へ落ちる（0.3 秒）。実行時に追加された object の View はここで作る
        if (!obj) break;
        const v = this._ensureObject(obj);
        const vv = this.visitors.get(payload.visitorId);
        const from = vv ? vv.handPosition(new THREE.Vector3()) : new THREE.Vector3(obj.x, 34, obj.y);
        v.arc = { from, t: 0, dur: ITEM_DROP_SEC, rise: 0, puff: true };
        break;
      }
      case 'mouth_start': {
        // 口に入れた：頭上に「！」、危険リングの開始時刻を覚える（残り時間で縮む）
        const b = payload.babyId != null && s ? (s.babies || []).find(x => x.id === payload.babyId) : null;
        if (b) {
          const until = payload.until != null ? payload.until : (b.mouthing ? b.mouthing.until : (s.elapsed || 0) + TUNING.MOUTH_SEC_MAX);
          this.mouthStart.set(b.id, { start: s.elapsed || 0, until });
          this._addPop(b.x, 30 + 40, b.y, '！', POP_COLORS.bad);
          this.fx.start('mouthPop', b.id, 0.35);
        }
        break;
      }
      case 'mouth_release': {
        // 手放した：口元から足元へ弧を描いて落ち、「ほっ」
        this._startArc(objectId);
        const b = payload.babyId != null && s ? (s.babies || []).find(x => x.id === payload.babyId) : null;
        if (b) {
          this._addPop(b.x, 30 + 34, b.y, 'ほっ', COLORS.info);
          this.mouthStart.delete(b.id);
        }
        break;
      }
      case 'high_full': {
        // 高い場所が満杯：wall の天面から手前の床へ跳ね返る＋「もう置けない」
        const v = obj ? this._ensureObject(obj) : null;
        if (v && obj) {
          const wl = findWall(s && s.stage, payload.into);
          const fx = wl ? Math.max(wl.x, Math.min(wl.x + wl.w, obj.x)) : obj.x;
          const fz = wl ? Math.max(wl.y, Math.min(wl.y + wl.h, obj.y)) : obj.y;
          v.arc = { from: new THREE.Vector3(fx, WALL_H * 0.6, fz), t: 0, dur: ITEM_DROP_SEC, rise: 8 };
          this._addPop(obj.x, BOX_H + 26, obj.y, 'もう置けない', POP_COLORS.bad);
        }
        break;
      }
      case 'cat_take': {
        // 猫がくわえた：小さなパフ
        const v = this.objects.get(objectId);
        if (v && this.particles) this.particles.burst(this._v.set(v.group.position.x, 6, v.group.position.z), { count: 8, color: COLORS.puff, life: 0.4, size: 5 });
        break;
      }
      case 'cat_drop': {
        // 猫が置いた：口元から床へ小さくホップし、着地で埃
        if (!obj) break;
        const v = this._ensureObject(obj);
        const cat = [...this.visitors.values()].find(x => x.type === 'cat');
        const from = cat ? cat.mouthPosition(new THREE.Vector3()) : new THREE.Vector3(obj.x, 14, obj.y);
        v.arc = { from, t: 0, dur: ITEM_DROP_SEC, rise: 10, puff: true };
        break;
      }
      case 'play_done': {
        const amt = payload.amount ?? 0;
        const v = this.objects.get(objectId);
        const pos = v ? v.group.position : this._v.set(ROOM.cx, 0, ROOM.cy);
        this._addPop(pos.x, BOX_H + 26, pos.z, (amt >= 0 ? '+' : '−') + Math.abs(amt), amt >= 0 ? POP_COLORS.good : POP_COLORS.bad);
        break;
      }
      case 'drop':
        this._startArc(objectId);
        break;
      case 'takeaway':
        if (payload.toyId) this._startArc(payload.toyId);
        break;
      case 'pickup':
        if (baby) this.fx.start('lift', objectId, 0.25);
        break;
      case 'fuss_start':
        this.fx.start('fussPop', objectId, 0.4);
        break;
      case 'bored':
        if (payload.until != null && s) this.boredTotal.set(objectId, Math.max(0.1, payload.until - (s.elapsed || 0)));
        break;
      case 'unbored':
        this.boredTotal.delete(objectId);
        break;
      case 'play_start':
        this.fx.start('playstart', objectId, 0.5);
        break;
      case 'recipe_ok': {
        // 成立：ドロップ位置で金色の sparkle（中央のラベルは ui.js）
        const p = this._payloadPos(payload, obj);
        if (this.particles) this.particles.burst(this._v.set(p.x, BOX_H * 0.5, p.y), { count: 40, color: COLORS.sparkle, life: 0.8, size: 8 });
        break;
      }
      case 'recipe_ng': {
        // 不成立：グッズが小さく震え、灰色の × がポップ
        if (payload.a) this.fx.start('gshake', payload.a, 0.4);
        const p = this._payloadPos(payload, obj);
        this._addPop(p.x, BOX_H + 22, p.y, '×', POP_COLORS.neutral);
        break;
      }
      case 'toy_merged': {
        // 合成：新しい toy がスケールバウンスで現れ、星が散る
        this.fx.start('popin', objectId, 0.55);
        const p = this._payloadPos(payload, obj);
        if (this.particles) this.particles.burst(this._v.set(p.x, BOX_H * 0.6, p.y), { count: 30, color: COLORS.merged, life: 0.9, size: 10 });
        break;
      }
      default:
        // combo_warn / sat_delta / no_toy / fuss_end / stage_* / screen は state から毎フレーム描く
        break;
    }
  }

  _payloadPos(payload, obj) {
    if (payload && Number.isFinite(payload.x) && Number.isFinite(payload.y)) return { x: payload.x, y: payload.y };
    if (obj) return { x: obj.x, y: obj.y };
    return { x: ROOM.cx, y: ROOM.cy };
  }

  /** `into`（object id または wall の model）の位置（部屋ローカル）。wall なら from を矩形内にクランプし、上面の高さへ */
  _intoPos(into, from, s) {
    if (into == null || !s) return from.clone();
    const v = this.objects.get(into);
    if (v) return new THREE.Vector3(v.group.position.x, BOX_H + 4, v.group.position.z);
    const w = findWall(s.stage, into);
    if (w) {
      const pad = Math.min(16, w.w / 2, w.h / 2);
      return new THREE.Vector3(
        Math.max(w.x + pad, Math.min(w.x + w.w - pad, from.x)),
        WALL_H + 6,
        Math.max(w.y + pad, Math.min(w.y + w.h - pad, from.z))
      );
    }
    return from.clone();
  }

  /** 絵文字 Sprite が from から to へ弧を描いて飛ぶ（trashed / stored） */
  _startFly(emoji, from, to) {
    const sprite = makeSprite(makeEmojiTexture(emoji), 18, 18, { renderOrder: 12 });
    sprite.position.copy(from);
    this.room.add(sprite);
    this.flies.push({ sprite, from: from.clone(), to: to.clone(), t: 0 });
  }

  _updateFlies(dt) {
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i];
      f.t += dt;
      const k = Math.min(1, f.t / FLY_SEC);
      if (k >= 1) { disposeSprite(f.sprite); this.flies.splice(i, 1); continue; }
      const e = easeOut(k);
      f.sprite.position.lerpVectors(f.from, f.to, e);
      f.sprite.position.y += Math.sin(Math.PI * k) * 26;
      const sc = 18 * (1 - 0.5 * k);
      f.sprite.scale.set(sc, sc, 1);
      f.sprite.material.opacity = 1 - 0.6 * k * k;
    }
  }

  _clearFlies() {
    for (const f of this.flies) disposeSprite(f.sprite);
    this.flies = [];
  }

  /** toy が手元から足元へ弧を描いて落ちる（0.4 秒）。既に落下中なら開始しない */
  _startArc(toyId) {
    const v = this.objects.get(toyId);
    if (!v || v.arc) return;
    const from = v.group.position.clone();
    from.y = v.body.position.y;
    v.arc = { from, t: 0, dur: 0.4 };
  }

  _addPop(x, y, z, text, color) {
    const sprite = makeSprite(makePopTexture(text, color), 56, 21, { renderOrder: 12 });
    sprite.position.set(x, y, z);
    this.room.add(sprite);
    this.pops.push({ sprite, t: 0, y });
  }

  _clearPops() {
    for (const p of this.pops) disposeSprite(p.sprite);
    this.pops = [];
  }

  // ---------------------------------------------------------------- update / draw

  update(state, dt = 0) {
    this.lastState = state;
    this.t += dt;
    this.fx.tick(dt);
    if (!this.renderer) return;

    // Play 中に別ステージ（loadStage が呼ばれなかった等）ならプレースホルダーで即組む
    if (state && state.stage && state.screen === 'play' && state.stage !== this.stage) {
      this._buildStage(state.stage);
    }
    const live = !!(state && state.stage && state.stage === this.stage && (state.screen === 'play' || state.screen === 'stageResult'));
    if (this.stageGroup) this.stageGroup.visible = !!this.stage && (live || state.screen !== 'play');

    if (live) {
      this._detectLanding(state);
      this._tickFalls(dt);
      const warn = this._comboWarnSets(state);
      this._updateBabies(state, dt, warn);
      this._updateObjects(state, dt, warn);
      this._updateVisitors(state, dt);
      this._rememberBabies(state);
    } else {
      for (const v of this.visitors.values()) v.group.visible = false;
    }
    this._updatePops(dt);
    this._updateFlies(dt);
    if (this.particles) this.particles.update(dt, this.t);

    // ヒヤリの黄フラッシュ
    const fa = this.fx.flashT > 0 ? (this.fx.flashT / FLASH_SEC) * 0.5 : 0;
    const faStr = fa.toFixed(3);
    if (this.flashEl && this.flashEl.style.opacity !== faStr) this.flashEl.style.opacity = faStr;

    this.renderer.render(this.scene, this.camera);

    // ラベル（DOM）はワールド行列が確定した render 後に投影する
    if (this.labelLayer) {
      // ラベルは play 中だけ。stageResult / finalResult では結果画面に重なるので出さない
      this.labelLayer.enabled = !!(state && state.screen === 'play');
      if (live) {
        this.labelLayer.hoverId = this._pickHover();
        this.labelLayer.dragId = state.drag ? state.drag.targetId : null;
      }
      this.labelLayer.update(this.camera);
    }
  }

  /** ホバー中の id（ラベルの優先表示用）。マウスが動いたフレームだけレイキャストする */
  _pickHover() {
    const p = this._hoverPos;
    if (!p) return null;
    if (this._hoverAt && this._hoverAt.x === p.x && this._hoverAt.y === p.y) return this.hoverId;
    this._hoverAt = { x: p.x, y: p.y };
    this.hoverId = this.pickObject(p.x, p.y);
    return this.hoverId;
  }

  _detectLanding(state) {
    for (const b of state.babies || []) {
      const prev = this.prevAnim.get(b.id);
      if (prev === 'held' && b.anim !== 'held') this.fx.start('land', b.id, 0.3);
      this.prevAnim.set(b.id, b.anim);
    }
  }

  _tickFalls(dt) {
    for (const [id, f] of this.babyFalls) {
      f.t += dt;
      if (f.t >= f.dur) this.babyFalls.delete(id);
    }
  }

  /** 前フレームの赤ちゃん位置（転落アニメの出発点。playEffect 時点で state は既に更新済みなので自前で持つ） */
  _rememberBabies(state) {
    for (const b of state.babies || []) this.babyPrev.set(b.id, { x: b.x, y: b.y, climbing: b.climbing || null });
  }

  /**
   * 赤ちゃんの描画位置：登っている間は壁の天面（h = WALL_H）、転落／ホップ中は from → to の弧。
   * @returns {{ pos: {x,y,h}|null, airborne: number }}
   */
  _babyPlacement(b) {
    const fall = this.babyFalls.get(b.id);
    if (fall) {
      const k = Math.min(1, fall.t / fall.dur);
      const to = fall.to || this._v2.set(b.x, 0, b.y);
      if (fall.kind === 'hop') {
        const s = Math.sin(Math.PI * k);
        return {
          pos: { x: fall.from.x + (to.x - fall.from.x) * k, y: fall.from.z + (to.z - fall.from.z) * k, h: fall.from.y * (1 - k) + s * 10 },
          airborne: Math.max(1 - k, s * 0.5), squash: 0
        };
      }
      // 転落：0.75 までで加速しながら落ち、残りでバウンド（safe はマットの上で少し大きく）
      const kf = Math.min(1, k / 0.75);
      let h = fall.from.y * (1 - kf * kf);
      let squash = 0;
      if (k > 0.75) {
        const kb = (k - 0.75) / 0.25;
        h += Math.sin(Math.PI * kb) * (fall.kind === 'safe' ? 8 : 3);
        squash = 1 - kb;
      }
      return { pos: { x: fall.from.x + (to.x - fall.from.x) * kf, y: fall.from.z + (to.z - fall.from.z) * kf, h }, airborne: 1 - kf, squash };
    }
    if (b.climbing) return { pos: { x: b.x, y: b.y, h: WALL_H }, airborne: 0, squash: 0 };
    return { pos: null, airborne: 0, squash: 0 };
  }

  _updateVisitors(state, dt) {
    const keep = new Set();
    for (const vis of state.visitors || []) {
      keep.add(vis.id);
      let v = this.visitors.get(vis.id);
      if (!v) {
        if (!vis.active) continue;                 // まだ現れていない訪問者の View は作らない
        v = vis.type === 'cat' ? new CatView(vis, this.shared) : new VisitorView(vis, this.shared);
        (this.stageGroup || this.room).add(v.group);
        this.visitors.set(vis.id, v);
      }
      v.update(vis, dt);
    }
    for (const id of [...this.visitors.keys()]) {
      if (!keep.has(id)) { this.visitors.get(id).dispose(); this.visitors.delete(id); }
    }
  }

  /** climbable な家具のマット（家具の前の床に薄い緑の板）。無ければ作る。fixed のときだけ見せる */
  _ensureMat(o, stage) {
    let m = this.mats.get(o.id);
    if (m) return m;
    const wl = findWall(stage, o.id) || { x: o.x - 100, y: o.y - 84, w: 200, h: 70 };
    const geo = new THREE.BoxGeometry(wl.w, MAT_H, MAT_D);
    const side = new THREE.MeshStandardMaterial({ color: COLORS.mat, roughness: 0.95, metalness: 0 });
    const top = new THREE.MeshStandardMaterial({ map: makeMatTexture(wl.w, MAT_D), roughness: 0.95, metalness: 0 });
    // BoxGeometry の面順: +x, -x, +y(top), -y, +z, -z
    m = new THREE.Mesh(geo, [side, side, top, side, side, side]);
    m.position.set(wl.x + wl.w / 2, MAT_H / 2, wl.y + wl.h + MAT_D / 2);
    m.receiveShadow = true;
    m.visible = false;
    (this.stageGroup || this.room).add(m);
    this.mats.set(o.id, m);
    return m;
  }

  /** combo 予告中の hazard id と toy id の集合（同位相で点滅） */
  _comboWarnSets(state) {
    const hazards = new Set();
    const toys = new Set();
    for (const b of state.babies || []) {
      if (b.comboWarnHazardId) {
        hazards.add(b.comboWarnHazardId);
        if (b.carrying) toys.add(b.carrying);
      }
    }
    return { hazards, toys, k: 0.5 + 0.5 * Math.sin(this.t * COMBO_PULSE) };
  }

  _updateBabies(state, dt, warn) {
    const keep = new Set();
    const babies = state.babies || [];
    for (let i = 0; i < babies.length; i++) {
      const b = babies[i];
      const v = this._ensureBaby(b, i);
      keep.add(b.id);
      let hold = b.holdProgress || 0;
      if (state.press && state.press.targetId === b.id && state.press.needSec > 0) {
        hold = Math.max(hold, state.press.elapsed / state.press.needSec);
      }
      const place = this._babyPlacement(b);
      v.update(b, {
        dt, t: this.t,
        mouthK: this._mouthFraction(b, state),
        mouthPopK: this.fx.progress('mouthPop', b.id),
        speedK: (b.speed || TUNING.BABY_SPEED) / (TUNING.BABY_SPEED || 1),
        liftK: this.fx.progress('lift', b.id),
        // 転落の着地でも少しつぶれる（land と同じ演出を借りる）
        landK: this.fx.progress('land', b.id) ?? (place.squash > 0 ? 1 - place.squash * 0.5 : null),
        fussPopK: this.fx.progress('fussPop', b.id),
        hold,
        nMoya: b.fussing ? 6 : (b.satLow ? 3 : 0),
        pos: place.pos,
        airborne: place.airborne
      });
      // 停止中：頭上に小さな星
      const key = `stun:${b.id}`;
      if (b.anim === 'stun') {
        const gp = v.group.position;
        this.particles.ensureOrbit(key, { n: 3, radius: 13, height: 40, speed: 5, size: 7 });
        this.particles.setOrbitCenter(key, gp.x, gp.y + v.lift.position.y, gp.z);
        this._orbitKeep.add(key);
      }
    }
    for (const id of [...this.babies.keys()]) {
      if (!keep.has(id)) { this.babies.get(id).dispose(); this.babies.delete(id); }
    }
  }

  /** 口に入れている残り時間の割合（1 → 0）。口に入れていなければ null */
  _mouthFraction(b, state) {
    if (!b.mouthing) { this.mouthStart.delete(b.id); return null; }
    const elapsed = state.elapsed || 0;
    const until = b.mouthing.until != null ? b.mouthing.until : elapsed;
    let rec = this.mouthStart.get(b.id);
    if (!rec || rec.until !== until) {
      rec = { start: Math.min(elapsed, until - (TUNING.MOUTH_SEC_MAX || 4)), until };
      this.mouthStart.set(b.id, rec);
    }
    const total = Math.max(0.05, rec.until - rec.start);
    return Math.max(0, Math.min(1, (until - elapsed) / total));
  }

  _updateObjects(state, dt, warn) {
    const elapsed = state.elapsed || 0;
    const t = this.t;
    const hints = hintTargets(state);
    const hintedWalls = hintWalls(state);
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);

    // ---- 高い場所（highPlace の wall）：ラベルに n/容量（§11.2）。ヒント板は軽いものをドラッグ中だけ脈打つ（満杯なら赤く静止）
    for (const w of this.walls) {
      if (w.def.highPlace) {
        const n = highPlaceCount(state, w.def);
        const cap = wallCapacity(w.def);
        const full = n >= cap;
        const text = `${w.def.label ? w.def.label + ' ' : ''}${n}/${cap}${full ? ' 満' : ''}`;
        if (w.label && (text !== w.labelText || full !== w.labelFull)) {
          w.label.setText(text, { alert: full });
          w.labelText = text;
          w.labelFull = full;
        }
      }
      if (!w.hint) continue;
      const on = hintedWalls.has(w.def.model);
      const full = on && isHighPlaceFull(state, w.def);
      w.hint.visible = on;
      if (on) {
        w.hint.material.color.setHex(full ? COLORS.hintFull : COLORS.hint);
        w.hint.material.opacity = full ? 0.3 : 0.25 + 0.35 * pulse;
      }
      if (w.mesh.material.emissive) {
        w.mesh.material.emissive.setHex(on ? (full ? COLORS.hintFull : COLORS.hint) : 0x000000);
        w.mesh.material.emissiveIntensity = on ? (full ? 0.12 : 0.1 + 0.2 * pulse) : 0;
      }
    }

    for (const o of state.objects || []) {
      const v = this._ensureObject(o);
      const g = v.group;
      const isToy = o.kind === 'toy';

      // ---- used（使い終わった安全グッズ）は消える
      if (o.state === 'used') {
        g.visible = false;
        v.arc = null;
        continue;
      }

      // ---- removed（片付け済み item / toy）。再発予告はゴースト＋emissive 周期変化
      if (o.state === 'removed') {
        const warnRespawn = o.respawnAt != null && o.respawnAt - elapsed <= TUNING.RESPAWN_WARN_SEC;
        g.visible = warnRespawn;
        if (warnRespawn) {
          v.setGhost(true);
          v.setBored(false);
          // 出現位置（定義位置 spawnX/spawnY。捨てた場所ではない）
          g.position.set(typeof o.spawnX === 'number' ? o.spawnX : o.x, 0, typeof o.spawnY === 'number' ? o.spawnY : o.y);
          v.body.scale.setScalar(1);
          v.body.position.y = 0;
          v.setEmissive(0xffa040, 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 12)));
          v.label.visible = true;
        }
        v.disc.visible = false;
        v.arc = null;
        continue;
      }
      g.visible = true;
      v.setGhost(false);
      const stored = isStored(o);
      v.setStored(stored);
      v.setFixed(o.kind === 'hazard' && o.state === 'fixed');
      // ---- 登れる家具（ソファ）：open の間は前縁のクッション、fixed なら家具の前の床にマット（✅ はマットの右端）
      if (o.climbable) {
        const mat = this._ensureMat(o, state.stage);
        const fixedNow = o.state === 'fixed';
        mat.visible = fixedNow;
        v.body.visible = !fixedNow;
        v.label.visible = !fixedNow;
        const resting = o.boredUntil != null && o.boredUntil > elapsed;
        v.label.material.opacity = resting ? 0.5 : 1;
        if (fixedNow) {
          v.check.position.set(mat.position.x - o.x + (mat.geometry.parameters.width / 2 - 18), MAT_H + 6, mat.position.z - o.y);
          const shake = this.fx.progress('shake', o.id);
          if (shake != null) v.check.position.x += Math.sin(shake * 40) * 5 * (1 - shake);
        } else {
          v.check.position.set(15, v.topH + 6, 8);
        }
      }
      const bored = isToy && o.state === 'bored';
      v.setBored(bored);
      if (bored) v.setBoredRing(boredFraction(o, elapsed, this.boredTotal.get(o.id)));
      if (v.glow) v.setGlowPulse(t);

      // ---- 位置
      // 持たれている：赤ちゃんの手（toy）／口元（mouthing の物）／猫の口（carriedBy 'cat'）
      const carried = o.carriedBy != null;
      const dragging = !!(state.drag && state.drag.targetId === o.id);
      let x = o.x, y = 0, z = o.y;
      let bodyScale = 1;
      if (stored) {
        // 収納済み：高い場所なら壁の上面、収納先（引き出しなど）ならその箱の上に小さく乗せる
        const intoView = this.objects.get(o.storedIn);
        y = intoView ? BOX_H : (findWall(state.stage, o.storedIn) ? WALL_H : 0);
        bodyScale = STORED_SCALE;
      } else if (carried) {
        const bv = this.babies.get(o.carriedBy);
        const cv = bv ? null : [...this.visitors.values()].find(vv => vv.type === 'cat' && (vv.id === o.carriedBy || o.carriedBy === 'cat'));
        const baby = bv ? (state.babies || []).find(bb => bb.id === o.carriedBy) : null;
        const inMouth = !!(baby && baby.mouthing && baby.mouthing.objectId === o.id);
        if (bv) {
          if (inMouth) bv.mouthPosition(this._v2); else bv.handPosition(this._v2);
          x = this._v2.x; y = this._v2.y; z = this._v2.z;
        } else if (cv) {
          cv.mouthPosition(this._v2);
          x = this._v2.x; y = this._v2.y; z = this._v2.z;
        }
        bodyScale = inMouth || cv ? 0.55 : 0.75;
        v.arc = null;
      } else if (dragging) {
        x = state.drag.x; z = state.drag.y; y = DRAG_LIFT;
      }
      // 落下の弧（drop / takeaway：山なり。visitor_drop：手元から加速して落ち、着地で埃）
      if (v.arc) {
        v.arc.t += dt;
        const k = Math.min(1, v.arc.t / v.arc.dur);
        const rise = v.arc.rise != null ? v.arc.rise : 22;
        if (rise > 0) {
          const e = easeOut(k);
          x = v.arc.from.x + (o.x - v.arc.from.x) * e;
          z = v.arc.from.z + (o.y - v.arc.from.z) * e;
          y = v.arc.from.y * (1 - k) + Math.sin(Math.PI * k) * rise;
        } else {
          x = v.arc.from.x + (o.x - v.arc.from.x) * k;
          z = v.arc.from.z + (o.y - v.arc.from.z) * k;
          y = v.arc.from.y * (1 - k * k);
        }
        if (k >= 1) {
          if (v.arc.puff && this.particles) this.particles.burst(this._v.set(o.x, 3, o.y), { count: 10, color: COLORS.puff, life: 0.4, size: 5 });
          v.arc = null;
        }
      }
      // 再発の跳ね
      const bounce = this.fx.progress('bounce', o.id);
      if (bounce != null) {
        bodyScale *= 1 + 0.25 * Math.sin(Math.PI * bounce);
        y += 10 * Math.sin(Math.PI * bounce);
      }
      // 合成 toy は少し大きく。生まれた直後はスケールバウンス
      if (o.merged) bodyScale *= 1.15;
      const popin = this.fx.progress('popin', o.id);
      if (popin != null) {
        const k = easeOut(popin);
        bodyScale *= Math.max(0.05, k * (1 + 0.45 * Math.sin(Math.PI * Math.min(1, popin * 1.4))));
      }
      // レシピ不成立：グッズが小さく震える
      const gshake = this.fx.progress('gshake', o.id);
      if (gshake != null) x += Math.sin(gshake * 40) * 4 * (1 - gshake);
      // 重いものを引っ張った：「動かない」の小さな揺れ
      const nudge = this.fx.progress('nudge', o.id);
      if (nudge != null) x += Math.sin(nudge * 32) * 3 * (1 - nudge);
      g.position.set(x, 0, z);
      v.body.position.y = y;
      v.body.scale.setScalar(bodyScale);
      v.disc.visible = dragging || !!v.arc;
      if (v.disc.visible) {
        const ds = 1 + y / 60;
        v.disc.scale.set(ds, ds, 1);
        v.disc.material.opacity = Math.max(0.08, 0.22 - y / 200);
      }
      if (!o.climbable) {
        v.label.visible = !carried;
        // ✅ とラベルは縮小した本体の高さに合わせる（収納済みは壁の上）。
        // v.topH は形状ごとの実高さ（shapes.js）。箱固定の BOX_H を使うと小さい物でラベルが浮く
        v.check.position.y = y + v.topH * bodyScale + 6;
        v.label.position.y = y + v.topH * bodyScale + 14;
      }
      if (v.plate) v.plate.visible = !stored;

      // ---- 容れ物の蓋：ヒント中は脈打って持ち上がり、捨てた直後（lidpop）はぱたんと開く
      if (v.lid) {
        let lift = hints.has(o.id) ? 2 + 3 * pulse : 0;
        const pop = this.fx.progress('lidpop', o.id);
        if (pop != null) lift += 8 * Math.sin(Math.PI * pop);
        v.setLidLift(lift);
      }

      // ---- ✅ の揺れ（ignoresFix の combo ヒヤリ）
      const shake = this.fx.progress('shake', o.id);
      v.check.position.x = 15 * bodyScale + (shake != null ? Math.sin(shake * 40) * 5 * (1 - shake) : 0);

      // ---- emissive：combo 予告（紫・同期点滅）> ドラッグのヒント（ティール・脈打つ）> 遊び開始（青・短く）
      const ps = this.fx.progress('playstart', o.id);
      if (warn.hazards.has(o.id) || warn.toys.has(o.id)) {
        v.setEmissive(COLORS.combo, 0.15 + 0.85 * warn.k);
      } else if (hints.has(o.id)) {
        v.setEmissive(COLORS.hint, 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 6)));
      } else if (ps != null) {
        v.setEmissive(COLORS.playStart, 0.7 * (1 - ps));
      } else {
        v.setEmissive(null);
      }

      // ---- 遊び中：toy 上空に星が回る
      if (isToy && o.playingBy != null) {
        const key = `play:${o.id}`;
        this.particles.ensureOrbit(key, { n: 5, radius: 20, height: BOX_H + 10, speed: 4, size: 9 });
        this.particles.setOrbitCenter(key, x, y, z);
        this._orbitKeep.add(key);
      }
    }
    this.particles.pruneOrbits(this._orbitKeep);
    this._orbitKeep.clear();
  }

  _updatePops(dt) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      const k = Math.min(1, p.t / POP_SEC);
      if (k >= 1) { disposeSprite(p.sprite); this.pops.splice(i, 1); continue; }
      p.sprite.position.y = p.y + POP_RISE_PX * easeOut(k);
      p.sprite.material.opacity = 1 - k;
    }
  }
}

function idFromHits(hits) {
  for (const h of hits) {
    let o = h.object;
    while (o) {
      if (o.userData && o.userData.id != null) return o.userData.id;
      o = o.parent;
    }
  }
  return null;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function disposeMats(material) {
  const mats = Array.isArray(material) ? material : [material];
  const seen = new Set();
  for (const m of mats) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    if (m.map) m.map.dispose();
    m.dispose();
  }
}

function detectSoftwareGL(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const soft = /swiftshader|llvmpipe|softpipe|software/i.test(String(name || ''));
    console.info('[three] renderer:', name, soft ? '(software GL: light shadows)' : '');
    return soft;
  } catch (e) {
    return false;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then((r) => { clearTimeout(timer); resolve(r); }, () => { clearTimeout(timer); resolve(null); });
  });
}
