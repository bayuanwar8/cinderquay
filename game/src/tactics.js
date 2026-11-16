// tactics.js — round roles + site push + post-plant rotation for CINDERQUAY.
// Owns: assigning each bot a lane/site for the round (with a role label
// for the HUD/radio workstream: entry / anchor / support / mid-lurk),
// the bomb carrier's walk-to-site / channel state, and the rotation
// once the bomb is planted (attackers hold the site, defenders rotate
// to the device). Movement itself stays in nav.js; shooting in bots.js.
//
// Roles are labels on the assignment v2 already made, not new behaviour:
// attackers on the called site are entry (carrier + 2), attackers mid
// are support, defenders on a site are anchor, the mid defender is the
// mid-lurk. Nothing here changes where any bot walks.

import { dist2d } from './nav.js';

const SITE_HOLD_DIST = 9; // attackers stay within this of a planted site
const DEFUSE_REACH = 2; // defenders channel once this close to the device
// BUG 8: a defender duelling an enemy farther than this from the device
// rotates to the bomb instead — 12 m is the same "far enemy" notion as
// the carrier rule in bots.js, and about SITE_HOLD_DIST (9) + the site
// radius (3.4): beyond it the enemy cannot be holding the site.
const ROTATE_FAR_DIST = 12;
// BUG 8: a defender whose rotate route is spent walks the last metres
// straight to the device when it is within this distance — the planter
// stops at the edge of the 3.4 m site radius and the plant-spot waypoint
// sits at the site centre, so the route can end up to 3.3 + 0.6
// (waypoint-arrival slack) = 3.9 m from the device (checked numerically
// over the site disc); 5 m covers that with ~1 m of margin. Exported:
// bots.js uses the same bound for the direct walk.
export const DEFUSE_WALK_DIST = 5;

// Split the bots into attackers/defenders for the round and give each a
// lane and a site. Returns { attackers, defenders, calledSite }.
export function assignTasks(agents, attackSide, rng) {
  const calledSite = rng() < 0.5 ? 'A' : 'B';
  const attackers = agents.filter((a) => a.team === attackSide);
  const defenders = agents.filter((a) => a.team !== attackSide);
  // Attackers: carrier + 2 more to the called site, 2 mid. The carrier
  // travels with the main group.
  attackers.forEach((a, i) => {
    a.ai.site = calledSite;
    a.ai.lane = i < 3 ? calledSite : 'mid';
    a.ai.role = i < 3 ? 'entry' : 'support';
  });
  // Defenders: 2 A, 2 B, 1 mid.
  defenders.forEach((a, i) => {
    a.ai.site = null;
    a.ai.lane = i < 2 ? 'A' : i < 4 ? 'B' : 'mid';
    a.ai.role = i < 4 ? 'anchor' : 'mid-lurk';
  });
  return { attackers, defenders, calledSite };
}

// Once the bomb is planted, the planter stops channeling and holds the
// site like any other attacker (otherwise 'plant' would block engage).
export function clearPlantState(agent, bomb, nav) {
  const ai = agent.ai;
  if ((bomb.status === 'planted' || bomb.status === 'defusing') && ai.state === 'plant') {
    ai.state = 'hold';
    ai.holdWp = nav.nearestWaypoint(agent.pos.x, agent.pos.z);
    return true;
  }
  return false;
}

