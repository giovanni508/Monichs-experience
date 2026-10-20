import * as THREE from 'three';
import { highlightTargets } from '../gfx/materials.js';

const _v = new THREE.Vector3();

/**
 * Sistema comune degli hotspot.
 * Avvicinamento → il componente si illumina (rim light) → entro `focusRadius` appare la card
 * con titolo, testo tecnico e frase poetica → Spazio/click esegue l'azione della tappa (se c'è).
 *
 * Definizione (nei mondi):
 * {
 *   id, position: Vector3, radius (inizio bagliore), focusRadius (card),
 *   targets: [Object3D], textKey: 'movement.stations.crown', image: 'assets/img/cards/…',
 *   kickerKey, actionKey, onAction(h), onFocus(h), onVisited(h), order
 * }
 */
export class Hotspots {
  constructor({ ui, audio, onVisited }) {
    this.ui = ui;
    this.audio = audio;
    this.onVisited = onVisited;
    this.list = [];
    this.focused = null;
    this.enabled = true;
  }

  setList(list) {
    this.clear();
    this.list = list || [];
    for (const h of this.list) {
      h.visited = h.visited || false;
      h.focusTime = 0;
      h.hl = 0;
      h.actionDone = false;
      h.radius = h.radius ?? 20;
      h.focusRadius = h.focusRadius ?? 10;
      if (!h.uniforms && h.targets) h.uniforms = highlightTargets(h.targets, h.color);
    }
  }

  clear() {
    if (this.focused) this.ui.hideCard();
    this.focused = null;
    for (const h of this.list) (h.uniforms || []).forEach((u) => (u.uHL.value = 0));
    this.list = [];
  }

  resetVisits() {
    for (const h of this.list) {
      h.visited = false;
      h.actionDone = false;
    }
  }

  update(dt, playerPos, camForward) {
    if (!this.enabled) return;
    let best = null;
    let bestScore = Infinity;
    const t = performance.now() / 1000;
    for (const h of this.list) {
      if (h.disabled) {
        h.hl += (0 - h.hl) * (1 - Math.exp(-dt * 3));
        (h.uniforms || []).forEach((u) => (u.uHL.value = h.hl));
        continue;
      }
      const d = playerPos.distanceTo(h.position);
      _v.subVectors(h.position, playerPos).normalize();
      const facing = camForward ? camForward.dot(_v) : 1;
      // bagliore: cresce avvicinandosi; pulsazione lenta (0,4 Hz) quando non ancora visitato
      const approach = THREE.MathUtils.clamp((h.radius - d) / Math.max(0.001, h.radius - h.focusRadius), 0, 1);
      const pulse = h.visited ? 0 : (0.5 + 0.5 * Math.sin(t * 2.4 + h.position.x)) * 0.25;
      let target = approach * (0.4 + pulse);
      if (h === this.focused) target = 0.75 + Math.sin(t * 1.6) * 0.08;
      if (h.glowScale) target *= h.glowScale;
      h.hl += (target - h.hl) * (1 - Math.exp(-dt * 3.2));
      (h.uniforms || []).forEach((u) => (u.uHL.value = h.hl));

      if (d < h.focusRadius) {
        // preferisce l'hotspot guardato e più vicino
        const score = d * (1.6 - Math.max(0, facing) * 0.6);
        if (score < bestScore) {
          bestScore = score;
          best = h;
        }
      }
    }

    if (best !== this.focused) {
      if (this.focused) this.focused.onBlur?.(this.focused);
      this.focused = best;
      if (best) {
        this.ui.showCard(best);
        best.onFocus?.(best);
        if (!best.visited) this.audio?.chime('discover');
      } else this.ui.hideCard();
    }

    if (this.focused) {
      const h = this.focused;
      h.focusTime += dt;
      // manualVisit: la tappa si completa solo con la sua azione (es. caricare la corona)
      if (!h.visited && !h.manualVisit && h.focusTime > 2.2) this.markVisited(h);
    }
  }

  markVisited(h) {
    if (h.visited) return;
    h.visited = true;
    h.onVisited?.(h);
    this.onVisited?.(h);
  }

  // Spazio / click / pulsante A
  interact() {
    const h = this.focused;
    if (!h || !h.onAction) return false;
    if (h.actionOnce && h.actionDone) return false;
    h.onAction(h);
    if (!h.manualVisit) {
      h.actionDone = !!h.actionOnce;
      this.markVisited(h);
    }
    this.ui.fillCard(h);
    return true;
  }

  // Rimuove la card corrente (es. durante una transizione)
  blur() {
    if (this.focused) {
      this.ui.hideCard();
      this.focused = null;
    }
  }

  get visitedCount() {
    return this.list.filter((h) => h.visited && !h.extra).length;
  }

  get total() {
    return this.list.filter((h) => !h.extra).length;
  }
}
