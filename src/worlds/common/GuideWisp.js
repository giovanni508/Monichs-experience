import * as THREE from 'three';
import { glowSprite } from '../../gfx/effects.js';

const _a = new THREE.Vector3();

/**
 * Lucciola guida: una piccola luce che fluttua davanti al giocatore lungo il percorso,
 * verso la prossima tappa. Non è un'interfaccia: è parte del sogno.
 */
export class GuideWisp {
  constructor(world, { color = 0xffe2b8, size = 1.6 } = {}) {
    this.world = world;
    this.group = new THREE.Group();
    size *= 0.7;
    this.core = glowSprite(color, size, 0.95);
    this.halo = glowSprite(color, size * 3.4, 0.18);
    this.group.add(this.core, this.halo);
    // scia: alcuni sprite che seguono con ritardo
    this.trail = [];
    for (let i = 0; i < 7; i++) {
      const s = glowSprite(color, size * (0.7 - i * 0.07), 0.35 - i * 0.04);
      this.trail.push({ sprite: s, pos: new THREE.Vector3() });
      world.scene.add(s);
    }
    world.scene.add(this.group);
    this.pos = new THREE.Vector3();
    this.target = null; // Vector3 della prossima tappa
    this.visible = 1;
    this.opacity = 1;
    this.time = Math.random() * 10;
    this.lead = 9; // distanza davanti al giocatore lungo il percorso
  }

  setTarget(point) {
    this.target = point ? point.clone() : null;
  }

  reset(pos) {
    this.pos.copy(pos);
    this.trail.forEach((t) => t.pos.copy(pos));
  }

  update(dt, playerPos, { hide = false } = {}) {
    this.time += dt;
    const w = this.world;
    const want = new THREE.Vector3();
    if (this.target) {
      const toTarget = _a.subVectors(this.target, playerPos);
      const dist = toTarget.length();
      if (dist < 9) {
        // arrivati: orbita lenta attorno alla tappa
        const t = this.time * 0.6;
        want.copy(this.target).add(new THREE.Vector3(Math.cos(t) * 3.5, 1.5 + Math.sin(t * 1.3) * 0.8, Math.sin(t) * 3.5));
      } else if (w.path) {
        // un po' avanti lungo il percorso, nella direzione della tappa
        const near = new THREE.Vector3();
        const tPlayer = w.nearestOnPath(playerPos, near);
        const tTarget = w.nearestOnPath(this.target, new THREE.Vector3());
        const dir = Math.sign(tTarget - tPlayer) || 1;
        const lenApprox = this.pathLength || (this.pathLength = this.computeLength());
        const step = (this.lead / lenApprox) * dir;
        let tw = tPlayer + step;
        if (dir > 0) tw = Math.min(tw, tTarget);
        else tw = Math.max(tw, tTarget);
        this.pointAt(tw, want);
        want.y += 1.2;
      } else {
        want.copy(playerPos).addScaledVector(toTarget.normalize(), Math.min(this.lead, dist));
      }
    } else {
      want.copy(this.pos);
    }
    want.y += Math.sin(this.time * 1.7) * 0.5;
    want.x += Math.sin(this.time * 0.9) * 0.4;
    const k = 1 - Math.exp(-dt * 1.6);
    this.pos.lerp(want, k);
    this.group.position.copy(this.pos);

    const targetOpacity = hide || !this.target ? 0 : 1;
    this.opacity += (targetOpacity - this.opacity) * (1 - Math.exp(-dt * 2.5));
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 2.2);
    this.core.material.opacity = 0.75 * this.opacity * pulse;
    this.halo.material.opacity = 0.13 * this.opacity;
    let prev = this.pos;
    this.trail.forEach((t, i) => {
      t.pos.lerp(prev, 1 - Math.exp(-dt * (6 - i * 0.5)));
      t.sprite.position.copy(t.pos);
      t.sprite.material.opacity = (0.32 - i * 0.04) * this.opacity;
      prev = t.pos;
    });
  }

  computeLength() {
    const pts = this.world.path.points;
    let l = 0;
    for (let i = 0; i < pts.length - 1; i++) l += pts[i].distanceTo(pts[i + 1]);
    return l || 1;
  }

  // punto del percorso al parametro normalizzato t
  pointAt(t, out) {
    const pts = this.world.path.points;
    const total = this.pathLength || this.computeLength();
    let d = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < pts.length - 1; i++) {
      const l = pts[i].distanceTo(pts[i + 1]);
      if (d <= l || i === pts.length - 2) return out.copy(pts[i]).lerp(pts[i + 1], Math.min(1, d / (l || 1)));
      d -= l;
    }
    return out.copy(pts[pts.length - 1]);
  }
}
