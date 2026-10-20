import * as THREE from 'three';
import { Mat } from './materials.js';

// Maglie del bracciale integrato Delta: base spazzolata a tutta larghezza con smussi lucidati
// e un elemento centrale lucido in rilievo (come nelle foto del bracciale).

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function linearTangents(geo) {
  const pos = geo.attributes.position;
  const t = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    t[i * 4] = 1;
    t[i * 4 + 3] = 1;
  }
  geo.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
}

/** Geometrie di una "riga" di maglie, in coordinate locali: X = larghezza, Z = direzione del bracciale, Y = su. */
export function linkGeometries({ width = 22, length = 5.2, height = 2.6 } = {}) {
  const outer = new THREE.ExtrudeGeometry(roundedRect(width, length, length * 0.18), {
    depth: height,
    bevelEnabled: true,
    bevelThickness: height * 0.22,
    bevelSize: height * 0.22,
    bevelSegments: 1,
    curveSegments: 6,
  });
  outer.rotateX(-Math.PI / 2);
  outer.translate(0, -height, 0);
  linearTangents(outer);
  const center = new THREE.ExtrudeGeometry(roundedRect(width * 0.38, length * 0.62, length * 0.3), {
    depth: height * 0.42,
    bevelEnabled: true,
    bevelThickness: height * 0.2,
    bevelSize: height * 0.16,
    bevelSegments: 3,
    curveSegments: 10,
  });
  center.rotateX(-Math.PI / 2);
  center.translate(0, height * 0.02, 0);
  return { outer, center };
}

/**
 * Costruisce un bracciale lungo una lista di pose { pos: Vector3, dir: Vector3, scale }.
 * @returns {{ group, outerMesh, centerMesh, materials }}
 */
export function buildBracelet(poses, { width = 22, length = 5.2, height = 2.6, accent = 'steel' } = {}) {
  const { outer, center } = linkGeometries({ width, length, height });
  const brushed = Mat.steelSatin({ color: 0xcdd0d5, roughness: 0.3, anisotropy: 0.85 });
  const polished = accent === 'rose' ? Mat.roseGoldPolished({ color: 0xf1b69c, roughness: 0.08 }) : Mat.steelPolished({ color: 0xeef0f2, roughness: 0.04 });
  const outerMesh = new THREE.InstancedMesh(outer, brushed, poses.length);
  const centerMesh = new THREE.InstancedMesh(center, polished, poses.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4();
  poses.forEach((p, i) => {
    const z = p.dir.clone().normalize();
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    basis.makeBasis(x, y, z);
    q.setFromRotationMatrix(basis);
    const s = p.scale ?? 1;
    m.compose(p.pos, q, new THREE.Vector3(s, 1, 1));
    outerMesh.setMatrixAt(i, m);
    centerMesh.setMatrixAt(i, m);
  });
  const group = new THREE.Group();
  group.add(outerMesh, centerMesh);
  return { group, outerMesh, centerMesh, materials: { brushed, polished } };
}
