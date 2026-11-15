// Cinderquay — boot and the one loop. A fixed 60 Hz simulation feeds a render
// at the display's rate; the simulation never reads the frame clock.
// ?shot=start|combat|plant|end|buy|scores with &seed=N arranges a deterministic frame,
// renders it twice, then freezes and sets window.__shotReady.
//
// Where the systems live (this file only wires them together):
//   rounds / buy timers / win checks -> rounds.js (createRounds)
//   economy: buy catalogue + round rewards -> economy.js
//   bomb: plant/defuse channels + fuse + device mesh -> bomb.js
//   bot AI: brain + shooting -> bots.js (createBots); mesh in botmodels.js
//   bot movement: waypoints + BFS -> nav.js; hearing -> hearing.js
//   bot roles + site push + rotation -> tactics.js
//   weapons: WEAPONS/GRENADES tables + hitscan -> weapons.js
//   viewmodel: first-person rig + flash + recoil -> viewmodel.js
//   grenades: HE/smoke throws + fuse -> grenades.js
//   map, lighting, sites, spawns, waypoints, colliders -> world.js (createWorld)
//   HUD: health/ammo/timer/score/kill feed/overlays/buy menu -> hud.js (createHud)
//   minimap canvas drawing -> minimap.js
//   audio: synth WebAudio shots/hits/kills/UI -> audio.js (createAudio)
//   player movement + collision -> player.js; input + pointer lock -> input.js
//   round state + damage -> state.js; deterministic RNG -> rng.js
//   tracers/impacts/explosions/smoke -> effects.js; staged screenshots -> shots.js
// No network, no multiplayer, no dependencies beyond three.js.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createState, damageAgent } from './state.js';
import { createPlayer } from './player.js';
import { WEAPONS, GRENADES, hitscan } from './weapons.js';
import { createWeaponRig } from './viewmodel.js';
import { throwGrenade, stepGrenades } from './grenades.js';
import { menuItemsForPlayer } from './economy.js';
import { createBombDevice } from './bomb.js';
import { createEffects } from './effects.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createRadio } from './radio.js';
import { createZones } from './zones.js';
import { setupShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const isShot = shot === 'start' || shot === 'combat' || shot === 'plant' || shot === 'end' ||
  shot === 'buy' || shot === 'scores';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 30, 90);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const world = createWorld(scene);
const state = createState(seed);
const effects = createEffects(scene);
const hud = createHud();
const audio = createAudio();
const radio = createRadio(state);
const zones = createZones(scene, world);
const player = createPlayer(world.colliders);
const rig = createWeaponRig(camera);
const input = createInput(renderer.domElement, onLockChange);

// The player is agent 0; bots.js appends agents 1..9 into the same array.
const me = {
  id: 0, team: 'ember', isPlayer: true, name: 'You',
  role: 'Entry',
  pos: player.state.pos, vel: player.state.vel,
  yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true,
  weaponId: 'pistol', mag: 12, reserve: 36,
  grenades: { he: 0, smoke: 0, flash: 0 },
  money: 800, kills: 0, deaths: 0, dmg: 0, hsKills: 0,
  defuseKit: false, flashUntil: 0, flashStrength: 0,
  mover: player.state, mesh: null, hitMeshes: [],
  ai: null, crouching: false, onGround: true,
};
state.agents.push(me);
const bots = createBots(scene, world, state);
const rounds = createRounds(state, world);

const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3();
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpPoint = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const visibleEnemies = new Set();

let frozen = false;
let paused = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let lastFeedHead = null; // newest state.feed entry already rendered
let lastBanner = null;
let lastScoreE = -1;
let lastScoreT = -1;
let lastMoney = -1;
let lastRound = -1;
let lastPhase = '';
let throwCooldown = 0;
let minimapTimer = 0;
let shotFiredAt = -10;
let lastAlive = true;
let slot = 'primary'; // primary | pistol | he | smoke

// Planted/dropped bomb device (live play only; shot mode stages its own).
// Built by bomb.js; the mesh names (bombMesh/bombBody/bombLamp) live there.
const bombDevice = createBombDevice(scene);

function syncCamera() {
  camera.position.set(me.pos.x, me.pos.y + player.state.eye, me.pos.z);
  camera.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
  const targetFov = input.state.scoped && rig.state.weaponId === 'sniper' ? 74 / WEAPONS.sniper.zoom : 74;
  if (Math.abs(camera.fov - targetFov) > 0.2) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
}

