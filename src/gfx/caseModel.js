import * as THREE from 'three';
import { Mat } from './materials.js';
import { crownGeometry } from './gears.js';

// Cassa Delta stilizzata (piano XY, quadrante verso +Z): carrure ottagonale con anse integrate,
// lunetta rotonda con quattro tacche (12, 3, 6, 9), vetro zaffiro, corona a ore 3.
// Proporzioni dal dato confermato: Ø 38 mm, spessore ~10,5 mm.

function octagon(rx, ry, cut) {
  return [
    [-rx + cut, -ry],
    [rx - cut, -ry],
    [rx, -ry + cut],
    [rx, ry - cut],
    [rx - cut, ry],
    [-rx + cut, ry],
    [-rx, ry - cut],
    [-rx, -ry + cut],
  ].map(([x, y]) => new THREE.Vector2(x, y));
}

function addPlanarTangents(geo) {
  const pos = geo.attributes.position;
  const t = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    t[i * 4] = 1;
    t[i * 4 + 3] = 1;
  }
  geo.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
}

function addRingTangents(geo) {
  const pos = geo.attributes.position;
  const t = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const l = Math.hypot(x, y);
    t[i * 4] = l > 1e-5 ? -y / l : 1;
    t[i * 4 + 1] = l > 1e-5 ? x / l : 0;
    t[i * 4 + 3] = 1;
  }
  geo.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
}

/**
 * @param {number} dialR raggio del quadrante (le altre misure ne derivano)
 * @param {'steel'|'rose'} bezel
 */
export function buildDeltaCase({ dialR = 40, bezel = 'steel', crystal = true } = {}) {
  const g = new THREE.Group();
  const D = dialR * 2 * (38 / 30.5); // diametro della cassa rispetto al quadrante
  const thickness = D * (10.5 / 38);
  const caseRx = D * 0.56;
  const caseRy = D * 0.6;

  const brushed = Mat.steelSatin({ color: 0xcfd2d7, roughness: 0.28, anisotropy: 0.8 });
  const polished = Mat.steelPolished({ color: 0xe8eaed, roughness: 0.05 });
  const bezelMat = bezel === 'rose' ? Mat.roseGold({ color: 0xf0b49b, roughness: 0.2 }) : Mat.steelSatin({ color: 0xd8dbdf, roughness: 0.22, anisotropy: 0.9 });
  const bezelPolish = bezel === 'rose' ? Mat.roseGoldPolished() : polished;

  // carrure ottagonale (spazzolata) con smussi lucidati
  const caseShape = new THREE.Shape(octagon(caseRx, caseRy, D * 0.17));
  const hole = new THREE.Path();
  hole.absarc(0, 0, dialR * 1.13, 0, Math.PI * 2, true);
  caseShape.holes.push(hole);
  const caseGeo = new THREE.ExtrudeGeometry(caseShape, {
    depth: thickness * 0.72,
    bevelEnabled: true,
    bevelThickness: D * 0.02,
    bevelSize: D * 0.02,
    bevelSegments: 1,
    curveSegments: 64,
  });
  caseGeo.translate(0, 0, -thickness * 0.72 + thickness * 0.08);
  addPlanarTangents(caseGeo);
  const caseMesh = new THREE.Mesh(caseGeo, brushed);
  g.add(caseMesh);

  // lunetta rotonda con le quattro tacche
  const bo = dialR * 1.42;
  const bi = dialR * 1.12;
  const notchW = 0.07; // ampiezza angolare (rad)
  const notchD = dialR * 0.06;
  const pts = [];
  const N = 360;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let r = bo;
    for (const c of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const d = Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)));
      if (d < notchW) r = bo - notchD;
    }
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const bezelShape = new THREE.Shape(pts);
  const bh = new THREE.Path();
  bh.absarc(0, 0, bi, 0, Math.PI * 2, true);
  bezelShape.holes.push(bh);
  const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, {
    depth: thickness * 0.14,
    bevelEnabled: true,
    bevelThickness: dialR * 0.05,
    bevelSize: dialR * 0.05,
    bevelSegments: 2,
    curveSegments: 96,
  });
  bezelGeo.translate(0, 0, thickness * 0.08);
  addRingTangents(bezelGeo);
  const bezelMesh = new THREE.Mesh(bezelGeo, bezelMat);
  g.add(bezelMesh);
  // filo lucido interno della lunetta
  const lip = new THREE.Mesh(new THREE.TorusGeometry(bi + dialR * 0.01, dialR * 0.025, 12, 160), bezelPolish);
  lip.position.z = thickness * 0.24;
  g.add(lip);

  // fondo interno scuro (sotto il quadrante) per chiudere la vista dai lati
  const back = new THREE.Mesh(new THREE.CircleGeometry(dialR * 1.15, 96), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6, metalness: 0.5 }));
  back.position.z = -thickness * 0.5;
  g.add(back);

  // vetro zaffiro con antiriflesso: quasi invisibile, solo un velo di riflessi
  let glass = null;
  if (crystal) {
    glass = new THREE.Mesh(
      new THREE.CircleGeometry(dialR * 1.13, 96),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.08, envMapIntensity: 1.6, depthWrite: false }),
    );
    glass.position.z = thickness * 0.2;
    glass.renderOrder = 5;
    g.add(glass);
  }

  // corona a ore 3
  const crown = new THREE.Mesh(crownGeometry({ radius: D * 0.085, length: D * 0.08, flutes: 22, depth: D * 0.008 }), polished);
  crown.rotation.y = Math.PI / 2;
  crown.position.set(caseRx + D * 0.11, 0, -thickness * 0.25);
  g.add(crown);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(D * 0.04, D * 0.04, D * 0.06, 24), polished);
  tube.rotation.z = Math.PI / 2;
  tube.position.set(caseRx + D * 0.02, 0, -thickness * 0.25);
  g.add(tube);

  // viti sulla carrure (come nella foto di profilo: due per lato)
  const screwGeo = new THREE.CylinderGeometry(D * 0.016, D * 0.016, D * 0.01, 20);
  screwGeo.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const s = new THREE.Mesh(screwGeo, polished);
      s.position.set(sx * (caseRx + D * 0.004), sy * D * 0.2, -thickness * 0.25);
      g.add(s);
    }
  }

  return {
    group: g,
    materials: { brushed, polished, bezel: bezelMat },
    meshes: { caseMesh, bezelMesh, glass, crown },
    size: { D, thickness, caseRx, caseRy },
  };
}
