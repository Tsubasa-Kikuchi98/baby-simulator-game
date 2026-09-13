// 赤ちゃん 1 人ぶんの 3D 表現。baby.glb（AnimationMixer）があればクリップ再生、無ければ手続きアニメ。
// 影の円盤は床に残す（抱き上げ中も）。モヤモヤ球・不機嫌 Sprite・取り上げリングもここ。
// v5（§11.1）：口に入れている間は頭上に赤い危険リング（残り時間で縮む）。物そのものは renderer が mouthPosition に置く。
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { COLORS, makeSprite, RingTexture, disposeSprite } from './textures.js';
import { fitModel, disposeObject } from './assets.js';

export const HELD_LIFT = 20;
const BABY_H = 30;
const CRAWL_RATE = 8;      // 基準速度で這うときの体の揺れ（rad/s）。baby.speed に比例して進む

const unitSphere = new THREE.SphereGeometry(1, 18, 12);
const eyeGeo = new THREE.SphereGeometry(1.5, 8, 6);
const discGeo = new THREE.CircleGeometry(15, 24);
const moyaGeo = new THREE.SphereGeometry(5, 10, 8);
const hairGeo = new THREE.TorusGeometry(2.2, 0.8, 6, 10, Math.PI);

function easeOut(k) { return 1 - (1 - k) * (1 - k); }

