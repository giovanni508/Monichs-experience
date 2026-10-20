// Cinematica stilizzata ma coerente di un calibro automatico a 28.800 alternanze/ora.
//
// Dati confermati: 28.800 A/h = 8 alternanze al secondo = 4 Hz.
// Valori di disegno (plausibili, NON dichiarati nei testi): ampiezza del bilanciere,
// numero di denti del rodaggio. Lo scappamento ad ancora svizzero ha 15 denti: a ogni
// alternanza la ruota avanza di mezzo passo (12°) → 16 giri al minuto a 4 Hz.
//
// Rapporti scelti: bariletto 72 → pignone centrale 12; centrale 80 → pignone terza 10;
// terza 75 → pignone quarta 10; quarta 96 → pignone di scappamento 6.
//   ruota centrale: 1 giro/ora · quarta ruota: 1 giro/minuto · scappamento: 16 giri/minuto.

export const CALIBER = {
  frequency: 4, // Hz
  beatsPerSecond: 8,
  amplitude: (280 * Math.PI) / 180, // ampiezza tipica di un bilanciere in salute (valore di disegno)
  liftHalf: (26 * Math.PI) / 180, // metà dell'angolo di sollevamento
  forkSwing: (8 * Math.PI) / 180, // escursione dell'ancora tra le due spine di limitazione
  escapeTeeth: 15,
  stepAngle: (2 * Math.PI) / 30, // mezzo dente
  train: {
    barrel: 72,
    centerPinion: 12,
    center: 80,
    thirdPinion: 10,
    third: 75,
    fourthPinion: 10,
    fourth: 96,
    escapePinion: 6,
  },
};

const T = CALIBER.train;
// Rapporti di velocità rispetto alla ruota di scappamento (segno: ingranaggi che ingranano ruotano in verso opposto)
export const RATIOS = {
  escape: 1,
  fourth: -T.escapePinion / T.fourth,
  third: (T.escapePinion / T.fourth) * (T.fourthPinion / T.third),
  center: -(T.escapePinion / T.fourth) * (T.fourthPinion / T.third) * (T.thirdPinion / T.center),
  barrel: (T.escapePinion / T.fourth) * (T.fourthPinion / T.third) * (T.thirdPinion / T.center) * (T.centerPinion / T.barrel),
};

const DELTA = Math.asin(CALIBER.liftHalf / CALIBER.amplitude) / Math.PI; // metà finestra d'impulso, in unità di alternanza

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Stato del calibro al tempo meccanico t (secondi).
 * @param {number} t tempo meccanico
 * @param {number} legibility allarga la finestra d'impulso (1 = fisica, 3 = più leggibile al rallentatore)
 */
export function caliberState(t, legibility = 1, out = {}) {
  const A = CALIBER.amplitude;
  const u = t * 2 * CALIBER.frequency; // alternanze trascorse (continue)
  const theta = A * Math.sin(Math.PI * u);
  const k = Math.round(u);
  const d = Math.min(0.2, DELTA * legibility);
  const p = clamp01((u - k + d) / (2 * d));
  // impulso + piccola "caduta" finale del dente
  const eased = p < 0.82 ? (p / 0.82) * 0.9 : 0.9 + ((p - 0.82) / 0.18) * 0.1;
  const steps = k + eased;
  const thetaL = CALIBER.liftHalf * legibility;
  const fork = -CALIBER.forkSwing * Math.max(-1, Math.min(1, theta / Math.min(thetaL, A * 0.6)));

  out.theta = theta; // angolo del bilanciere (rad)
  out.fork = fork; // angolo dell'ancora (rad)
  out.escape = steps * CALIBER.stepAngle; // angolo cumulato della ruota di scappamento
  out.beat = k;
  out.beatPhase = u - k;
  out.impulse = p > 0 && p < 1 ? 1 : 0;
  out.fourth = out.escape * RATIOS.fourth;
  out.third = out.escape * RATIOS.third;
  out.center = out.escape * RATIOS.center;
  out.barrel = out.escape * RATIOS.barrel;
  return out;
}

// Orologio meccanico globale: il tempo del calibro scorre con una scala variabile
// (rallentatore, time-lapse) interpolata in modo logaritmico per transizioni morbide.
export class MechClock {
  constructor() {
    this.time = 1000 + Math.random() * 50;
    this.scale = 1;
    this.target = 1;
    this.response = 1.6;
  }

  setScale(target, response = 1.6) {
    this.target = Math.max(0.005, target);
    this.response = response;
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * this.response);
    const ls = Math.log(this.scale);
    this.scale = Math.exp(ls + (Math.log(this.target) - ls) * k);
    if (Math.abs(this.scale - this.target) / this.target < 0.001) this.scale = this.target;
    this.time += dt * this.scale;
  }
}
