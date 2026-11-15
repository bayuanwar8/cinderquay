// CINDERQUAY map: a container terminal at dusk, 64 x 48 m.
// x = east (+), z = south (+), north is -z, ground y = 0.
// Ember spawns south (z = +20), Tide spawns north (z = -20); sites A (west)
// and B (east) sit along the north edge. Three north-south lanes (A, mid, B)
// are crossed by two east-west connectors. Every solid box is both a movement
// collider and a bullet stopper; painted markings are flat and never collide.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

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
  [-12, -6],   // 22 north connector west
  [12, -6],    // 23 north connector east
];

// Bidirectional edges; every pair below is walkable in a straight line
// without clipping a solid box (checked against the cover layout).
const WAYPOINT_EDGES = [
  [0, 1], [0, 10], [0, 14], [1, 10], [1, 17],
  [2, 13], [2, 16], [3, 13], [3, 19],
  [4, 5], [4, 6], [4, 16], [4, 13], [4, 22], [6, 16],
  [7, 8], [7, 9], [7, 19], [7, 13], [7, 23], [9, 19],
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
  // Dark silhouette material for the crane outside the north wall.
  const silhouette = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#232830'),
    roughness: 0.95,
    metalness: 0.1,
  });

  // Solid box: mesh + Box3 collider + bullet stopper. y is the centre height.
  function solid(w, h, d, x, y, z, colorKey) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[colorKey]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Flat painted marking: sits 0.02 above the asphalt, never a collider.
  function marking(w, d, x, z, colorKey) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), materials[colorKey]);
    mesh.position.set(x, 0.011, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
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
  solid(65.2, 0.5, 49.2, 0, -0.25, 0, 'ground');
  solid(65.2, 5, 0.6, 0, 2.5, -24.3, 'concrete');   // north wall
  solid(65.2, 5, 0.6, 0, 2.5, 24.3, 'concrete');    // south wall
  solid(0.6, 5, 49.2, -32.3, 2.5, 0, 'concrete');   // west wall
  solid(0.6, 5, 49.2, 32.3, 2.5, 0, 'concrete');    // east wall

  // ---- containers (6 x 2.6 x 2.6) -----------------------------------------
  // Mid block: long axis along x, splitting mid into a west and an east door.
  solid(6, 2.6, 2.6, 0, 1.3, 0, 'rust');
  // Lane-side cover, set back from the lane centre so the lane stays open.
  solid(2.6, 2.6, 6, -23.5, 1.3, 6, 'teal');       // A lane west
  solid(2.6, 2.6, 6, 23.5, 1.3, 6, 'mustard');     // B lane east
  // South connector flanks.
  solid(6, 2.6, 2.6, -12, 1.3, 10.5, 'rust');
  solid(6, 2.6, 2.6, 12, 1.3, 10.5, 'olive');
  // North connector flanks.
  solid(6, 2.6, 2.6, -12, 1.3, -8.5, 'teal');
  solid(6, 2.6, 2.6, 12, 1.3, -8.5, 'mustard');
  // Site A cover: west wall of the site + north edge.
  solid(2.6, 2.6, 6, -26, 1.3, -14, 'teal');
  solid(6, 2.6, 2.6, -17.5, 1.3, -19, 'rust');
  // Site B cover, mirrored.
  solid(2.6, 2.6, 6, 26, 1.3, -14, 'mustard');
  solid(6, 2.6, 2.6, 17.5, 1.3, -19, 'olive');
  // Spawn cover, tucked against the back walls behind the spawn lines.
  solid(6, 2.6, 2.6, -14, 1.3, 22, 'rust');
  solid(6, 2.6, 2.6, 14, 1.3, 22, 'teal');
  solid(6, 2.6, 2.6, -14, 1.3, -22, 'mustard');
  solid(6, 2.6, 2.6, 14, 1.3, -22, 'olive');
  // Mid-lane side cover, offset from the lane centre.
  solid(6, 2.6, 2.6, 6, 1.3, 14, 'olive');
  solid(6, 2.6, 2.6, -6, 1.3, -12, 'teal');
  // Two stacked second layers for height variety.
  solid(2.6, 2.6, 6, -23.5, 3.9, 6, 'mustard');
  solid(2.6, 2.6, 6, 23.5, 3.9, 6, 'rust');

  // ---- crates (1.2^3) ------------------------------------------------------
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
    solid(1.2, 1.2, 1.2, x, 0.6, z, CONTAINER_COLORS[i % CONTAINER_COLORS.length]);
  });
  // Two crates stacked on a partner for a taller crouch block.
  solid(1.2, 1.2, 1.2, -8, 1.8, 16, 'mustard');
  solid(1.2, 1.2, 1.2, 26, 1.8, 2, 'rust');

  // ---- barrel clusters ------------------------------------------------------
  const barrelClusters = [
    [-24, 10], [24, 10], [-24, -8], [24, -8],
  ];
  for (const [cx, cz] of barrelClusters) {
    barrel(cx, cz, BARREL_COLORS[0]);
    barrel(cx + 1.0, cz + 0.6, BARREL_COLORS[1]);
    barrel(cx - 0.2, cz + 1.0, BARREL_COLORS[2]);
  }

  // ---- painted markings (flat, never colliders) -----------------------------
  // Yellow centre lines down the three lanes.
  marking(0.4, 28, -20, 2, 'mustard');
  marking(0.4, 28, 0, 2, 'mustard');
  marking(0.4, 28, 20, 2, 'mustard');
  // Connector dashes.
  marking(30, 0.4, 0, 8, 'mustard');
  marking(30, 0.4, 0, -6, 'mustard');
  // Site pads + centre squares.
  marking(6.8, 6.8, -22, -14, 'mustard');
  marking(6.8, 6.8, 22, -14, 'mustard');
  marking(2.2, 2.2, -22, -14, 'ember');
  marking(2.2, 2.2, 22, -14, 'tide');
  // Spawn zone strips.
  marking(17, 0.5, 0, 20, 'ember');
  marking(17, 0.5, 0, -20, 'tide');

  // ---- site beacons (blink in update) ---------------------------------------
  const beaconMats = [];
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
    beaconMats.push(mat);
  }

  // ---- crane silhouette + low sun, outside the walls -------------------------
  const crane = new THREE.Group();
  function craneBox(w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), silhouette);
    mesh.position.set(x, y, z);
    crane.add(mesh);
    return mesh;
  }
  craneBox(1.4, 15, 1.4, -28, 7.5, -28);          // mast
  craneBox(1.4, 15, 1.4, -23, 7.5, -28);          // second leg
  craneBox(6.4, 1.2, 1.2, -25.5, 14.6, -28);      // mast cap
  craneBox(18, 1, 1, -24, 13.8, -28);             // jib reaching east
  craneBox(7, 0.9, 0.9, -32.5, 13.8, -28);        // counter-jib west
  craneBox(0.12, 5, 0.12, -18, 11.2, -28);        // hanging cable
  craneBox(0.8, 0.8, 0.8, -18, 8.4, -28);         // hook block
  craneBox(2.2, 1.6, 1.6, -27, 12.6, -28);        // operator cab
  group.add(crane);

  // Crane warning light, blinking in update().
  const craneLightMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ff3b30'),
    emissive: new THREE.Color('#ff3b30'),
    emissiveIntensity: 2.5,
    roughness: 0.4,
  });
  const craneLight = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), craneLightMat);
  craneLight.position.set(-15.2, 14.3, -28);
  group.add(craneLight);

  // Low orange sun disc on the western horizon; fog off so it stays vivid.
  const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.horizon), fog: false });
  const sun = new THREE.Mesh(new THREE.CircleGeometry(4.5, 32), sunMat);
  sun.position.set(-70, 7, -6);
  sun.lookAt(0, 7, 0);
  group.add(sun);

  // ---- lighting ---------------------------------------------------------------
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 30, 90);

  const hemi = new THREE.HemisphereLight(
    new THREE.Color(PALETTE.sky),
    new THREE.Color('#5a4030'),
    0.7,
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

  // Sodium lamps over mid and both sites; no shadows, pools of warm light.
  for (const [lx, lz] of [[0, 0], [-22, -14], [22, -14]]) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.sodium), 60, 26, 2);
    lamp.position.set(lx, 5.2, lz);
    scene.add(lamp);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), materials.steel);
    head.position.set(lx, 5.4, lz);
    group.add(head);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5.4, 0.14), materials.steel);
    post.position.set(lx + 0.8, 2.7, lz);
    group.add(post);
  }

  const waypoints = buildWaypoints();

  // Blink state lives in closure scope; update() allocates nothing.
  function update(dt, t) {
    void dt;
    const pulse = 1.4 + 1.4 * Math.sin(t * 5);
    beaconMats[0].emissiveIntensity = pulse;
    beaconMats[1].emissiveIntensity = 1.4 + 1.4 * Math.sin(t * 5 + Math.PI);
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
