// bots.js — the 9 bot teammates/opponents of CINDERQUAY.
// Builds low-poly humanoid meshes, runs the per-bot brain (push / hold /
// engage / plant / defuse / retreat / dead) and fires hitscan shots through
// weapons.js. All gameplay randomness goes through state.rng.
// Movement collision is shared with the player via createMover.

import * as THREE from 'three';
import { createMover } from './player.js';
import { WEAPONS, hitscan, throwGrenade } from './weapons.js';
import { PALETTE } from './palette.js';
import { damageAgent, aliveAgents } from './state.js';

const EMBER_NAMES = ['Ash', 'Coal', 'Rust', 'Soot'];
const TIDE_NAMES = ['Brine', 'Kelp', 'Fathom', 'Salter', 'Marrow'];

const BOT_SPEED = 4.2;
const BOT_CROUCH_SPEED = 3.0;
const EYE_STAND = 1.6;
const LOS_HZ = 5; // perception throttle, checks per second per bot
const HEAR_RADIUS = 25;
const PICKUP_RADIUS = 1.5;
const REACT_MIN = 0.35;
const REACT_MAX = 0.7;
const AIM_ERR_MIN = 2; // degrees
const AIM_ERR_MAX = 4;
const ENGAGE_RANGE = 48;
const FALL_TIME = 0.4; // seconds for the death fall-over

// Module-level scratch only — nothing is allocated inside step().
const _eye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _boxHit = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function randRange(rng, a, b) {
  return a + rng() * (b - a);
}

function clampAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Angle from `from` to `to` on the ground plane, as a yaw (0 = facing -z).
function yawTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

function dist2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Breadth-first search over world.waypoints. `queue`, `came` and `seen`
// are reused scratch arrays owned by the caller. Returns a list of
// waypoint ids from start to goal (inclusive), or null when unreachable.
function bfsPath(waypoints, startId, goalId, queue, came, seen) {
  if (startId === goalId) return [goalId];
  queue.length = 0;
  came.length = 0;
  seen.length = 0;
  for (let i = 0; i < waypoints.length; i++) {
    came.push(-1);
    seen.push(false);
  }
  queue.push(startId);
  seen[startId] = true;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goalId) break;
    const node = waypoints[cur];
    if (!node) continue;
    for (let i = 0; i < node.neighbors.length; i++) {
      const nb = node.neighbors[i];
      if (!seen[nb]) {
        seen[nb] = true;
        came[nb] = cur;
        queue.push(nb);
      }
    }
  }
  if (!seen[goalId]) return null;
  const path = [];
  let cur = goalId;
  while (cur !== -1) {
    path.push(cur);
    cur = came[cur];
  }
  path.reverse();
  return path;
}

