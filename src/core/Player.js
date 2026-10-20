import * as THREE from 'three';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _move = { x: 0, z: 0 };
const _feet = { x: 0, y: 0, z: 0 };

// Camera in prima persona: sei piccolo e cammini. I piedi poggiano sul pavimento del mondo
// (passerelle, terrazze, canyon, prati di Côtes), gli ostacoli non si attraversano, niente salto né
// volo. Resta il tono onirico: inerzia morbida, respiro, un passo appena accennato.
// (I mondi senza spazio calpestabile usano ancora la vecchia camera fluttuante.)
export class Player {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(); // occhi
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.roll = 0;
    this.speed = 6.0;
    this.slowSpeed = 1.9;
    this.walkSpeed = 5.0;
    this.slowWalk = 1.8;
    this.verticalFactor = 0.6; // solo camera fluttuante: quanto lo sguardo porta su/giù
    this.mouseSensitivity = 0.0019;
    this.padSensitivity = 2.6; // rad/s a levetta piena
    this.accel = 2.4;
    this.lookResponse = 13;
    this.breathAmp = 0.03;
    this.breathPeriod = 4.8;
    this.world = null;
    this.time = Math.random() * 100;
    this.frozen = false;
    this.lookAt = null; // guida dolce dello sguardo (es. all'arrivo in un mondo)
    this.lookAtStrength = 0;
    // corpo
    this.feetY = 0;
    this.eyeHeight = 3.2;
    this.radius = 0.55;
    this.height = 3.6;
    this.stepPhase = 0;
    this.stride = 0;
  }

  setWorld(world) {
    this.world = world;
    this.eyeHeight = world.eyeHeight ?? 3.2;
    this.radius = world.bodyRadius ?? 0.55;
    this.height = world.bodyHeight ?? this.eyeHeight + 0.45;
  }

  get walking() {
    return !!this.world?.walk;
  }

  spawn({ position, yaw = 0, pitch = 0 }) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    this.roll = 0;
    this.stride = 0;
    if (this.walking) {
      // i piedi cercano il pavimento più vicino all'altezza indicata
      _feet.x = position.x;
      _feet.z = position.z;
      _feet.y = position.y - this.eyeHeight;
      const floor = this.world.walk.settle(_feet, this.radius);
      this.feetY = floor ?? _feet.y;
      this.position.set(_feet.x, this.feetY + this.eyeHeight, _feet.z);
    }
    this.applyCamera(0);
  }

  // Ruota dolcemente lo sguardo verso un punto per `seconds` secondi.
  guideLook(point, seconds = 2.5, strength = 2.2) {
    this.lookAt = point.clone();
    this.lookAtTime = seconds;
    this.lookAtStrength = strength;
  }

  update(dt, input, controlsActive = true) {
    this.time += dt;

    if (controlsActive && !this.frozen) {
      const [dx, dy] = input.consumeMouse();
      this.targetYaw -= dx * this.mouseSensitivity;
      this.targetPitch -= dy * this.mouseSensitivity;
      if (input.gamepad.active) {
        // curva sulla levetta destra: piccoli spostamenti precisi per mirare, a fondo corsa si gira svelti
        const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
        this.targetYaw -= curve(input.gamepad.rx) * this.padSensitivity * dt;
        this.targetPitch -= curve(input.gamepad.ry) * this.padSensitivity * 0.8 * dt;
      }
    } else if (!this.frozen) {
      // da fermi (pausa, transizioni) i movimenti del mouse si scartano; se "congelati" li usa il mondo
      input.consumeMouse();
    }

    if (this.lookAt && this.lookAtTime > 0) {
      this.lookAtTime -= dt;
      const d = _desired.subVectors(this.lookAt, this.position);
      const wantYaw = Math.atan2(-d.x, -d.z);
      const wantPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      let dyaw = wantYaw - this.targetYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const k = 1 - Math.exp(-dt * this.lookAtStrength);
      this.targetYaw += dyaw * k;
      this.targetPitch += (wantPitch - this.targetPitch) * k;
      if (this.lookAtTime <= 0) this.lookAt = null;
    }

    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch, -1.3, 1.3);
    const lk = 1 - Math.exp(-dt * this.lookResponse);
    this.yaw += (this.targetYaw - this.yaw) * lk;
    this.pitch += (this.targetPitch - this.pitch) * lk;

    input.moveVector(_move);
    if (!controlsActive || this.frozen) {
      _move.x = 0;
      _move.z = 0;
    }
    if (this.walking) this.walk(dt, input);
    else this.float(dt, input);

    // rollio leggerissimo in base allo spostamento laterale
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const lateral = this.velocity.dot(_right);
    const targetRoll = THREE.MathUtils.clamp(-lateral * 0.008, -0.04, 0.04);
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 3));

    this.applyCamera(dt);
  }

  // ------------------------------------------------------------------ a piedi

  walk(dt, input) {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // avanti e destra sul piano: lo sguardo in alto o in basso non fa volare
    let dx = -sy * _move.z + cy * _move.x;
    let dz = -cy * _move.z - sy * _move.x;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }
    const speed = (input.slow ? this.slowWalk : this.walkSpeed) * (this.world.speedScale ?? 1);
    const ak = 1 - Math.exp(-dt * (len > 0.01 ? 4.2 : 6));
    this.velocity.x += (dx * speed - this.velocity.x) * ak;
    this.velocity.z += (dz * speed - this.velocity.z) * ak;
    this.velocity.y = 0;

    _feet.x = this.position.x + this.velocity.x * dt;
    _feet.z = this.position.z + this.velocity.z * dt;
    _feet.y = this.feetY;
    const floor = this.world.walk.resolve(_feet, this.velocity, this.radius, this.height);
    if (floor !== null) {
      // salire segue in fretta (gradini, ascensore), scendere un po' più morbido
      const k = 1 - Math.exp(-dt * (floor > this.feetY ? 16 : 10));
      this.feetY += (floor - this.feetY) * k;
    }
    this.position.set(_feet.x, this.feetY + this.eyeHeight, _feet.z);

    // passo: un'oscillazione minima legata alla distanza percorsa
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    this.stepPhase += (sp * dt * Math.PI) / Math.max(0.5, this.eyeHeight * 0.85);
    const s = Math.min(1, sp / Math.max(0.1, this.walkSpeed * (this.world.speedScale ?? 1)));
    this.stride += (s - this.stride) * (1 - Math.exp(-dt * 5));
  }

  // ------------------------------------------------------------------ fluttuante (mondi senza pavimento)

  float(dt, input) {
    const cp = Math.cos(this.pitch);
    _fwd.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch) * this.verticalFactor, -Math.cos(this.yaw) * cp);
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const speed = input.slow ? this.slowSpeed : this.speed;
    const speedScale = this.world?.speedScale ?? 1;
    _desired.set(0, 0, 0).addScaledVector(_fwd, _move.z).addScaledVector(_right, _move.x);
    if (_desired.lengthSq() > 1) _desired.normalize();
    _desired.multiplyScalar(speed * speedScale);
    this.velocity.lerp(_desired, 1 - Math.exp(-dt * this.accel));
    this.position.addScaledVector(this.velocity, dt);
    if (this.world?.constrain) this.world.constrain(this.position, this.velocity, dt);
    this.stride = 0;
  }

  applyCamera() {
    const t = this.time;
    const breath = Math.sin((t / this.breathPeriod) * Math.PI * 2);
    const cam = this.camera;
    cam.position.copy(this.position);
    if (this.walking) {
      const bob = this.stride * this.eyeHeight;
      cam.position.y += breath * this.breathAmp * this.eyeHeight * 0.5 + Math.sin(this.stepPhase * 2) * 0.012 * bob;
      cam.position.x += Math.sin(this.stepPhase) * 0.008 * bob * Math.cos(this.yaw);
      cam.position.z -= Math.sin(this.stepPhase) * 0.008 * bob * Math.sin(this.yaw);
    } else {
      const drift = Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.23 + 1.7) * 0.4;
      cam.position.y += breath * 0.045 + drift * 0.03;
      cam.position.x += Math.sin(t * 0.29) * 0.02;
    }
    cam.rotation.set(
      this.pitch + breath * 0.003 + Math.sin(t * 0.41) * 0.0015,
      this.yaw + Math.sin(t * 0.19) * 0.002,
      this.roll + Math.sin(t * 0.31) * 0.003 + Math.sin(this.stepPhase) * 0.0025 * this.stride,
      'YXZ',
    );
  }

  get forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }
}
