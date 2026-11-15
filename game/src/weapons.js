// CINDERQUAY weapons: the arsenal table, first-person view models, hitscan
// and grenade projectiles. Ammo lives per weapon so switching keeps each
// gun's magazine and reserve exactly as it was left.
import * as THREE from 'three';
import { damageAgent } from './state.js';

export const WEAPONS = {
  pistol: { name: 'P9 Sidearm', price: 0, damage: 26, headMult: 4, mag: 12, reserve: 36, fireGap: 0.18, auto: false, reloadTime: 1.4, spreadStill: 0.004, spreadMove: 0.030, spreadAir: 0.05, recoilPitch: 0.006, recoilYaw: 0.003, range: 60, pellets: 1, zoom: 1 },
  rifle: { name: 'KR-47 Emberline', price: 2700, damage: 30, headMult: 4, mag: 30, reserve: 90, fireGap: 0.11, auto: true, reloadTime: 2.0, spreadStill: 0.003, spreadMove: 0.032, spreadAir: 0.06, recoilPitch: 0.011, recoilYaw: 0.005, range: 80, pellets: 1, zoom: 1 },
  smg: { name: 'Vex-9', price: 1500, damage: 22, headMult: 4, mag: 32, reserve: 96, fireGap: 0.075, auto: true, reloadTime: 1.7, spreadStill: 0.006, spreadMove: 0.040, spreadAir: 0.07, recoilPitch: 0.007, recoilYaw: 0.004, range: 55, pellets: 1, zoom: 1 },
  sniper: { name: 'Longshore 88', price: 4200, damage: 88, headMult: 4, mag: 5, reserve: 15, fireGap: 1.10, auto: false, reloadTime: 2.8, spreadStill: 0.0005, spreadMove: 0.090, spreadAir: 0.12, recoilPitch: 0.030, recoilYaw: 0.010, range: 120, pellets: 1, zoom: 2.4 },
  shotgun: { name: 'Dockbreaker 12', price: 1900, damage: 9, headMult: 2, mag: 6, reserve: 18, fireGap: 0.80, auto: false, reloadTime: 2.6, spreadStill: 0.050, spreadMove: 0.070, spreadAir: 0.09, recoilPitch: 0.020, recoilYaw: 0.008, range: 30, pellets: 8, zoom: 1 },
};

export const GRENADES = {
  he: { name: 'Blast charge', price: 300, radius: 6, maxDamage: 90, fuse: 1.2 },
  smoke: { name: 'Haze canister', price: 250, radius: 4.5, duration: 8, fuse: 1.0 },
};

const MUZZLE_TIME = 0.06;
const THROW_SPEED = 14;
const GRENADE_GRAVITY = 20;
const BOUNCE_KEEP = 0.4;
const REST_SPEED = 0.8;
const MOVE_REFERENCE = 5.2;

// Scratch objects reused by hitscan and grenade stepping — nothing here is
// allocated inside a per-frame call.
const ray = new THREE.Raycaster();
const rayDir = new THREE.Vector3();
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const liveHitMeshes = [];

