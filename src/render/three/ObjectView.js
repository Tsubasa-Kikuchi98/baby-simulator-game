// hazard / item / toy / goods / container 1 個ぶんの 3D 表現。glb があれば差し替え、無ければ kind 色の箱＋ラベル Sprite。
// goods（安全グッズ）は平たいティール色の板、container（容れ物）は蓋つきのバケツ、合成 toy は床に金色のグローリング、
// 飽きた toy は半透明＋「あきた」＋残り時間リング。重い hazard（動かせない家具）は床の台座＋鍵の印。
// 収納済み（高い場所・収納先に置いた軽い hazard）は灰色＋✅（縮小は renderer が body.scale で行う）。
// v5：ダミー（kind 'prop'）はベージュの平たい板、危険なおもちゃ（ingestible）は上にオレンジの「！」バッジ Sprite。
// 状態→見た目の判断は ThreeRenderer が行い、ここは setter を提供する。v3：進捗リングは持たない。
import * as THREE from 'three';
import { COLORS, makeLabelTexture, makeTopTexture, makeSprite, RingTexture, disposeSprite } from './textures.js';
import { fitModel, disposeObject } from './assets.js';

export const BOX_W = 36;
export const BOX_H = 30;
export const GOODS_H = 12;                 // 安全グッズは平たい板
export const BIN_H = 30;                   // 容れ物の高さ（蓋を除く）
export const CUSHION_H = 8;                // 登れる家具（ソファ）の前縁のクッション
export const PROP_H = 14;                  // ダミー（平たい板）
const boxGeo = new THREE.BoxGeometry(BOX_W, BOX_H, BOX_W);
const cushionGeo = new THREE.BoxGeometry(28, CUSHION_H, 20);
const goodsGeo = new THREE.BoxGeometry(BOX_W * 1.2, GOODS_H, BOX_W * 0.85);
const propGeo = new THREE.BoxGeometry(BOX_W * 1.15, PROP_H, BOX_W * 0.8);
const binGeo = new THREE.CylinderGeometry(15, 12, BIN_H, 18);
const lidGeo = new THREE.CylinderGeometry(17, 17, 4, 18);
const knobGeo = new THREE.SphereGeometry(2.6, 8, 6);
const plateGeo = new THREE.BoxGeometry(BOX_W + 12, 2.5, BOX_W + 12);
const discGeo = new THREE.CircleGeometry(17, 20);
const glowGeo = new THREE.RingGeometry(21, 27, 36);

const KIND_STYLE = {
  hazard: { color: COLORS.hazard, top: COLORS.hazardTop },
  item: { color: COLORS.item, top: COLORS.itemTop },
  toy: { color: COLORS.toy, top: COLORS.toyTop },
  goods: { color: COLORS.goods, top: COLORS.goodsTop },
  container: { color: COLORS.container, top: COLORS.containerTop },
  prop: { color: COLORS.prop, top: COLORS.propTop }
};