function equippedWeaponId() {
  return slot === 'pistol' ? 'pistol' : me.weaponId;
}

// Current flash blindness, 0 = clear, 1 = full whiteout. Fades linearly
// over the flash duration from the strength the pop set.
function playerBlind() {
  if ((me.flashUntil || 0) <= state.time) return 0;
  const remain = (me.flashUntil - state.time) / GRENADES.flash.duration;
  return Math.max(0, Math.min(1, (me.flashStrength || 0) * remain));
}

// Team plan + the player's role this round, for the top-bar label.
function currentPlan() {
  if (state.phase !== 'buy' && state.phase !== 'live') return '';
  const site = state.bomb.site || 'A';
  if (state.attackSide === 'ember') return `PLAN: SPLIT ${site} — YOU: ENTRY`;
  return `PLAN: HOLD ${site} — YOU: ANCHOR`;
}

// Scoreboard meta: round-end banner naming the winner + MVP, and the
// current W/L streak per team (W from state.streak, L from state.losses).
function scoreboardMeta() {
  let banner = '';
  if (state.roundWinner) {
    const mvp = state.mvpName || '—';
    banner = `${state.roundWinner.toUpperCase()} WIN — MVP ${mvp === 'You' ? 'You' : mvp}`;
  }
  const streakOf = (team) => {
    const w = (state.streak && state.streak[team]) || 0;
    if (w > 0) return 'W' + w;
    const l = (state.losses && state.losses[team]) || 0;
    if (l > 0) return 'L' + l;
    return '—';
  };
  return {
    banner,
    streakText: `EMBER ${streakOf('ember')} · TIDE ${streakOf('tide')}`,
  };
}

function applySlot() {
  if (slot === 'he' || slot === 'smoke' || slot === 'flash') {
    rig.grenadeOut(slot);
    const label = slot === 'he' ? GRENADES.he.name : slot === 'smoke' ? GRENADES.smoke.name : GRENADES.flash.name;
    hud.setAmmo(me.grenades[slot], 0, label);
  } else {
    rig.equip(equippedWeaponId());
    hud.setAmmo(rig.state.mag, rig.state.reserve, WEAPONS[equippedWeaponId()].name);
  }
  hud.setWeaponSlots(slot, {
    primary: me.weaponId === 'pistol' ? null : WEAPONS[me.weaponId].name,
    pistol: 'P9 Sidearm',
    he: me.grenades.he,
    smoke: me.grenades.smoke,
    flash: me.grenades.flash,
  });
}

function shootPlayer() {
  if (!rig.ready()) return;
  if (!rig.takeRound()) {
    audio.dry();
    return;
  }
  const weapon = WEAPONS[rig.state.weaponId];
  camera.getWorldDirection(direction);
  const speed = player.groundSpeed();
  // A flash-blind shooter sprays wide: up to 3x spread at full whiteout.
  const blind = playerBlind();
  const spread = rig.spreadOf(speed, !player.state.onGround, player.state.crouching) * (1 + 2 * blind);
  let anyHit = false;
  let anyKill = false;
  for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
    tmpDir.copy(direction);
    tmpDir.x += (state.rng() * 2 - 1) * spread;
    tmpDir.y += (state.rng() * 2 - 1) * spread;
    tmpDir.z += (state.rng() * 2 - 1) * spread;
    tmpDir.normalize();
    camera.getWorldPosition(origin);
    const hit = hitscan(origin, tmpDir, weapon.range, world.shootables, state.agents, me);
    muzzle.set(0.24, -0.16, -0.9).applyMatrix4(camera.matrixWorld);
    if (hit && hit.agent) {
      const dmg = weapon.damage * (hit.part === 'head' ? weapon.headMult : 1);
      const result = damageAgent(state, hit.agent, dmg, hit.part === 'head', me);
      anyHit = true;
      if (result === 'kill') anyKill = true;
      effects.addTracer(muzzle, hit.point, 0xffc46b);
      effects.addImpact(hit.point, 0xffc46b);
      if (result === 'kill') audio.kill();
      else audio.hit();
    } else if (hit) {
      effects.addTracer(muzzle, hit.point, 0xffc46b);
      effects.addImpact(hit.point, 0x9a938a);
    } else {
      tmpPoint.copy(origin).addScaledVector(tmpDir, weapon.range);
      effects.addTracer(muzzle, tmpPoint, 0xffc46b);
    }
  }
  rig.pullTrigger();
  player.recoil(weapon.recoilPitch, (state.rng() * 2 - 1) * weapon.recoilYaw);
  audio.shot(rig.state.weaponId, 0);
  bots.hearShot(origin); // nearby bots hear the shot and investigate
  if (anyHit) hud.hitMarker(anyKill);
  hud.setAmmo(rig.state.mag, rig.state.reserve, weapon.name);
  hud.setCrosshairGap(5 + Math.min(spread, 0.05) * 300);
  shotFiredAt = state.time;
  me.mag = rig.state.mag;
  me.reserve = rig.state.reserve;
}

