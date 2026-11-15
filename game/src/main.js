// Cinderquay — boot and the one loop. A fixed 60 Hz simulation feeds a render
// at the display's rate; the simulation never reads the frame clock.
// ?shot=start|combat|plant|end with &seed=N arranges a deterministic frame,
// renders it twice, then freezes and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createState, damageAgent } from './state.js';
import { createPlayer } from './player.js';
import { WEAPONS, GRENADES, createWeaponRig, hitscan, throwGrenade, stepGrenades } from './weapons.js';
import { createEffects } from './effects.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { setupShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const isShot = shot === 'start' || shot === 'combat' || shot === 'plant' || shot === 'end';

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
const player = createPlayer(world.colliders);
const rig = createWeaponRig(camera);
const input = createInput(renderer.domElement, onLockChange);

// The player is agent 0; bots.js appends agents 1..9 into the same array.
const me = {
  id: 0, team: 'ember', isPlayer: true, name: 'You',
  pos: player.state.pos, vel: player.state.vel,
  yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true,
  weaponId: 'pistol', mag: 12, reserve: 36,
  grenades: { he: 0, smoke: 0 },
  money: 800, kills: 0, deaths: 0,
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
let lastFeedCount = 0;
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
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.3, 0.35),
  new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }),
);
bombBody.position.y = 0.15;
const bombLamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 8, 8),
  new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 2 }),
);
bombLamp.position.y = 0.35;
bombMesh.add(bombBody, bombLamp);
bombMesh.visible = false;
scene.add(bombMesh);

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

