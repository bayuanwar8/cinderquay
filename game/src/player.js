// Gunplay movement for CINDERQUAY: a feet-anchored AABB body that accelerates,
// brakes and jumps, resolving one axis at a time against the world's Box3
// colliders so a wall can stop the player without swallowing them.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;
const MAX_FALL = 30;
const EYE_LERP = 12;

// Scratch probe box, reused by every collision test so step() never allocates.
const probe = new THREE.Box3();

function hitsAny(colliders, x, y, z, height, lift) {
  probe.min.set(x - RADIUS, y + lift, z - RADIUS);
  probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
  for (let i = 0; i < colliders.length; i++) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

export function createMover(colliders) {
  const mover = {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    crouching: false,
    onGround: true,
  };

  function step(dt, wishX, wishZ, speed, crouch, jump) {
    // Crouch state: standing back up is refused while the tall body would
    // intersect something overhead.
    if (crouch && !mover.crouching) {
      mover.crouching = true;
      mover.height = CROUCH_HEIGHT;
    } else if (!crouch && mover.crouching) {
      if (!hitsAny(colliders, mover.pos.x, mover.pos.y, mover.pos.z, STAND_HEIGHT, 0.02)) {
        mover.crouching = false;
        mover.height = STAND_HEIGHT;
      }
    }
    const eyeTarget = mover.crouching ? CROUCH_EYE : STAND_EYE;
    mover.eye += (eyeTarget - mover.eye) * Math.min(1, dt * EYE_LERP);

    // Horizontal drive: accelerate toward the wish velocity, brake with
    // friction when there is no wish and the feet are on the ground.
    const accel = mover.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const targetX = wishX * speed;
    const targetZ = wishZ * speed;
    const stepX = accel * dt;
    mover.vel.x += Math.max(-stepX, Math.min(stepX, targetX - mover.vel.x));
    mover.vel.z += Math.max(-stepX, Math.min(stepX, targetZ - mover.vel.z));
    if (mover.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      mover.vel.x *= damp;
      mover.vel.z *= damp;
    }

    if (jump && mover.onGround) {
      mover.vel.y = JUMP_SPEED;
      mover.onGround = false;
    }
    mover.vel.y = Math.max(-MAX_FALL, mover.vel.y - GRAVITY * dt);

    // Resolve X, then Z, then Y. The small lift keeps the floor (and the
    // ground plane itself) out of the horizontal tests.
    const nextX = mover.pos.x + mover.vel.x * dt;
    if (!hitsAny(colliders, nextX, mover.pos.y, mover.pos.z, mover.height, 0.04)) {
      mover.pos.x = nextX;
    } else {
      mover.vel.x = 0;
    }
    const nextZ = mover.pos.z + mover.vel.z * dt;
    if (!hitsAny(colliders, mover.pos.x, mover.pos.y, nextZ, mover.height, 0.04)) {
      mover.pos.z = nextZ;
    } else {
      mover.vel.z = 0;
    }

    mover.pos.y += mover.vel.y * dt;
    mover.onGround = false;
    const floor = hitsAny(colliders, mover.pos.x, mover.pos.y, mover.pos.z, mover.height, 0);
    if (floor && mover.vel.y <= 0) {
      mover.pos.y = floor.max.y;
      mover.vel.y = 0;
      mover.onGround = true;
    } else if (floor) {
      mover.pos.y = floor.min.y - mover.height;
      mover.vel.y = 0;
    }
    if (mover.pos.y < 0) {
      mover.pos.y = 0;
      mover.vel.y = 0;
      mover.onGround = true;
    }
  }

  mover.step = step;
  return mover;
}

export function createPlayer(colliders) {
  const mover = createMover(colliders);

  function look(dx, dy) {
    mover.yaw -= dx * 0.0022;
    mover.pitch = Math.max(-1.45, Math.min(1.45, mover.pitch - dy * 0.0022));
  }

  function recoil(pitchKick, yawKick) {
    mover.pitch = Math.max(-1.45, Math.min(1.45, mover.pitch + pitchKick));
    mover.yaw += yawKick;
  }

  function groundSpeed() {
    return Math.hypot(mover.vel.x, mover.vel.z);
  }

  return { mover, look, recoil, groundSpeed, state: mover };
}
