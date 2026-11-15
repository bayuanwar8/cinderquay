// grenades.js — HE / smoke throws for CINDERQUAY.
// Owns: throwing a grenade, its ballistic flight + bounce, the fuse,
// and the detonation hooks (HE blast damage + explosion, smoke cloud).
// No flash grenade here — that is a later workstream's job.
import * as THREE from 'three';
import { GRENADES } from './weapons.js';
import { damageAgent } from './state.js';

const THROW_SPEED = 14;
const GRENADE_GRAVITY = 20;
const BOUNCE_KEEP = 0.4;
const REST_SPEED = 0.8;

// Scratch objects reused by the throw/step calls — nothing here is
// allocated inside a per-frame call (except the fresh velocity vector
// of a throw, which must never be shared scratch).
const rayDir = new THREE.Vector3();
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();

export function throwGrenade(state, from, dir, kind, effects) {
  if (!state.grenades) state.grenades = [];
  rayDir.copy(dir).normalize();
  state.grenades.push({
    kind,
    pos: from.clone(),
    // A throw is a rare event, so a fresh vector here is fine; the shared
    // scratch vector must never be stored, or the next throw would rewrite
    // this grenade's velocity.
    vel: new THREE.Vector3().copy(rayDir).multiplyScalar(THROW_SPEED),
    fuse: GRENADES[kind].fuse,
  });
}

export function stepGrenades(state, dt, world, effects, audio) {
  if (!state.grenades || state.grenades.length === 0) return;
  const colliders = world.colliders;
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vel.y -= GRENADE_GRAVITY * dt;
    g.pos.addScaledVector(g.vel, dt);

    // Bounce off the ground plane.
    if (g.pos.y < 0) {
      g.pos.y = 0;
      g.vel.y = Math.abs(g.vel.y) > 1 ? -g.vel.y * BOUNCE_KEEP : 0;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }

    // Bounce off world colliders: find the shallowest penetration axis and
    // reflect that velocity component, scaled down.
    for (let c = 0; c < colliders.length; c++) {
      const box3 = colliders[c];
      if (
        g.pos.x > box3.min.x - 0.05 && g.pos.x < box3.max.x + 0.05 &&
        g.pos.y > box3.min.y - 0.05 && g.pos.y < box3.max.y + 0.05 &&
        g.pos.z > box3.min.z - 0.05 && g.pos.z < box3.max.z + 0.05
      ) {
        const dxMin = g.pos.x - (box3.min.x - 0.05);
        const dxMax = (box3.max.x + 0.05) - g.pos.x;
        const dyMin = g.pos.y - (box3.min.y - 0.05);
        const dyMax = (box3.max.y + 0.05) - g.pos.y;
        const dzMin = g.pos.z - (box3.min.z - 0.05);
        const dzMax = (box3.max.z + 0.05) - g.pos.z;
        const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
        if (m === dxMin) { g.pos.x = box3.min.x - 0.05; g.vel.x = -Math.abs(g.vel.x) * BOUNCE_KEEP; }
        else if (m === dxMax) { g.pos.x = box3.max.x + 0.05; g.vel.x = Math.abs(g.vel.x) * BOUNCE_KEEP; }
        else if (m === dyMin) { g.pos.y = box3.min.y - 0.05; g.vel.y = -Math.abs(g.vel.y) * BOUNCE_KEEP; }
        else if (m === dyMax) { g.pos.y = box3.max.y + 0.05; g.vel.y = Math.abs(g.vel.y) * BOUNCE_KEEP; }
        else if (m === dzMin) { g.pos.z = box3.min.z - 0.05; g.vel.z = -Math.abs(g.vel.z) * BOUNCE_KEEP; }
        else { g.pos.z = box3.max.z + 0.05; g.vel.z = Math.abs(g.vel.z) * BOUNCE_KEEP; }
      }
    }

    // Rolling to rest: below the speed cut the projectile stops dead.
    if (g.vel.lengthSq() < REST_SPEED * REST_SPEED) g.vel.set(0, 0, 0);

    if (g.fuse > 0) continue;

    if (g.kind === 'he') {
      const def = GRENADES.he;
      scratchB.copy(g.pos);
      for (let a = 0; a < state.agents.length; a++) {
        const target = state.agents[a];
        if (!target.alive) continue;
        const dist = scratchA.copy(target.pos).distanceTo(scratchB);
        if (dist > def.radius) continue;
        const amount = Math.round(def.maxDamage * (1 - dist / def.radius));
        if (amount > 0) damageAgent(state, target, amount, false, null);
      }
      effects.addExplosion(g.pos);
      if (audio && audio.explosion) {
        const playerPos = state.agents && state.agents[0] ? state.agents[0].pos : g.pos;
        audio.explosion(scratchA.copy(g.pos).distanceTo(playerPos));
      }
    } else if (g.kind === 'flash') {
      // Blinding pop: strength falls off with distance and only bites
      // agents facing the flash; looking away leaves a faint glint.
      // Sets flashUntil / flashStrength on each caught agent — the player
      // reads those for the white overlay + accuracy penalty in main.js,
      // bots read them to stop firing and turn away in bots.js.
      const def = GRENADES.flash;
      for (let a = 0; a < state.agents.length; a++) {
        const target = state.agents[a];
        if (!target || !target.alive) continue;
        const dx = g.pos.x - target.pos.x;
        const dz = g.pos.z - target.pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > def.radius) continue;
        // Facing: yaw 0 looks along -z, so forward = (-sin yaw, -cos yaw).
        const fx = -Math.sin(target.yaw || 0);
        const fz = -Math.cos(target.yaw || 0);
        const len = Math.max(0.001, Math.hypot(dx, dz));
        const facing = (dx * fx + dz * fz) / len;
        const falloff = 1 - dist / def.radius;
        const strength = facing > 0.1
          ? Math.min(1, 0.35 + 0.65 * falloff)
          : 0.2;
        target.flashUntil = state.time + def.duration * strength;
        target.flashStrength = strength;
      }
      if (effects && effects.addImpact) effects.addImpact(g.pos, 0xffffff);
    } else {
      const def = GRENADES.smoke;
      effects.addSmoke(g.pos, def.radius, def.duration);
      if (!state.smoke) state.smoke = [];
      state.smoke.push({ pos: g.pos.clone(), radius: def.radius, until: state.time + def.duration });
    }
    state.grenades.splice(i, 1);
  }
}
