// CINDERQUAY weapons: the arsenal table and hitscan. Ammo lives per
// weapon so switching keeps each gun's magazine and reserve exactly as
// it was left. The first-person rig lives in viewmodel.js, grenades in
// grenades.js.
import * as THREE from 'three';

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
  // Flash burst: no damage. Anyone inside the radius who is facing the
  // pop is blinded — full whiteout up close, weaker at the edge; a target
  // looking away only catches a glint. Duration scales with strength.
  flash: { name: 'Flash burst', price: 200, radius: 14, duration: 2.2, fuse: 1.0 },
};

// Scratch objects reused by hitscan — nothing here is allocated inside
// a per-frame call.
const ray = new THREE.Raycaster();
const rayDir = new THREE.Vector3();
const liveHitMeshes = [];

// `exclude` (the shooter) is never a valid hit: the ray starts at the
// shooter's eye, which sits essentially on the surface of his own head
// hit-sphere (lean + bob + sway move the head ~0.15 m from the eye,
// the head radius is 0.15) — so on some walk poses the outgoing ray
// front-face-hits his own head at ~0.002 m and he one-shots himself
// (v3 regression from the stronger walk animation; v2's smaller
// lean/bob/sway kept the eye safely inside the sphere). Excluding the
// shooter restores v2 behaviour: a shooter's own meshes were never a
// legit hit there (backface-culled), so no real shot changes.
export function hitscan(origin, dir, range, shootables, agents, exclude) {
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
    if (exclude && agent === exclude) continue; // never shoot yourself
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
