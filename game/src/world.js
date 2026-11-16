// CINDERQUAY map: a container terminal at dusk, 64 x 48 m.
// x = east (+), z = south (+), north is -z, ground y = 0.
// Ember spawns south (z = +20), Tide spawns north (z = -20); sites A (west)
// and B (east) sit along the north edge. Three north-south lanes (A, mid, B)
// are crossed by two east-west connectors. Every solid box is both a movement
// collider and a bullet stopper; painted markings live in the ground texture.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { PALETTE } from './palette.js';
import {
  createGroundTexture,
  createContainerTexture,
  createConcreteTexture,
  createCrateTexture,
  createGlowTexture,
  createHazeTexture,
  createLetterTexture,
  createSiteSignTexture,
  createTerminalSignTexture,
  createCraneSignTexture,
} from './textures.js';

const CONTAINER_COLORS = ['rust', 'teal', 'mustard', 'olive'];
const BARREL_COLORS = ['rust', 'mustard', 'teal'];

// Waypoint nodes: [x, z]. Covers both spawns, both sites (approach, plant
// spot, hold corner), mid (south, both doors of the mid block, north),
// both side lanes (south, middle, north) and both connectors (west, east).
const WAYPOINT_POS = [
  [-6, 18],    // 0  ember spawn west
  [6, 18],     // 1  ember spawn east
  [-6, -18],   // 2  tide spawn west
  [6, -18],    // 3  tide spawn east
  [-20, -8],   // 4  site A approach
  [-22, -14],  // 5  site A plant spot
  [-28, -11],  // 6  site A hold corner
  [20, -8],    // 7  site B approach
  [22, -14],   // 8  site B plant spot
  [28, -11],   // 9  site B hold corner
  [0, 14],     // 10 mid south
  [-4.5, 0],   // 11 mid west door
  [4.5, 0],    // 12 mid east door
  [0, -10],    // 13 mid north
  [-20, 14],   // 14 A lane south
  [-20, 2],    // 15 A lane middle
  [-20, -4],   // 16 A lane north
  [20, 14],    // 17 B lane south
  [20, 2],     // 18 B lane middle
  [20, -4],    // 19 B lane north
  [-12, 5],    // 20 south connector west
  [12, 5],     // 21 south connector east
  [-12, -4],   // 22 north connector west (BUG 4: was -6 — the 13->22 / 13->23
  [12, -4],    // 23 north connector east  segments clipped the (±12,-8.5)
  // containers' corners by 0.19 m < bot radius 0.34, wedging bots there)
];

// Bidirectional edges; every pair below is walkable in a straight line
// without clipping a solid box (checked against the cover layout).
// BUG 4: [2,16], [3,19], [4,13], [7,13] are REMOVED — their segments cut
// straight through the (±12,-8.5) containers (0.00 m clearance), and bots
// walking them wedged against the container faces forever (the axis-
// separated mover + inclusive box touch makes the corner a pocket: every
// wish direction keeps the probe touching the box except away from the
// waypoint, which the bot never wishes). Routes now go via the north
// connectors (13->22->16 / 13->23->19), whose segments clear the boxes.
const WAYPOINT_EDGES = [
  [0, 1], [0, 10], [0, 14], [1, 10], [1, 17],
  [2, 13], [3, 13],
  [4, 5], [4, 6], [4, 16], [4, 22], [6, 16],
  [7, 8], [7, 9], [7, 19], [7, 23], [9, 19],
  [10, 11], [10, 12], [10, 14], [10, 20], [10, 21],
  [11, 13], [11, 20], [11, 22],
  [12, 13], [12, 21], [12, 23],
  [13, 22], [13, 23],
  [14, 15], [14, 20], [15, 16],
  [17, 18], [17, 21], [18, 19], [19, 23],
  [20, 22], [21, 23], [22, 16], [23, 19],
];

