// CINDERQUAY pooled effects: tracers, impact sparks, explosions and smoke
// clouds. Every mesh, material and light is created once up front and handed
// out round-robin; step() only moves and fades what is already alive, so the
// render path never allocates.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_SPARKS = 16;
const MAX_EXPLOSIONS = 4;
const MAX_SMOKE = 4;
const SPHERES_PER_CLOUD = 5;
const TRACER_LIFE = 0.06;
const SPARK_LIFE = 0.15;
const EXPLOSION_LIFE = 0.5;

// Scratch vectors reused by addTracer / addSmoke — no allocation in step().
const mid = new THREE.Vector3();
const dir = new THREE.Vector3();

export function createEffects(scene) {
  // Running clock, refreshed by step(t) so addSmoke can stamp a cloud's
  // expiry at once even though its signature carries no time argument.
  let clock = 0;

  // --- Tracers: thin stretched boxes, additive, one material each so the
  // colour can be set per shot without touching a shared material. ---
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 1),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  // --- Impact sparks: small bright boxes that fly out and die fast. ---
  const sparks = [];
  for (let i = 0; i < MAX_SPARKS; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.03, 0.03),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, vel: new THREE.Vector3() });
  }
  let sparkNext = 0;

  // --- Explosions: an expanding sphere plus a point light, 0.5 s each. ---
  const explosions = [];
  for (let i = 0; i < MAX_EXPLOSIONS; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    const light = new THREE.PointLight(0xff7a2f, 0, 14);
    scene.add(light);
    explosions.push({ mesh, light, life: 0 });
  }
  let explosionNext = 0;

  // --- Smoke clouds: 4 clouds of 5 translucent spheres each. ---
  const smokeClouds = [];
  const smokePuffs = [];
  for (let i = 0; i < MAX_SMOKE; i++) {
    const cloud = { pos: new THREE.Vector3(), radius: 4.5, until: 0 };
    smokeClouds.push(cloud);
    const puffs = [];
    for (let j = 0; j < SPHERES_PER_CLOUD; j++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x9a938a, transparent: true, opacity: 0.28, depthWrite: false }),
      );
      mesh.visible = false;
      scene.add(mesh);
      // Fixed offsets inside the cloud so the puffs keep their shape.
      puffs.push({
        mesh,
        off: new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.5 + 0.3, (Math.random() - 0.5) * 1.2),
        size: 0.55 + Math.random() * 0.5,
      });
    }
    smokePuffs.push(puffs);
  }
  let smokeNext = 0;

  function addTracer(from, to, color) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % MAX_TRACERS;
    mid.addVectors(from, to).multiplyScalar(0.5);
    dir.subVectors(to, from);
    const len = dir.length();
    t.mesh.position.copy(mid);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, Math.max(0.01, len));
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = TRACER_LIFE;
  }

  function addImpact(point, color) {
    const s = sparks[sparkNext];
    sparkNext = (sparkNext + 1) % MAX_SPARKS;
    s.mesh.position.copy(point);
    s.mesh.material.color.set(color);
    s.mesh.material.opacity = 1;
    s.mesh.visible = true;
    // Visual-only jitter: it cannot change gameplay.
    s.vel.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5)
      .normalize().multiplyScalar(2.5);
    s.life = SPARK_LIFE;
  }

  function addExplosion(point) {
    const e = explosions[explosionNext];
    explosionNext = (explosionNext + 1) % MAX_EXPLOSIONS;
    e.mesh.position.copy(point);
    e.mesh.scale.setScalar(0.3);
    e.mesh.material.opacity = 0.8;
    e.mesh.visible = true;
    e.light.position.copy(point);
    e.light.intensity = 40;
    e.life = EXPLOSION_LIFE;
  }

  function addSmoke(point, radius, duration) {
    const cloud = smokeClouds[smokeNext];
    const puffs = smokePuffs[smokeNext];
    smokeNext = (smokeNext + 1) % MAX_SMOKE;
    cloud.pos.copy(point);
    cloud.radius = radius;
    cloud.until = clock + duration;
    for (let j = 0; j < puffs.length; j++) {
      const p = puffs[j];
      p.mesh.position.copy(point).addScaledVector(p.off, radius * 0.6);
      p.mesh.scale.setScalar(radius * p.size);
      p.mesh.material.opacity = 0.28;
      p.mesh.visible = true;
    }
  }

  function step(dt, t) {
    clock = t;
    for (let i = 0; i < tracers.length; i++) {
      const tr = tracers[i];
      if (tr.life <= 0) continue;
      tr.life -= dt;
      if (tr.life <= 0) {
        tr.mesh.visible = false;
      } else {
        tr.mesh.material.opacity = 0.9 * (tr.life / TRACER_LIFE);
      }
    }

    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.y -= 4 * dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
      } else {
        s.mesh.material.opacity = s.life / SPARK_LIFE;
      }
    }

    for (let i = 0; i < explosions.length; i++) {
      const e = explosions[i];
      if (e.life <= 0) continue;
      e.life -= dt;
      const age = 1 - e.life / EXPLOSION_LIFE;
      if (e.life <= 0) {
        e.mesh.visible = false;
        e.light.intensity = 0;
      } else {
        e.mesh.scale.setScalar(0.3 + age * 3.2);
        e.mesh.material.opacity = 0.8 * (1 - age);
        e.light.intensity = 40 * (1 - age);
      }
    }

    for (let i = 0; i < smokeClouds.length; i++) {
      const cloud = smokeClouds[i];
      const puffs = smokePuffs[i];
      if (t >= cloud.until) {
        for (let j = 0; j < puffs.length; j++) puffs[j].mesh.visible = false;
        continue;
      }
      // Fade out over the last second of the cloud's life.
      const remain = cloud.until - t;
      const opacity = remain < 1 ? 0.28 * remain : 0.28;
      for (let j = 0; j < puffs.length; j++) {
        puffs[j].mesh.material.opacity = opacity;
      }
    }
  }

  return { smokeClouds, addTracer, addImpact, addExplosion, addSmoke, step };
}