// Carrier reaches the called site: channel (rounds/bomb owns progress).
// Walking away from the site drops the bot back to 'push'.
// BUG 4: the carrier's route can be spent while it still stands outside
// the site — after a fight, a divert, or a dropped-bomb pickup the path
// is exhausted and the bot just holds forever. When the carrier has no
// route left and is not mid-fight, walk it back to the plant spot (the
// nearest waypoint to the site centre, which sits inside the plant
// radius — the random site waypoints mostly do not).
export function updateCarrier(agent, bomb, world, nav) {
  const ai = agent.ai;
  const site = world.sites[bomb.site || ai.site || 'A'];
  if (!site) return;
  if (dist2d(agent.pos.x, agent.pos.z, site.x, site.z) <= site.r) {
    ai.state = 'plant';
    return;
  }
  if (ai.state === 'plant') ai.state = 'push';
  // Re-plan also while engaging: the carrier pushes through a fight on
  // its route (bots.js), so a spent route must be replaced mid-fight too.
  if (nav && ai.state !== 'defuse') {
    const pathLeft = ai.path ? ai.path.length - ai.pathIdx : 0;
    if (!ai.path || pathLeft <= 0) {
      const wp = nav.nearestWaypoint(site.x, site.z);
      if (nav.planTo(agent, wp)) ai.state = 'push';
    }
  }
}

// After the plant, attackers hold around the site; defenders rotate in.
// `nav` is the navigator from nav.js (planToSite / planTo / nearestWaypoint).
export function postPlant(agent, bomb, world, nav, isAttacker, radio) {
  const ai = agent.ai;
  const plantedSite = bomb.status === 'planted' || bomb.status === 'defusing' ? bomb.site : null;
  if (!plantedSite) return;
  if (isAttacker) {
    if (ai.state === 'engage' || ai.state === 'dead') return;
    const site = world.sites[plantedSite];
    const d = dist2d(agent.pos.x, agent.pos.z, site.x, site.z);
    if (d > SITE_HOLD_DIST) {
      if (ai.state !== 'retreat') {
        ai.state = 'retreat';
        nav.planToSite(agent, plantedSite);
      }
    } else if (ai.state === 'retreat') {
      ai.state = 'hold';
      ai.holdWp = nav.nearestWaypoint(agent.pos.x, agent.pos.z);
    }
  } else {
    if (ai.state === 'dead' || ai.state === 'defuse') return;
    const d = bomb.pos ? dist2d(agent.pos.x, agent.pos.z, bomb.pos.x, bomb.pos.z) : Infinity;
    // BUG 8: standing on the device defuses even mid-duel. The old code
    // returned early for 'engage' before ever checking the distance, so
    // a defender strafing across the bomb never channelled.
    if (d <= DEFUSE_REACH) {
      ai.state = 'defuse';
      return;
    }
    // BUG 8: a defender duelling a far-away enemy never rotates — the
    // attackers hold the site in the open, so the defender almost always
    // has line of sight and stays 'engage' for the whole 35 s fuse. Let
    // an 'engage' defender rotate when its target is far from the
    // device: that enemy is not guarding the site, so the duel can wait.
    // A defender whose target is close to the bomb keeps duelling — it
    // is already defending the site.
    const farTarget = ai.state === 'engage' && ai.target && bomb.pos &&
      dist2d(ai.target.pos.x, ai.target.pos.z, bomb.pos.x, bomb.pos.z) > ROTATE_FAR_DIST;
    if (ai.state === 'engage' && !farTarget) return;
    if (ai.state !== 'retreat') {
      ai.state = 'retreat';
      const wp = nav.nearestWaypoint(bomb.pos.x, bomb.pos.z);
      // BUG 8: only re-plan when the route does not already end at the
      // bomb — the engage transition re-enters 'engage' every frame while
      // the defender still sees its target, so re-planning here on every
      // frame would reset pathIdx and pin the defender to the first
      // waypoint of its route. A spent route close to the device is not
      // re-planned either: bots.js walks the last metres straight to the
      // bomb instead (a re-plan would send it back to the waypoint).
      const pathLeft = ai.path ? ai.path.length - ai.pathIdx : 0;
      const dest = ai.path && ai.path.length ? ai.path[ai.path.length - 1] : -1;
      if (dest !== wp || (pathLeft <= 0 && d > DEFUSE_WALK_DIST)) nav.planTo(agent, wp);
      // One rotation call per plant, not one per frame (B).
      if (radio && !ai.radioRotated) {
        ai.radioRotated = true;
        radio.rotation(agent, plantedSite);
      }
    }
  }
}
