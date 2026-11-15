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
export function updateCarrier(agent, bomb, world) {
  const ai = agent.ai;
  const site = world.sites[bomb.site || ai.site || 'A'];
  if (site && dist2d(agent.pos.x, agent.pos.z, site.x, site.z) <= site.r) {
    ai.state = 'plant';
  } else if (ai.state === 'plant') {
    ai.state = 'push';
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
    if (ai.state === 'engage' || ai.state === 'dead' || ai.state === 'defuse') return;
    const d = bomb.pos ? dist2d(agent.pos.x, agent.pos.z, bomb.pos.x, bomb.pos.z) : Infinity;
    if (d <= DEFUSE_REACH) {
      ai.state = 'defuse';
    } else if (ai.state !== 'retreat') {
      ai.state = 'retreat';
      const wp = nav.nearestWaypoint(bomb.pos.x, bomb.pos.z);
      nav.planTo(agent, wp);
      // One rotation call per plant, not one per frame (B).
      if (radio && !ai.radioRotated) {
        ai.radioRotated = true;
        radio.rotation(agent, plantedSite);
      }
    }
  }
}
