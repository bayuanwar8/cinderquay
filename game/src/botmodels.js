// botmodels.js — bot humanoid meshes for CINDERQUAY.
// Owns: building the low-poly bot body (torso / head / helmet / vest /
// pack / legs / arms / gun), the hitbox registration (torso + head
// userData), and the per-frame mesh sync (walk swing, bob, death
// fall-over). The brain that drives these meshes stays in bots.js.
import * as THREE from 'three';
import { createMover } from './player.js';
import { PALETTE } from './palette.js';
import { roleOf } from './radio.js';

const FALL_TIME = 0.4; // seconds for the death fall-over
const LOS_HZ = 5; // perception throttle, checks per second per bot

function randRange(rng, a, b) {
  return a + rng() * (b - a);
}

// Arms point forward-down and hold the gun; pivots sit at the shoulders/
// hips so the walk swing rotates around the joint, not the limb centre.
const ARM_FWD_X = -1.02; // base pitch of the forward-aimed arms
const ARM_IN_Z = 0.45; // inward tilt so both hands meet on the gun

const darkMat = new THREE.MeshLambertMaterial({ color: 0x23211f });
const gunMat = new THREE.MeshLambertMaterial({ color: 0x191919 });

function teamMaterial(team) {
  return new THREE.MeshLambertMaterial({
    color: team === 'ember' ? PALETTE.ember : PALETTE.tide,
  });
}

export function buildBot(scene, colliders, rng, id, name, team, spawn, variant) {
    const bodyMat = teamMaterial(team);
    // Shadowed face: darker skin so the face reads as shaded behind the visor (E).
    const skinMat = new THREE.MeshLambertMaterial({ color: 0x8a6242 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x11151a });
    const glowMat = new THREE.MeshBasicMaterial({
      color: team === 'ember' ? PALETTE.ember : PALETTE.tide,
    });
    const group = new THREE.Group();
    const isEntry = variant === 'entry';
    const isSniper = variant === 'sniper';

    // Torso: capsule in full team colour, ~0.52 wide x 0.62 tall.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.1, 4, 12), bodyMat);
    torso.position.y = 1.08;
    // Neck + head: skin, deliberately a different colour/material from torso.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8), skinMat);
    neck.position.y = 1.42;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skinMat);
    head.position.y = 1.58;
    // Helmet: full team-colour shell + dark centre stripe over the top (E).
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      bodyMat,
    );
    helmet.position.y = 1.59;
    const helmStripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.36), darkMat);
    helmStripe.position.set(0, 1.74, 0);
    // Visor: dark smoked-glass panel across the face + glowing team slit (E).
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.05), glassMat);
    visor.position.set(0, 1.61, -0.15);
    const visorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.02), glowMat);
    visorGlow.position.set(0, 1.61, -0.18);
    // Shoulder pads in full team colour — the silhouette reads at a glance (E).
    const padW = isEntry ? 0.24 : 0.2;
    const padL = new THREE.Mesh(new THREE.BoxGeometry(padW, 0.1, 0.24), bodyMat);
    padL.position.set(-0.32, 1.36, 0);
    const padR = new THREE.Mesh(new THREE.BoxGeometry(padW, 0.1, 0.24), bodyMat);
    padR.position.set(0.32, 1.36, 0);
    // Vest: team-colour front/back plates (entry wears a thicker rig) +
    // dark pouches strapped over the chest (E).
    const vestW = isEntry ? 0.5 : 0.44;
    const vestD = isEntry ? 0.13 : 0.09;
    const vestF = new THREE.Mesh(new THREE.BoxGeometry(vestW, 0.36, vestD), bodyMat);
    vestF.position.set(0, 1.1, -0.24);
    const vestB = new THREE.Mesh(new THREE.BoxGeometry(vestW, 0.36, vestD), bodyMat);
    vestB.position.set(0, 1.1, 0.24);
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.05), darkMat);
    pouch.position.set(-0.1, 1.02, -0.3);
    const pouch2 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.05), darkMat);
    pouch2.position.set(0.12, 1.18, -0.3);
    const pouchSide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.16), darkMat);
    pouchSide.position.set(isEntry ? 0.27 : 0.25, 1.05, -0.1);
    // Backpack + bedroll + side pocket + radio antenna (tilted back so it
    // never covers the space above the head where the nametag sits) (E).
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.16), darkMat);
    pack.position.set(0, 1.12, 0.32);
    const packPocket = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.06), darkMat);
    packPocket.position.set(0, 1.05, 0.42);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.38, 8), darkMat);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 1.37, 0.32);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), darkMat);
    antenna.position.set(0.15, 1.58, 0.38);
    antenna.rotation.x = 0.18;
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), glowMat);
    antennaTip.position.set(0.15, 1.83, 0.42);

    // Legs: pivot at the hip (top of the leg meets the torso bottom, no gap),
    // boot at the bottom.
    function makeLeg(x) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.78, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), darkMat);
      leg.position.y = -0.36;
      const knee = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.06), bodyMat);
      knee.position.set(0, -0.38, -0.13);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.12, 0.3), darkMat);
      boot.position.set(0, -0.72, -0.03);
      pivot.add(leg, knee, boot);
      return pivot;
    }
    const legL = makeLeg(-0.14);
    const legR = makeLeg(0.14);

    // Arms: dark sleeves, pivot at the shoulder, angled forward-down and
    // inward so the hands meet on the gun grip. Team stripe band on each
    // upper arm (team colour reads against the dark sleeve).
    function makeArm(x, inward) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.32, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.16), darkMat);
      arm.position.y = -0.24;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.18), bodyMat);
      stripe.position.y = -0.12;
      const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.18), bodyMat);
      elbow.position.y = -0.32;
      // Gloved hand at the end of the arm, on the gun grip (E).
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.14), darkMat);
      glove.position.set(0, -0.52, 0.01);
      pivot.add(arm, stripe, elbow, glove);
      pivot.rotation.x = ARM_FWD_X;
      pivot.rotation.z = inward;
      return pivot;
    }
    const armL = makeArm(-0.31, ARM_IN_Z);
    const armR = makeArm(0.31, -ARM_IN_Z);

    // Rifle held in both hands at chest height, barrel forward (-z).
    // Sniper variant: longer barrel + scope on top (E).
    const barrelLen = isSniper ? 0.5 : 0.2;
    const barrelZ = isSniper ? -0.97 : -0.82;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), gunMat);
    gun.position.set(0.08, 1.06, -0.38);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, barrelLen), gunMat);
    barrel.position.set(0.08, 1.07, barrelZ);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1), gunMat);
    mag.position.set(0.08, 0.97, -0.32);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.16), gunMat);
    stock.position.set(0.08, 1.06, -0.04);
    let scope = null;
    if (isSniper) {
      scope = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.24), gunMat);
      scope.position.set(0.08, 1.16, -0.45);
    }
    // Support hand: dark glove wrapped on the foregrip (E).
    const supportGlove = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.13), darkMat);
    supportGlove.position.set(0.08, 0.99, -0.56);

    group.add(torso, neck, head, helmet, helmStripe, visor, visorGlow, padL, padR,
      vestF, vestB, pouch, pouch2, pouchSide, pack, packPocket, roll, antenna,
      antennaTip, legL, legR, armL, armR, gun, barrel, mag, stock, supportGlove);
    if (scope) group.add(scope);
    group.position.set(spawn.x, 0, spawn.z);
    scene.add(group);

    // Nametag: small canvas sprite above the head, team-coloured, so a
    // teammate or an enemy reads by name at a glance. A sprite always
    // faces the camera; it hides with the body when the bot is down (B).
    const tagCanvas = document.createElement('canvas');
    tagCanvas.width = 256;
    tagCanvas.height = 64;
    const tagCtx = tagCanvas.getContext('2d');
    tagCtx.font = 'bold 34px system-ui, sans-serif';
    tagCtx.textAlign = 'center';
    tagCtx.textBaseline = 'middle';
    tagCtx.lineWidth = 7;
    tagCtx.strokeStyle = 'rgba(0,0,0,0.9)';
    tagCtx.strokeText(name, 128, 32);
    tagCtx.fillStyle = team === 'ember' ? '#ff8c2e' : '#2ec4b6';
    tagCtx.fillText(name, 128, 32);
    const nametag = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(tagCanvas), transparent: true, depthWrite: false,
    }));
    nametag.scale.set(1.7, 0.42, 1);
    nametag.position.set(0, 1.98, 0);
    group.add(nametag);

    const mover = createMover(colliders);
    mover.pos.set(spawn.x, 0, spawn.z);

    const agent = {
      id,
      team,
      isPlayer: false,
      name,
      role: roleOf({ name }),
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
      grenades: { he: 0, smoke: 0, flash: 0 },
      money: 800,
      kills: 0,
      deaths: 0,
      dmg: 0,
      hsKills: 0,
      flashUntil: 0,
      flashStrength: 0,
      mover,
      mesh: group,
      nametag,
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
      role: null, // entry | anchor | support | mid-lurk (tactics.js)
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
      variant, // 'entry' (thicker vest) | 'sniper' (long barrel + scope) | 'standard' (E)
      poseFreeze: false, // staging only: hold the walk pose at posePhase (E)
      posePhase: 0,
      fallT: 0,
      grenadeThrown: false,
      grenadeTimer: randRange(rng, 6, 14),
      parts: { torso, head, legL, legR, armL, armR, gun },
    };
    return agent;
  }