function nearestWaypoint(waypoints, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// True when the segment from `a` to `b` passes within `radius` of `centre`.
function segmentHitsSphere(a, b, centre, radius) {
  _segA.subVectors(b, a);
  const len2 = _segA.lengthSq();
  if (len2 === 0) return a.distanceTo(centre) <= radius;
  let t = _closest.subVectors(centre, a).dot(_segA) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  _closest.copy(a).addScaledVector(_segA, t);
  return _closest.distanceTo(centre) <= radius;
}

export function createBots(scene, world, state) {
  const rng = state.rng;
  const waypoints = world.waypoints;
  const colliders = world.colliders;

  // BFS scratch, shared by all bots (paths are planned one at a time).
  const bfsQueue = [];
  const bfsCame = [];
  const bfsSeen = [];

  const agents = [];
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x23211f });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x191919 });

  function teamMaterial(team) {
    return new THREE.MeshLambertMaterial({
      color: team === 'ember' ? PALETTE.ember : PALETTE.tide,
    });
  }

  // --- mesh + agent construction -------------------------------------------
  function buildBot(id, name, team, spawn) {
    const bodyMat = teamMaterial(team);
    const group = new THREE.Group();

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), bodyMat);
    torso.position.y = 1.08;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), bodyMat);
    head.position.y = 1.58;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), darkMat);
    legL.position.set(-0.14, 0.31, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), darkMat);
    legR.position.set(0.14, 0.31, 0);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.16), bodyMat);
    armL.position.set(-0.34, 1.12, -0.06);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.16), bodyMat);
    armR.position.set(0.34, 1.12, -0.06);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), gunMat);
    gun.position.set(0.18, 1.18, -0.28); // forward is -z at yaw 0, so the barrel points ahead

    group.add(torso, head, legL, legR, armL, armR, gun);
    group.position.set(spawn.x, 0, spawn.z);
    scene.add(group);

    const mover = createMover(colliders);
    mover.pos.set(spawn.x, 0, spawn.z);

    const agent = {
      id,
      team,
      isPlayer: false,
      name,
      pos: mover.pos,
      vel: mover.vel,
      yaw: team === 'ember' ? 0 : Math.PI, // ember faces north (-z), tide faces south (+z)
      pitch: 0,
      hp: 100,
      armor: 0,
      alive: true,
      weaponId: 'pistol',
      mag: 12,
      reserve: 36,
      grenades: { he: 0, smoke: 0 },
      money: 800,
      kills: 0,
      deaths: 0,
      mover,
      mesh: group,
      hitMeshes: [],
      ai: null,
      crouching: false,
      onGround: true,
    };
    agent.mover.yaw = agent.yaw;
    torso.userData = { agent, part: 'torso' };
    head.userData = { agent, part: 'head' };
    agent.hitMeshes = [torso, head];
    agent.ai = {
      state: 'hold', // push | hold | engage | plant | defuse | retreat | dead
      lane: 'mid', // assigned lane: 'A' | 'B' | 'mid'
      site: null, // assigned site for attackers
      path: null, // waypoint ids
      pathIdx: 0,
      holdWp: 0,
      scanYaw: 0,
      target: null,
      losTimer: randRange(rng, 0, 1 / LOS_HZ),
      hasLos: false,
      seenAt: -1, // state.time when the target was first seen
      reactAt: -1, // state.time when the bot may open fire
      burstLeft: 0,
      burstPause: 0,
      fireTimer: 0,
      reloadLeft: 0,
      lastHeard: null, // { x, z } of a heard shot, or null
      hearWp: -1,
      strafeDir: 1,
      strafeTimer: 0,
      walkPhase: 0,
      fallT: 0,
      grenadeThrown: false,
      grenadeTimer: randRange(rng, 6, 14),
      parts: { torso, head, legL, legR, armL, armR, gun },
    };
    return agent;
  }

  // ids 1-4: Ember bots (player is id 0, fifth Ember). ids 5-9: Tide bots.
  for (let i = 0; i < 4; i++) {
    const spawn = world.spawns.ember[i + 1] || world.spawns.ember[0];
    agents.push(buildBot(i + 1, EMBER_NAMES[i], 'ember', spawn));
  }
  for (let i = 0; i < 5; i++) {
    const spawn = world.spawns.tide[i] || world.spawns.tide[0];
    agents.push(buildBot(i + 5, TIDE_NAMES[i], 'tide', spawn));
  }
  for (const a of agents) state.agents.push(a);

  // --- waypoint helpers ------------------------------------------------------
  function siteWaypoints(site) {
    const s = world.sites[site];
    const out = [];
    for (const w of waypoints) {
      if (dist2d(w.x, w.z, s.x, s.z) < 7) out.push(w.id);
    }
    return out;
  }

  function laneWaypoints(lane) {
    const out = [];
    for (const w of waypoints) {
      if (lane === 'A' && w.x < -12) out.push(w.id);
      else if (lane === 'B' && w.x > 12) out.push(w.id);
      else if (lane === 'mid' && Math.abs(w.x) <= 12) out.push(w.id);
    }
    return out;
  }

  function planTo(agent, goalWp) {
    const from = nearestWaypoint(waypoints, agent.pos.x, agent.pos.z);
    const path = bfsPath(waypoints, from, goalWp, bfsQueue, bfsCame, bfsSeen);
    if (path) {
      agent.ai.path = path;
      agent.ai.pathIdx = 0;
      return true;
    }
    agent.ai.path = null;
    return false;
  }

  function planToSite(agent, site) {
    const spots = siteWaypoints(site);
    if (!spots.length) return false;
    const pick = spots[Math.floor(rng() * spots.length)];
    return planTo(agent, pick);
  }

  function planToLane(agent, lane) {
    const nodes = laneWaypoints(lane);
    if (!nodes.length) return false;
    // Walk to the far end of the lane for attackers (north, -z); defenders
    // hold the mid node nearest the north connector (z = -6).
    let goal = nodes[0];
    let best = -Infinity;
    for (const id of nodes) {
      const w = waypoints[id];
      const score = agent.team === state.attackSide ? -w.z : -Math.abs(w.z + 6);
      if (score > best) {
        best = score;
        goal = id;
      }
    }
    return planTo(agent, goal);
  }

  // --- perception ------------------------------------------------------------
  function losBlocked(from, to, effects) {
    _dir.subVectors(to, from);
    const dist = _dir.length();
    if (dist < 0.001) return false;
    _dir.divideScalar(dist);
    _ray.set(from, _dir);
    _ray.far = dist;
    for (let i = 0; i < colliders.length; i++) {
      if (_ray.ray.intersectBox(colliders[i], _boxHit) !== null) {
        if (_boxHit.distanceTo(from) < dist - 0.05) return true;
      }
    }
    if (effects && effects.smokeClouds) {
      for (let i = 0; i < effects.smokeClouds.length; i++) {
        const c = effects.smokeClouds[i];
        if (segmentHitsSphere(from, to, c.pos, c.radius)) return true;
      }
    }
    return false;
  }

  function canSee(agent, target, effects) {
    _eye.set(agent.pos.x, agent.pos.y + EYE_STAND, agent.pos.z);
    _targetEye.set(target.pos.x, target.pos.y + 1.35, target.pos.z);
    return !losBlocked(_eye, _targetEye, effects);
  }

  function nearestVisibleEnemy(agent, effects) {
    let best = null;
    let bestD = ENGAGE_RANGE + 1;
    for (let i = 0; i < state.agents.length; i++) {
      const other = state.agents[i];
      if (!other || other === agent || !other.alive || other.team === agent.team) continue;
      const d = dist2d(agent.pos.x, agent.pos.z, other.pos.x, other.pos.z);
      if (d > ENGAGE_RANGE || d >= bestD) continue;
      if (!canSee(agent, other, effects)) continue;
      best = other;
      bestD = d;
    }
    return best;
  }

  // --- shooting ---------------------------------------------------------------
  function botShoot(agent, target, ctx) {
    const ai = agent.ai;
    const weapon = WEAPONS[agent.weaponId] || WEAPONS.pistol;
    if (agent.mag <= 0) {
      if (ai.reloadLeft <= 0) ai.reloadLeft = weapon.reloadTime;
      return;
    }
    agent.mag -= 1;

    // Aim at the chest with a seeded error cone; worse while the target moves.
    const moving = target.vel ? target.vel.lengthSq() > 0.25 : false;
    const errDeg = randRange(rng, AIM_ERR_MIN, AIM_ERR_MAX) * (moving ? 1.6 : 1);
    const err = (errDeg * Math.PI) / 180;
    _eye.set(agent.pos.x, agent.pos.y + EYE_STAND, agent.pos.z);
    _targetEye.set(target.pos.x, target.pos.y + 1.25, target.pos.z);
    _dir.subVectors(_targetEye, _eye).normalize();
    // Pitch the aim ray by the error angle around a horizontal axis.
    _right.set(_dir.z, 0, -_dir.x).normalize();
    const pitchErr = (rng() - 0.5) * 2 * err;
    const yawErr = (rng() - 0.5) * 2 * err;
    _dir.applyAxisAngle(_right, pitchErr);
    _dir.applyAxisAngle(_up, yawErr);

    const pellets = weapon.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const spread = weapon.spreadStill + weapon.spreadMove * 0.5;
      _to.copy(_dir);
      if (spread > 0) {
        _to.x += (rng() - 0.5) * 2 * spread;
        _to.y += (rng() - 0.5) * 2 * spread;
        _to.z += (rng() - 0.5) * 2 * spread;
        _to.normalize();
      }
      const hit = hitscan(_eye, _to, weapon.range, ctx.shootables, state.agents);
      _muzzle.copy(_eye).addScaledVector(_dir, 0.6);
      if (!hit) {
        _hitPoint.copy(_eye).addScaledVector(_to, weapon.range);
        if (ctx.effects) ctx.effects.addTracer(_muzzle, _hitPoint, agent.team === 'ember' ? 0xffb347 : 0x2ec4b6);
        continue;
      }
      if (ctx.effects) {
        ctx.effects.addTracer(_muzzle, hit.point, agent.team === 'ember' ? 0xffb347 : 0x2ec4b6);
        if (hit.wall) ctx.effects.addImpact(hit.point, 0xffc27a);
      }
      if (hit.agent && hit.agent.alive) {
        const dmg = weapon.damage * (hit.part === 'head' ? weapon.headMult : 1);
        const result = damageAgent(state, hit.agent, dmg, hit.part === 'head', agent);
        if (result === 'kill') {
          if (ctx.audio) ctx.audio.kill();
          onAgentKilled(hit.agent);
        } else if (ctx.audio) {
          ctx.audio.hit();
        }
        if (ctx.effects) ctx.effects.addImpact(hit.point, 0xff5a3c);
      }
    }

    if (ctx.audio && ctx.player) {
      const d = agent.pos.distanceTo(ctx.player.pos);
      ctx.audio.shot(agent.weaponId, d);
    }
    // Nearby bots hear the shot and investigate.
    for (const other of agents) {
      if (other === agent || !other.alive) continue;
      if (other.pos.distanceTo(agent.pos) <= HEAR_RADIUS) {
        other.ai.lastHeard = { x: agent.pos.x, z: agent.pos.z };
      }
    }
  }

  function maybeThrowGrenade(agent, target, ctx) {
    const ai = agent.ai;
    if (ai.grenadeThrown || agent.grenades.he <= 0) return;
    if (typeof throwGrenade !== 'function') return;
    const d = dist2d(agent.pos.x, agent.pos.z, target.pos.x, target.pos.z);
    if (d < 10 || d > 25) return;
    if (ai.grenadeTimer > 0) return;
    agent.grenades.he -= 1;
    ai.grenadeThrown = true;
    _eye.set(agent.pos.x, agent.pos.y + EYE_STAND, agent.pos.z);
    _dir.set(target.pos.x - agent.pos.x, 1.5, target.pos.z - agent.pos.z).normalize();
    throwGrenade(state, _eye, _dir, 'he', ctx.effects);
  }

  // --- movement ---------------------------------------------------------------
  // Walk toward the current path waypoint. Returns true while still moving.
  function followPath(agent, dt, speed) {
    const ai = agent.ai;
    if (!ai.path || ai.pathIdx >= ai.path.length) return false;
    const wp = waypoints[ai.path[ai.pathIdx]];
    if (!wp) {
      ai.path = null;
      return false;
    }
    const d = dist2d(agent.pos.x, agent.pos.z, wp.x, wp.z);
    if (d < 0.6) {
      ai.pathIdx += 1;
      return ai.pathIdx < ai.path.length;
    }
    const tx = (wp.x - agent.pos.x) / d;
    const tz = (wp.z - agent.pos.z) / d;
    agent.yaw = yawTo(agent.pos, wp);
    agent.mover.yaw = agent.yaw;
    agent.mover.step(dt, tx, tz, speed, false, false);
    ai.walkPhase += dt * 9;
    return true;
  }

  function standStill(agent, dt) {
    agent.mover.step(dt, 0, 0, 0, false, false);
  }

  function syncMesh(agent, dt) {
    const g = agent.mesh;
    const ai = agent.ai;
    g.position.copy(agent.pos);
    if (ai.state === 'dead') {
      ai.fallT += dt;
      const k = Math.min(1, ai.fallT / FALL_TIME);
      g.rotation.x = -1.45 * k;
      g.rotation.y = agent.yaw;
      return;
    }
    g.rotation.x = 0;
    g.rotation.y = agent.yaw;
    const moving = ai.state === 'push' || ai.state === 'engage';
    const swing = moving ? Math.sin(ai.walkPhase) * 0.45 : 0;
    ai.parts.legL.rotation.x = swing;
    ai.parts.legR.rotation.x = -swing;
    ai.parts.armL.rotation.x = -swing * 0.6;
    ai.parts.armR.rotation.x = swing * 0.6;
  }

  // --- round setup --------------------------------------------------------------
  function assignTasks() {
    const attackSide = state.attackSide;
    const calledSite = rng() < 0.5 ? 'A' : 'B';
    const attackers = agents.filter((a) => a.team === attackSide);
    const defenders = agents.filter((a) => a.team !== attackSide);
    // Attackers: carrier + 2 more to the called site, 2 mid. The carrier
    // travels with the main group.
    attackers.forEach((a, i) => {
      a.ai.site = calledSite;
      a.ai.lane = i < 3 ? calledSite : 'mid';
    });
    // Defenders: 2 A, 2 B, 1 mid.
    defenders.forEach((a, i) => {
      a.ai.site = null;
      a.ai.lane = i < 2 ? 'A' : i < 4 ? 'B' : 'mid';
    });
    return { attackers, defenders, calledSite };
  }

  function resetForRound() {
    const { attackers, calledSite } = assignTasks();
    const attackSide = state.attackSide;

    for (const a of agents) {
      const spawns = world.spawns[a.team];
      const idx = a.team === 'ember' ? (a.id - 1) % spawns.length : (a.id - 5) % spawns.length;
      const spawn = spawns[idx] || spawns[0];
      a.mover.pos.set(spawn.x, 0, spawn.z);
      a.mover.vel.set(0, 0, 0);
      a.yaw = a.team === 'ember' ? 0 : Math.PI; // ember faces north (-z), tide faces south (+z)
      a.mover.yaw = a.yaw;
      a.hp = 100;
      a.alive = true;
      // Kills/deaths are match totals: they persist across rounds.
      a.crouching = false;
      // Bot economy: pistol round 1, rifle from round 2, armor from round 3,
      // and sometimes one grenade (seeded).
      if (state.round >= 2) {
        a.weaponId = 'rifle';
        a.money = Math.max(a.money, 0);
      } else {
        a.weaponId = 'pistol';
      }
      const w = WEAPONS[a.weaponId];
      a.mag = w.mag;
      a.reserve = w.reserve;
      a.armor = state.round >= 3 ? 50 : 0;
      a.grenades.he = rng() < 0.35 ? 1 : 0;
      a.grenades.smoke = rng() < 0.2 ? 1 : 0;

      const ai = a.ai;
      ai.state = 'push';
      ai.path = null;
      ai.pathIdx = 0;
      ai.target = null;
      ai.hasLos = false;
      ai.seenAt = -1;
      ai.reactAt = -1;
      ai.burstLeft = 0;
      ai.burstPause = 0;
      ai.fireTimer = 0;
      ai.reloadLeft = 0;
      ai.lastHeard = null;
      ai.hearWp = -1;
      ai.fallT = 0;
      ai.grenadeThrown = false;
      ai.grenadeTimer = randRange(rng, 6, 14);
      ai.walkPhase = 0;
      ai.scanYaw = a.yaw;
      ai.strafeDir = rng() < 0.5 ? -1 : 1;
      ai.strafeTimer = 0;

      if (a.team === attackSide) {
        if (a.ai.lane === 'mid') planToLane(a, 'mid');
        else planToSite(a, calledSite);
      } else if (a.ai.lane === 'mid') {
        planToLane(a, 'mid');
      } else {
        planToSite(a, a.ai.lane);
      }
      if (a.ai.state === 'push' && !a.ai.path) ai.state = 'hold';
      a.mesh.rotation.x = 0;
      a.mesh.visible = true;
      syncMesh(a, 0);
    }

    // Bomb starts with a bot on the attacking side, in the main group.
    const carrier = attackers.find((a) => a.ai.lane !== 'mid') || attackers[0];
    state.bomb.status = 'carried';
    state.bomb.site = calledSite;
    state.bomb.carrierId = carrier ? carrier.id : -1;
    state.bomb.planterId = -1;
    state.bomb.defuserId = -1;
    state.bomb.progress = 0;
    state.bomb.timer = 35;
    if (state.bomb.pos) state.bomb.pos.set(carrier.pos.x, 0.4, carrier.pos.z);
    else state.bomb.pos = new THREE.Vector3(carrier.pos.x, 0.4, carrier.pos.z);
  }

  // --- death ----------------------------------------------------------------------
  function onAgentKilled(agent) {
    if (!agent.ai) return;
    const ai = agent.ai;
    if (ai.state !== 'dead') {
      ai.state = 'dead';
      ai.fallT = 0;
      ai.target = null;
    }
    // Drop the bomb where the carrier fell; rounds.step resets any channel.
    if (state.bomb.carrierId === agent.id && state.bomb.status !== 'planted') {
      state.bomb.status = 'idle';
      state.bomb.carrierId = -1;
      state.bomb.planterId = -1;
      state.bomb.progress = 0;
      if (state.bomb.pos) state.bomb.pos.set(agent.pos.x, 0.4, agent.pos.z);
      else state.bomb.pos = new THREE.Vector3(agent.pos.x, 0.4, agent.pos.z);
      addFeedLine(`${agent.name} dropped the bomb`, 'info');
    }
  }

  function addFeedLine(text, cls) {
    // Local feed helper (state.js owns the cap); kept tiny on purpose.
    state.feed.unshift({ text, cls, t: state.time });
    if (state.feed.length > 6) state.feed.length = 6;
  }

  // External hook for main.js: a shot at `pos` is heard by bots nearby.
  function hearShot(pos) {
    for (const a of agents) {
      if (!a.alive) continue;
      if (a.pos.distanceTo(pos) <= HEAR_RADIUS) {
        a.ai.lastHeard = { x: pos.x, z: pos.z };
      }
    }
  }

  // --- per-bot brain ---------------------------------------------------------------
  function stepBot(agent, dt, ctx) {
    const ai = agent.ai;
    if (!agent.alive) {
      if (ai.state !== 'dead') onAgentKilled(agent);
      syncMesh(agent, dt);
      return;
    }

    const effects = ctx.effects;
    const bomb = state.bomb;
    const isAttacker = agent.team === state.attackSide;
    const plantedSite = bomb.status === 'planted' || bomb.status === 'defusing' ? bomb.site : null;

    // Reload timer.
    if (ai.reloadLeft > 0) {
      ai.reloadLeft -= dt;
      if (ai.reloadLeft <= 0) {
        const w = WEAPONS[agent.weaponId] || WEAPONS.pistol;
        const need = w.mag - agent.mag;
        const take = Math.min(need, agent.reserve);
        agent.mag += take;
        agent.reserve -= take;
      }
    }

    // Bomb pickup: nearest live attacker walks within 1.5 m of a dropped bomb.
    if (isAttacker && bomb.status === 'idle' && bomb.pos) {
      const d = dist2d(agent.pos.x, agent.pos.z, bomb.pos.x, bomb.pos.z);
      if (d <= PICKUP_RADIUS) {
        bomb.status = 'carried';
        bomb.carrierId = agent.id;
        bomb.site = ai.site || bomb.site;
        addFeedLine(`${agent.name} picked up the bomb`, agent.team);
      } else if (ai.state === 'push' || ai.state === 'hold') {
        // Divert to the dropped bomb if no other attacker is closer.
        let closer = false;
        for (const other of agents) {
          if (other === agent || !other.alive || other.team !== agent.team) continue;
          if (dist2d(other.pos.x, other.pos.z, bomb.pos.x, bomb.pos.z) < d) {
            closer = true;
            break;
          }
        }
        if (!closer) {
          const wp = nearestWaypoint(waypoints, bomb.pos.x, bomb.pos.z);
          if (ai.hearWp !== wp) {
            ai.hearWp = wp;
            planTo(agent, wp);
            ai.state = 'push';
          }
        }
      }
    }

    // Escort: when the player carries the bomb (Ember attacking), attacker
    // bots stay near the player instead of running their own lane.
    const playerCarries = bomb.carrierId === 0 && bomb.status === 'carried';
    if (isAttacker && playerCarries && ctx.player && ctx.player.alive) {
      const d = dist2d(agent.pos.x, agent.pos.z, ctx.player.pos.x, ctx.player.pos.z);
      if (d > 6 && ai.state !== 'engage') {
        const wp = nearestWaypoint(waypoints, ctx.player.pos.x, ctx.player.pos.z);
        if (ai.hearWp !== wp) {
          ai.hearWp = wp;
          planTo(agent, wp);
          ai.state = 'push';
        }
      }
    }

    // --- perception (throttled to 5 Hz) ---
    ai.losTimer -= dt;
    if (ai.losTimer <= 0) {
      ai.losTimer = 1 / LOS_HZ;
      const seen = nearestVisibleEnemy(agent, effects);
      if (seen) {
        if (ai.target !== seen) {
          ai.target = seen;
          ai.seenAt = state.time;
          ai.reactAt = state.time + randRange(rng, REACT_MIN, REACT_MAX);
          ai.burstLeft = 0;
          ai.burstPause = 0;
        }
        ai.hasLos = true;
      } else {
        ai.hasLos = false;
        if (ai.target && !ai.target.alive) ai.target = null;
      }
    }

    // Hearing: investigate the last heard shot.
    if (ai.lastHeard && ai.state !== 'engage' && ai.state !== 'plant' && ai.state !== 'defuse') {
      const wp = nearestWaypoint(waypoints, ai.lastHeard.x, ai.lastHeard.z);
      if (ai.hearWp !== wp) {
        ai.hearWp = wp;
        planTo(agent, wp);
        ai.state = 'push';
      }
      if (dist2d(agent.pos.x, agent.pos.z, ai.lastHeard.x, ai.lastHeard.z) < 2) {
        ai.lastHeard = null;
      }
    }

    // Once the bomb is planted, the planter stops channeling and holds the
    // site like any other attacker (otherwise 'plant' would block engage).
    if ((bomb.status === 'planted' || bomb.status === 'defusing') && ai.state === 'plant') {
      ai.state = 'hold';
      ai.holdWp = nearestWaypoint(waypoints, agent.pos.x, agent.pos.z);
    }

    // --- state transitions ---
    if (ai.hasLos && ai.target && ai.target.alive && ai.state !== 'plant' && ai.state !== 'defuse') {
      ai.state = 'engage';
    } else if (ai.state === 'engage' && (!ai.target || !ai.target.alive || !ai.hasLos)) {
      ai.target = null;
      ai.state = ai.path ? 'push' : 'hold';
    }

    // Carrier reaches the called site: channel (rounds.step owns progress).
    if (isAttacker && bomb.carrierId === agent.id && bomb.status === 'carried') {
      const site = world.sites[bomb.site || ai.site || 'A'];
      if (site && dist2d(agent.pos.x, agent.pos.z, site.x, site.z) <= site.r) {
        ai.state = 'plant';
      } else if (ai.state === 'plant') {
        ai.state = 'push';
      }
    }

    // After the plant, attackers hold around the site; defenders rotate in.
    if (plantedSite) {
      if (isAttacker && ai.state !== 'engage' && ai.state !== 'dead') {
        const site = world.sites[plantedSite];
        const d = dist2d(agent.pos.x, agent.pos.z, site.x, site.z);
        if (d > 9) {
          if (ai.state !== 'retreat') {
            ai.state = 'retreat';
            planToSite(agent, plantedSite);
          }
        } else if (ai.state === 'retreat') {
          ai.state = 'hold';
          ai.holdWp = nearestWaypoint(waypoints, agent.pos.x, agent.pos.z);
        }
      } else if (!isAttacker && ai.state !== 'engage' && ai.state !== 'dead' && ai.state !== 'defuse') {
        const d = bomb.pos ? dist2d(agent.pos.x, agent.pos.z, bomb.pos.x, bomb.pos.z) : Infinity;
        if (d <= 2) {
          ai.state = 'defuse';
        } else if (ai.state !== 'retreat') {
          ai.state = 'retreat';
          const wp = nearestWaypoint(waypoints, bomb.pos.x, bomb.pos.z);
          planTo(agent, wp);
        }
      }
    }

    // --- behaviour per state ---
    if (ai.state === 'push' || ai.state === 'retreat') {
      if (!followPath(agent, dt, BOT_SPEED)) {
        ai.state = 'hold';
        ai.holdWp = nearestWaypoint(waypoints, agent.pos.x, agent.pos.z);
        ai.scanYaw = agent.yaw;
      }
    } else if (ai.state === 'hold') {
      // Slow scan: sweep the yaw back and forth around the hold direction.
      ai.scanYaw += dt * 0.5;
      agent.yaw = ai.scanYaw + Math.sin(state.time * 0.4 + agent.id) * 0.9;
      agent.mover.yaw = agent.yaw;
      standStill(agent, dt);
    } else if (ai.state === 'engage' && ai.target) {
      const t = ai.target;
      agent.yaw = yawTo(agent.pos, t.pos);
      agent.mover.yaw = agent.yaw;
      // Strafe sideways while fighting, flipping direction every so often.
      ai.strafeTimer -= dt;
      if (ai.strafeTimer <= 0) {
        ai.strafeTimer = randRange(rng, 0.7, 1.6);
        ai.strafeDir = rng() < 0.5 ? -1 : 1;
      }
      const d = dist2d(agent.pos.x, agent.pos.z, t.pos.x, t.pos.z);
      _fwd.set(-Math.sin(agent.yaw), 0, -Math.cos(agent.yaw));
      _right.set(-_fwd.z, 0, _fwd.x);
      let wx = 0;
      let wz = 0;
      if (d > 14) {
        wx += _fwd.x;
        wz += _fwd.z;
      } else if (d < 5) {
        wx -= _fwd.x;
        wz -= _fwd.z;
      }
      wx += _right.x * ai.strafeDir * 0.7;
      wz += _right.z * ai.strafeDir * 0.7;
      const wl = Math.hypot(wx, wz) || 1;
      agent.mover.step(dt, wx / wl, wz / wl, BOT_CROUCH_SPEED, false, false);
      ai.walkPhase += dt * 9;

      // Burst fire, only after the reaction delay has passed.
      const weapon = WEAPONS[agent.weaponId] || WEAPONS.pistol;
      ai.fireTimer -= dt;
      if (ai.burstPause > 0) {
        ai.burstPause -= dt;
      } else if (state.time >= ai.reactAt && ai.fireTimer <= 0 && ai.reloadLeft <= 0) {
        if (ai.burstLeft <= 0) ai.burstLeft = 3 + Math.floor(rng() * 3);
        botShoot(agent, t, ctx);
        ai.burstLeft -= 1;
        ai.fireTimer = weapon.fireGap;
        if (ai.burstLeft <= 0) ai.burstPause = randRange(rng, 0.4, 0.9);
        maybeThrowGrenade(agent, t, ctx);
      }
    } else if (ai.state === 'plant' || ai.state === 'defuse') {
      // Stand still and channel; rounds.step advances bomb.progress and
      // resets it if this bot moves away or dies.
      standStill(agent, dt);
    }

    agent.onGround = agent.mover.onGround;
    agent.crouching = false;
    syncMesh(agent, dt);
  }

  function step(dt, ctx) {
    for (let i = 0; i < agents.length; i++) {
      stepBot(agents[i], dt, ctx);
    }
  }

  return { agents, step, resetForRound, onAgentKilled, hearShot };
}