function throwPlayerGrenade() {
  const kind = slot;
  if (kind !== 'he' && kind !== 'smoke' && kind !== 'flash') return;
  if (me.grenades[kind] <= 0 || throwCooldown > 0) return;
  me.grenades[kind] -= 1;
  throwCooldown = 0.6;
  camera.getWorldDirection(direction);
  camera.getWorldPosition(origin);
  throwGrenade(state, origin, direction, kind, effects);
  audio.click();
  applySlot();
  hud.setGrenades(me.grenades.he, me.grenades.smoke, me.grenades.flash);
}

function openBuyMenu() {
  hud.showBuyMenu(menuItemsForPlayer(me), me.money, (itemId) => {
    if (rounds.buy(me, itemId)) {
      if (itemId === 'armor' || itemId === 'defuse') {
        // Applied inside buy(); nothing else to sync.
      } else if (itemId === 'he' || itemId === 'smoke' || itemId === 'flash') {
        hud.setGrenades(me.grenades.he, me.grenades.smoke, me.grenades.flash);
      } else {
        me.weaponId = itemId;
        rig.ammo[itemId] = { mag: WEAPONS[itemId].mag, reserve: WEAPONS[itemId].reserve };
        slot = 'primary';
        applySlot();
      }
      audio.click();
      hud.setMoney(me.money);
      openBuyMenu();
    }
  });
  hud.setMoney(me.money);
}