function buildWaypoints() {
  const sets = WAYPOINT_POS.map(() => new Set());
  for (const [a, b] of WAYPOINT_EDGES) {
    sets[a].add(b);
    sets[b].add(a);
  }
  return WAYPOINT_POS.map(([x, z], id) => ({
    id,
    x,
    z,
    neighbors: [...sets[id]].sort((p, q) => p - q),
  }));
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const colliders = [];
  const shootables = [];

  // One shared material per palette colour; boxes are cheap, materials are not.
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'sodium' ? 0.6 : 0.92,
      metalness: name === 'steel' ? 0.35 : 0.04,
    });
  }
  // Dark silhouette material for the crane + distant skyline.
  const silhouette = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#232830'),
    roughness: 0.95,
    metalness: 0.1,
  });
  // Near-black tyre rubber.
  const tyreMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1b1b1e'),
    roughness: 0.96,
    metalness: 0,
  });

  // Textured materials (procedural canvas textures, built once).
  const groundTex = createGroundTexture();
  const groundTopMat = new THREE.MeshStandardMaterial({
    map: groundTex, roughness: 0.96, metalness: 0.0,
  });
  const containerTex = createContainerTexture();
  const containerMats = {};
  for (const key of CONTAINER_COLORS) {
    containerMats[key] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[key]),
      map: containerTex, roughness: 0.82, metalness: 0.18,
    });
  }
  const concreteTex = createConcreteTexture();
  const concreteMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.concrete),
    map: concreteTex, roughness: 0.94, metalness: 0.02,
  });
  const crateTex = createCrateTexture();
  const crateMats = {};
  for (const key of CONTAINER_COLORS) {
    crateMats[key] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[key]),
      map: crateTex, roughness: 0.9, metalness: 0.02,
    });
  }
  const glowTex = createGlowTexture();
  const letterTexA = createLetterTexture('A', PALETTE.ember);
  const letterTexB = createLetterTexture('B', PALETTE.ink);
  const letterTexWhite = createLetterTexture('A', PALETTE.ink);
  const letterTexWhiteB = createLetterTexture('B', PALETTE.ink);
  const siteSignA = createSiteSignTexture('SITE A', 'CONTAINER ROW', PALETTE.ember);
  const siteSignB = createSiteSignTexture('SITE B', 'CRANE YARD', PALETTE.tide);
  const terminalSign = createTerminalSignTexture();
  const craneSign = createCraneSignTexture();

  // Solid box: mesh + Box3 collider + bullet stopper. y is the centre height.
  // matOverride swaps the flat palette material for a textured one.
  function solid(w, h, d, x, y, z, colorKey, matOverride) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      matOverride || materials[colorKey],
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Visual-only box: no collider, no bullet stopper (silhouette variety).
  function visualBox(w, h, d, x, y, z, mat, ry = 0, rz = 0, rx = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Painted letter decal: transparent canvas texture on a plane, held just
  // proud of the surface it paints (wall face or ground). No collider.
  // ry turns the plane to face +x (PI/2) / -x (-PI/2); rx = -PI/2 lays it
  // flat on the ground, glyph top toward north (-z) so it reads upright
  // from a southern approach.
  function decal(w, h, x, y, z, ry, tex, rx = 0) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: tex, transparent: true, roughness: 0.9, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        depthWrite: false,
      }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Location sign: dark steel backing box + opaque sign texture face.
  // The face sits 0.045 m proud of the backing along the plane normal.
  function signBoard(w, h, x, y, z, ry, tex) {
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.07),
      materials.steel,
    );
    back.position.set(x, y, z);
    back.rotation.y = ry;
    back.castShadow = true;
    back.receiveShadow = true;
    group.add(back);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.08 }),
    );
    face.position.set(x, y, z);
    face.rotation.y = ry;
    face.translateZ(0.045);
    face.receiveShadow = true;
    group.add(face);
    return face;
  }

  // Barrel: cylinder mesh, collider approximated by a square box.
  function barrel(x, z, colorKey) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12),
      materials[colorKey],
    );
    mesh.position.set(x, 0.525, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - 0.42, 0, z - 0.42),
      new THREE.Vector3(x + 0.42, 1.05, z + 0.42),
    ));
    shootables.push(mesh);
    return mesh;
  }

  // ---- ground + perimeter -------------------------------------------------
  // The floor is one big box, not a plane, so the yard itself is a collider.
  // Top face (+y, material index 2) carries the asphalt + markings texture.
  {
    const groundMesh = new THREE.Mesh(
      new THREE.BoxGeometry(65.2, 0.5, 49.2),
      [materials.ground, materials.ground, groundTopMat,
        materials.ground, materials.ground, materials.ground],
    );
    groundMesh.position.set(0, -0.25, 0);
    groundMesh.receiveShadow = true;
    group.add(groundMesh);
    colliders.push(new THREE.Box3().setFromObject(groundMesh));
    shootables.push(groundMesh);
  }
  // Perimeter walls carry the concrete panel texture.
  solid(65.2, 5, 0.6, 0, 2.5, -24.3, 'concrete', concreteMat);   // north wall
  solid(65.2, 5, 0.6, 0, 2.5, 24.3, 'concrete', concreteMat);    // south wall
  solid(0.6, 5, 49.2, -32.3, 2.5, 0, 'concrete', concreteMat);   // west wall
  solid(0.6, 5, 49.2, 32.3, 2.5, 0, 'concrete', concreteMat);    // east wall

  // Wall top trim (cap) + pilasters proud of the inner face, every ~8 m.
  for (const z of [-24.3, 24.3]) {
    visualBox(65.2, 0.28, 0.9, 0, 5.08, z, concreteMat);
    for (let x = -28; x <= 28; x += 8) {
      visualBox(1.0, 5.0, 0.18, x, 2.5, z > 0 ? 23.95 : -23.95, concreteMat);
    }
  }
  for (const x of [-32.3, 32.3]) {
    visualBox(0.9, 0.28, 49.2, x, 5.08, 0, concreteMat);
    for (let z = -20; z <= 20; z += 8) {
      visualBox(0.18, 5.0, 1.0, x > 0 ? 31.95 : -31.95, 2.5, z, concreteMat);
    }
  }

  // ---- containers (6 x 2.6 x 2.6, corrugated texture) ----------------------
  // Mid block: long axis along x, splitting mid into a west and an east door.
  solid(6, 2.6, 2.6, 0, 1.3, 0, 'rust', containerMats.rust);
  // Lane-side cover, set back from the lane centre so the lane stays open.
  solid(2.6, 2.6, 6, -23.5, 1.3, 6, 'teal', containerMats.teal);       // A lane west
  solid(2.6, 2.6, 6, 23.5, 1.3, 6, 'mustard', containerMats.mustard);  // B lane east
  // South connector flanks.
  solid(6, 2.6, 2.6, -12, 1.3, 10.5, 'rust', containerMats.rust);
  solid(6, 2.6, 2.6, 12, 1.3, 10.5, 'olive', containerMats.olive);
  // North connector flanks.
  solid(6, 2.6, 2.6, -12, 1.3, -8.5, 'teal', containerMats.teal);
  solid(6, 2.6, 2.6, 12, 1.3, -8.5, 'mustard', containerMats.mustard);
  // Site A cover: west wall of the site + north edge.
  solid(2.6, 2.6, 6, -26, 1.3, -14, 'teal', containerMats.teal);
  solid(6, 2.6, 2.6, -17.5, 1.3, -19, 'rust', containerMats.rust);
  // Site B cover, mirrored.
  solid(2.6, 2.6, 6, 26, 1.3, -14, 'mustard', containerMats.mustard);
  solid(6, 2.6, 2.6, 17.5, 1.3, -19, 'olive', containerMats.olive);
  // Spawn cover, tucked against the back walls behind the spawn lines.
  solid(6, 2.6, 2.6, -14, 1.3, 22, 'rust', containerMats.rust);
  solid(6, 2.6, 2.6, 14, 1.3, 22, 'teal', containerMats.teal);
  solid(6, 2.6, 2.6, -14, 1.3, -22, 'mustard', containerMats.mustard);
  solid(6, 2.6, 2.6, 14, 1.3, -22, 'olive', containerMats.olive);
  // Mid-lane side cover, offset from the lane centre.
  solid(6, 2.6, 2.6, 6, 1.3, 14, 'olive', containerMats.olive);
  solid(6, 2.6, 2.6, -6, 1.3, -12, 'teal', containerMats.teal);
  // Two stacked second layers for height variety.
  solid(2.6, 2.6, 6, -23.5, 3.9, 6, 'mustard', containerMats.mustard);
  solid(2.6, 2.6, 6, 23.5, 3.9, 6, 'rust', containerMats.rust);

  // Visual-only tilted / stacked containers (colliders stay the old boxes).
  visualBox(6, 2.6, 2.6, -29, 1.45, 16, containerMats.rust, 0.35, 0.05);
  visualBox(6, 2.6, 2.6, -8, 1.35, -22.3, containerMats.teal, -0.2, -0.05);
  visualBox(6, 2.6, 2.6, 29, 1.3, -16.5, containerMats.olive, 0.12, 0);
  visualBox(6, 2.6, 2.6, 29, 3.9, -16.5, containerMats.mustard, 0.12, 0);

  // ---- crates (1.2^3, wood-plank texture) ----------------------------------
  const crateSpots = [
    [-8, 16], [-6.6, 16], [8, 16], [9.4, 16],
    [-26, 2], [-26, 3.4], [26, 2], [26, 3.4],
    [-14, -2], [-14, -0.6], [14, -2], [14, -0.6],
    [-10, -16], [10, -16],
    [-28, -20], [28, -20], [-28, 20], [28, 20],
    [-4, -18], [4, -18],
    [-16, -10], [16, -10],
  ];
  crateSpots.forEach(([x, z], i) => {
    const key = CONTAINER_COLORS[i % CONTAINER_COLORS.length];
    solid(1.2, 1.2, 1.2, x, 0.6, z, key, crateMats[key]);
  });
  // Two crates stacked on a partner for a taller crouch block.
  solid(1.2, 1.2, 1.2, -8, 1.8, 16, 'mustard', crateMats.mustard);
  solid(1.2, 1.2, 1.2, 26, 1.8, 2, 'rust', crateMats.rust);

  // ---- barrel clusters ------------------------------------------------------
  const barrelClusters = [
    [-24, 10], [24, 10], [-24, -8], [24, -8],
  ];
  for (const [cx, cz] of barrelClusters) {
    barrel(cx, cz, BARREL_COLORS[0]);
    barrel(cx + 1.0, cz + 0.6, BARREL_COLORS[1]);
    barrel(cx - 0.2, cz + 1.0, BARREL_COLORS[2]);
  }

  // ---- silhouette variety: pipes, pallets, tyres, puddles, fence ------------
  function pipe(r, len, x, y, z, rx, rz) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), materials.steel);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  // Horizontal runs hugging the walls + a vertical cluster.
  pipe(0.16, 26, 8, 0.45, -23.85, 0, Math.PI / 2);
  pipe(0.11, 26, 8, 0.75, -23.85, 0, Math.PI / 2);
  pipe(0.16, 20, -31.85, 0.5, -6, Math.PI / 2, 0);
  pipe(0.16, 16, 31.85, 0.5, 10, Math.PI / 2, 0);
  pipe(0.12, 2.4, -31.85, 1.2, 8, 0, 0);
  pipe(0.18, 2.4, -31.85, 1.2, 8.5, 0, 0);
  pipe(0.12, 1.8, -31.85, 0.9, 8.9, 0, 0);

  // Pallets: flat slatted base, visual only.
  function pallet(x, z, ry) {
    const p = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 1.0), crateMats.olive);
    base.position.y = 0.08;
    p.add(base);
    for (const dz of [-0.36, 0, 0.36]) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.14), crateMats.mustard);
      slat.position.set(0, 0.16, dz);
      p.add(slat);
    }
    p.position.set(x, 0, z);
    p.rotation.y = ry;
    p.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
    group.add(p);
  }
  pallet(-10.5, 14.5, 0.2);
  pallet(10.5, -14.5, -0.4);
  pallet(-27, 8, 0.9);

  // Tyre stacks (torus rings), visual only.
  function tyreStack(x, z, lean) {
    for (let i = 0; i < 3; i++) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.13, 8, 18), tyreMat);
      tyre.position.set(x, 0.14 + i * 0.26, z);
      tyre.rotation.x = Math.PI / 2;
      tyre.castShadow = true;
      tyre.receiveShadow = true;
      group.add(tyre);
    }
    if (lean) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.13, 8, 18), tyreMat);
      tyre.position.set(x + 0.75, 0.45, z + 0.2);
      tyre.rotation.set(Math.PI / 2, 0, 0.5);
      tyre.castShadow = true;
      group.add(tyre);
    }
  }
  tyreStack(-28.5, 8, true);
  tyreStack(28.5, -2, false);
  tyreStack(4, 18.5, true);

  // Puddles: low-roughness discs catching the sun as specular streaks.
  const puddleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#232a33'), roughness: 0.06, metalness: 0.55,
  });
  for (const [px, pz, pr] of [[10, -4, 1.6], [-12, 12, 2.0], [24, 4, 1.3], [-24, -2, 1.2], [2, -16, 1.4]]) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(pr, 24), puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(px, 0.015, pz);
    puddle.receiveShadow = true;
    group.add(puddle);
  }

  // Fence rails + posts along the top of the north and south walls.
  const railMat = materials.steel;
  for (const z of [-24.3, 24.3]) {
    for (const ry of [5.55, 5.95]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(65.2, 0.06, 0.06), railMat);
      rail.position.set(0, ry, z);
      group.add(rail);
    }
  }
  for (const x of [-32.3, 32.3]) {
    for (const ry of [5.55, 5.95]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 49.2), railMat);
      rail.position.set(x, ry, 0);
      group.add(rail);
    }
  }
  {
    const postGeo = new THREE.BoxGeometry(0.07, 1.1, 0.07);
    const spots = [];
    for (let x = -32; x <= 32; x += 2.2) { spots.push([x, 5.45, -24.3]); spots.push([x, 5.45, 24.3]); }
    for (let z = -24; z <= 24; z += 2.2) { spots.push([-32.3, 5.45, z]); spots.push([32.3, 5.45, z]); }
    const posts = new THREE.InstancedMesh(postGeo, railMat, spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach(([x, y, z], i) => {
      m4.makeTranslation(x, y, z);
      posts.setMatrixAt(i, m4);
    });
    posts.instanceMatrix.needsUpdate = true;
    group.add(posts);
  }

  // ---- site beacons (blink in update) ---------------------------------------
  const beaconMats = [];
  const beaconGlows = [];
  for (const [bx, bz] of [[-25.2, -11.2], [25.2, -11.2]]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), materials.steel);
    pole.position.set(bx, 0.8, bz);
    group.add(pole);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.accent),
      emissive: new THREE.Color(PALETTE.accent),
      emissiveIntensity: 2,
      roughness: 0.4,
    });
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), mat);
    tip.position.set(bx, 1.75, bz);
    group.add(tip);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(PALETTE.accent),
      transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false,
    }));
    glow.position.set(bx, 1.75, bz);
    glow.scale.set(1.4, 1.4, 1);
    group.add(glow);
    beaconMats.push(mat);
    beaconGlows.push(glow);
  }

  // ---- crane silhouette, outside the north wall ------------------------------
  // v3: bigger silhouette — 26 m mast (was 20), jib stretched east to x=-4
  // (was -10) so the crane reads as the yard landmark over the north wall.
  const crane = new THREE.Group();
  function craneBox(w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), silhouette);
    mesh.position.set(x, y, z);
    crane.add(mesh);
    return mesh;
  }
  craneBox(1.8, 26, 1.8, -28, 13, -28);          // mast
  craneBox(1.8, 26, 1.8, -23, 13, -28);          // second leg
  craneBox(6.8, 0.8, 0.8, -25.5, 13, -28);       // mast tie beam
  craneBox(6.8, 1.5, 1.5, -25.5, 25.6, -28);     // mast cap
  craneBox(30, 1.2, 1.2, -19, 24.8, -28);        // jib reaching east
  craneBox(9, 1.1, 1.1, -34.5, 24.8, -28);       // counter-jib west
  craneBox(0.12, 8, 0.12, -10, 20.8, -28);       // hanging cable
  craneBox(0.9, 0.9, 0.9, -10, 16.4, -28);       // hook block
  craneBox(2.4, 1.8, 1.8, -27, 23.6, -28);       // operator cab
  group.add(crane);

  // Crane warning light, blinking in update().
  const craneLightMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ff3b30'),
    emissive: new THREE.Color('#ff3b30'),
    emissiveIntensity: 2.5,
    roughness: 0.4,
  });
  const craneLight = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), craneLightMat);
  craneLight.position.set(-10, 25.4, -28);
  group.add(craneLight);

  // ---- site letters + location signs (v3) ------------------------------------
  // Giant letters: "A" painted on the east face of the site A west container
  // (face x=-24.7) + on the site A ground pad; "B" on the west face of the
  // site B east container (face x=+24.7) + on the site B ground pad. All
  // visual-only — no collider or gameplay position changes.
  decal(2.4, 2.4, -24.67, 1.35, -14, Math.PI / 2, letterTexA);       // wall A
  decal(2.4, 2.4, 24.67, 1.35, -14, -Math.PI / 2, letterTexB);       // wall B
  decal(6, 6, -22, 0.02, -14, 0, letterTexWhite, -Math.PI / 2);      // ground A
  decal(6, 6, 22, 0.02, -14, 0, letterTexWhiteB, -Math.PI / 2);      // ground B
  // Site signs on the south face (z=-17.7) of each site's north container.
  // Narrow (2.4 m) and flush with the outer edge of the face so the whole
  // board — text included — stays inside the plant-shot frame from the
  // site approach instead of running off the right edge.
  signBoard(2.4, 0.67, -19.3, 1.45, -17.64, 0, siteSignA);
  signBoard(2.4, 0.67, 19.3, 1.45, -17.64, 0, siteSignB);
  // "TERMINAL" on the north wall inner face (z=-24.0), centred on the wall
  // so it reads from mid-map through the gap between the mid block and the
  // west north-connector container.
  signBoard(7, 1.75, 0, 3.6, -23.96, 0, terminalSign);
  // "CINDERQUAY CRANE" name board across the crane mast legs, south face
  // (legs at z=-28, face z=-27.1); y=8 clears the north wall from the yard.
  signBoard(6, 1.13, -25.5, 8, -27.04, 0, craneSign);

  // ---- sky: gradient dome + stars + sun glow + haze + skyline --------------
  // The dome IS the background (no solid scene.background any more).
  const sunDir = new THREE.Vector3(-40, 12, 8).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sunDir: { value: sunDir } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 sunDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.08, 1.0);
        vec3 top = vec3(0.06, 0.08, 0.19);
        vec3 mid = vec3(0.24, 0.13, 0.27);
        vec3 hor = vec3(0.42, 0.19, 0.21);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, top, smoothstep(0.18, 0.65, h));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.45, 0.15) * pow(s, 6.0) * 0.55;
        col += vec3(1.0, 0.75, 0.45) * pow(s, 40.0) * 0.9;
        col = mix(vec3(0.15, 0.09, 0.11), col, smoothstep(-0.08, 0.01, d.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(175, 32, 20), skyMat);
  group.add(sky);

  // Stars on the upper dome. Seeded (fixed) so the sky is identical on
  // every load — Math.random() here made screenshots differ run to run.
  {
    const starRng = mulberry32(0xc1d3a9);
    const count = 450;
    const pos = new Float32Array(count * 3);
    let i = 0;
    while (i < count) {
      const u = starRng() * 2 - 1;
      const a = starRng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = u;
      if (y < 0.12) continue; // keep stars above the horizon band
      pos[i * 3] = r * Math.cos(a) * 170;
      pos[i * 3 + 1] = y * 170;
      pos[i * 3 + 2] = r * Math.sin(a) * 170;
      i++;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: new THREE.Color('#cfd8ff'), size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0.85, fog: false, depthWrite: false,
    }));
    group.add(stars);
  }

  // Sun glow: big soft halo + bright core, additive sprites at the sun azimuth.
  const glowPos = sunDir.clone().multiplyScalar(165);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: new THREE.Color('#ff7a2f'),
    transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false,
  }));
  halo.position.copy(glowPos);
  halo.scale.set(95, 95, 1);
  group.add(halo);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: new THREE.Color('#ffd9a0'),
    transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false,
  }));
  core.position.copy(glowPos);
  core.scale.set(30, 30, 1);
  group.add(core);

  // Horizon haze ring hugging the dome just above the walls.
  {
    const hazeTex = createHazeTexture();
    const haze = new THREE.Mesh(
      new THREE.CylinderGeometry(150, 150, 26, 48, 1, true),
      new THREE.MeshBasicMaterial({
        map: hazeTex, transparent: true, side: THREE.BackSide,
        depthWrite: false, fog: false,
      }),
    );
    haze.position.y = 6;
    group.add(haze);
  }

  // Distant skyline silhouettes outside the walls (fog fades them in).
  const skylineSpots = [
    [-45, -42, 12, 18, 10], [-30, -50, 10, 26, 10], [-12, -44, 14, 14, 10],
    [5, -52, 10, 22, 10], [22, -46, 12, 16, 10], [38, -50, 10, 24, 10],
    [52, -40, 12, 12, 10], [-40, 44, 12, 15, 10], [-15, 48, 10, 20, 10],
    [12, 45, 14, 13, 10], [35, 48, 10, 18, 10], [-48, -10, 10, 20, 12],
    [-50, 15, 10, 14, 12], [48, -5, 10, 22, 12], [50, 18, 10, 15, 12],
  ];
  for (const [bx, bz, bw, bh, bd] of skylineSpots) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), silhouette);
    b.position.set(bx, bh / 2, bz);
    group.add(b);
  }
  // A second distant crane on the east horizon.
  for (const [w, h, d, x, y, z] of [
    [1.2, 22, 1.2, 58, 11, -42], [14, 0.9, 0.9, 55, 21, -42],
    [5, 0.8, 0.8, 64, 21, -42], [1.8, 1.4, 1.4, 57, 19.4, -42],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), silhouette);
    m.position.set(x, y, z);
    group.add(m);
  }

  // ---- lighting ---------------------------------------------------------------
  // No solid background: the sky dome is the background. Fog colour matches
  // the dome's horizon band so distant walls fade into the sky, not a band.
  scene.background = null;
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 30, 90);

  const hemi = new THREE.HemisphereLight(
    new THREE.Color(PALETTE.sky),
    new THREE.Color('#6b4a38'),
    0.85,
  );
  scene.add(hemi);

  // Warm sun, low from the west so shadows stretch east across the yard.
  const sunLight = new THREE.DirectionalLight(new THREE.Color('#ff9a3d'), 2.6);
  sunLight.position.set(-40, 12, 8);
  sunLight.target.position.set(0, 0, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -40;
  sunLight.shadow.camera.right = 40;
  sunLight.shadow.camera.top = 40;
  sunLight.shadow.camera.bottom = -40;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 120;
  sunLight.shadow.bias = -0.0006;
  scene.add(sunLight, sunLight.target);

  // Cool fill from the east so the shadow side is never dead black. No shadow.
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86c8'), 0.65);
  fill.position.set(40, 18, -6);
  fill.target.position.set(0, 0, 0);
  scene.add(fill, fill.target);

  // Sodium lamps: mid (0, 4.5), site A (-18.2, -17), site B (18.2, -17).
  // The site posts stand clear of the north containers and the site pads.
  // Head sits EXACTLY above its post (no offset). Cone glow + halo sprite
  // under each head; the PointLight follows the head.
  const coneMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.sodium), transparent: true, opacity: 0.05,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const [lx, lz] of [[0, 4.5], [-18.2, -17], [18.2, -17]]) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.sodium), 60, 26, 2);
    lamp.position.set(lx, 5.15, lz);
    scene.add(lamp);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5.4, 0.14), materials.steel);
    post.position.set(lx, 2.7, lz);
    group.add(post);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), materials.steel);
    head.position.set(lx, 5.4, lz);
    group.add(head);
    const bulb = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.05, 0.4),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(PALETTE.sodium),
        emissive: new THREE.Color(PALETTE.sodium),
        emissiveIntensity: 3, roughness: 0.4,
      }),
    );
    bulb.position.set(lx, 5.29, lz);
    group.add(bulb);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.0, 24, 1, true), coneMat);
    cone.position.set(lx, 4.3, lz);
    group.add(cone);
    const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(PALETTE.sodium),
      transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    haloSprite.position.set(lx, 5.35, lz);
    haloSprite.scale.set(2.4, 2.4, 1);
    group.add(haloSprite);
  }

  const waypoints = buildWaypoints();

  // Blink state lives in closure scope; update() allocates nothing.
  function update(dt, t) {
    void dt;
    const pulse = 1.4 + 1.4 * Math.sin(t * 5);
    beaconMats[0].emissiveIntensity = pulse;
    beaconMats[1].emissiveIntensity = 1.4 + 1.4 * Math.sin(t * 5 + Math.PI);
    beaconGlows[0].material.opacity = 0.25 + 0.35 * Math.sin(t * 5) + 0.35;
    beaconGlows[1].material.opacity = 0.25 + 0.35 * Math.sin(t * 5 + Math.PI) + 0.35;
    craneLightMat.emissiveIntensity = Math.sin(t * 1.5) > 0 ? 2.5 : 0.15;
  }

  return {
    group,
    colliders,
    shootables,
    sites: { A: { x: -22, z: -14, r: 3.4 }, B: { x: 22, z: -14, r: 3.4 } },
    spawns: {
      ember: [-8, -4, 0, 4, 8].map((x) => ({ x, z: 20 })),
      tide: [-8, -4, 0, 4, 8].map((x) => ({ x, z: -20 })),
    },
    waypoints,
    bounds: { minX: -32, maxX: 32, minZ: -24, maxZ: 24 },
    update,
  };
}
