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
    // v2 mid lamp post (0,4.5) sits on the lane axis from here, but it is
    // only 0.14 m wide at 15.5 m — a thin centred line, not a blocker —
    // so the v1 start composition is kept as-is.
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
    // Freeze the staged bots mid-stride (v3 character work): legs at full
    // opposite swing so the firefight reads as motion, not a standstill.
    // The sim is frozen after setupShot returns, so these poses hold for
    // the capture. freezePose lives in bots.js and touches render only.
    if (ctx.bots && typeof ctx.bots.freezePose === 'function') {
      if (tideMid) ctx.bots.freezePose(tideMid, Math.PI / 2, yawToward(-5, -4, -6, 8));
      if (tideLane) ctx.bots.freezePose(tideLane, Math.PI * 0.85, yawToward(-7, -8, -6, 8));
      if (emberMate) ctx.bots.freezePose(emberMate, Math.PI / 2.4, yawToward(-7.5, 3, -5, -4));
    }
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
      ctx.rig.state.kick = 0.02;
    }
    // Aftermath of the firefight, added AFTER settle so everything is at
    // full brightness in the capture: a just-detonated HE near the mid door
    // (the feed already shows two eliminations), residual smoke by the door,
    // and a 3-spark hit burst on the Tide bot (one impact was added above).
    if (ctx.effects) {
      try {
        if (tideMid && tideMid.pos) {
          ctx.effects.addImpact(new THREE.Vector3(tideMid.pos.x - 0.15, 1.35, tideMid.pos.z + 0.1), '#ffd27a');
          ctx.effects.addImpact(new THREE.Vector3(tideMid.pos.x + 0.15, 1.05, tideMid.pos.z - 0.1), '#ffb347');
        }
        if (typeof ctx.effects.addExplosion === 'function') ctx.effects.addExplosion(new THREE.Vector3(-4, 1, -7));
        if (typeof ctx.effects.addSmoke === 'function') ctx.effects.addSmoke(new THREE.Vector3(-1.5, 1, -8.5), 2.5, 30);
      } catch (e) { /* no-op */ }
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
      hud.feed('Kelp ▸ Ash', 'tide');
      hud.feed('You ▸ Brine — HS', 'ember');
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
    // defuser on the west side of the device. Lamp post A v2 is at
    // (-18.2,-18.2): south of the site and beyond the device from this
    // camera, so it cannot cover the defuser or the device (it only shows
    // as a thin post near the right frame edge).
    place(tideHold, -20, -17, yawToward(-20, -17, -22, -14));
    place(emberDefuser, -23, -13, yawToward(-23, -13, -22, -14));
    syncRigAmmo('rifle', 18, 60);
    if (ctx.applySlot) ctx.applySlot();
    // Planted device: cylinder body + cap + blinking lamp, on the site A floor.
    if (world.group) {
      const device = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.26, 0.3, 20),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.55, metalness: 0.35 }),
      );
      body.position.y = 0.15;
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.16, 0.08, 16),
        new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.5 }),
      );
      cap.position.y = 0.34;
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 2 }),
      );
      lamp.position.y = 0.4;
      device.add(body, cap, lamp);
      device.position.set(-22, 0, -14);
      world.group.add(device);
    }
    setCamera(-18, EYE, -10, -22, 1.0, -14);
    settle(30);
    // Covering fire + cover smoke, added AFTER settle so they are still
    // bright in the capture: the player fires one round at the Tide hold
    // bot (ammo 18/60 already accounts for it) and a smoke cloud from the
    // earlier push hangs west of the site — clear of the defuser and the
    // device. No explosion here: the bomb is planted and being defused,
    // it has not gone off.
    if (ctx.effects) {
      try {
        const fwd = forwardOf(yawToward(-18, -10, -22, -14));
        const from = new THREE.Vector3(-18 + fwd.x * 1.2 + 0.3, 1.45, -10 + fwd.z * 1.2);
        const to = tideHold && tideHold.pos
          ? new THREE.Vector3(tideHold.pos.x, 1.2, tideHold.pos.z)
          : new THREE.Vector3(-20, 1.2, -17);
        if (typeof ctx.effects.addTracer === 'function') ctx.effects.addTracer(from, to, '#ffb347');
        if (typeof ctx.effects.addImpact === 'function') ctx.effects.addImpact(to, '#ffb347');
        if (typeof ctx.effects.addSmoke === 'function') ctx.effects.addSmoke(new THREE.Vector3(-26.5, 1, -17.5), 1.2, 30);
      } catch (e) { /* no-op */ }
    }
    if (ctx.rig && ctx.rig.state) {
      ctx.rig.state.flash = 1;
      ctx.rig.state.kick = 0.02;
    }
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

  if (name === 'buy') {
    // Buy phase, round 5: the menu is open, the 12 s buy clock shows
    // 0:11, the rifle is already owned, kevlar is maxed (owned), and
    // one HE + one smoke are in the bag. Flash grenades do not exist in
    // this base yet (workstream B adds them); the shot re-shoots after
    // integration. Camera holds the spawn lane so the yard, minimap and
    // teammates stay visible behind the dimmed menu.
    state.phase = 'buy';
    state.round = 5;
    state.buyTimeLeft = 11;
    state.roundTimeLeft = 100;
    state.scores = { ember: 2, tide: 2 };
    state.bomb = { status: 'idle', site: null, carrierId: -1, planterId: -1, defuserId: -1, progress: 0, timer: 35, pos: null };
    resetAgents();
    if (player) {
      player.weaponId = 'rifle';
      player.mag = 30;
      player.reserve = 90;
      player.hp = 100;
      player.armor = 100;
      player.money = 3850;
      player.grenades = { he: 1, smoke: 1 };
    }
    placePlayer(0, 20, 0);
    syncRigAmmo('rifle', 30, 90);
    setCamera(0, EYE, 20, 0, 1.4, -14);
    // settle() runs step(), whose phase-change hook opens the buy menu
    // from the staged player values (rifle + kevlar owned, HE/SMOKE x1).
    settle(10);
    if (hud) {
      hud.hideOverlay();
      baseHud(100, 100, 30, 90, 'KR-47 Emberline', 11, 2, 2, 5, 3850);
      hud.setGrenades(1, 1);
      hud.setWeaponSlots('rifle', [
        { id: 'pistol', name: 'P9 Sidearm' },
        { id: 'rifle', name: 'KR-47 Emberline' },
      ]);
      hud.feed('You ▸ Kelp', 'ember');
      hud.feed('Ash ▸ Fathom', 'ember');
      // baseHud hides the menu, so re-open it from the staged values.
      if (typeof ctx.openBuyMenu === 'function') ctx.openBuyMenu();
      // The menu's round label and wallet line are static HTML in v2 —
      // stage them to match the round and the money above.
      const buyRound = document.getElementById('buy-round');
      if (buyRound) buyRound.textContent = '5';
      const buyMoney = document.getElementById('buy-money');
      if (buyMoney) buyMoney.textContent = '$3,850';
    }
    return;
  }

  if (name === 'scores') {
    // Round end, round 5: Ember takes it 3-2 on a site A detonation and
    // the scoreboard is open with every row filled. The v2 scoreboard
    // only renders Player / K / D / $ — the Role / DMG / HS% / MVP
    // columns are workstream B's hud.js rebuild, so this shot re-shoots
    // after integration. The round-end banner is folded into the
    // scoreboard heading (a centred overlay would cover the board).
    state.phase = 'roundEnd';
    state.round = 5;
    state.roundTimeLeft = 0;
    state.scores = { ember: 3, tide: 2 };
    state.roundWinner = 'ember';
    state.bomb = { status: 'exploded', site: 'A', carrierId: -1, planterId: -1, defuserId: -1, progress: 0, timer: 0, pos: null };
    resetAgents();
    // Staged table: the player is MVP on 7 kills; the rest of the
    // table is a plausible 5-round tally. money is the funds column;
    // dmg / hsKills fill the DMG and HS% columns (0s there read as a
    // broken board — every row must show real numbers).
    const table = {
      You: { kills: 7, deaths: 2, money: 5200, dmg: 512, hsKills: 2, alive: true },
      Ash: { kills: 5, deaths: 3, money: 4100, dmg: 380, hsKills: 1, alive: true },
      Coal: { kills: 4, deaths: 4, money: 2900, dmg: 290, hsKills: 1, alive: true },
      Rust: { kills: 3, deaths: 5, money: 1750, dmg: 210, hsKills: 0, alive: false },
      Soot: { kills: 2, deaths: 4, money: 1200, dmg: 160, hsKills: 1, alive: true },
      Brine: { kills: 6, deaths: 5, money: 3600, dmg: 470, hsKills: 2, alive: false },
      Kelp: { kills: 5, deaths: 6, money: 2400, dmg: 350, hsKills: 1, alive: false },
      Fathom: { kills: 4, deaths: 5, money: 2900, dmg: 300, hsKills: 1, alive: true },
      Salter: { kills: 3, deaths: 6, money: 1500, dmg: 190, hsKills: 0, alive: false },
      Marrow: { kills: 2, deaths: 7, money: 900, dmg: 140, hsKills: 1, alive: true },
    };
    agents.forEach((a) => {
      if (!a) return;
      const row = table[a.name] || table.You;
      a.kills = row.kills;
      a.deaths = row.deaths;
      a.money = row.money;
      a.dmg = row.dmg;
      a.hsKills = row.hsKills;
      a.alive = row.alive;
    });
    if (player) {
      player.name = 'Vex'; // renders as "You (Vex)" in the v2 board
      player.weaponId = 'rifle';
      player.mag = 22;
      player.reserve = 60;
      player.hp = 100;
      player.armor = 50;
      player.money = 5200;
      player.grenades = { he: 1, smoke: 0 };
    }
    // Same site A composition as 'end': fallen Tide bots at the frame
    // edges, one standing Ember guard, the blast site in view — the
    // centred board covers the middle, the yard shows around it.
    const tideDown1 = byTeam('tide', 0);
    const tideDown2 = byTeam('tide', 1);
    const emberStand = byTeam('ember', 0);
    drop(tideDown1, -19.5, -11.5, 2.3);
    drop(tideDown2, -22, -12.5, -0.84);
    place(emberStand, -17.5, -13.5, yawToward(-17.5, -13.5, -22, -14));
    placePlayer(-16.5, -9, yawToward(-16.5, -9, -21, -14));
    if (player) player.pitch = 0.18;
    syncRigAmmo('rifle', 22, 60);
    if (ctx.applySlot) ctx.applySlot();
    setCamera(-16.5, EYE, -9, -21, 0.7, -14);
    settle(30);
    if (ctx.effects && typeof ctx.effects.addExplosion === 'function') {
      try { ctx.effects.addExplosion(new THREE.Vector3(-22, 1, -14)); } catch (e) { /* no-op */ }
    }
    if (hud) {
      hud.hideOverlay();
      hud.hideBuyMenu();
      hud.setHealth(100, 50);
      hud.setAmmo(22, 60, 'KR-47 Emberline');
      hud.setTimer(0);
      hud.setScore(3, 2);
      hud.setRound(5);
      hud.setMoney(5200);
      hud.setBombStatus('');
      hud.setChannel('', null);
      hud.setHint('');
      hud.setGrenades(1, 0);
      hud.feed('You ▸ Brine — HS', 'ember');
      hud.feed('Ash ▸ Kelp', 'ember');
      hud.feed('Brine ▸ Rust', 'tide');
      hud.setScoreboard(agents, {
        banner: 'EMBER TAKES ROUND 5 — MVP You ★',
        streakText: 'EMBER W2 · TIDE L1',
      });
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
    // Fallen bots spread LEFT and RIGHT of centre so they stay visible
    // beside/below the centred roundEnd panel instead of hiding behind it,
    // and parked inside the light: tideDown1 ~2.5 m from the staged
    // explosion at the site, tideDown2 ~2.7 m from the v2 lamp A pool
    // (-18.2,-18.2), so both catch strong light from above/beside instead
    // of lying dark on dark ground. Camera moved closer than v1 (player at
    // (-16.5,-9) instead of (-14,-6)) and pitched UP (+0.18) so the ground
    // — and the bodies on it — drops into the strip below the panel, while
    // the standing Ember guard is pushed far right (x ~1000) so the panel
    // never covers it. The fallen bots' yaws put their bodies ACROSS the
    // frame (not foreshortened toward the camera) so they read as bodies,
    // not dark blobs: tideDown1 head-left, tideDown2 head-right.
    // NOTE: setCamera below is only nominal — settle() re-syncs the camera
    // from the player position/yaw/pitch, so the player placement IS the
    // camera placement here.
    drop(tideDown1, -19.5, -11.5, 2.3);
    drop(tideDown2, -22, -12.5, -0.84);
    place(emberStand, -17.5, -13.5, yawToward(-17.5, -13.5, -22, -14));
    if (player) {
      player.weaponId = 'rifle';
      player.mag = 22;
      player.reserve = 60;
      player.money = 3200;
      player.hp = 100;
      player.grenades = { he: 1, smoke: 0 };
    }
    placePlayer(-16.5, -9, yawToward(-16.5, -9, -21, -14));
    if (player) player.pitch = 0.18;
    syncRigAmmo('rifle', 22, 60);
    if (ctx.applySlot) ctx.applySlot();
    setCamera(-16.5, EYE, -9, -21, 0.7, -14);
    settle(30); // 0.5 s: fallen bots finish their 0.4 s fall-over animation
    // Fresh explosion glow at the site, added AFTER settle so it is still
    // at full brightness in the capture: its light spills onto the fallen
    // bots and the ground around the panel.
    if (ctx.effects && typeof ctx.effects.addExplosion === 'function') {
      try { ctx.effects.addExplosion(new THREE.Vector3(-22, 1, -14)); } catch (e) { /* no-op */ }
    }
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
