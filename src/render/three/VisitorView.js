// 訪問者の 3D 表現。VisitorView（無神経なおじさん、既定 type 'uncle'）：赤ちゃんの 2 倍の高さのカプセル＋顔（絵文字 Sprite）＋足元の影＋名前ラベル。
// CatView（type 'cat'、§11.5）：赤ちゃんの半分ほどの低い横向きカプセル＋4 本の速い脚＋しっぽ＋🐈 の顔。くわえた物は renderer が mouthPosition に置く。
// どちらも歩行で上下に小さく揺れ、進行方向（dirX, dirY）を向く。プレイヤーは触れない（pickObject の対象にしない）。
import * as THREE from 'three';
import { COLORS, makeSprite, makeEmojiTexture, disposeSprite } from './textures.js';

export const VISITOR_H = 60;        // 赤ちゃん（BABY_H 30）の 2 倍
const WALK_RATE = 9;                // 歩行の上下動（rad/s）
const bodyGeo = new THREE.CapsuleGeometry(10.5, VISITOR_H - 21, 4, 14);
const legGeo = new THREE.CapsuleGeometry(3.2, 10, 3, 8);
const armGeo = new THREE.CapsuleGeometry(2.6, 16, 3, 8);
const discGeo = new THREE.CircleGeometry(13, 24);

export class VisitorView {
  /** @param {object} def state.visitors[i]（id, label, emoji, x, y） @param {object} shared 共有テクスチャ＋ labels */
  constructor(def, shared) {
    this.id = def.id;
    this.group = new THREE.Group();            // 床位置（ゲーム座標）
    this.group.position.set(def.x, 0, def.y);
    this.anim = new THREE.Group();             // 上下動
    this.group.add(this.anim);
    this.facing = new THREE.Group();           // 進行方向（+z が前）
    this.anim.add(this.facing);

    this.shirtMat = new THREE.MeshStandardMaterial({ color: COLORS.visitorShirt, roughness: 0.9 });
    this.pantsMat = new THREE.MeshStandardMaterial({ color: COLORS.visitorPants, roughness: 0.9 });
    this.body = new THREE.Mesh(bodyGeo, this.shirtMat);
    this.body.position.y = 14 + (VISITOR_H - 21) / 2;
    this.body.castShadow = true;
    this.legL = new THREE.Mesh(legGeo, this.pantsMat);
    this.legR = new THREE.Mesh(legGeo, this.pantsMat);
    this.legL.position.set(-4.5, 8, 0);
    this.legR.position.set(4.5, 8, 0);
    this.legL.castShadow = this.legR.castShadow = true;
    this.armL = new THREE.Mesh(armGeo, this.shirtMat);
    this.armR = new THREE.Mesh(armGeo, this.shirtMat);
    this.armL.position.set(-12, VISITOR_H - 22, 0);
    this.armR.position.set(12, VISITOR_H - 22, 0);
    this.facing.add(this.body, this.legL, this.legR, this.armL, this.armR);

    // 顔（絵文字 Sprite。常にカメラを向く）
    this.face = makeSprite(makeEmojiTexture(def.emoji || '🧔'), 32, 32, { renderOrder: 11 });
    this.face.position.set(0, VISITOR_H - 2, 0);
    this.anim.add(this.face);

    // 足元の影
    this.disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: COLORS.shadow, transparent: true, opacity: 0.2, depthWrite: false }));
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.5;
    this.group.add(this.disc);

    // 名前
    this.label = shared.labels.create(def.label || 'おじさん', { color: COLORS.visitorInk, priority: 2 });
    this.label.position.set(0, VISITOR_H + 20, 0);
    this.group.add(this.label);

    this.heading = 0;
    this.phase = 0;
    this.group.visible = false;
  }

  /** @param {object} v state.visitors[i] @param {number} dt */
  update(v, dt) {
    this.group.visible = !!v.active;
    if (!v.active) return;
    this.group.position.set(v.x, 0, v.y);
    const dirX = v.dirX || 0;
    const dirY = v.dirY || 0;
    const moving = Math.abs(dirX) + Math.abs(dirY) > 0.01;
    if (moving) {
      this.phase += dt * WALK_RATE;
      const target = Math.atan2(dirX, dirY);
      let d = target - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, dt * 10);
    }
    this.facing.rotation.y = this.heading;
    const s = Math.sin(this.phase);
    this.anim.position.y = Math.abs(s) * 2.5;
    // 脚と腕を前後に振る
    this.legL.rotation.x = s * 0.5;
    this.legR.rotation.x = -s * 0.5;
    this.armL.rotation.x = -s * 0.45;
    this.armR.rotation.x = s * 0.45;
  }

  /** 手（item を落とす位置）の部屋ローカル座標 */
  handPosition(out) {
    const f = this.heading;
    out.set(
      this.group.position.x + Math.sin(f) * 10,
      VISITOR_H - 26,
      this.group.position.z + Math.cos(f) * 10
    );
    return out;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    disposeSprite(this.face);
    disposeSprite(this.label);
    this.shirtMat.dispose();
    this.pantsMat.dispose();
    this.disc.material.dispose();
  }
}

