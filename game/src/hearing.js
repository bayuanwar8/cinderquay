// hearing.js — shot hearing + investigate reaction for CINDERQUAY.
// Owns: HEAR_RADIUS, broadcasting a shot position to nearby bots, and
// the per-bot investigate step (walk to the last heard shot, clear it
// once close). No sight, no shooting — those stay in bots.js.

const HEAR_RADIUS = 25;
const INVESTIGATE_CLEAR_DIST = 2;

// `agents` is the bot list (ids 1..9); the player is never a listener
// here — main.js hears through bots.hearShot, same as before.
export function createHearing(agents) {
  // Every live bot within HEAR_RADIUS of `pos` remembers the shot.
  // `except` (the shooter, for bot shots) never hears its own shot.
  function broadcastShot(pos, except) {
    for (const a of agents) {
      if (a === except || !a.alive) continue;
      if (a.pos.distanceTo(pos) <= HEAR_RADIUS) {
        a.ai.lastHeard = { x: pos.x, z: pos.z };
      }
    }
  }

  // Investigate the last heard shot, unless the bot is busy engaging,
  // planting or defusing. `planTo` is nav.planTo; `nearestWp` is
  // nav.nearestWaypoint bound to the world. `radio` (optional) gets one
  // heard-shot call per investigation, not one per frame (B).
  function investigate(agent, planTo, nearestWp, radio) {
    const ai = agent.ai;
    if (!ai.lastHeard) return;
    if (ai.state === 'engage' || ai.state === 'plant' || ai.state === 'defuse') return;
    const wp = nearestWp(ai.lastHeard.x, ai.lastHeard.z);
    if (ai.hearWp !== wp) {
      ai.hearWp = wp;
      planTo(agent, wp);
      ai.state = 'push';
      if (radio && !ai.radioHeard) {
        ai.radioHeard = true;
        radio.heardShot(agent);
      }
    }
    if (Math.hypot(agent.pos.x - ai.lastHeard.x, agent.pos.z - ai.lastHeard.z) < INVESTIGATE_CLEAR_DIST) {
      ai.lastHeard = null;
      ai.radioHeard = false;
    }
  }

  return { broadcastShot, investigate, HEAR_RADIUS };
}
