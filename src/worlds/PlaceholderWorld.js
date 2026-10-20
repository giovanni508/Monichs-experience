import * as THREE from 'three';
import { World } from './World.js';

// Mondo provvisorio (usato solo durante lo sviluppo, finché il mondo reale non è pronto)
export class PlaceholderWorld extends World {
  constructor(app, id, color = 0x334455) {
    super(app, id);
    this.color = color;
  }

  async load() {
    const s = this.scene;
    s.background = new THREE.Color(0x05060a);
    s.fog = new THREE.FogExp2(0x05060a, 0.02);
    const grid = new THREE.GridHelper(200, 80, this.color, 0x222630);
    s.add(grid);
    s.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.2));
    const box = new THREE.Mesh(new THREE.TorusKnotGeometry(4, 1.2, 160, 24), new THREE.MeshStandardMaterial({ color: this.color, metalness: 0.6, roughness: 0.3 }));
    box.position.set(0, 6, -20);
    s.add(box);
    this.box = box;
    this.spawn = { position: new THREE.Vector3(0, 4, 10), yaw: 0, pitch: 0 };
    this.loaded = true;
  }

  update(dt) {
    super.update(dt);
    this.box.rotation.y += dt * 0.2;
  }

  constrain() {}
}