export class BabyView {
  /**
   * @param {object} def   runtimeBaby（id, x, y）
   * @param {number} index  0 or 1（ロンパースの色）
   * @param {{ grumpyTex: THREE.Texture }} shared
   */
  constructor(def, index, shared) {
    this.id = def.id;
    this.index = index;
    this.shared = shared;

    this.group = new THREE.Group();          // 床位置（ゲーム座標）
    this.group.userData.id = def.id;
    this.group.position.set(def.x, 0, def.y);
    this.lift = new THREE.Group();           // 抱き上げの持ち上げ
    this.group.add(this.lift);
    this.anim = new THREE.Group();           // 手続きアニメ（揺れ・スケール）
    this.lift.add(this.anim);
    this.facing = new THREE.Group();         // 進行方向（+z が前）
    this.anim.add(this.facing);

    // --- プレースホルダー（体＋頭）
    this.onesieMat = new THREE.MeshStandardMaterial({ color: COLORS.onesie[index % 2], roughness: 0.9 });
    this.skinMat = new THREE.MeshStandardMaterial({ color: COLORS.skin, roughness: 0.9 });
    this.faceMat = new THREE.MeshStandardMaterial({ color: COLORS.face, roughness: 0.6 });
    this.body = new THREE.Mesh(unitSphere, this.onesieMat);
    this.body.scale.set(12, 9, 14);
    this.body.position.set(0, 9, -2);
    this.body.castShadow = true;
    this.body.userData.id = def.id;
    this.head = new THREE.Mesh(unitSphere, this.skinMat);
    this.head.scale.setScalar(10.5);
    this.head.position.set(0, 15, 9);
    this.head.castShadow = true;
    this.head.userData.id = def.id;
    this.eyeL = new THREE.Mesh(eyeGeo, this.faceMat);
    this.eyeR = new THREE.Mesh(eyeGeo, this.faceMat);
    this.eyeL.position.set(-3.6, 16.5, 18.6);
    this.eyeR.position.set(3.6, 16.5, 18.6);
    this.hair = new THREE.Mesh(hairGeo, new THREE.MeshStandardMaterial({ color: 0x8a6a55, roughness: 0.9 }));
    this.hair.position.set(0, 25, 9);
    this.hair.rotation.x = Math.PI / 2;
    this.placeholder = new THREE.Group();
    this.placeholder.add(this.body, this.head, this.eyeL, this.eyeR, this.hair);
    this.facing.add(this.placeholder);
    this.pickMeshes = [this.body, this.head];

    // --- 影（床に残す）
    this.disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: COLORS.shadow, transparent: true, opacity: 0.16, depthWrite: false }));
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.5;
    this.group.add(this.disc);

    // --- モヤモヤ球（最大 6）
    this.moyaMat = new THREE.MeshStandardMaterial({ color: COLORS.moya, transparent: true, opacity: 0.35, roughness: 1, depthWrite: false });
    this.moya = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(moyaGeo, this.moyaMat);
      m.visible = false;
      this.lift.add(m);
      this.moya.push(m);
    }

    // --- 不機嫌アイコン
    this.grumpy = makeSprite(shared.grumpyTex, 18, 18, { renderOrder: 11 });
    this.grumpy.position.set(12, BABY_H + 14, 0);
    this.grumpy.visible = false;
    this.lift.add(this.grumpy);

    this.ringTex = null;
    this.ring = null;
    this.dangerTex = null;     // 口に入れている間の危険リング（赤）
    this.danger = null;

    // --- glTF / AnimationMixer
    this.model = null;
    this.mixer = null;
    this.actions = new Map();
    this.currentAction = null;
    this.currentAnimName = null;

    this.heading = 0;          // rad
    this.phase = 0;            // 這うアニメの位相（p.speedK に従って進む。止まれば止まる）
    this.look = 0;             // きょろきょろ（idle）の首振り（rad）
    this.prevPos = new THREE.Vector2(def.x, def.y);
  }

  setModel(gltf) {
    if (!gltf) return;
    const scene = skeletonClone(gltf.scene);
    this.model = fitModel(scene, { maxW: 30, maxH: BABY_H, maxD: 34 });
    this.model.traverse((n) => { if (n.isMesh) n.userData.id = this.id; });
    this.facing.add(this.model);
    this.placeholder.visible = false;
    if (gltf.animations && gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
  }

  /** クリップがあれば切替。無ければ false（手続きアニメにフォールバック） */
  _setClip(name) {
    if (!this.mixer) return false;
    if (this.currentAnimName === name) return !!this.currentAction;
    this.currentAnimName = name;
    const next = this.actions.get(name) || null;
    if (this.currentAction && this.currentAction !== next) this.currentAction.fadeOut(0.2);
    if (next) {
      next.reset().fadeIn(0.2).play();
      this.currentAction = next;
      return true;
    }
    this.currentAction = null;
    return false;
  }

  /**
   * @param {object} b runtimeBaby
   * @param {object} p { dt, t, speedK(実効速度/基準速度), liftK(0..1|null), landK, fussPopK, hold(0..1), nMoya,
   *   pos?: { x, y, h }（描画位置の上書き。h は床からの高さ。ソファの上＝WALL_H、転落アニメの弧など）, airborne?: 0..1（影を小さく）,
   *   mouthK?: 0..1|null（口に入れている残り時間の割合。null なら危険リング無し）, mouthPopK?: 0..1|null（mouth_start 直後の拡大） }
   */
  update(b, p) {
    const { dt, t } = p;
    const speedK = Math.max(0.3, Math.min(2.5, p.speedK != null ? p.speedK : 1));
    if (b.anim === 'crawl') this.phase += dt * CRAWL_RATE * speedK;
    // idle：首を左右に振ってきょろきょろ。それ以外は正面へ戻す
    const lookTarget = b.anim === 'idle' ? Math.sin(t * 1.7 + this.index * 2.1) * 0.38 : 0;
    this.look += (lookTarget - this.look) * Math.min(1, dt * 8);
    // 位置と向き（pos があればそれを使う：登っている間は壁の天面、転落中は弧の上）
    const px = p.pos ? p.pos.x : b.x;
    const pz = p.pos ? p.pos.y : b.y;
    const ph0 = p.pos ? (p.pos.h || 0) : 0;
    this.group.position.set(px, ph0, pz);
    const dx = px - this.prevPos.x;
    const dz = pz - this.prevPos.y;
    if (dx * dx + dz * dz > 0.05 && b.anim !== 'climb') {
      const target = Math.atan2(dx, dz);
      let d = target - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, dt * 10);
    }
    this.prevPos.set(px, pz);
    this.facing.rotation.y = this.heading + this.look;
    // プレースホルダーの頭も少し先に振る（視線を感じさせる）
    this.head.position.x = Math.sin(this.look) * 4;
    this.eyeL.position.x = -3.6 + Math.sin(this.look) * 5;
    this.eyeR.position.x = 3.6 + Math.sin(this.look) * 5;

    const held = b.anim === 'held' || b.isHeld;
    const liftFull = held ? HELD_LIFT : 0;
    const liftNow = p.liftK != null ? liftFull * easeOut(p.liftK) : liftFull;
    this.lift.position.y = liftNow;

    // 手続きアニメ（クリップがあれば体の揺れは控えめに。クリップの再生速度も baby.speed に従う）
    const hasClip = this._setClip(b.anim);
    if (this.mixer) {
      if (this.currentAction) this.currentAction.timeScale = b.anim === 'crawl' ? speedK : 1;
      this.mixer.update(dt);
    }
    let bob = 0, wobble = 0, sx = 1, sy = 1;
    if (!hasClip) {
      const ph = this.phase;
      switch (b.anim) {
        case 'crawl': bob = Math.abs(Math.sin(ph)) * 1.6; sx = 1 + Math.sin(ph) * 0.03; sy = 1 - Math.sin(ph) * 0.03; break;
        case 'idle': bob = Math.sin(t * 3) * 1; break;
        case 'stun': wobble = Math.sin(t * 9) * 1.5; break;
        case 'play': sy = 1 + Math.abs(Math.sin(t * 6)) * 0.12; sx = 1 - Math.abs(Math.sin(t * 6)) * 0.05; bob = Math.abs(Math.sin(t * 6)) * 3; break;
        case 'climb': { const hop = Math.abs(Math.sin(t * 5 + this.index)); bob = hop * 3; sy = 1 + hop * 0.05; sx = 1 - hop * 0.03; break; }
        case 'fuss': wobble = Math.sin(t * 14) * 3; break;
        case 'held': sx = 1.08; sy = 1.08; break;
        case 'mouth': bob = Math.sin(t * 6) * 0.8; wobble = Math.sin(t * 3) * 0.6; break;
        default: break;
      }
    }
    if (p.landK != null) {
      const k = Math.sin(Math.PI * p.landK);
      sx *= 1 + 0.18 * k;
      sy *= 1 - 0.18 * k;
    }
    this.anim.position.set(wobble, bob, 0);
    this.anim.scale.set(sx, sy, sx);
    this.anim.rotation.z = b.anim === 'stun' ? Math.sin(t * 9) * 0.08 : 0;

    // 影：抱き上げ中は少し濃く小さく。空中（転落アニメ）は床に残して小さく
    const air = Math.max(0, Math.min(1, p.airborne || 0));
    this.disc.material.opacity = held ? 0.26 : 0.16;
    const ds = (held ? 0.8 : 1) * (1 - 0.45 * air);
    this.disc.scale.set(ds, ds, 1);
    this.disc.position.y = air > 0 ? 0.5 - ph0 : 0.5;   // 空中なら床（着地点）に、登っている間は天面に置く

    // モヤモヤ
    const n = p.nMoya || 0;
    for (let i = 0; i < 6; i++) {
      const m = this.moya[i];
      if (i >= n) { m.visible = false; continue; }
      m.visible = true;
      const a = t * (n >= 6 ? 1.8 : 1.1) + (i * Math.PI * 2) / n;
      const rr = 24 + Math.sin(t * 2.3 + i) * 4;
      m.position.set(Math.cos(a) * rr, 14 + Math.sin(t * 3 + i * 1.7) * 4, Math.sin(a) * rr);
      const s = 1 + Math.sin(t * 3 + i * 1.7) * 0.25;
      m.scale.setScalar(s);
    }

    // 不機嫌アイコン
    const fussing = !!b.fussing || b.anim === 'fuss';
    this.grumpy.visible = fussing;
    if (fussing) {
      const s = p.fussPopK != null ? 1 + 0.4 * Math.sin(Math.PI * p.fussPopK) : 1;
      this.grumpy.scale.set(18 * s, 18 * s, 1);
      this.grumpy.position.y = BABY_H + 14 + Math.sin(t * 4) * 1.5;
    }

    // 取り上げ長押しリング
    if (p.hold > 0) {
      if (!this.ring) {
        this.ringTex = new RingTexture();
        this.ring = makeSprite(this.ringTex.texture, 30, 30, { renderOrder: 11 });
        this.ring.position.y = BABY_H + 30;
        this.lift.add(this.ring);
      }
      this.ringTex.update(p.hold);
      this.ring.visible = true;
    } else if (this.ring) {
      this.ring.visible = false;
    }

    // 口に入れている間の危険リング（残り時間の割合 p.mouthK。1 → 0 で縮む。取り上げリングより少し上）
    if (p.mouthK != null) {
      if (!this.danger) {
        this.dangerTex = new RingTexture({ color: COLORS.danger, track: COLORS.dangerTrack, lineWidth: 16, shadow: false, center: '！' });
        this.danger = makeSprite(this.dangerTex.texture, 22, 22, { renderOrder: 11 });
        this.danger.position.set(0, BABY_H + 16, 6);
        this.lift.add(this.danger);
      }
      this.dangerTex.update(p.mouthK);
      const s = p.mouthPopK != null ? 1 + 0.5 * Math.sin(Math.PI * p.mouthPopK) : 1;
      const blink = 0.75 + 0.25 * Math.sin(t * 10);
      this.danger.scale.set(22 * s, 22 * s, 1);
      this.danger.material.opacity = blink;
      this.danger.visible = true;
      if (this.ring && this.ring.visible) this.ring.position.y = BABY_H + 40;
    } else {
      if (this.danger) this.danger.visible = false;
      if (this.ring) this.ring.position.y = BABY_H + 30;
    }
  }

  /** 口元（口に入れている物を置く位置）の部屋ローカル座標。手より前・上 */
  mouthPosition(out) {
    const f = this.heading;
    out.set(
      this.group.position.x + Math.sin(f) * 14,
      this.group.position.y + this.lift.position.y + 13,
      this.group.position.z + Math.cos(f) * 14
    );
    return out;
  }

  /** 手（toy を持つ位置）のワールド（部屋ローカル）座標 */
  handPosition(out) {
    const f = this.heading;
    out.set(
      this.group.position.x + Math.sin(f) * 18,
      this.lift.position.y + 8,
      this.group.position.z + Math.cos(f) * 18
    );
    return out;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    disposeSprite(this.ring);
    if (this.ringTex) this.ringTex.dispose();
    disposeSprite(this.danger);
    if (this.dangerTex) this.dangerTex.dispose();
    if (this.grumpy) this.grumpy.material.dispose();
    this.onesieMat.dispose();
    this.skinMat.dispose();
    this.faceMat.dispose();
    this.hair.material.dispose();
    this.moyaMat.dispose();
    this.disc.material.dispose();
    if (this.mixer) this.mixer.stopAllAction();
    if (this.model) disposeObject(this.model);
  }
}