function box(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

export function createWeaponRig(camera) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.55, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.8, metalness: 0.2 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.75, metalness: 0.05 });
  const ember = new THREE.MeshStandardMaterial({ color: 0xff8c2e, roughness: 0.5, metalness: 0.3 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x2ec4b6, roughness: 0.5, metalness: 0.3 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc99a2e, roughness: 0.4, metalness: 0.7 });

  // One low-poly assembly per weapon, each with its own silhouette: the
  // pistol is short and flat, the rifle long with a wooden stock and amber
  // stripe, the SMG stubby with a teal grip and suppressor, the sniper the
  // longest with a scope and brass ring, the shotgun fat with a wide pump.
  const models = {};
  const muzzleZ = {};

  const pistol = new THREE.Group();
  pistol.add(box(0.05, 0.07, 0.26, steel, 0, 0.01, -0.08));
  pistol.add(box(0.045, 0.09, 0.05, dark, 0, -0.05, 0.04));
  pistol.add(box(0.02, 0.02, 0.06, brass, 0, 0.05, -0.2));
  models.pistol = pistol;
  muzzleZ.pistol = -0.24;

  const rifle = new THREE.Group();
  rifle.add(box(0.07, 0.09, 0.5, steel, 0, 0, -0.1));
  rifle.add(box(0.04, 0.04, 0.42, dark, 0, 0.02, -0.5));
  rifle.add(box(0.06, 0.08, 0.24, wood, 0, -0.01, 0.26));
  rifle.add(box(0.075, 0.015, 0.3, ember, 0, 0.052, -0.1));
  rifle.add(box(0.05, 0.12, 0.04, dark, 0, -0.08, -0.02));
  rifle.add(box(0.03, 0.03, 0.1, dark, 0, 0.06, -0.3));
  models.rifle = rifle;
  muzzleZ.rifle = -0.74;

  const smg = new THREE.Group();
  smg.add(box(0.07, 0.08, 0.3, dark, 0, 0, -0.02));
  smg.add(box(0.055, 0.055, 0.2, teal, 0, 0.01, -0.28));
  smg.add(box(0.05, 0.11, 0.05, teal, 0, -0.07, 0.02));
  smg.add(box(0.04, 0.04, 0.16, steel, 0, 0, 0.16));
  smg.add(box(0.02, 0.05, 0.02, brass, 0, 0.06, -0.14));
  models.smg = smg;
  muzzleZ.smg = -0.4;

  const sniper = new THREE.Group();
  sniper.add(box(0.06, 0.08, 0.55, steel, 0, 0, -0.05));
  sniper.add(box(0.035, 0.035, 0.5, dark, 0, 0.015, -0.55));
  sniper.add(box(0.05, 0.05, 0.2, dark, 0, 0.065, -0.12));
  sniper.add(box(0.012, 0.05, 0.2, brass, 0, 0.065, -0.12));
  sniper.add(box(0.06, 0.09, 0.26, wood, 0, -0.01, 0.32));
  sniper.add(box(0.05, 0.02, 0.08, dark, 0, 0, 0.48));
  models.sniper = sniper;
  muzzleZ.sniper = -0.82;

  const shotgun = new THREE.Group();
  shotgun.add(box(0.09, 0.1, 0.42, dark, 0, 0, -0.06));
  shotgun.add(box(0.07, 0.07, 0.34, wood, 0, -0.045, -0.34));
  shotgun.add(box(0.055, 0.055, 0.44, steel, 0, 0.02, -0.42));
  shotgun.add(box(0.08, 0.09, 0.2, wood, 0, -0.01, 0.26));
  shotgun.add(box(0.02, 0.02, 0.3, brass, 0.055, 0.02, -0.2));
  models.shotgun = shotgun;
  muzzleZ.shotgun = -0.66;

  for (const id of Object.keys(models)) {
    models[id].position.set(0.24, -0.2, -0.42);
    models[id].visible = false;
    camera.add(models[id]);
  }

  // Grenade held in hand: a dark sphere with a pin ring, shown by grenadeOut.
  const grenadeMesh = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.6, metalness: 0.4 }),
  );
  const pin = new THREE.Mesh(
    new THREE.TorusGeometry(0.02, 0.005, 6, 12),
    brass,
  );
  pin.position.set(0.04, 0.05, 0);
  grenadeMesh.add(shell, pin);
  grenadeMesh.position.set(0.24, -0.2, -0.42);
  grenadeMesh.visible = false;
  camera.add(grenadeMesh);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(0xffb347, 0, 6);
  camera.add(flashLight);

  const ammo = {};
  for (const id of Object.keys(WEAPONS)) {
    ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }

  const state = {
    weaponId: 'pistol',
    mag: ammo.pistol.mag,
    reserve: ammo.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    kick: 0,
    flash: 0,
  };
  models.pistol.visible = true;

  function placeFlash() {
    const z = -0.42 + muzzleZ[state.weaponId] - 0.06;
    flash.position.set(0.24, -0.18, z);
    flashLight.position.set(0.24, -0.16, z + 0.3);
  }
  placeFlash();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.weaponId];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    if (state.flash > 0) flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const w = WEAPONS[state.weaponId];
      const dip = Math.sin(Math.min(1, (w.reloadTime - state.reloadLeft) / w.reloadTime) * Math.PI);
      model.rotation.x = -0.55 * dip;
      model.position.y = -0.2 - 0.12 * dip;
      if (state.reloadLeft === 0) {
        const need = w.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        ammo[state.weaponId].mag = state.mag;
        ammo[state.weaponId].reserve = state.reserve;
        model.rotation.x = 0;
        model.position.y = -0.2;
      }
    }
  }

  function equip(id) {
    if (!WEAPONS[id] || id === state.weaponId) return;
    ammo[state.weaponId].mag = state.mag;
    ammo[state.weaponId].reserve = state.reserve;
    models[state.weaponId].visible = false;
    state.weaponId = id;
    state.mag = ammo[id].mag;
    state.reserve = ammo[id].reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.kick = 0;
    state.flash = 0;
    grenadeMesh.visible = false;
    models[id].visible = true;
    placeFlash();
  }

  function ready() {
    return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
  }

  function takeRound() {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    ammo[state.weaponId].mag = state.mag;
    return true;
  }

  function reload() {
    const w = WEAPONS[state.weaponId];
    if (state.reloadLeft > 0 || state.mag === w.mag || state.reserve === 0) return;
    state.reloadLeft = w.reloadTime;
  }

  // Moving and airborne fire is punished hard; crouching steadies the aim.
  function spreadOf(speed, airborne, crouching) {
    const w = WEAPONS[state.weaponId];
    if (airborne) return w.spreadAir;
    const moveFrac = Math.min(1, speed / MOVE_REFERENCE);
    let spread = w.spreadStill + moveFrac * (w.spreadMove - w.spreadStill);
    if (crouching) spread *= 0.7;
    return spread;
  }

  function pullTrigger() {
    const w = WEAPONS[state.weaponId];
    state.cooldown = w.fireGap;
    state.flash = MUZZLE_TIME;
    state.kick = 0.03 + w.recoilPitch * 2;
  }

  function grenadeOut(id) {
    models[state.weaponId].visible = false;
    grenadeMesh.visible = true;
    const mat = shell.material;
    mat.color.set(id === 'smoke' ? 0x4a5560 : 0x2e4a2e);
  }

  return { state, ammo, step, equip, ready, takeRound, reload, spreadOf, pullTrigger, grenadeOut };
}

