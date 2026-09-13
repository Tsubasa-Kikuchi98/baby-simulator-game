// パーティクル：対策完了の緑の上昇バースト（0.6 秒）、遊び中／停止中の回る星。
import * as THREE from 'three';
import { makeStarTexture, makeDotTexture, COLORS } from './textures.js';

export class ParticleSystem {
  /** @param {THREE.Object3D} parent 追加先（部屋グループ。ゲーム座標 (x, h, y) で置く） */
  constructor(parent) {
    this.parent = parent;
    this.bursts = [];          // { points, vel: Float32Array, t, life, mat }
    this.orbits = new Map();   // key → { points, n, radius, height, speed, phase }
    this.dotTex = makeDotTexture();
    this.starTex = makeStarTexture();
  }

  /** 緑の粒が上昇して消える */
  burst(pos, { count = 26, color = COLORS.fixedParticle, life = 0.6, size = 7 } = {}) {
    const positions = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 14;
      positions[i * 3] = pos.x + Math.cos(a) * r;
      positions[i * 3 + 1] = pos.y + Math.random() * 6;
      positions[i * 3 + 2] = pos.z + Math.sin(a) * r;
      vel[i * 3] = Math.cos(a) * (10 + Math.random() * 30);
      vel[i * 3 + 1] = 60 + Math.random() * 70;
      vel[i * 3 + 2] = Math.sin(a) * (10 + Math.random() * 30);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, sizeAttenuation: true, map: this.dotTex, transparent: true, opacity: 1,
      depthWrite: false, depthTest: false
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 9;
    points.frustumCulled = false;
    this.parent.add(points);
    this.bursts.push({ points, vel, t: 0, life, mat });
  }

  /** 回る星（key で識別。毎フレーム setOrbitCenter で中心を渡す） */
  ensureOrbit(key, { n = 5, radius = 22, height = 36, speed = 4, size = 9, color = 0xffd25f } = {}) {
    let o = this.orbits.get(key);
    if (o) return o;
    const positions = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, sizeAttenuation: true, map: this.starTex, transparent: true, alphaTest: 0.2,
      depthWrite: false, depthTest: false
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 9;
    points.frustumCulled = false;
    this.parent.add(points);
    o = { points, n, radius, height, speed, phase: Math.random() * Math.PI * 2, center: new THREE.Vector3() };
    this.orbits.set(key, o);
    return o;
  }

  setOrbitCenter(key, x, y, z) {
    const o = this.orbits.get(key);
    if (o) o.center.set(x, y, z);
  }

  removeOrbit(key) {
    const o = this.orbits.get(key);
    if (!o) return;
    this.parent.remove(o.points);
    o.points.geometry.dispose();
    o.points.material.dispose();
    this.orbits.delete(key);
  }

  /** 使われなかった orbit を消す（keep: 今フレーム使った key の Set） */
  pruneOrbits(keep) {
    for (const key of [...this.orbits.keys()]) if (!keep.has(key)) this.removeOrbit(key);
  }

  update(dt, t) {
    // bursts
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) {
        this.parent.remove(b.points);
        b.points.geometry.dispose();
        b.mat.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const pos = b.points.geometry.attributes.position;
      const arr = pos.array;
      for (let j = 0; j < arr.length; j += 3) {
        arr[j] += b.vel[j] * dt;
        arr[j + 1] += b.vel[j + 1] * dt;
        arr[j + 2] += b.vel[j + 2] * dt;
        b.vel[j + 1] -= 90 * dt; // 少し減速
      }
      pos.needsUpdate = true;
      b.mat.opacity = 1 - k * k;
      b.mat.size = 7 * (1 - 0.4 * k);
    }
    // orbits
    for (const o of this.orbits.values()) {
      const arr = o.points.geometry.attributes.position.array;
      for (let i = 0; i < o.n; i++) {
        const a = t * o.speed + o.phase + (i * Math.PI * 2) / o.n;
        arr[i * 3] = o.center.x + Math.cos(a) * o.radius;
        arr[i * 3 + 1] = o.center.y + o.height + Math.sin(t * 6 + i * 1.3) * 3;
        arr[i * 3 + 2] = o.center.z + Math.sin(a) * o.radius * 0.7;
      }
      o.points.geometry.attributes.position.needsUpdate = true;
    }
  }

  reset() {
    for (const b of this.bursts) {
      this.parent.remove(b.points);
      b.points.geometry.dispose();
      b.mat.dispose();
    }
    this.bursts = [];
    for (const key of [...this.orbits.keys()]) this.removeOrbit(key);
  }

  dispose() {
    this.reset();
    this.dotTex.dispose();
    this.starTex.dispose();
  }
}
