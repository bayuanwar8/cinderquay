// bots.js — the 9 bot teammates/opponents of CINDERQUAY.
// Coordinator only: it builds the agents (meshes in botmodels.js), runs
// the per-bot brain (push / hold / engage / plant / defuse / retreat /
// dead) and fires hitscan shots through weapons.js. The brain's pieces
// live in their own modules: nav.js (waypoints + BFS), hearing.js
// (hearShot + investigate), tactics.js (roles + site push + rotation).
// All gameplay randomness goes through state.rng.
// Movement collision is shared with the player via createMover.

import * as THREE from 'three';
import { WEAPONS, hitscan } from './weapons.js';
import { throwGrenade } from './grenades.js';
import { damageAgent } from './state.js';
import { dist2d, yawTo, segmentHitsSphere, createNavigator } from './nav.js';
import { createHearing } from './hearing.js';
import { assignTasks, clearPlantState, updateCarrier, postPlant } from './tactics.js';
import { buildBot, syncMesh } from './botmodels.js';
const EMBER_NAMES = ['Ash', 'Coal', 'Rust', 'Soot'];
const TIDE_NAMES = ['Brine', 'Kelp', 'Fathom', 'Salter', 'Marrow'];

const BOT_SPEED = 4.2;
const BOT_CROUCH_SPEED = 3.0;
const EYE_STAND = 1.6;
const LOS_HZ = 5; // perception throttle, checks per second per bot
const PICKUP_RADIUS = 1.5;
const REACT_MIN = 0.35;
const REACT_MAX = 0.7;
const AIM_ERR_MIN = 2; // degrees
const AIM_ERR_MAX = 4;
const ENGAGE_RANGE = 48;

// Module-level scratch only — nothing is allocated inside step().
const _eye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _boxHit = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function randRange(rng, a, b) {
  return a + rng() * (b - a);
}