function step(dt) {
  state.time += dt;
  throwCooldown = Math.max(0, throwCooldown - dt);

  // Player movement from input (only while live and locked, or in shot mode).
  // A dead player cannot move or shoot; the round plays on with the bots.
  if (state.phase === 'live' && (input.state.locked || isShot) && me.alive) {
    const keys = input.state.keys;
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(me.yaw);
    const cos = Math.cos(me.yaw);
    let wx = 0;
    let wz = 0;
    if (forward || strafe) {
      wx = -sin * forward + cos * strafe;
      wz = -cos * forward - sin * strafe;
      const len = Math.hypot(wx, wz) || 1;
      wx /= len;
      wz /= len;
    }
    const speed = player.state.crouching ? 2.4 : 5.2;
    player.state.step(dt, wx, wz, speed, keys.has('ControlLeft') || keys.has('KeyC'), keys.has('Space'));
    me.yaw = player.state.yaw;
    me.pitch = player.state.pitch;
    me.crouching = player.state.crouching;
    me.onGround = player.state.onGround;
    me.pos.copy(player.state.pos);
    me.vel.copy(player.state.vel);
  }

  rig.step(dt);
  // Bots only move and fight while a round is live; they stand at spawn
  // during buy / round-end. Rounds owns the buy / live / round-end timers.
  // In shot mode rounds.step is skipped entirely: the staged scene must not
  // be advanced by round timers (a roundEnd settle would startRound() and
  // reset every staged bot).
  if (state.phase === 'live') {
    bots.step(dt, { player: me, shootables: world.shootables, effects, audio, world, radio });
  }
  if (!isShot && (state.phase === 'buy' || state.phase === 'live' || state.phase === 'roundEnd')) {
    rounds.step(dt, { hud, audio, bots, player: me, effects, input, world, radio });
  }
  stepGrenades(state, dt, world, effects, audio);
  effects.step(dt, state.time);
  world.update(dt, state.time);
  zones.update(dt, state);

  // Bomb device visibility (live play only; shot mode stages its own).
  if (!isShot) bombDevice.sync(state, state.time);

  // Grenade throw + reload + slot keys (edge-triggered).
  if (state.phase === 'live' && input.state.locked) {
    if (input.consumePressed('Digit1') && me.weaponId !== 'pistol') { slot = 'primary'; applySlot(); }
    if (input.consumePressed('Digit2')) { slot = 'pistol'; applySlot(); }
    if (input.consumePressed('Digit3') && me.grenades.he > 0) { slot = 'he'; applySlot(); }
    if (input.consumePressed('Digit4') && me.grenades.smoke > 0) { slot = 'smoke'; applySlot(); }
    if (input.consumePressed('Digit5') && me.grenades.flash > 0) { slot = 'flash'; applySlot(); }
    if (input.consumePressed('KeyG')) throwPlayerGrenade();
    if (input.consumePressed('KeyR') && (slot === 'primary' || slot === 'pistol')) rig.reload();
    if (input.consumePressed('KeyB') && state.phase === 'buy') openBuyMenu();
  }
  if (input.state.firing && state.phase === 'live' && input.state.locked && me.alive) {
    if (slot === 'he' || slot === 'smoke' || slot === 'flash') throwPlayerGrenade();
    else if (WEAPONS[rig.state.weaponId].auto || state.time - shotFiredAt > 0.25) shootPlayer();
  }
  if (input.consumePressed('Tab')) hud.setScoreboard(state.agents, scoreboardMeta());
  if (input.state.keys.has('Tab')) hud.setScoreboard(state.agents, scoreboardMeta());
  else hud.hideScoreboard();

  // Death / revive transitions.
  if (!me.alive && lastAlive) {
    lastAlive = false;
    hud.banner('YOU ARE DOWN', 'Your team fights on — you are back next round', 3500);
    hud.damageFlash();
  } else if (me.alive && !lastAlive) {
    lastAlive = true;
  }

  // Sync HUD from state (hud caches, so unchanged values skip DOM writes).
  hud.setHealth(me.hp, me.armor);
  hud.setPlan(currentPlan());
  hud.setFlash(playerBlind());
  // Ammo comes from the rig so a finished reload shows up without a shot.
  if (slot === 'primary' || slot === 'pistol') {
    me.mag = rig.state.mag;
    me.reserve = rig.state.reserve;
    hud.setAmmo(rig.state.mag, rig.state.reserve, WEAPONS[rig.state.weaponId].name);
  }
  hud.setTimer(Math.max(0, Math.ceil(state.phase === 'buy' ? state.buyTimeLeft : state.roundTimeLeft)));
  if (state.scores.ember !== lastScoreE || state.scores.tide !== lastScoreT) {
    lastScoreE = state.scores.ember;
    lastScoreT = state.scores.tide;
    hud.setScore(lastScoreE, lastScoreT);
  }
  if (me.money !== lastMoney) {
    lastMoney = me.money;
    hud.setMoney(lastMoney);
  }
  if (state.round !== lastRound) {
    lastRound = state.round;
    hud.setRound(lastRound);
  }
  // Feed sync by newest-entry reference, not by length: addFeed caps the
  // array at 6, so once the cap is hit the length stops growing and a
  // length index would re-render the oldest line and drop newer ones.
  // New entries sit ahead of lastFeedHead; if the head was pushed out by
  // the cap, skip the batch rather than duplicate lines.
  {
    const feed = state.feed;
    let fresh = 0;
    if (lastFeedHead === null) {
      fresh = feed.length;
    } else {
      while (fresh < feed.length && feed[fresh] !== lastFeedHead) fresh += 1;
      if (fresh === feed.length && feed.length > 0) fresh = -1;
    }
    if (fresh > 0) {
      for (let i = fresh - 1; i >= 0; i -= 1) hud.feed(feed[i].text, feed[i].cls);
    }
    if (feed.length > 0) lastFeedHead = feed[0];
  }
  if (state.banner !== lastBanner) {
    lastBanner = state.banner;
    if (lastBanner) hud.banner(lastBanner.title, lastBanner.sub, 4000);
  }
  if (state.phase !== lastPhase) {
    lastPhase = state.phase;
    if (lastPhase === 'buy') {
      hud.hideOverlay();
      openBuyMenu();
    } else hud.hideBuyMenu();
    if (lastPhase === 'live' && !input.state.locked && !isShot) {
      // Buy timer expired without a Deploy click: freeze the sim behind a
      // pause overlay until the player clicks to lock in.
      paused = true;
      hud.showOverlay('paused', {});
    }
    if (lastPhase === 'matchEnd') {
      if (document.pointerLockElement) document.exitPointerLock();
      hud.showOverlay('matchEnd', { winner: state.matchWinner, score: state.scores });
    }
  }
  if (state.phase === 'buy') hud.setTimer(Math.max(0, Math.ceil(state.buyTimeLeft)));

  // Minimap at ~4 Hz.
  minimapTimer += dt;
  if (minimapTimer > 0.25) {
    minimapTimer = 0;
    visibleEnemies.clear();
    for (const agent of state.agents) {
      if (!agent.alive || agent.team !== 'tide' || agent.isPlayer) continue;
      tmpPoint.set(agent.pos.x, agent.pos.y + 1.2, agent.pos.z);
      origin.set(me.pos.x, me.pos.y + player.state.eye, me.pos.z);
      tmpDir.copy(tmpPoint).sub(origin);
      const dist = tmpDir.length();
      if (dist > 70) continue;
      tmpDir.normalize();
      const hit = hitscan(origin, tmpDir, dist + 0.5, world.shootables, state.agents, me);
      if (hit && hit.agent === agent) visibleEnemies.add(agent.id);
    }
    hud.drawMinimap(state.agents, world.sites, state.bomb, me.yaw, visibleEnemies, world.colliders);
  }

  // Damage vignette fades with health.
  hud.setHealth(me.hp, me.armor);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && !paused) {
    const look = input.takeLook();
    if (input.state.locked) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  syncCamera();
}

