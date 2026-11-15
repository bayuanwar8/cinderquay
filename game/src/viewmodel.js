// viewmodel.js — first-person weapon rig for CINDERQUAY.
// Owns: the weapon view models, muzzle flash, recoil kick, walk bob /
// idle sway, reload dip, ammo-per-weapon state and spread. The arsenal
// table itself stays in weapons.js; this module only renders and fires
// through it.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

const MUZZLE_TIME = 0.06;
const MOVE_REFERENCE = 5.2;

function box(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(r, len, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

export function createWeaponRig(camera) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.55, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.8, metalness: 0.2 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.75, metalness: 0.05 });
  const ember = new THREE.MeshStandardMaterial({ color: 0xff8c2e, roughness: 0.5, metalness: 0.3 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x2ec4b6, roughness: 0.5, metalness: 0.3 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc99a2e, roughness: 0.4, metalness: 0.7 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x4a4030, roughness: 0.9, metalness: 0.05 });
  const shellRed = new THREE.MeshStandardMaterial({ color: 0x8c2f26, roughness: 0.5, metalness: 0.3 });

  // Simple gloved hand wrapped around a vertical grip: palm behind the
  // grip, curled fingers in front, thumb on the inner side. (No forearm:
  // the long sleeve bars read as floating boxes in first person, so the
  // hands end at the wrist.)
  function gripHand() {
    const hand = new THREE.Group();
    hand.add(box(0.062, 0.06, 0.075, glove, 0, 0, 0.01));
    hand.add(box(0.058, 0.016, 0.02, glove, 0, -0.022, -0.038));
    hand.add(box(0.058, 0.016, 0.02, glove, 0, -0.002, -0.042));
    hand.add(box(0.058, 0.016, 0.02, glove, 0, 0.018, -0.038));
    hand.add(box(0.016, 0.018, 0.055, glove, -0.036, 0.008, -0.005));
    hand.add(box(0.055, 0.05, 0.07, glove, 0, -0.005, 0.07));
    return hand;
  }

  // Support hand under a horizontal handguard / pump: palm below, fingers
  // curled over the top, forearm angling down-left toward the screen edge.
  function supportHand() {
    const hand = new THREE.Group();
    hand.add(box(0.06, 0.05, 0.085, glove, 0, -0.055, 0));
    hand.add(box(0.056, 0.016, 0.02, glove, 0, 0.045, -0.025));
    hand.add(box(0.056, 0.016, 0.02, glove, 0, 0.045, 0));
    hand.add(box(0.056, 0.016, 0.02, glove, 0, 0.045, 0.025));
    hand.add(box(0.016, 0.018, 0.05, glove, 0.036, -0.03, 0));
    return hand;
  }

  // One low-poly assembly per weapon, each with its own silhouette: the
  // pistol is short and flat, the rifle long with a wooden stock and amber
  // stripe, the SMG stubby with a teal grip and suppressor, the sniper the
  // longest with a scope and brass ring, the shotgun fat with a wide pump.
  const models = {};
  const muzzleZ = {};

  const pistol = new THREE.Group();
  pistol.add(box(0.05, 0.07, 0.26, steel, 0, 0.01, -0.08));
  pistol.add(box(0.045, 0.09, 0.05, dark, 0, -0.05, 0.04));
  pistol.add(box(0.02, 0.02, 0.06, brass, 0, 0.05, -0.2));
  pistol.add(cyl(0.011, 0.04, dark, 0, 0.01, -0.21)); // round muzzle tip
  pistol.add(box(0.012, 0.03, 0.012, dark, 0, -0.03, -0.005)); // trigger
  pistol.add(box(0.04, 0.008, 0.07, dark, 0, -0.048, 0.0)); // trigger guard
  pistol.add(box(0.01, 0.018, 0.01, brass, 0, 0.055, -0.19)); // front sight
  pistol.add(box(0.012, 0.014, 0.012, dark, -0.014, 0.052, 0.03)); // rear sight L
  pistol.add(box(0.012, 0.014, 0.012, dark, 0.014, 0.052, 0.03)); // rear sight R
  for (let i = 0; i < 3; i++) { // slide serrations, both sides
    pistol.add(box(0.004, 0.05, 0.012, dark, -0.026, 0.01, 0.0 + i * 0.02));
    pistol.add(box(0.004, 0.05, 0.012, dark, 0.026, 0.01, 0.0 + i * 0.02));
  }
  pistol.add(box(0.05, 0.018, 0.055, dark, 0, -0.1, 0.04)); // mag baseplate
  pistol.add(box(0.014, 0.02, 0.014, dark, 0, 0.05, 0.045)); // hammer
  const pistolHand = gripHand();
  pistolHand.position.set(0, -0.05, 0.04);
  pistol.add(pistolHand);
  models.pistol = pistol;
  muzzleZ.pistol = -0.24;

  const rifle = new THREE.Group();
  rifle.add(box(0.07, 0.09, 0.5, steel, 0, 0, -0.1));
  rifle.add(box(0.04, 0.04, 0.42, dark, 0, 0.02, -0.5));
  rifle.add(cyl(0.016, 0.34, steel, 0, 0.02, -0.55)); // round barrel
  rifle.add(box(0.06, 0.08, 0.24, wood, 0, -0.01, 0.26));
  rifle.add(box(0.075, 0.015, 0.3, ember, 0, 0.052, -0.1));
  rifle.add(box(0.05, 0.12, 0.04, dark, 0, -0.08, -0.02));
  rifle.add(box(0.03, 0.03, 0.1, dark, 0, 0.06, -0.3));
  rifle.add(box(0.012, 0.035, 0.012, dark, 0, -0.045, -0.055)); // trigger
  rifle.add(box(0.04, 0.01, 0.08, dark, 0, -0.062, -0.045)); // trigger guard
  const rifleMag = box(0.045, 0.15, 0.07, steel, 0, -0.14, -0.06); // curved mag
  rifleMag.rotation.x = 0.28;
  rifle.add(rifleMag);
  rifle.add(box(0.05, 0.02, 0.08, dark, 0, -0.21, -0.02)); // mag base
  rifle.add(box(0.03, 0.015, 0.04, dark, 0.045, 0.02, 0.06)); // charging handle
  rifle.add(box(0.012, 0.045, 0.012, dark, 0, 0.065, -0.68)); // front sight post
  rifle.add(box(0.03, 0.01, 0.01, dark, 0, 0.088, -0.68)); // front sight ears
  rifle.add(box(0.012, 0.02, 0.012, dark, -0.015, 0.06, 0.1)); // rear sight L
  rifle.add(box(0.012, 0.02, 0.012, dark, 0.015, 0.06, 0.1)); // rear sight R
  rifle.add(box(0.05, 0.05, 0.07, dark, 0, 0.02, -0.72)); // muzzle brake
  rifle.add(box(0.004, 0.03, 0.09, dark, 0.037, 0.01, -0.12)); // ejection port
  const rifleHand = gripHand();
  rifleHand.position.set(0, -0.08, -0.02);
  rifle.add(rifleHand);
  const rifleSupport = supportHand();
  rifleSupport.position.set(0, 0.02, -0.5);
  rifle.add(rifleSupport);
  models.rifle = rifle;
  muzzleZ.rifle = -0.74;

  const smg = new THREE.Group();
  smg.add(box(0.07, 0.08, 0.3, dark, 0, 0, -0.02));
  smg.add(cyl(0.032, 0.2, teal, 0, 0.01, -0.28)); // round suppressor
  smg.add(box(0.05, 0.11, 0.05, teal, 0, -0.07, 0.02));
  smg.add(box(0.04, 0.04, 0.16, steel, 0, 0, 0.16));
  smg.add(box(0.02, 0.05, 0.02, brass, 0, 0.06, -0.14));
  smg.add(box(0.012, 0.03, 0.012, dark, 0, -0.04, -0.02)); // trigger
  smg.add(box(0.04, 0.01, 0.07, dark, 0, -0.055, -0.01)); // trigger guard
  smg.add(box(0.035, 0.17, 0.045, steel, 0, -0.15, -0.02)); // stick mag
  smg.add(box(0.04, 0.018, 0.05, dark, 0, -0.24, -0.02)); // mag base
  smg.add(box(0.01, 0.03, 0.01, dark, 0, 0.05, -0.36)); // front sight
  smg.add(box(0.012, 0.018, 0.012, dark, -0.014, 0.05, 0.06)); // rear sight L
  smg.add(box(0.012, 0.018, 0.012, dark, 0.014, 0.05, 0.06)); // rear sight R
  smg.add(box(0.05, 0.02, 0.03, steel, 0, 0.05, -0.08)); // top charging handle
  smg.add(box(0.05, 0.09, 0.02, dark, 0, -0.01, 0.24)); // butt plate
  const smgHand = gripHand();
  smgHand.position.set(0, -0.07, 0.02);
  smg.add(smgHand);
  const smgSupport = supportHand();
  smgSupport.position.set(0, 0.0, -0.28);
  smg.add(smgSupport);
  models.smg = smg;
  muzzleZ.smg = -0.4;

  const sniper = new THREE.Group();
  sniper.add(box(0.06, 0.08, 0.55, steel, 0, 0, -0.05));
  sniper.add(cyl(0.014, 0.5, dark, 0, 0.015, -0.55)); // round barrel
  sniper.add(cyl(0.028, 0.2, dark, 0, 0.065, -0.12)); // round scope tube
  sniper.add(cyl(0.031, 0.02, brass, 0, 0.065, -0.12)); // scope ring
  sniper.add(box(0.06, 0.09, 0.26, wood, 0, -0.01, 0.32));
  sniper.add(box(0.05, 0.02, 0.08, dark, 0, 0, 0.48));
  sniper.add(box(0.05, 0.1, 0.045, dark, 0, -0.07, 0.08)); // grip
  sniper.add(box(0.012, 0.03, 0.012, dark, 0, -0.04, 0.045)); // trigger
  sniper.add(box(0.04, 0.01, 0.07, dark, 0, -0.055, 0.05)); // trigger guard
  sniper.add(box(0.05, 0.09, 0.08, steel, 0, -0.1, -0.02)); // magazine
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.032, 0.07, 12), dark);
  bell.rotation.x = Math.PI / 2;
  bell.position.set(0, 0.065, -0.25); // scope objective bell
  sniper.add(bell);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.026, 12),
    new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x2ec4b6, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1 }),
  );
  lens.position.set(0, 0.065, -0.286); // lens glint, faces forward
  lens.rotation.y = Math.PI;
  sniper.add(lens);
  sniper.add(box(0.02, 0.03, 0.03, dark, 0, 0.045, -0.05)); // scope mount
  sniper.add(box(0.02, 0.03, 0.03, dark, 0, 0.045, -0.19)); // scope mount
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 8), steel);
  bolt.rotation.z = Math.PI / 2;
  bolt.position.set(0.07, 0.01, 0.05); // bolt handle
  sniper.add(bolt);
  const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), dark);
  boltKnob.position.set(0.105, 0.01, 0.05);
  sniper.add(boltKnob);
  sniper.add(box(0.055, 0.02, 0.16, dark, 0, 0.045, 0.32)); // cheek rest
  sniper.add(box(0.045, 0.045, 0.06, dark, 0, 0.015, -0.8)); // muzzle brake
  const sniperHand = gripHand();
  sniperHand.position.set(0, -0.07, 0.08);
  sniper.add(sniperHand);
  const sniperSupport = supportHand();
  sniperSupport.position.set(0, 0.0, -0.5);
  sniper.add(sniperSupport);
  models.sniper = sniper;
  muzzleZ.sniper = -0.82;

  const shotgun = new THREE.Group();
  shotgun.add(box(0.09, 0.1, 0.42, dark, 0, 0, -0.06));
  shotgun.add(box(0.07, 0.07, 0.34, wood, 0, -0.045, -0.34));
  shotgun.add(cyl(0.024, 0.44, steel, 0, 0.02, -0.42)); // round barrel
  shotgun.add(cyl(0.018, 0.38, dark, 0, -0.025, -0.4)); // magazine tube
  shotgun.add(box(0.08, 0.09, 0.2, wood, 0, -0.01, 0.26));
  shotgun.add(box(0.02, 0.02, 0.3, brass, 0.055, 0.02, -0.2));
  shotgun.add(box(0.05, 0.1, 0.045, dark, 0, -0.07, 0.08)); // grip
  shotgun.add(box(0.012, 0.03, 0.012, dark, 0, -0.04, 0.045)); // trigger
  shotgun.add(box(0.04, 0.01, 0.07, dark, 0, -0.055, 0.05)); // trigger guard
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 8), brass);
  bead.position.set(0, 0.06, -0.62); // front bead sight
  shotgun.add(bead);
  for (let i = 0; i < 3; i++) { // side-saddle shells on the receiver
    const shellMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), shellRed);
    shellMesh.rotation.x = Math.PI / 2;
    shellMesh.position.set(-0.052, 0.02, -0.14 + i * 0.06);
    shotgun.add(shellMesh);
  }
  shotgun.add(box(0.05, 0.012, 0.12, dark, 0, -0.055, -0.06)); // loading port
  const shotgunHand = gripHand();
  shotgunHand.position.set(0, -0.07, 0.08);
  shotgun.add(shotgunHand);
  const shotgunSupport = supportHand();
  shotgunSupport.position.set(0, -0.03, -0.34);
  shotgun.add(shotgunSupport);
  models.shotgun = shotgun;
  muzzleZ.shotgun = -0.66;

  for (const id of Object.keys(models)) {
    models[id].position.set(0.24, -0.2, -0.52);
    models[id].visible = false;
    camera.add(models[id]);
  }

  // Grenade held in hand: a dark sphere with a pin ring, shown by grenadeOut.
  const grenadeMesh = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.6, metalness: 0.4 }),
  );
  const pin = new THREE.Mesh(
    new THREE.TorusGeometry(0.02, 0.005, 6, 12),
    brass,
  );
  pin.position.set(0.04, 0.05, 0);
  grenadeMesh.add(shell, pin);
  grenadeMesh.position.set(0.24, -0.2, -0.52);
  grenadeMesh.visible = false;
  camera.add(grenadeMesh);

  // Muzzle flash: a radial-gradient starburst sprite (built once), additive
  // so it blooms over the scene instead of reading as a flat card.
  function makeFlashTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.25, 'rgba(255,214,120,0.95)');
    grad.addColorStop(0.55, 'rgba(255,140,40,0.55)');
    grad.addColorStop(1, 'rgba(255,110,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'lighter';
    for (const [dx, dy, len, wid] of [[1, 0, 62, 7], [-1, 0, 62, 7], [0, 1, 62, 7], [0, -1, 62, 7], [0.7, 0.7, 40, 5], [-0.7, -0.7, 40, 5]]) {
      const spike = g.createLinearGradient(64, 64, 64 + dx * len, 64 + dy * len);
      spike.addColorStop(0, 'rgba(255,220,130,0.9)');
      spike.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = spike;
      g.beginPath();
      g.moveTo(64 - dy * wid, 64 + dx * wid);
      g.lineTo(64 + dx * len, 64 + dy * len);
      g.lineTo(64 + dy * wid, 64 - dx * wid);
      g.closePath();
      g.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeFlashTexture(), color: 0xffc46b, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flash.scale.set(0.5, 0.5, 1);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(0xffb347, 0, 8);
  camera.add(flashLight);

  const ammo = {};
  for (const id of Object.keys(WEAPONS)) {
    ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }

  const state = {
    weaponId: 'pistol',
    mag: ammo.pistol.mag,
    reserve: ammo.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    _kick: 0,
    _flash: 0,
  };
  models.pistol.visible = true;

  function placeFlash() {
    const z = -0.52 + muzzleZ[state.weaponId] - 0.06;
    flash.position.set(0.24, -0.18, z);
    flashLight.position.set(0.24, -0.16, z + 0.3);
  }
  placeFlash();

  // The flash / kick visuals apply the moment the value is assigned, not
  // only on the next step() call. That matters because main.js never steps
  // the rig after staging a shot (it renders twice, then freezes): shots.js
  // sets state.flash = 1 / state.kick = 0.06 for the capture, and without
  // this the flash would stay invisible and the recoil unposed. Live play
  // is unchanged — pullTrigger / step() assign the same fields.
  function applyFlashVisual() {
    const f = state._flash;
    flash.visible = f > 0;
    if (f > 0) {
      flash.material.rotation = f * 30;
      const n = Math.min(1, f / MUZZLE_TIME);
      const s = 0.34 + 0.2 * n;
      flash.scale.set(s, s, 1);
      flash.material.opacity = n;
    }
    flashLight.intensity = f > 0 ? 24 : 0;
  }

  function applyModelTransform() {
    const model = models[state.weaponId];
    const kick = state._kick;
    model.position.set(
      0.24 + swayXVal, -0.2 + swayYVal - 0.16 * reloadDipVal + kick * 0.4,
      -0.52 + kick,
    );
    model.rotation.set(
      kick * 3.2 - 0.7 * reloadDipVal, swayRotYVal + reloadDipVal * 0.25,
      swayRotZVal + kick * 0.5,
    );
    grenadeMesh.position.set(0.24 + swayXVal, -0.2 + swayYVal, -0.52);
  }

  Object.defineProperty(state, 'flash', {
    get() { return state._flash; },
    set(v) { state._flash = v; applyFlashVisual(); },
  });
  Object.defineProperty(state, 'kick', {
    get() { return state._kick; },
    set(v) { state._kick = v; applyModelTransform(); },
  });

  // Walk bob / idle sway state. Bob amplitude is driven by the camera's
  // own frame-to-frame movement (main.js moves the camera from the player
  // position before rig.step runs), so no signature change is needed;
  // a gentle breathing sway runs even when standing still.
  const prevCamPos = new THREE.Vector3();
  let camInit = false;
  let bobPhase = 0;
  let bobAmp = 0;
  let idlePhase = 0;
  let swayXVal = 0;
  let swayYVal = 0;
  let swayRotYVal = 0;
  let swayRotZVal = 0;
  let reloadDipVal = 0;

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 10);

    if (!camInit) {
      prevCamPos.copy(camera.position);
      camInit = true;
    }
    const stepSpeed = dt > 0
      ? Math.min(8, Math.hypot(camera.position.x - prevCamPos.x, camera.position.z - prevCamPos.z) / dt)
      : 0;
    prevCamPos.copy(camera.position);
    const targetAmp = Math.min(1, stepSpeed / MOVE_REFERENCE);
    bobAmp += (targetAmp - bobAmp) * Math.min(1, dt * 8);
    bobPhase += dt * (5 + 5 * bobAmp) * (bobAmp > 0.03 ? 1 : 0.25);
    idlePhase += dt * 1.6;
    swayXVal = Math.sin(bobPhase) * 0.009 * bobAmp + Math.sin(idlePhase) * 0.0018;
    swayYVal = Math.abs(Math.cos(bobPhase)) * 0.008 * bobAmp + Math.sin(idlePhase * 0.7) * 0.0015;
    swayRotZVal = Math.sin(bobPhase) * 0.014 * bobAmp;
    swayRotYVal = Math.sin(bobPhase * 0.5) * 0.01 * bobAmp;

    reloadDipVal = 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const w = WEAPONS[state.weaponId];
      reloadDipVal = Math.sin(Math.min(1, (w.reloadTime - state.reloadLeft) / w.reloadTime) * Math.PI);
      if (state.reloadLeft === 0) {
        const need = w.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        ammo[state.weaponId].mag = state.mag;
        ammo[state.weaponId].reserve = state.reserve;
      }
    }

    applyModelTransform();
  }

  function equip(id) {
    if (!WEAPONS[id] || id === state.weaponId) return;
    ammo[state.weaponId].mag = state.mag;
    ammo[state.weaponId].reserve = state.reserve;
    models[state.weaponId].visible = false;
    state.weaponId = id;
    state.mag = ammo[id].mag;
    state.reserve = ammo[id].reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.kick = 0;
    state.flash = 0;
    grenadeMesh.visible = false;
    models[id].visible = true;
    placeFlash();
  }

  function ready() {
    return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
  }

  function takeRound() {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    ammo[state.weaponId].mag = state.mag;
    return true;
  }

  function reload() {
    const w = WEAPONS[state.weaponId];
    if (state.reloadLeft > 0 || state.mag === w.mag || state.reserve === 0) return;
    state.reloadLeft = w.reloadTime;
  }

  // Moving and airborne fire is punished hard; crouching steadies the aim.
  function spreadOf(speed, airborne, crouching) {
    const w = WEAPONS[state.weaponId];
    if (airborne) return w.spreadAir;
    const moveFrac = Math.min(1, speed / MOVE_REFERENCE);
    let spread = w.spreadStill + moveFrac * (w.spreadMove - w.spreadStill);
    if (crouching) spread *= 0.7;
    return spread;
  }

  function pullTrigger() {
    const w = WEAPONS[state.weaponId];
    state.cooldown = w.fireGap;
    state.flash = MUZZLE_TIME;
    state.kick = 0.05 + w.recoilPitch * 3;
  }

  function grenadeOut(id) {
    models[state.weaponId].visible = false;
    grenadeMesh.visible = true;
    const mat = shell.material;
    if (id === 'smoke') mat.color.set(0x4a5560);
    else if (id === 'flash') mat.color.set(0xf5f0c8);
    else mat.color.set(0x2e4a2e);
  }

  return { state, ammo, step, equip, ready, takeRound, reload, spreadOf, pullTrigger, grenadeOut };
}
