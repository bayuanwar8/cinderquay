// bomb.js — plant/defuse channels + planted-bomb timer + fuse for CINDERQUAY.
// Owns: PLANT_TIME / DEFUSE_TIME / BOMB_TIME, the planting and defusing
// channels (progress lives here and here only), the planted-bomb timer
// with its beeps and detonation, bomb pickup / drop, and the 3D bomb
// device mesh (bombMesh / bombBody / bombLamp — names kept from v2).
// Economy numbers come from economy.js; the round flow that calls this
// stays in rounds.js, which passes endRound in as a hook.

import * as THREE from 'three';
import { addFeed, damageAgent } from './state.js';
import { PLANT_BONUS } from './economy.js';

export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const DEFUSE_KIT_MULT = 0.5; // defuse kit halves the defuse channel (B)
export const BOMB_TIME = 35;
const EXPLOSION_RADIUS = 6;
const EXPLOSION_MAX_DAMAGE = 120;
const PICKUP_RADIUS = 1.5;
const DEFUSE_RADIUS = 2;

function agentById(state, id) {
  for (let i = 0; i < state.agents.length; i++) {
    if (state.agents[i] && state.agents[i].id === id) return state.agents[i];
  }
  return null;
}

function dist2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// The planted/dropped bomb device (live play only; shot mode stages its
// own). Cylinder body + cap + antenna + blinking lamp.
export function createBombDevice(scene) {
  const bombMesh = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.26, 0.3, 20),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.55, metalness: 0.35 }),
  );
  bombBody.position.y = 0.15;
  const bombCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.16, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.5 }),
  );
  bombCap.position.y = 0.34;
  const bombAntenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.8 }),
  );
  bombAntenna.position.set(0.18, 0.42, 0);
  const bombLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 2 }),
  );
  bombLamp.position.y = 0.4;
  bombMesh.add(bombBody, bombCap, bombAntenna, bombLamp);
  bombMesh.visible = false;
  scene.add(bombMesh);

  // Show the device while it is planted, being defused, or dropped on the
  // ground; the lamp blinks fast while armed, dim while dropped.
  function sync(state, time) {
    if (state.bomb.pos && (state.bomb.status === 'planted' || state.bomb.status === 'defusing' || state.bomb.status === 'idle')) {
      bombMesh.visible = true;
      bombMesh.position.copy(state.bomb.pos);
      bombLamp.material.emissiveIntensity = state.bomb.status === 'idle' ? 0.6 : (Math.sin(time * 6) > 0 ? 2.5 : 0.4);
    } else {
      bombMesh.visible = false;
    }
  }

  return { mesh: bombMesh, body: bombBody, cap: bombCap, antenna: bombAntenna, lamp: bombLamp, sync };
}

