// Minimap CINDERQUAY — Owns: yard layout, site zones, agent dots, player
// arrow + view cone, bomb marker, location label under the map.
// The layout is drawn from the live world colliders (world.colliders, a
// THREE.Box3 list) passed in by main.js — never a hand-drawn copy of the
// map, so the minimap always matches the yard the player walks in.
// Yard x [-32, 32], z [-24, 24]; north (-z) is up. Logical size 180x140
// (CSS pixels); the canvas backing store is 2x so text stays crisp.

const LW = 180;
const LH = 140;
const BOUNDS = { minX: -32, maxX: 32, minZ: -24, maxZ: 24 };

// Area names, from the world layout: sites on the north edge, spawns on the
// north/south edges, the mid block at the centre, lanes down each side.
export function areaNameFor(x, z) {
  if (x <= -16 && z <= -8) return 'SITE A · CONTAINER ROW';
  if (x >= 16 && z <= -8) return 'SITE B · CRANE YARD';
  if (z >= 17) return 'EMBER SPAWN';
  if (z <= -17) return 'TIDE SPAWN';
  if (Math.abs(x) <= 8 && Math.abs(z) <= 8) return 'MID ARCH';
  if (x <= -14) return 'A LANE';
  if (x >= 14) return 'B LANE';
  return 'TERMINAL';
}

// Plan-view footprints from the collider list. The ground slab and the four
// perimeter walls span the whole yard, so they are skipped here and drawn
// as the border instead. Everything left is a real obstacle: containers
// (6 x 2.6), crates (1.2^2) and barrels (~0.84^2), classified by footprint.
// Walkable route network, from the live waypoint graph (world.waypoints:
// {id,x,z,neighbors[]}). Edges are verified walkable in world.js, so the
// network drawn here is the real route map, not a guess. Falls back to the
// painted ground markings (three N-S lanes + two E-W connectors + site
// spurs) when no graph is passed in, so the panel never loses its roads.
// Door nodes are the mid-block doors: WAYPOINT_POS 11 (-4.5, 0) and 12
// (4.5, 0) in world.js — the two gaps the mid corridor splits through.
const MID_DOORS = [[-4.5, 0], [4.5, 0]];

function routeNetwork(waypoints) {
  const edges = [];
  const nodes = [];
  if (Array.isArray(waypoints) && waypoints.length > 1) {
    const byId = new Map(waypoints.map((w) => [w.id, w]));
    for (const w of waypoints) {
      if (!w || typeof w.x !== 'number' || !Array.isArray(w.neighbors)) continue;
      nodes.push([w.x, w.z]);
      for (const n of w.neighbors) {
        const o = byId.get(n);
        if (o && typeof o.x === 'number' && w.id < n) edges.push([[w.x, w.z], [o.x, o.z]]);
      }
    }
    if (edges.length) return { edges, nodes };
  }
  // Fallback: the painted lane markings from the ground texture.
  const lanes = [
    [[-20, -12], [-20, 16]], [[0, -12], [0, 16]], [[20, -12], [20, 16]],
    [[-15, 8], [15, 8]], [[-15, -6], [15, -6]],
    [[-20, -8], [-22, -14]], [[20, -8], [22, -14]],
    [[-6, 18], [6, 18]], [[-6, -18], [6, -18]],
  ];
  return {
    edges: lanes,
    nodes: [[-20, -8], [20, -8], [0, 14], [0, -10], [-6, 18], [6, 18], [-6, -18], [6, -18]],
  };
}

function layoutRects(colliders) {
  const rects = [];
  for (const b of colliders || []) {
    if (!b || !b.min || !b.max) continue;
    const w = b.max.x - b.min.x;
    const d = b.max.z - b.min.z;
    if (w <= 0 || d <= 0 || w > 40 || d > 40) continue;
    const area = w * d;
    let kind = 'barrel';
    if (area >= 8) kind = 'container';
    else if (area >= 1) kind = 'crate';
    rects.push({ x: b.min.x, z: b.min.z, w, d, upper: b.min.y > 1, kind });
  }
  return rects;
}