function runShot(name) {
  // Shot mode: feed entries and the banner must not expire on virtual time
  // before the capture (hud checks this flag).
  window.__cqShot = true;
  hud.hideOverlay();
  hud.hideBuyMenu();
  setupShot(name, {
    state, world, agents: state.agents, bots, rounds, hud,
    player, rig, effects, camera, settle, rng: state.rng,
    applySlot, openBuyMenu, me,
  });
  hud.setScore(state.scores.ember, state.scores.tide);
  hud.setRound(state.round);
  hud.setMoney(me.money);
  hud.setHealth(me.hp, me.armor);
  hud.setPlan(currentPlan());
  zones.update(0, state);
  if (slot === 'he' || slot === 'smoke' || slot === 'flash') {
    hud.setAmmo(me.grenades[slot], 0, slot === 'he' ? GRENADES.he.name : slot === 'smoke' ? GRENADES.smoke.name : GRENADES.flash.name);
  } else {
    hud.setAmmo(rig.state.mag, rig.state.reserve, WEAPONS[rig.state.weaponId].name);
  }
  hud.setGrenades(me.grenades.he, me.grenades.smoke, me.grenades.flash);
  hud.drawMinimap(state.agents, world.sites, state.bomb, me.yaw, visibleEnemies, world.colliders);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function onLockChange(locked) {
  if (isShot) return;
  if (locked) {
    paused = false;
    hud.hideOverlay();
    audio.ensure();
  } else if (state.phase === 'live' && started) {
    paused = true;
    hud.showOverlay('paused', {});
  } else if (!started) {
    hud.showOverlay('start', {});
  }
}

hud.onPlay(() => {
  if (isShot) return;
  audio.ensure();
  if (state.phase === 'matchEnd' || (state.phase === 'roundEnd' && state.matchWinner)) {
    rounds.startMatch();
    started = true;
    input.requestLock();
    return;
  }
  if (!started) {
    started = true;
    rounds.startMatch();
  }
  input.requestLock();
});

hud.onRestart(() => {
  if (isShot) return;
  // Only a finished match restarts from here; any other overlay is just a
  // resume (hud routes roundEnd clicks here too, and those must NOT restart).
  if (state.phase === 'matchEnd') {
    rounds.startMatch();
    started = true;
  }
  input.requestLock();
});

document.getElementById('deploy-btn').addEventListener('click', () => {
  if (isShot) return;
  hud.hideBuyMenu();
  audio.ensure();
  input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
applySlot();
hud.setHealth(100, 0);
hud.setGrenades(0, 0, 0);
if (isShot) {
  runShot(shot);
} else {
  hud.showOverlay('start', {});
  requestAnimationFrame(frame);
}
