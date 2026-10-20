import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Ombre del sole in tempo reale. Una luce direzionale per mondo proietta le ombre; la "scatola"
// della mappa d'ombra segue chi guarda (spostata un po' davanti a lui) e si muove solo a passi di un
// texel, così i bordi delle ombre non tremolano camminando. La risoluzione dipende dalla qualità.
// ---------------------------------------------------------------------------------------------

const _fwd = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();
const _zero = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class SunShadow {
  /**
   * @param {THREE.DirectionalLight} light  luce già orientata (posizione → bersaglio)
   * @param {object} o  extent: mezzo lato della scatola; distance: distanza della luce dal centro;
   *                    ahead: quanto la scatola sta davanti alla camera (frazione di extent);
   *                    center: centro fisso (scene ferme, come l'epilogo) invece di seguire la camera
   */
  constructor(light, { extent = 50, distance = 220, ahead = 0.45, center = null, bias = -0.0004, normalBias = 0.05, radius = 3, intensity = 1 } = {}) {
    this.light = light;
    this.center = center;
    this.extent = extent;
    this.distance = distance;
    this.ahead = ahead;
    this.dir = light.position.clone().sub(light.target.position).normalize(); // verso la luce
    this.size = 0;
    light.castShadow = true;
    const s = light.shadow;
    s.bias = bias;
    s.normalBias = normalBias;
    s.radius = radius;
    s.intensity = intensity;
    const cam = s.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = distance * 2;
    cam.updateProjectionMatrix();
    // base della luce (uguale a quella della sua camera d'ombra), per agganciare il centro ai texel
    _m.lookAt(this.dir, _zero, _up);
    this.basis = _m.clone();
    this.basisInv = _mi.copy(_m).invert().clone();
  }

  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    const s = this.light.shadow;
    s.mapSize.set(size, size);
    if (s.map) {
      s.map.dispose();
      s.map = null;
    }
  }

  update(camera) {
    if (this.center) _c.copy(this.center);
    else {
      camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
      _fwd.normalize();
      _c.copy(camera.position).addScaledVector(_fwd, this.extent * this.ahead);
    }
    const texel = (2 * this.extent) / Math.max(1, this.size);
    _c.applyMatrix4(this.basisInv);
    _c.x = Math.round(_c.x / texel) * texel;
    _c.y = Math.round(_c.y / texel) * texel;
    _c.applyMatrix4(this.basis);
    const l = this.light;
    l.target.position.copy(_c);
    l.position.copy(_c).addScaledVector(this.dir, this.distance);
    l.target.updateMatrixWorld();
  }
}

/**
 * Accende proiezione e ricezione delle ombre sugli oggetti illuminati di un gruppo.
 * Restano fuori: materiali non illuminati (shader propri, sprite, bagliori), trasparenze (vetri) e
 * ciò che ha userData.noShadow; userData.noCastShadow tiene la ricezione ma non la proiezione.
 */
export function enableShadows(root, { cast = true, receive = true } = {}) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noShadow) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const lit = mats.some((m) => m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial));
    if (!lit) return;
    const seeThrough = mats.every((m) => m.transparent && (m.opacity < 0.98 || !m.depthWrite));
    if (cast && !seeThrough && !o.userData.noCastShadow) o.castShadow = true;
    if (receive && !seeThrough) o.receiveShadow = true;
  });
}