function applySlot() {
  if (slot === 'he' || slot === 'smoke') {
    rig.grenadeOut(slot);
    hud.setAmmo(me.grenades[slot], 0, slot === 'he' ? GRENADES.he.name : GRENADES.smoke.name);
  } else {
    rig.equip(equippedWeaponId());
    hud.setAmmo(rig.state.mag, rig.state.reserve, WEAPONS[equippedWeaponId()].name);
  }
  hud.setWeaponSlots(slot, {
    primary: me.weaponId === 'pistol' ? null : WEAPONS[me.weaponId].name,
    pistol: 'P9 Sidearm',
    he: me.grenades.he,
    smoke: me.grenades.smoke,
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
  const spread = rig.spreadOf(speed, !player.state.onGround, player.state.crouching);
  let anyHit = false;
  let anyKill = false;
  for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
    tmpDir.copy(direction);
    tmpDir.x += (state.rng() * 2 - 1) * spread;
    tmpDir.y += (state.rng() * 2 - 1) * spread;
    tmpDir.z += (state.rng() * 2 - 1) * spread;
    tmpDir.normalize();
    camera.getWorldPosition(origin);
    const hit = hitscan(origin, tmpDir, weapon.range, world.shootables, state.agents);
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
  if (kind !== 'he' && kind !== 'smoke') return;
  if (me.grenades[kind] <= 0 || throwCooldown > 0) return;
  me.grenades[kind] -= 1;
  throwCooldown = 0.6;
  camera.getWorldDirection(direction);
  camera.getWorldPosition(origin);
  throwGrenade(state, origin, direction, kind, effects);
  audio.click();
  applySlot();
  hud.setGrenades(me.grenades.he, me.grenades.smoke);
}

function buyItems() {
  const items = [];
  for (const id of ['rifle', 'smg', 'shotgun', 'sniper']) {
    items.push({ id, name: WEAPONS[id].name, price: WEAPONS[id].price, key: id === 'rifle' ? '1' : id === 'smg' ? '2' : id === 'shotgun' ? '3' : '4', owned: me.weaponId === id });
  }
  items.push({ id: 'he', name: GRENADES.he.name, price: GRENADES.he.price, key: '5', owned: false, count: me.grenades.he });
  items.push({ id: 'smoke', name: GRENADES.smoke.name, price: GRENADES.smoke.price, key: '6', owned: false, count: me.grenades.smoke });
  items.push({ id: 'armor', name: 'Kevlar vest (+50 armor)', price: 650, key: '7', owned: me.armor >= 100 });
  return items;
}

function openBuyMenu() {
  hud.showBuyMenu(buyItems(), me.money, (itemId) => {
    if (rounds.buy(me, itemId)) {
      if (itemId === 'armor') {
        // armor applied inside buy()
      } else if (itemId === 'he' || itemId === 'smoke') {
        hud.setGrenades(me.grenades.he, me.grenades.smoke);
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
    bots.step(dt, { player: me, shootables: world.shootables, effects, audio, world });
  }
  if (!isShot && (state.phase === 'buy' || state.phase === 'live' || state.phase === 'roundEnd')) {
    rounds.step(dt, { hud, audio, bots, player: me, effects, input, world });
  }
  stepGrenades(state, dt, world, effects, audio);
  effects.step(dt, state.time);
  world.update(dt, state.time);

  // Bomb device visibility (live play only; shot mode stages its own).
  if (!isShot && state.bomb.pos && (state.bomb.status === 'planted' || state.bomb.status === 'defusing' || state.bomb.status === 'idle')) {
    bombMesh.visible = true;
    bombMesh.position.copy(state.bomb.pos);
    bombLamp.material.emissiveIntensity = state.bomb.status === 'idle' ? 0.6 : (Math.sin(state.time * 6) > 0 ? 2.5 : 0.4);
  } else {
    bombMesh.visible = false;
  }

  // Grenade throw + reload + slot keys (edge-triggered).
  if (state.phase === 'live' && input.state.locked) {
    if (input.consumePressed('Digit1') && me.weaponId !== 'pistol') { slot = 'primary'; applySlot(); }
    if (input.consumePressed('Digit2')) { slot = 'pistol'; applySlot(); }
    if (input.consumePressed('Digit3') && me.grenades.he > 0) { slot = 'he'; applySlot(); }
    if (input.consumePressed('Digit4') && me.grenades.smoke > 0) { slot = 'smoke'; applySlot(); }
    if (input.consumePressed('KeyG')) throwPlayerGrenade();
    if (input.consumePressed('KeyR') && (slot === 'primary' || slot === 'pistol')) rig.reload();
    if (input.consumePressed('KeyB') && state.phase === 'buy') openBuyMenu();
  }
  if (input.state.firing && state.phase === 'live' && input.state.locked && me.alive) {
    if (slot === 'he' || slot === 'smoke') throwPlayerGrenade();
    else if (WEAPONS[rig.state.weaponId].auto || state.time - shotFiredAt > 0.25) shootPlayer();
  }
  if (input.consumePressed('Tab')) hud.setScoreboard(state.agents);
  if (input.state.keys.has('Tab')) hud.setScoreboard(state.agents);
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
  if (state.feed.length !== lastFeedCount) {
    for (let i = lastFeedCount; i < state.feed.length; i += 1) hud.feed(state.feed[i].text, state.feed[i].cls);
    lastFeedCount = state.feed.length;
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
      const hit = hitscan(origin, tmpDir, dist + 0.5, world.shootables, state.agents);
      if (hit && hit.agent === agent) visibleEnemies.add(agent.id);
    }
    hud.drawMinimap(state.agents, world.sites, state.bomb, me.yaw, visibleEnemies);
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
  if (slot === 'he' || slot === 'smoke') {
    hud.setAmmo(me.grenades[slot], 0, slot === 'he' ? GRENADES.he.name : GRENADES.smoke.name);
  } else {
    hud.setAmmo(rig.state.mag, rig.state.reserve, WEAPONS[rig.state.weaponId].name);
  }
  hud.setGrenades(me.grenades.he, me.grenades.smoke);
  hud.drawMinimap(state.agents, world.sites, state.bomb, me.yaw, visibleEnemies);
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
hud.setGrenades(0, 0);
if (isShot) {
  runShot(shot);
} else {
  hud.showOverlay('start', {});
  requestAnimationFrame(frame);
}