// ---------------------------------------------------------------- 猫（§11.5）

export const CAT_H = 15;            // 体の高さ（赤ちゃん BABY_H 30 の半分）
const CAT_RUN_RATE = 22;            // 脚の周期（速い）
const catBodyGeo = new THREE.CapsuleGeometry(5.5, 16, 4, 12);
const catLegGeo = new THREE.CapsuleGeometry(1.6, 5, 3, 6);
const catTailGeo = new THREE.CapsuleGeometry(1.2, 12, 3, 6);
const catDiscGeo = new THREE.CircleGeometry(12, 20);

export class CatView {
  /** @param {object} def state.visitors[i]（id, label, emoji, x, y, type:'cat'） @param {object} shared 共有テクスチャ＋ labels */
  constructor(def, shared) {
    this.id = def.id;
    this.type = 'cat';
    this.group = new THREE.Group();
    this.group.position.set(def.x, 0, def.y);
    this.anim = new THREE.Group();
    this.group.add(this.anim);
    this.facing = new THREE.Group();           // +z が前
    this.anim.add(this.facing);

    this.furMat = new THREE.MeshStandardMaterial({ color: COLORS.catFur, roughness: 0.95 });
    this.darkMat = new THREE.MeshStandardMaterial({ color: COLORS.catFurDark, roughness: 0.95 });
    // 体（横向きのカプセル。長軸を z に）
    this.body = new THREE.Mesh(catBodyGeo, this.furMat);
    this.body.rotation.x = Math.PI / 2;
    this.body.position.set(0, CAT_H - 5, 0);
    this.body.castShadow = true;
    // 脚 4 本（前後で位相をずらす）
    this.legs = [];
    for (const [x, z] of [[-3.5, 7], [3.5, 7], [-3.5, -7], [3.5, -7]]) {
      const leg = new THREE.Mesh(catLegGeo, this.darkMat);
      leg.position.set(x, 4, z);
      leg.castShadow = true;
      this.legs.push(leg);
      this.facing.add(leg);
    }
    // しっぽ（後ろ。上に反る）
    this.tail = new THREE.Mesh(catTailGeo, this.darkMat);
    this.tail.position.set(0, CAT_H + 1, -14);
    this.tail.rotation.x = -0.6;
    this.facing.add(this.body, this.tail);

    // 顔（絵文字 Sprite。前寄り）
    this.face = makeSprite(makeEmojiTexture(def.emoji || '🐈'), 28, 28, { renderOrder: 11 });
    this.face.position.set(0, CAT_H + 6, 12);
    this.facing.add(this.face);

    // 足元の影
    this.disc = new THREE.Mesh(catDiscGeo, new THREE.MeshBasicMaterial({ color: COLORS.shadow, transparent: true, opacity: 0.18, depthWrite: false }));
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.5;
    this.disc.scale.set(1.5, 1, 1);
    this.group.add(this.disc);

    // 名前
    this.label = shared.labels.create(def.label || 'ねこ', { color: COLORS.catInk, priority: 2 });
    this.label.position.set(0, CAT_H + 28, 0);
    this.group.add(this.label);

    this.heading = 0;
    this.phase = 0;
    this.group.visible = false;
  }

  update(v, dt) {
    this.group.visible = !!v.active;
    if (!v.active) return;
    this.group.position.set(v.x, 0, v.y);
    const dirX = v.dirX || 0;
    const dirY = v.dirY || 0;
    const moving = Math.abs(dirX) + Math.abs(dirY) > 0.01;
    if (moving) {
      this.phase += dt * CAT_RUN_RATE;
      const target = Math.atan2(dirX, dirY);
      let d = target - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, dt * 12);
    }
    this.facing.rotation.y = this.heading;
    const s = moving ? Math.sin(this.phase) : 0;
    this.anim.position.y = moving ? Math.abs(Math.cos(this.phase)) * 1.5 : 0;
    // 脚：対角で同位相（トロット）
    this.legs[0].rotation.x = s * 0.8;
    this.legs[3].rotation.x = s * 0.8;
    this.legs[1].rotation.x = -s * 0.8;
    this.legs[2].rotation.x = -s * 0.8;
    this.tail.rotation.x = -0.6 + s * 0.15;
    this.tail.rotation.z = Math.sin(this.phase * 0.5) * 0.2;
  }

  /** 口元（くわえた物を置く位置）の部屋ローカル座標 */
  mouthPosition(out) {
    const f = this.heading;
    out.set(
      this.group.position.x + Math.sin(f) * 16,
      CAT_H - 2 + this.anim.position.y,
      this.group.position.z + Math.cos(f) * 16
    );
    return out;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    disposeSprite(this.face);
    disposeSprite(this.label);
    this.furMat.dispose();
    this.darkMat.dispose();
    this.disc.material.dispose();
  }
}