// Bomb channel logic. `hooks.endRound(winner, reason)` is rounds.js'
// endRound; `world` supplies the site positions.
export function createBomb(state, world, hooks) {
  let ctx = null; // latest step ctx { hud, audio, bots, player, effects, input, world }
  let beepT = 0;

  const defendSide = () => (state.attackSide === 'ember' ? 'tide' : 'ember');

  function playerAgent() {
    for (let i = 0; i < state.agents.length; i++) {
      if (state.agents[i] && state.agents[i].isPlayer) return state.agents[i];
    }
    return state.agents[0] || (ctx && ctx.player) || null;
  }

  function hud() {
    return ctx && ctx.hud ? ctx.hud : null;
  }

  function audio() {
    return ctx && ctx.audio ? ctx.audio : null;
  }

  function call(fn, ...args) {
    if (typeof fn === 'function') fn(...args);
  }

  function resetBeep() {
    beepT = 0;
  }

  // Player picks up a dropped bomb by walking over it.
  function tryPlayerPickup() {
    const bomb = state.bomb;
    const p = playerAgent();
    const h = hud();
    if (bomb.status === 'idle' && bomb.pos && p && p.alive) {
      if (dist2d(p.pos.x, p.pos.z, bomb.pos.x, bomb.pos.z) <= PICKUP_RADIUS) {
        bomb.status = 'carried';
        bomb.carrierId = p.id;
        if (h) call(h.setBombStatus, `BOMB CARRIED — take it to site ${bomb.site || 'A/B'}`);
        addFeed(state, 'You picked up the bomb', 'ember');
      }
    }
  }

  // A dead carrier drops the bomb where they fell (covers the player
  // carrier; bots report their own drop via bots.onAgentKilled).
  function dropDeadCarrier() {
    const bomb = state.bomb;
    if ((bomb.status === 'carried' || bomb.status === 'planting') && bomb.carrierId >= 0) {
      const carrier = agentById(state, bomb.carrierId);
      if (!carrier || !carrier.alive) {
        bomb.status = 'idle';
        bomb.carrierId = -1;
        bomb.planterId = -1;
        bomb.progress = 0;
        if (carrier && bomb.pos) bomb.pos.set(carrier.pos.x, 0.4, carrier.pos.z);
        const h = hud();
        if (h) call(h.setChannel, null, null);
      }
    }
  }

  function stepPlant(dt) {
    const bomb = state.bomb;
    if (bomb.status !== 'carried' && bomb.status !== 'planting') return;
    const carrier = agentById(state, bomb.carrierId);
    const site = bomb.site ? world.sites[bomb.site] : null;
    let channeling = false;
    if (carrier && carrier.alive && site) {
      const inSite = dist2d(carrier.pos.x, carrier.pos.z, site.x, site.z) <= site.r;
      if (inSite) {
        if (carrier.isPlayer) {
          channeling = !!(ctx && ctx.input && ctx.input.isDown('KeyE'));
        } else {
          channeling = carrier.ai && carrier.ai.state === 'plant';
        }
      }
    }
    const h = hud();
    if (!channeling) {
      if (bomb.status === 'planting') {
        bomb.status = 'carried';
        bomb.progress = 0;
        if (h) call(h.setChannel, null, null);
      }
      return;
    }
    bomb.status = 'planting';
    bomb.planterId = carrier.id;
    bomb.progress += dt / PLANT_TIME;
    if (h) call(h.setChannel, 'Planting the bomb', Math.min(1, bomb.progress));
    if (bomb.progress < 1) return;

    // Plant complete.
    bomb.progress = 0;
    bomb.status = 'planted';
    bomb.timer = BOMB_TIME;
    beepT = 0;
    if (bomb.pos) bomb.pos.set(carrier.pos.x, 0.4, carrier.pos.z);
    carrier.money += PLANT_BONUS;
    addFeed(state, `${carrier.name} planted the bomb at site ${bomb.site}`, carrier.team);
    if (ctx && ctx.radio) ctx.radio.plantStarted(carrier, bomb.site);
    if (h) {
      call(h.setChannel, null, null);
      call(h.setBombStatus, `BOMB PLANTED — ${Math.ceil(bomb.timer)}`);
    }
    const a = audio();
    if (a) call(a.plantTick);
  }

  function stepDefuse(dt) {
    const bomb = state.bomb;
    if (bomb.status !== 'planted' && bomb.status !== 'defusing') return;
    if (!bomb.pos) return;
    const defTeam = defendSide();
    let defuser = null;
    for (const a of state.agents) {
      if (!a || !a.alive || a.team !== defTeam) continue;
      if (dist2d(a.pos.x, a.pos.z, bomb.pos.x, bomb.pos.z) > DEFUSE_RADIUS) continue;
      if (a.isPlayer) {
        if (ctx && ctx.input && ctx.input.isDown('KeyE')) defuser = a;
      } else if (a.ai && a.ai.state === 'defuse') {
        defuser = a;
      }
      if (defuser) break;
    }
    const h = hud();
    if (!defuser) {
      if (bomb.status === 'defusing') {
        bomb.status = 'planted';
        bomb.progress = 0;
        if (h) call(h.setChannel, null, null);
      }
      return;
    }
    bomb.status = 'defusing';
    bomb.defuserId = defuser.id;
    // A defuse kit halves the channel: 5 s becomes 2.5 s for its carrier (B).
    const defuseTime = defuser.defuseKit ? DEFUSE_TIME * DEFUSE_KIT_MULT : DEFUSE_TIME;
    bomb.progress += dt / defuseTime;
    if (h) call(h.setChannel, defuser.defuseKit ? 'Defusing the bomb — kit' : 'Defusing the bomb', Math.min(1, bomb.progress));
    if (bomb.progress < 1) return;
    bomb.progress = 0;
    bomb.status = 'defused';
    if (h) call(h.setChannel, null, null);
    addFeed(state, `${defuser.name} defused the bomb`, defuser.team);
    if (ctx && ctx.radio) ctx.radio.defused(defuser, bomb.site);
    hooks.endRound(defTeam, 'defuse');
  }

  function stepBombTimer(dt) {
    const bomb = state.bomb;
    if (bomb.status !== 'planted' && bomb.status !== 'defusing') return;
    bomb.timer -= dt;
    const h = hud();
    if (h) call(h.setBombStatus, `BOMB PLANTED — ${Math.max(0, Math.ceil(bomb.timer))}`);
    // Beeps accelerate as the timer runs down.
    beepT -= dt;
    if (beepT <= 0) {
      const a = audio();
      if (a) call(a.beep);
      const frac = Math.max(0, bomb.timer / BOMB_TIME);
      beepT = 0.25 + frac * 0.85;
    }
    if (bomb.timer > 0) return;

    // Detonation: linear falloff to every agent within 6 m, no team exception.
    bomb.status = 'exploded';
    if (bomb.pos) {
      if (ctx && ctx.effects) call(ctx.effects.addExplosion, bomb.pos);
      const a = audio();
      const p = playerAgent();
      if (a && p) call(a.explosion, p.pos.distanceTo(bomb.pos));
      for (const target of state.agents) {
        if (!target || !target.alive) continue;
        const d = Math.sqrt(
          (target.pos.x - bomb.pos.x) ** 2 +
            (target.pos.y - bomb.pos.y) ** 2 +
            (target.pos.z - bomb.pos.z) ** 2,
        );
        if (d > EXPLOSION_RADIUS) continue;
        const dmg = EXPLOSION_MAX_DAMAGE * (1 - d / EXPLOSION_RADIUS);
        damageAgent(state, target, dmg, false, null);
      }
    }
    hooks.endRound(state.attackSide, 'bomb');
  }

  // One live-phase tick, in the order rounds.js ran it before the split:
  // pickup, dead-carrier drop, plant channel, defuse channel, fuse timer.
  function step(dt, nextCtx) {
    if (nextCtx) ctx = nextCtx;
    if (!ctx) return;
    tryPlayerPickup();
    dropDeadCarrier();
    stepPlant(dt);
    if (state.phase !== 'live') return;
    stepDefuse(dt);
    if (state.phase !== 'live') return;
    stepBombTimer(dt);
  }

  return { step, stepPlant, stepDefuse, stepBombTimer, tryPlayerPickup, dropDeadCarrier, resetBeep };
}