export function syncMesh(agent, dt) {
    const g = agent.mesh;
    const ai = agent.ai;
    const moving = ai.poseFreeze || ai.state === 'push' || ai.state === 'engage' || ai.state === 'retreat';
    if (ai.state === 'dead') {
      ai.fallT += dt;
      const k = Math.min(1, ai.fallT / FALL_TIME);
      g.position.copy(agent.pos);
      // Fall, then a small decaying settle wobble once the body hits the ground.
      const over = Math.max(0, ai.fallT - FALL_TIME);
      const settle = over > 0 ? 0.06 * Math.sin(over * 9) * Math.exp(-over * 4) : 0;
      g.rotation.x = -1.45 * k + settle;
      g.rotation.y = agent.yaw;
      g.rotation.z = 0;
      return;
    }
    // A frozen pose renders the walk at posePhase; a live walk uses walkPhase (E).
    const phase = ai.poseFreeze ? ai.posePhase : ai.walkPhase;
    const swing = moving ? Math.sin(phase) * 0.75 : 0;
    const bob = moving ? Math.abs(Math.sin(phase)) * 0.07 : 0;
    g.position.copy(agent.pos);
    g.position.y += bob;
    g.rotation.x = moving ? 0.08 : 0; // visible forward lean while moving (E)
    g.rotation.y = agent.yaw;
    g.rotation.z = moving ? Math.sin(phase) * 0.04 : 0; // visible sway (E)
    if (agent.nametag) agent.nametag.visible = agent.alive; // (B)
    ai.parts.legL.rotation.x = swing;
    ai.parts.legR.rotation.x = -swing;
    // Arms stay aimed forward on the gun; the stride swings them harder now (E).
    ai.parts.armL.rotation.x = ARM_FWD_X + swing * 0.35;
    ai.parts.armR.rotation.x = ARM_FWD_X - swing * 0.35;
  }