export function createMinimap(canvas, labelEl) {
  const ctx = canvas ? canvas.getContext('2d') : null;
  if (canvas && ctx) {
    // 2x backing store; all drawing below uses logical 180x140 pixels.
    canvas.width = LW * 2;
    canvas.height = LH * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
  }
  let lastLabel = '';

  function draw(agents, sites, bomb, playerYaw, visibleEnemies, colliders, waypoints) {
    if (!ctx) return;
    const scale = Math.min(LW / 64, LH / 48);
    const ox = (LW - 64 * scale) / 2;
    const oy = (LH - 48 * scale) / 2;
    const px = (x) => ox + (x - BOUNDS.minX) * scale;
    const py = (z) => oy + (z - BOUNDS.minZ) * scale;
    const visible = visibleEnemies instanceof Set ? visibleEnemies : new Set();

    // --- yard floor: asphalt, a touch lighter than before so the roads read
    ctx.clearRect(0, 0, LW, LH);
    ctx.fillStyle = '#292522';
    ctx.fillRect(0, 0, LW, LH);

    // --- surfaces: concrete site pads + team spawn strips ------------------
    // Site pads are concrete aprons (6.8 m, same as the painted pads in the
    // ground texture); the rest of the yard is asphalt.
    ctx.fillStyle = '#4a4438';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (const cx of [-22, 22]) {
      ctx.fillRect(px(cx - 3.4), py(-14 - 3.4), 6.8 * scale, 6.8 * scale);
      ctx.strokeRect(px(cx - 3.4), py(-14 - 3.4), 6.8 * scale, 6.8 * scale);
    }
    // Spawn lines, same colours as the painted strips on the ground.
    ctx.fillStyle = 'rgba(255,140,46,0.55)';
    ctx.fillRect(px(-8.5), py(20 - 0.25), 17 * scale, Math.max(1.5, 0.5 * scale));
    ctx.fillStyle = 'rgba(46,196,182,0.55)';
    ctx.fillRect(px(-8.5), py(-20 - 0.25), 17 * scale, Math.max(1.5, 0.5 * scale));

    // --- walkable roads: ribbon + dashed centre line + node dots -----------
    // Ribbon first (wide, soft asphalt band), then the dashed yellow
    // centre line — the same markings the ground texture paints — so each
    // lane reads as a road, not just empty floor between blocks. Blocks
    // are drawn after this, so a road visibly threads the gaps between
    // containers instead of hiding under them.
    const net = routeNetwork(waypoints);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [[ax, az], [bx, bz]] of net.edges) {
      ctx.moveTo(px(ax), py(az));
      ctx.lineTo(px(bx), py(bz));
    }
    ctx.strokeStyle = '#4a4238';
    ctx.lineWidth = 2.6 * scale;
    ctx.stroke();
    ctx.beginPath();
    for (const [[ax, az], [bx, bz]] of net.edges) {
      ctx.moveTo(px(ax), py(az));
      ctx.lineTo(px(bx), py(bz));
    }
    ctx.strokeStyle = 'rgba(201,154,46,0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Waypoint nodes: faint dots, just enough to show the route joints.
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    for (const [nx, nz] of net.nodes) {
      ctx.beginPath();
      ctx.arc(px(nx), py(nz), 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mid-block doors: amber squares where the corridor splits through
    // the mid block (west door -4.5,0 / east door 4.5,0).
    ctx.strokeStyle = 'rgba(255,179,71,0.85)';
    ctx.lineWidth = 1;
    for (const [dx, dz] of MID_DOORS) {
      ctx.strokeRect(px(dx) - 2.5, py(dz) - 2.5, 5, 5);
    }
    // Lane tags at the south end of each lane.
    ctx.font = 'bold 6px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(154,147,138,0.95)';
    ctx.fillText('A', px(-20), py(17.5));
    ctx.fillText('MID', px(0), py(17.5));
    ctx.fillText('B', px(20), py(17.5));

    // --- faint 8 m grid ------------------------------------------------------
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = -24; gx <= 24; gx += 8) {
      ctx.moveTo(px(gx), py(-24));
      ctx.lineTo(px(gx), py(24));
    }
    for (let gz = -16; gz <= 16; gz += 8) {
      ctx.moveTo(px(-32), py(gz));
      ctx.lineTo(px(32), py(gz));
    }
    ctx.stroke();

    // --- solid blocks from the world colliders ---------------------------
    const rects = layoutRects(colliders);
    const FILL = {
      container: '#5a6673',
      containerUpper: '#74839a',
      crate: '#8a7a4a',
      barrel: '#a06535',
    };
    if (rects.length === 0) {
      // No layout passed in: keep the old mid-block hint so the panel is
      // never an empty box.
      ctx.fillStyle = FILL.container;
      ctx.fillRect(px(-3), py(-1.3), 6 * scale, 2.6 * scale);
    }
    for (const r of rects) {
      const fill = r.kind === 'container' && r.upper
        ? FILL.containerUpper
        : FILL[r.kind];
      ctx.fillStyle = fill;
      ctx.fillRect(px(r.x), py(r.z), Math.max(1.5, r.w * scale), Math.max(1.5, r.d * scale));
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(px(r.x), py(r.z), Math.max(1.5, r.w * scale), Math.max(1.5, r.d * scale));
    }

    // --- player: view cone, then arrow on top ----------------------------
    let player = null;
    for (const a of agents || []) {
      if (a && (a.isPlayer || a.id === 0)) { player = a; break; }
    }
    if (player) {
      const pos = player.pos || player;
      if (typeof pos.x === 'number' && typeof pos.z === 'number') {
        const yaw = typeof playerYaw === 'number' ? playerYaw : (player.yaw || 0);
        // forwardOf(yaw) = (-sin yaw, -cos yaw); canvas x is east, y is
        // south, so the canvas angle is atan2(-cos yaw, -sin yaw).
        const ang = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
        const cx = px(pos.x);
        const cy = py(pos.z);
        const coneR = 14 * scale;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, coneR, ang - 0.55, ang + 0.55);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,179,71,0.13)';
        ctx.fill();
      }
    }

    // --- perimeter walls ---------------------------------------------------
    ctx.strokeStyle = '#6b6560';
    ctx.lineWidth = 2;
    ctx.strokeRect(px(-32), py(-24), 64 * scale, 48 * scale);
    // North tick.
    ctx.fillStyle = '#9a938a';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', LW / 2, oy + 5);

    // --- bomb position, resolved before the sites so the marker can ring
    // a site circle from the outside instead of covering its letter -------
    let bombXY = null;
    if (bomb && bomb.status !== 'exploded') {
      if (bomb.pos && typeof bomb.pos.x === 'number') {
        bombXY = { x: bomb.pos.x, z: bomb.pos.z };
      } else if (typeof bomb.x === 'number') {
        bombXY = { x: bomb.x, z: bomb.z };
      } else if ((bomb.status === 'planted' || bomb.status === 'defusing')
        && bomb.site && sites && sites[bomb.site]) {
        bombXY = sites[bomb.site];
      }
    }

    // --- site zones: filled area + letter + name ---------------------------
    const siteList = [];
    if (sites) {
      if (sites.A) siteList.push(['A', sites.A, 'SITE A']);
      if (sites.B) siteList.push(['B', sites.B, 'SITE B']);
      if (Array.isArray(sites)) {
        sites.forEach((s, i) => siteList.push([s.label || String(i), s, '']));
      }
    }
    for (const [label, s, name] of siteList) {
      const r = (s.r || 3.4) * scale;
      const cx = px(s.x);
      const cy = py(s.z);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,140,46,0.22)';
      ctx.fill();
      ctx.strokeStyle = '#ff8c2e';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffb347';
      ctx.fillText(label, cx, cy);
      if (name) {
        // Caption under the zone, dark halo so it reads over any block.
        ctx.font = 'bold 7px sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#211c19';
        ctx.strokeText(name, cx, cy + r + 6);
        ctx.fillStyle = '#ffb347';
        ctx.fillText(name, cx, cy + r + 6);
      }
    }

    // --- bomb: red ring + dot at the planted position ----------------------
    // If the bomb sits on a site centre, ring the site circle from the
    // outside instead — a centre dot would cover the site letter.
    if (bombXY) {
      let ringedSite = null;
      for (const [, s] of siteList) {
        if (Math.hypot(bombXY.x - s.x, bombXY.z - s.z) < 1.5) { ringedSite = s; break; }
      }
      if (ringedSite) {
        ctx.beginPath();
        ctx.arc(px(ringedSite.x), py(ringedSite.z), (ringedSite.r || 3.4) * scale + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px(bombXY.x), py(bombXY.z), 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px(bombXY.x), py(bombXY.z), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff3b30';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // --- agents: player arrow, teammates amber, visible enemies teal -------
    for (const a of agents || []) {
      if (!a || a.alive === false) continue;
      const pos = a.pos || a;
      if (typeof pos.x !== 'number' || typeof pos.z !== 'number') continue;
      const x = px(pos.x);
      const y = py(pos.z);
      if (a.isPlayer || a.id === 0) {
        const yaw = typeof playerYaw === 'number' ? playerYaw : (a.yaw || 0);
        ctx.save();
        ctx.translate(x, y);
        // Triangle points up (-y = north); forward is (-sin yaw, -cos yaw),
        // which is a rotation of -yaw from north.
        ctx.rotate(-yaw);
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(5, 5);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fillStyle = '#ffb347';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      } else if (a.team === 'ember') {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8c2e';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (visible.has(a.id)) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#2ec4b6';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // --- location label under the map, follows the player ------------------
    if (labelEl && player) {
      const pos = player.pos || player;
      if (typeof pos.x === 'number' && typeof pos.z === 'number') {
        const text = 'CINDERQUAY — ' + areaNameFor(pos.x, pos.z);
        if (text !== lastLabel) {
          lastLabel = text;
          labelEl.textContent = text;
        }
      }
    }
  }

  return { draw };
}
