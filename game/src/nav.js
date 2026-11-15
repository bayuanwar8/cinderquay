// nav.js — waypoint graph + BFS routing for CINDERQUAY.
// Owns: ground-plane geometry helpers, BFS pathfinding over
// world.waypoints, and per-agent route planning (site / lane).
// Pure movement math only: no rendering, no combat, no rng of its own —
// the seeded rng is read from state so call order stays deterministic.

import * as THREE from 'three';

// Module-level scratch only — nothing is allocated inside a call.
const _segA = new THREE.Vector3();
const _closest = new THREE.Vector3();

export function dist2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Angle from `from` to `to` on the ground plane, as a yaw (0 = facing -z).
export function yawTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

// True when the segment from `a` to `b` passes within `radius` of `centre`.
export function segmentHitsSphere(a, b, centre, radius) {
  _segA.subVectors(b, a);
  const len2 = _segA.lengthSq();
  if (len2 === 0) return a.distanceTo(centre) <= radius;
  let t = _closest.subVectors(centre, a).dot(_segA) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  _closest.copy(a).addScaledVector(_segA, t);
  return _closest.distanceTo(centre) <= radius;
}

// Breadth-first search over world.waypoints. `queue`, `came` and `seen`
// are reused scratch arrays owned by the caller. Returns a list of
// waypoint ids from start to goal (inclusive), or null when unreachable.
export function bfsPath(waypoints, startId, goalId, queue, came, seen) {
  if (startId === goalId) return [goalId];
  queue.length = 0;
  came.length = 0;
  seen.length = 0;
  for (let i = 0; i < waypoints.length; i++) {
    came.push(-1);
    seen.push(false);
  }
  queue.push(startId);
  seen[startId] = true;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goalId) break;
    const node = waypoints[cur];
    if (!node) continue;
    for (let i = 0; i < node.neighbors.length; i++) {
      const nb = node.neighbors[i];
      if (!seen[nb]) {
        seen[nb] = true;
        came[nb] = cur;
        queue.push(nb);
      }
    }
  }
  if (!seen[goalId]) return null;
  const path = [];
  let cur = goalId;
  while (cur !== -1) {
    path.push(cur);
    cur = came[cur];
  }
  path.reverse();
  return path;
}

export function nearestWaypoint(waypoints, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Route planner bound to one world + state. `planTo*` write the route
// into agent.ai.path / agent.ai.pathIdx and return true when a route
// was found. BFS scratch is shared by all bots (paths are planned one
// at a time), exactly as bots.js did before the split.
export function createNavigator(world, state) {
  const rng = state.rng;
  const waypoints = world.waypoints;
  const bfsQueue = [];
  const bfsCame = [];
  const bfsSeen = [];

  function siteWaypoints(site) {
    const s = world.sites[site];
    const out = [];
    for (const w of waypoints) {
      if (dist2d(w.x, w.z, s.x, s.z) < 7) out.push(w.id);
    }
    return out;
  }

  function laneWaypoints(lane) {
    const out = [];
    for (const w of waypoints) {
      if (lane === 'A' && w.x < -12) out.push(w.id);
      else if (lane === 'B' && w.x > 12) out.push(w.id);
      else if (lane === 'mid' && Math.abs(w.x) <= 12) out.push(w.id);
    }
    return out;
  }

  function planTo(agent, goalWp) {
    const from = nearestWaypoint(waypoints, agent.pos.x, agent.pos.z);
    const path = bfsPath(waypoints, from, goalWp, bfsQueue, bfsCame, bfsSeen);
    if (path) {
      agent.ai.path = path;
      agent.ai.pathIdx = 0;
      return true;
    }
    agent.ai.path = null;
    return false;
  }

  function planToSite(agent, site) {
    const spots = siteWaypoints(site);
    if (!spots.length) return false;
    const pick = spots[Math.floor(rng() * spots.length)];
    return planTo(agent, pick);
  }

  function planToLane(agent, lane) {
    const nodes = laneWaypoints(lane);
    if (!nodes.length) return false;
    // Walk to the far end of the lane for attackers (north, -z); defenders
    // hold the mid node nearest the north connector (z = -6).
    let goal = nodes[0];
    let best = -Infinity;
    for (const id of nodes) {
      const w = waypoints[id];
      const score = agent.team === state.attackSide ? -w.z : -Math.abs(w.z + 6);
      if (score > best) {
        best = score;
        goal = id;
      }
    }
    return planTo(agent, goal);
  }

  return { planTo, planToSite, planToLane, nearestWaypoint: (x, z) => nearestWaypoint(waypoints, x, z), siteWaypoints, laneWaypoints, bfsPath: (a, b) => bfsPath(waypoints, a, b, bfsQueue, bfsCame, bfsSeen) };
}