export function hitscan(origin, dir, range, shootables, agents) {
  rayDir.copy(dir).normalize();
  ray.set(origin, rayDir);
  ray.far = range;

  let wallHit = null;
  if (shootables && shootables.length > 0) {
    const wallHits = ray.intersectObjects(shootables, false);
    if (wallHits.length > 0) {
      wallHit = { wall: true, point: wallHits[0].point, distance: wallHits[0].distance };
    }
  }

  liveHitMeshes.length = 0;
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (!agent.alive || !agent.hitMeshes) continue;
    for (let j = 0; j < agent.hitMeshes.length; j++) {
      liveHitMeshes.push(agent.hitMeshes[j]);
    }
  }
  let agentHit = null;
  if (liveHitMeshes.length > 0) {
    const hits = ray.intersectObjects(liveHitMeshes, false);
    if (hits.length > 0) {
      const hit = hits[0];
      agentHit = {
        agent: hit.object.userData.agent,
        part: hit.object.userData.part,
        point: hit.point,
        distance: hit.distance,
      };
    }
  }

  if (agentHit && (!wallHit || agentHit.distance < wallHit.distance)) return agentHit;
  if (wallHit) return wallHit;
  return null;
}

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
    } else {
      const def = GRENADES.smoke;
      effects.addSmoke(g.pos, def.radius, def.duration);
      if (!state.smoke) state.smoke = [];
      state.smoke.push({ pos: g.pos.clone(), radius: def.radius, until: state.time + def.duration });
    }
    state.grenades.splice(i, 1);
  }
}