export function createBots(scene, world, state) {
  const rng = state.rng;
  const waypoints = world.waypoints;
  const colliders = world.colliders;
  const nav = createNavigator(world, state);

  const agents = [];

  // ids 1-4: Ember bots (player is id 0, fifth Ember). ids 5-9: Tide bots.
  // Visual variant only: first bot of each team is the entry (thicker
  // vest), last bot is the sniper (longer barrel + scope).
  for (let i = 0; i < 4; i++) {
    const spawn = world.spawns.ember[i + 1] || world.spawns.ember[0];
    agents.push(buildBot(scene, colliders, rng, i + 1, EMBER_NAMES[i], 'ember', spawn,
      i === 0 ? 'entry' : i === 3 ? 'sniper' : 'standard'));
  }
  for (let i = 0; i < 5; i++) {
    const spawn = world.spawns.tide[i] || world.spawns.tide[0];
    agents.push(buildBot(scene, colliders, rng, i + 5, TIDE_NAMES[i], 'tide', spawn,
      i === 0 ? 'entry' : i === 4 ? 'sniper' : 'standard'));
  }
  for (const a of agents) state.agents.push(a);

  const hearing = createHearing(agents);

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
      const hit = hitscan(_eye, _to, weapon.range, ctx.shootables, state.agents, agent);
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
    // Nearby bots hear the shot and investigate (not the shooter).
    hearing.broadcastShot(agent.pos, agent);
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

  // --- round setup --------------------------------------------------------------
  function resetForRound() {
    const { attackers, calledSite } = assignTasks(agents, state.attackSide, rng);
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
      a.grenades.flash = rng() < 0.2 ? 1 : 0;
      a.flashUntil = 0;
      a.flashStrength = 0;

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
      ai.radioHeard = false;
      ai.radioRotated = false;
      ai.radioContactAt = -99;
      ai.fallT = 0;
      ai.grenadeThrown = false;
      ai.grenadeTimer = randRange(rng, 6, 14);
      ai.walkPhase = 0;
      ai.poseFreeze = false;
      ai.posePhase = 0;
      ai.scanYaw = a.yaw;
      ai.strafeDir = rng() < 0.5 ? -1 : 1;
      ai.strafeTimer = 0;

      if (a.team === attackSide) {
        if (a.ai.lane === 'mid') nav.planToLane(a, 'mid');
        else nav.planToSite(a, calledSite);
      } else if (a.ai.lane === 'mid') {
        nav.planToLane(a, 'mid');
      } else {
        nav.planToSite(a, a.ai.lane);
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
    // BUG 4: the carrier's route must end ON the plant spot. planToSite
    // picks a random waypoint within 7 m of the site, but only the plant
    // spot is inside the 3.4 m plant radius — the other two leave the
    // carrier holding outside the site forever.
    if (carrier) {
      const site = world.sites[calledSite];
      if (site) nav.planTo(carrier, nav.nearestWaypoint(site.x, site.z));
    }
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
        // BUG 4: a fresh carrier walks straight to the plant spot
        // instead of finishing the old route to the drop point.
        const site = world.sites[bomb.site];
        if (site) nav.planTo(agent, nav.nearestWaypoint(site.x, site.z));
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
          const wp = nav.nearestWaypoint(bomb.pos.x, bomb.pos.z);
          if (ai.hearWp !== wp) {
            ai.hearWp = wp;
            nav.planTo(agent, wp);
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
        const wp = nav.nearestWaypoint(ctx.player.pos.x, ctx.player.pos.z);
        if (ai.hearWp !== wp) {
          ai.hearWp = wp;
          nav.planTo(agent, wp);
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
          // First sight of this enemy: call it out on the radio, at most
          // once every 8 s per bot so the feed never repeats itself.
          if (ctx.radio && state.time - (ai.radioContactAt || -99) > 8) {
            ai.radioContactAt = state.time;
            ctx.radio.contact(agent, agent.ai.site);
          }
        }
        ai.hasLos = true;
      } else {
        ai.hasLos = false;
        if (ai.target && !ai.target.alive) ai.target = null;
      }
    }

    // Hearing: investigate the last heard shot (hearing.js).
    // BUG 4: the bomb carrier never investigates — chasing a sound
    // replaces its site route and it never walks back.
    const isCarrier = isAttacker && bomb.carrierId === agent.id && bomb.status === 'carried';
    if (!isCarrier) hearing.investigate(agent, nav.planTo, nav.nearestWaypoint, ctx.radio);
    // Once the bomb is planted, the planter stops channeling and holds the
    // site like any other attacker (tactics.js).
    clearPlantState(agent, bomb, nav);

    // --- state transitions ---
    // BUG 4: the bomb carrier does not stop to duel a distant enemy. With
    // five defenders around, some enemy is almost always visible, so an
    // engaging carrier sits in 'engage' for the whole round (strafing in
    // place) while the timer expires in mid. The carrier only fights
    // close threats (<= 12 m); anything farther, it keeps pushing the
    // site route and lets its entry teammates clear the way.
    const carrierFarTarget = isCarrier && ai.target &&
      dist2d(agent.pos.x, agent.pos.z, ai.target.pos.x, ai.target.pos.z) > 12;
    if (ai.hasLos && ai.target && ai.target.alive && ai.state !== 'plant' && ai.state !== 'defuse' && !carrierFarTarget) {
      ai.state = 'engage';
    } else if (ai.state === 'engage' && (!ai.target || !ai.target.alive || !ai.hasLos || carrierFarTarget)) {
      ai.target = null;
      ai.state = ai.path ? 'push' : 'hold';
    }

    // Carrier reaches the called site: channel (bomb.js owns progress).
    if (isAttacker && bomb.carrierId === agent.id && bomb.status === 'carried') {
      updateCarrier(agent, bomb, world, nav);
    }

    // After the plant, attackers hold around the site; defenders rotate in.
    postPlant(agent, bomb, world, nav, isAttacker, ctx.radio);
    // --- behaviour per state ---
    if (ai.state === 'push' || ai.state === 'retreat') {
      if (!followPath(agent, dt, BOT_SPEED)) {
        ai.state = 'hold';
        ai.holdWp = nav.nearestWaypoint(agent.pos.x, agent.pos.z);
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
      // Flashed: no shooting, turn away from the fight for a moment.
      const flashed = (agent.flashUntil || 0) > state.time;
      if (flashed) {
        agent.yaw += dt * 2.2;
        agent.mover.yaw = agent.yaw;
        standStill(agent, dt);
        ai.walkPhase += dt * 9;
        agent.onGround = agent.mover.onGround;
        agent.crouching = false;
        syncMesh(agent, dt);
        return;
      }
      // BUG 4: the carrier pushes through the fight along its site route
      // instead of strafing in place — standing still to duel is how the
      // round timer expires at the approach (minDist stuck ~14 m). It
      // keeps facing (and shooting) the target while its feet follow the
      // route; updateCarrier re-plans the route if it is spent.
      if (isCarrier && ai.path && ai.pathIdx < ai.path.length) {
        followPath(agent, dt, BOT_SPEED);
        agent.yaw = yawTo(agent.pos, t.pos);
        agent.mover.yaw = agent.yaw;
      } else {
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
        // BUG 4: a non-carrier closes with a distant enemy and backs off
        // a close one; the carrier never chases (stage 2) — it pushes
        // through on its route instead (branch above).
        if (!isCarrier) {
          if (d > 14) {
            wx += _fwd.x;
            wz += _fwd.z;
          } else if (d < 5) {
            wx -= _fwd.x;
            wz -= _fwd.z;
          }
        }
        wx += _right.x * ai.strafeDir * 0.7;
        wz += _right.z * ai.strafeDir * 0.7;
        const wl = Math.hypot(wx, wz) || 1;
        agent.mover.step(dt, wx / wl, wz / wl, BOT_CROUCH_SPEED, false, false);
        ai.walkPhase += dt * 9;
      }

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
      // Stand still and channel; bomb.js advances bomb.progress and
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

  // Staging hook for shots.js (E): freeze a bot mid-stride at `phase`
  // (Math.PI/2 = legs at full opposite swing) and re-pose the mesh now,
  // so the capture shows a walking bot instead of a standing one. An
  // optional yaw re-aims the bot (the hold scan drifts yaw during settle).
  // Live play never sets poseFreeze, so the sim is untouched.
  function freezePose(agent, phase, yaw) {
    if (!agent || !agent.ai) return;
    agent.ai.poseFreeze = true;
    agent.ai.posePhase = phase;
    agent.ai.state = 'hold';
    if (typeof yaw === 'number') {
      agent.yaw = yaw;
      agent.mover.yaw = yaw;
    }
    syncMesh(agent, 0);
  }

  return { agents, step, resetForRound, onAgentKilled, hearShot: hearing.broadcastShot, freezePose };
}
