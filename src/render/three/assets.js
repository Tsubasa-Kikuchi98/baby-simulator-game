// glTF の読み込みキャッシュ。./assets/models/<name>.glb が無ければ null（プレースホルダー維持）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_BASE = './assets/models/';

export class AssetCache {
  constructor() {
    this.loader = new GLTFLoader();
    this.cache = new Map(); // name → Promise<gltf|null>
  }

  /** @returns {Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF|null>} */
  load(name) {
    if (!name) return Promise.resolve(null);
    if (this.cache.has(name)) return this.cache.get(name);
    const p = this.loader.loadAsync(`${MODEL_BASE}${name}.glb`)
      .then((gltf) => {
        if (!gltf || !gltf.scene) return null;
        console.info(`[three] loaded model ${name}.glb`);
        return gltf;
      })
      .catch(() => null);
    this.cache.set(name, p);
    return p;
  }
}

/**
 * 読み込んだ scene の複製を、底面が y=0・中心が原点になるようにして
 * 指定サイズ（幅・高さ・奥行きの最大値）に収まるようスケールする。
 */
export function fitModel(scene, { maxW = 36, maxH = 34, maxD = 36 } = {}) {
  const obj = scene.clone(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = Math.min(maxW / (size.x || 1), maxH / (size.y || 1), maxD / (size.z || 1));
  obj.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(obj);
  const c = new THREE.Vector3();
  box2.getCenter(c);
  obj.position.set(-c.x, -box2.min.y, -c.z);
  obj.traverse((n) => {
    if (n.isMesh) { n.castShadow = true; n.receiveShadow = false; }
  });
  const wrap = new THREE.Group();
  wrap.add(obj);
  return wrap;
}

/** シーン内の Mesh / Points の頂点総数 */
export function countVertices(root) {
  let n = 0;
  root.traverse((o) => {
    if ((o.isMesh || o.isPoints) && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const cnt = o.geometry.attributes.position.count;
      n += o.isInstancedMesh ? cnt * o.count : cnt;
    }
  });
  return n;
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap']) {
        if (m[key] && m[key].dispose) m[key].dispose();
      }
      m.dispose();
    }
  });
}