export class ObjectView {
  /**
   * @param {object} def   stage.objects の定義（id, kind, label, emoji, model, fixedModel, x, y, weight, container）
   * @param {{ checkTex: THREE.Texture, akitaTex: THREE.Texture, lockTex?: THREE.Texture }} shared
   */
  constructor(def, shared) {
    this.def = def;
    this.id = def.id;
    this.kind = def.kind;
    this.shared = shared;
    const style = def.climbable ? { color: COLORS.cushion, top: COLORS.cushionTop } : (KIND_STYLE[def.kind] || KIND_STYLE.toy);
    this.style = style;
    this.isGoods = def.kind === 'goods';
    this.isBin = def.kind === 'container';
    this.isMerged = !!def.merged;
    this.isHeavy = def.kind === 'hazard' && (def.weight != null ? def.weight === 'heavy' : def.draggable === false);
    this.isClimbable = !!def.climbable;   // 登れる家具：本体は壁（wall）で、object は前縁の小さなクッション（open の間だけ見せる）
    this.isProp = def.kind === 'prop';
    this.isRisky = def.kind === 'toy' && !!def.ingestible;
    this.boxH = this.isGoods ? GOODS_H : (this.isBin ? BIN_H : (this.isClimbable ? CUSHION_H : (this.isProp ? PROP_H : BOX_H)));
    this.labelH = this.isGoods ? GOODS_H + 16 : (this.isBin ? BIN_H + 30 : (this.isClimbable ? CUSHION_H + 14 : (this.isProp ? PROP_H + 16 : BOX_H + 24)));

    this.group = new THREE.Group();
    this.group.userData.id = def.id;
    this.group.position.set(def.x, 0, def.y);

    // body: バウンド・持ち上げ・縮小のためのスケール用グループ
    this.body = new THREE.Group();
    this.group.add(this.body);

    this.sideMat = new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.85, metalness: 0 });
    this.topTex = makeTopTexture(this.isBin ? null : def.emoji, style.top);
    this.topMat = new THREE.MeshStandardMaterial({ map: this.topTex, roughness: 0.85, metalness: 0 });
    if (this.isBin) {
      // 容れ物：バケツ（側面 sideMat）＋ 蓋（lid グループ。ヒント中・捨てた直後に持ち上がる）
      this.box = new THREE.Mesh(binGeo, this.sideMat);
      this.box.position.y = BIN_H / 2;
      this.lidMat = new THREE.MeshStandardMaterial({ color: COLORS.containerLid, roughness: 0.8, metalness: 0 });
      this.lid = new THREE.Group();
      const lidMesh = new THREE.Mesh(lidGeo, this.lidMat);
      lidMesh.position.y = 2;
      lidMesh.castShadow = true;
      lidMesh.userData.id = def.id;
      const knob = new THREE.Mesh(knobGeo, this.lidMat);
      knob.position.y = 5.5;
      this.lid.add(lidMesh, knob);
      this.lid.position.y = BIN_H;
      this.body.add(this.lid);
    } else {
      // BoxGeometry の面順: +x, -x, +y(top), -y, +z, -z
      const geo = this.isGoods ? goodsGeo : (this.isClimbable ? cushionGeo : (this.isProp ? propGeo : boxGeo));
      this.box = new THREE.Mesh(geo, [this.sideMat, this.sideMat, this.topMat, this.sideMat, this.sideMat, this.sideMat]);
      this.box.position.y = this.boxH / 2;
      this.lid = null;
      this.lidMat = null;
      // 容れ物にもなる hazard（ゴミ箱）：箱の上に小さな蓋
      if (def.container) {
        this.lidMat = new THREE.MeshStandardMaterial({ color: COLORS.containerLid, roughness: 0.8, metalness: 0 });
        this.lid = new THREE.Group();
        const lidMesh = new THREE.Mesh(lidGeo, this.lidMat);
        lidMesh.scale.set(1.15, 0.7, 1.15);
        lidMesh.position.y = 1.5;
        const knob = new THREE.Mesh(knobGeo, this.lidMat);
        knob.position.y = 4.5;
        this.lid.add(lidMesh, knob);
        this.lid.position.y = BOX_H;
        this.body.add(this.lid);
      }
    }
    this.box.castShadow = true;
    this.box.receiveShadow = true;
    this.box.userData.id = def.id;
    this.body.add(this.box);
    this.pickMesh = this.box; // glb が入っても当たり判定は箱で取る（軽い）

    // 重い家具：床の暗い台座（据え付けの印）＋ 鍵の Sprite（未対策の間だけ）。登れる家具はクッションだけ（台座・鍵は無し）
    this.plate = null;
    this.lock = null;
    if (this.isHeavy && !this.isClimbable) {
      this.plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: COLORS.heavyPlate, roughness: 0.95, metalness: 0 }));
      this.plate.position.y = 1.25;
      this.plate.receiveShadow = true;
      this.group.add(this.plate);
      if (shared.lockTex) {
        this.lock = makeSprite(shared.lockTex, 11, 11);
        this.lock.position.set(-15, BOX_H + 5, 9);
        this.group.add(this.lock);
      }
    }

    this.model = null;
    this.fixedModel = null;
    this.modelMats = [];
    this.fixedModelMats = [];

    const labelText = this.isClimbable ? '登れる' : (def.label || def.id);
    const labelStyle = this.isGoods ? { color: COLORS.goodsInk } : (this.isClimbable || this.isProp ? { color: COLORS.cushionInk } : {});
    this.label = makeSprite(makeLabelTexture(labelText, labelStyle), 96, 18);
    this.label.position.set(0, this.labelH, -6);
    this.group.add(this.label);

    // 合成 toy：床の金色グローリング（renderer が setGlowPulse(t) で脈打たせる）
    this.glow = null;
    if (this.isMerged) {
      this.glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: COLORS.merged, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
      this.glow.rotation.x = -Math.PI / 2;
      this.glow.position.y = 0.6;
      this.glow.renderOrder = 2;
      this.group.add(this.glow);
    }

    this.check = makeSprite(shared.checkTex, 14, 14);
    this.check.position.set(15, BOX_H + 6, 8);
    this.check.visible = false;
    this.group.add(this.check);

    // 危険なおもちゃ（§11.4）：箱の右上に小さな「！」バッジ（body に付けるので持ち歩き・縮小に追従）
    this.risk = null;
    if (this.isRisky && shared.riskTex) {
      this.risk = makeSprite(shared.riskTex, 11, 11, { renderOrder: 11 });
      this.risk.position.set(14, BOX_H + 6, 10);
      this.body.add(this.risk);
    }

    this.disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: COLORS.shadow, transparent: true, opacity: 0.22, depthWrite: false }));
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.4;
    this.disc.visible = false;
    this.group.add(this.disc);

    this.akita = null;         // 「あきた」Sprite
    this.boredRingTex = null;  // 飽きの残り時間リング
    this.boredRing = null;

    this.isFixed = false;
    this.isStored = false;
    this.isGhost = false;
    this.isBored = false;
    this.baseEmissive = { color: 0x000000, intensity: 0 };
    this.arc = null;     // { from: Vector3, t, dur }
  }

  /** glb を差し込む（null なら何もしない）。fixedGltf は hazard の対策後モデル */
  setModels(gltf, fixedGltf) {
    if (gltf) {
      this.model = fitModel(gltf.scene, { maxW: BOX_W, maxH: BOX_H + 6, maxD: BOX_W });
      this.modelMats = cloneMaterials(this.model);
      this.body.add(this.model);
      this.box.visible = false;
      if (this.lid) this.lid.visible = false;
    }
    if (fixedGltf) {
      this.fixedModel = fitModel(fixedGltf.scene, { maxW: BOX_W, maxH: BOX_H + 6, maxD: BOX_W });
      this.fixedModelMats = cloneMaterials(this.fixedModel);
      this.fixedModel.visible = false;
      this.body.add(this.fixedModel);
    }
    this._applyFixedLook();
  }

  setFixed(on) {
    if (this.isFixed === !!on) return;
    this.isFixed = !!on;
    this._applyFixedLook();
  }

  /** 収納済み（高い場所・収納先へ移して fixed）：緑ではなく灰色にする。✅ は付く */
  setStored(on) {
    if (this.isStored === !!on) return;
    this.isStored = !!on;
    this._applyFixedLook();
  }

  _applyFixedLook() {
    const fixed = this.isFixed;
    this.check.visible = fixed;
    if (this.lock) this.lock.visible = !fixed;
    if (this.fixedModel) {
      this.fixedModel.visible = fixed;
      if (this.model) this.model.visible = !fixed;
      this.box.visible = false;
      this.baseEmissive = { color: 0x000000, intensity: 0 };
    } else if (this.model) {
      // 差し替えモデルが無いので緑（収納済みは灰色）に寄せる
      this.baseEmissive = fixed
        ? (this.isStored ? { color: 0x50585a, intensity: 0.35 } : { color: 0x2f7f3f, intensity: 0.45 })
        : { color: 0x000000, intensity: 0 };
    } else {
      const side = fixed ? (this.isStored ? COLORS.stored : COLORS.fixed) : this.style.color;
      const top = fixed ? (this.isStored ? COLORS.storedTop : COLORS.fixedTop) : this.style.top;
      this.sideMat.color.setHex(side);
      const tex = makeTopTexture(this.isBin ? null : this.def.emoji, top);
      this.topMat.map = tex;
      this.topMat.needsUpdate = true;
      this.topTex.dispose();
      this.topTex = tex;
      this.baseEmissive = { color: 0x000000, intensity: 0 };
    }
    this.setEmissive(null);
  }

  /** 容れ物の蓋の持ち上げ（ワールド単位。0 で閉じる） */
  setLidLift(h) {
    if (!this.lid) return;
    const base = this.isBin ? BIN_H : BOX_H;
    this.lid.position.y = base + h;
    this.lid.rotation.z = -h * 0.02;
  }

  /** 飽き表示：半透明（50%）＋「あきた」。残り時間リングは setBoredRing(frac) で毎フレーム */
  setBored(on) {
    if (this.isBored === !!on) return;
    this.isBored = !!on;
    if (!this.model) this.sideMat.color.setHex(on ? COLORS.toyBored : this.style.color);
    if (on) {
      if (!this.akita) {
        this.akita = makeSprite(this.shared.akitaTex, 32, 12, { renderOrder: 11 });
        this.akita.position.set(0, BOX_H + 44, -6);
        this.group.add(this.akita);
      }
      this.akita.visible = true;
    } else {
      if (this.akita) this.akita.visible = false;
      this.hideBoredRing();
    }
    this._applyAlpha();
  }

  setBoredRing(frac) {
    if (!this.boredRing) {
      this.boredRingTex = new RingTexture({ color: COLORS.bored, track: COLORS.boredTrack, lineWidth: 16, shadow: false });
      this.boredRing = makeSprite(this.boredRingTex.texture, 16, 16, { renderOrder: 11 });
      this.boredRing.position.set(17, BOX_H + 8, 8);
      this.group.add(this.boredRing);
    }
    this.boredRingTex.update(frac);
    this.boredRing.visible = true;
  }

  hideBoredRing() {
    if (this.boredRing) this.boredRing.visible = false;
  }

  /** 合成 toy のグローを脈打たせる（毎フレーム） */
  setGlowPulse(t) {
    if (!this.glow) return;
    this.glow.material.opacity = 0.45 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3));
    const sc = 1 + 0.06 * Math.sin(t * 3);
    this.glow.scale.set(sc, sc, 1);
  }

  /** 再発予告のゴースト表示（removed のまま薄く見せる） */
  setGhost(on) {
    if (this.isGhost === !!on) return;
    this.isGhost = !!on;
    this._applyAlpha();
  }

  /** ghost(0.35) > bored(0.5) > 通常(1) の順で不透明度を決める */
  _applyAlpha() {
    const opacity = this.isGhost ? 0.35 : (this.isBored ? 0.5 : 1);
    for (const m of this._allMats()) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.needsUpdate = true;
    }
    this.label.material.opacity = this.isGhost ? 0.5 : (this.isBored ? 0.7 : 1);
  }

  /** 一時的な emissive（combo 予告・ヒント・再発予告）。null で基準値に戻す */
  setEmissive(hex, intensity = 0) {
    const c = hex == null ? this.baseEmissive.color : hex;
    const k = hex == null ? this.baseEmissive.intensity : intensity;
    for (const m of this._allMats()) {
      if (!m.emissive) continue;
      m.emissive.setHex(c);
      m.emissiveIntensity = k;
    }
  }

  _allMats() {
    const mats = [this.sideMat, this.topMat, ...this.modelMats, ...this.fixedModelMats];
    if (this.lidMat) mats.push(this.lidMat);
    return mats;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    disposeSprite(this.label);
    disposeSprite(this.boredRing);
    if (this.boredRingTex) this.boredRingTex.dispose();
    if (this.akita) { this.akita.material.dispose(); }    // texture は shared
    if (this.check) { this.check.material.dispose(); }
    if (this.lock) { this.lock.material.dispose(); }      // texture は shared
    if (this.risk) { this.risk.material.dispose(); }      // texture は shared
    if (this.glow) { this.glow.material.dispose(); }
    if (this.plate) { this.plate.material.dispose(); }
    if (this.lidMat) this.lidMat.dispose();
    this.disc.material.dispose();
    this.sideMat.dispose();
    this.topMat.dispose();
    this.topTex.dispose();
    if (this.model) disposeObject(this.model);
    if (this.fixedModel) disposeObject(this.fixedModel);
  }
}

/** モデルのマテリアルを個別化して配列で返す（emissive を個別に触るため） */
function cloneMaterials(root) {
  const mats = [];
  root.traverse((n) => {
    if (!n.isMesh) return;
    if (Array.isArray(n.material)) {
      n.material = n.material.map((m) => m.clone());
      mats.push(...n.material);
    } else if (n.material) {
      n.material = n.material.clone();
      mats.push(n.material);
    }
  });
  return mats;
}
