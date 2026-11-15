// Shot modes CINDERQUAY — deterministic staged scenes for screenshots.
// setupShot(name, ctx) arranges agents, bomb and camera, lets the sim run a
// few fixed steps through settle(), then pushes HUD values that match
// exactly what is on screen. It never fetches anything and never touches
// the network. ctx is whatever main.js passes in (see SPEC).
import * as THREE from 'three';

const EYE = 1.6;

function yawToward(x, z, tx, tz) {
  return Math.atan2(-(tx - x), -(tz - z));
}

function forwardOf(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function setupShot(name, ctx) {
  const state = ctx.state || {};
  const world = ctx.world || {};
  const agents = ctx.agents || (ctx.bots && ctx.bots.agents) || state.agents || [];
  const hud = ctx.hud;
  const camera = ctx.camera;
  const player = agents[0] || null;
  const settle = typeof ctx.settle === 'function' ? ctx.settle : () => {};

  function byTeam(team, n) {
    const list = agents.filter((a) => a && a.team === team && !a.isPlayer);
    return list[n || 0] || null;
  }

  function place(agent, x, z, yaw, hp) {
    if (!agent) return;
    agent.alive = true;
    agent.hp = typeof hp === 'number' ? hp : 100;
    agent.yaw = yaw || 0;
    agent.pitch = 0;
    if (agent.pos) agent.pos.set(x, 0, z);
    if (agent.vel) agent.vel.set(0, 0, 0);
    if (agent.mesh) {
      agent.mesh.position.set(x, 0, z);
      agent.mesh.rotation.set(0, agent.yaw, 0);
      agent.mesh.visible = true;
    }
  }

  function drop(agent, x, z, yaw) {
    if (!agent) return;
    agent.alive = false;
    agent.hp = 0;
    agent.yaw = yaw || 0;
    if (agent.pos) agent.pos.set(x, 0, z);
    if (agent.mesh) {
      agent.mesh.position.set(x, 0.35, z);
      agent.mesh.rotation.set(-1.45, agent.yaw, 0);
      agent.mesh.visible = true;
    }
  }

  function placePlayer(x, z, yaw) {
    if (!player) return;
    place(player, x, z, yaw, player.hp > 0 ? player.hp : 100);
    const mover = (ctx.player && (ctx.player.mover || ctx.player.state)) || null;
    if (mover) {
      if (mover.pos) mover.pos.set(x, 0, z);
      if (typeof mover.yaw === 'number') mover.yaw = yaw;
      if (typeof mover.pitch === 'number') mover.pitch = 0;
      if (mover.vel) mover.vel.set(0, 0, 0);
    }
  }

  function setCamera(x, y, z, tx, ty, tz) {
    if (!camera) return;
    camera.position.set(x, y, z);
    camera.lookAt(tx, ty, tz);
  }

  // Back to a clean round: everyone alive on their own spawn line.
  function resetAgents() {
    agents.forEach((a, i) => {
      if (!a) return;
      const spread = [-8, -4, 0, 4, 8][i % 5];
      const z = a.team === 'tide' ? -20 : 20;
      place(a, spread, z, a.team === 'tide' ? Math.PI : 0, 100);
    });
  }

  // main.js re-syncs HUD money/health/ammo from the player + rig AFTER
  // setupShot returns, so the staged values must live in state, not only
  // in HUD calls — otherwise the capture would show the unstaged numbers.
  function syncRigAmmo(weaponId, mag, reserve) {
    const rig = ctx.rig;
    if (!rig) return;
    try {
      if (typeof rig.equip === 'function') rig.equip(weaponId);
    } catch (e) { /* no-op */ }
    if (rig.ammo) rig.ammo[weaponId] = { mag, reserve };
    if (rig.state) {
      rig.state.weaponId = weaponId;
      rig.state.mag = mag;
      rig.state.reserve = reserve;
    }
  }

  function baseHud(hp, armor, mag, reserve, weapon, timer, e, t, round, money) {
    if (!hud) return;
    hud.setHealth(hp, armor);
    hud.setAmmo(mag, reserve, weapon);
    hud.setTimer(timer);
    hud.setScore(e, t);
    hud.setRound(round);
    hud.setMoney(money);
    hud.setBombStatus('');
    hud.setChannel('', null);
    hud.hideBuyMenu();
    hud.setHint('');
  }

  if (name === 'start') {
    state.phase = 'menu';
    state.round = 1;
    state.roundTimeLeft = 100;
    state.scores = { ember: 0, tide: 0 };
    state.bomb = { status: 'idle', site: null, carrierId: -1, planterId: -1, defuserId: -1, progress: 0, timer: 35, pos: null };
    resetAgents();
    placePlayer(0, 20, 0);
    setCamera(0, EYE, 20, 0, 1.4, -14);
    settle(10);
    baseHud(100, 0, 12, 36, 'P9 Sidearm', 100, 0, 0, 1, 800);
    if (hud) {
      hud.setGrenades(0, 0);
      hud.setWeaponSlots('pistol', [{ id: 'pistol', name: 'P9 Sidearm' }]);
      hud.hideOverlay();
      hud.showOverlay('start');
      hud.setHint('Click PLAY to start');
    }
    return;
  }

  if (name === 'combat') {
    state.phase = 'live';
    state.round = 4;
    state.roundTimeLeft = 64;
    state.scores = { ember: 2, tide: 1 };
    state.bomb = { status: 'carried', site: null, carrierId: -1, planterId: -1, defuserId: -1, progress: 0, timer: 35, pos: null };
    resetAgents();
    if (player) {
      player.weaponId = 'rifle';
      player.mag = 22;
      player.reserve = 60;
      player.hp = 78;
      player.money = 2400;
      player.grenades = { he: 1, smoke: 0 };
    }
    // Fight at the west mid door: the rust block at (0,0) hides the centre,
    // so the player holds the west door where both Tide bots are in view.
    placePlayer(-6, 8, yawToward(-6, 8, -5, -4));
    const emberMate = byTeam('ember', 0);
    const tideMid = byTeam('tide', 0);
    const tideLane = byTeam('tide', 1);
    place(emberMate, -7.5, 3, yawToward(-7.5, 3, -5, -4));
    place(tideMid, -5, -4, yawToward(-5, -4, -6, 8));
    place(tideLane, -7, -8, yawToward(-7, -8, -6, 8));
    syncRigAmmo('rifle', 22, 60);
    setCamera(-6, EYE, 8, -5, 1.4, -4);
    settle(30);
    // Fresh tracer + frozen muzzle flash, added AFTER settle so they are
    // still bright in the capture instead of decayed.
    if (player && ctx.effects && typeof ctx.effects.addTracer === 'function') {
      const fwd = forwardOf(yawToward(-6, 8, -5, -4));
      const from = new THREE.Vector3(-6 + fwd.x * 0.6 + 0.3, 1.45, 8 + fwd.z * 0.6);
      const to = tideMid && tideMid.pos
        ? new THREE.Vector3(tideMid.pos.x, 1.2, tideMid.pos.z)
        : new THREE.Vector3(1.5, 1.2, -3);
      try { ctx.effects.addTracer(from, to, '#ffb347'); } catch (e) { /* no-op */ }
      try { ctx.effects.addImpact(to, '#ffb347'); } catch (e) { /* no-op */ }
    }
    if (ctx.rig && ctx.rig.state) {
      ctx.rig.state.flash = 1;
      ctx.rig.state.kick = 0.06;
    }
    if (hud) {
      hud.hideOverlay();
      baseHud(78, 0, 22, 60, 'KR-47 Emberline', 64, 2, 1, 4, 2400);
      hud.setGrenades(1, 0);
      hud.setWeaponSlots('rifle', [
        { id: 'pistol', name: 'P9 Sidearm' },
        { id: 'rifle', name: 'KR-47 Emberline' },
      ]);
      hud.setCrosshairGap(6);
      hud.feed('Kelp eliminated Ash', 'tide');
      hud.feed('You eliminated Brine', 'ember');
    }
    return;
  }

  if (name === 'plant') {
    state.phase = 'live';
    state.round = 4;
    state.roundTimeLeft = 24;
    state.scores = { ember: 2, tide: 1 };
    const emberDefuser = byTeam('ember', 0);
    state.bomb = {
      status: 'defusing', site: 'A', carrierId: -1, planterId: -1,
      defuserId: emberDefuser ? emberDefuser.id : -1,
      progress: 0.6, timer: 24, pos: new THREE.Vector3(-22, 0.15, -14),
    };
    resetAgents();
    if (player) {
      player.weaponId = 'rifle';
      player.mag = 18;
      player.reserve = 60;
      player.hp = 100;
      player.money = 2400;
      player.grenades = { he: 1, smoke: 0 };
    }
    placePlayer(-18, -10, yawToward(-18, -10, -22, -14));
    const tideHold = byTeam('tide', 0);
    // Hold bot just south of the site's north container, inside the frame;
    // defuser on the west side of the device (the sodium lamp post at
    // (-21.2,-14) hides anything standing east of it from this camera).
    place(tideHold, -20, -17, yawToward(-20, -17, -22, -14));
    place(emberDefuser, -23, -13, yawToward(-23, -13, -22, -14));
    syncRigAmmo('rifle', 18, 60);
    if (ctx.applySlot) ctx.applySlot();
    // Planted device: dark box + blinking orange lamp, on the site A floor.
    if (world.group) {
      const device = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.3, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }),
      );
      body.position.y = 0.15;
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 2 }),
      );
      lamp.position.y = 0.35;
      device.add(body);
      device.add(lamp);
      device.position.set(-22, 0, -14);
      world.group.add(device);
    }
    setCamera(-18, EYE, -10, -22, 1.0, -14);
    settle(30);
    if (hud) {
      hud.hideOverlay();
      baseHud(100, 0, 18, 60, 'KR-47 Emberline', 24, 2, 1, 4, 2400);
      hud.setGrenades(1, 0);
      hud.setBombStatus('BOMB PLANTED — 0:24');
      hud.setChannel('DEFUSING', 0.6);
      hud.setHint('Defuse in progress — cover the defuser!');
    }
    return;
  }

  if (name === 'end') {
    state.phase = 'roundEnd';
    state.round = 5;
    state.roundTimeLeft = 0;
    state.scores = { ember: 3, tide: 2 };
    state.roundWinner = 'ember';
    state.bomb = { status: 'exploded', site: 'A', carrierId: -1, planterId: -1, defuserId: -1, progress: 0, timer: 0, pos: null };
    resetAgents();
    const tideDown1 = byTeam('tide', 0);
    const tideDown2 = byTeam('tide', 1);
    const emberStand = byTeam('ember', 0);
    drop(tideDown1, -22, -14, 0.6);
    drop(tideDown2, -20, -12, -0.4);
    place(emberStand, -19, -11, yawToward(-19, -11, -22, -14));
    if (player) {
      player.weaponId = 'rifle';
      player.mag = 22;
      player.reserve = 60;
      player.money = 3200;
      player.hp = 100;
      player.grenades = { he: 1, smoke: 0 };
    }
    placePlayer(-14, -6, yawToward(-14, -6, -22, -14));
    syncRigAmmo('rifle', 22, 60);
    if (ctx.applySlot) ctx.applySlot();
    setCamera(-14, 3.2, -6, -22, 0.8, -14);
    settle(30); // 0.5 s: fallen bots finish their 0.4 s fall-over animation
    if (hud) {
      hud.setHealth(100, 0);
      hud.setAmmo(22, 60, 'KR-47 Emberline');
      hud.setTimer(0);
      hud.setScore(3, 2);
      hud.setRound(5);
      hud.setMoney(3200);
      hud.setBombStatus('');
      hud.setChannel('', null);
      hud.showOverlay('roundEnd', {
        score: { ember: 3, tide: 2 },
        winner: 'ember',
        reason: 'Site A cleared — Tide eliminated.',
      });
    }
    return;
  }

  // Unknown mode: fall back to the start scene rather than crashing.
  setupShot('start', ctx);
}
