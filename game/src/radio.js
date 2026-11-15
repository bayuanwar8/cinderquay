// radio.js — bot radio chatter for CINDERQUAY.
// Owns: bot callsigns + roles, and the "[RADIO] Name (Role): callout"
// feed lines. Presentation only: it pushes lines into state.feed, main.js
// renders them. All wording is our own.
import { addFeed } from './state.js';

// One role per bot, fixed for the match. The player (id 0) is the fifth
// Ember and takes Entry while attacking, Anchor while defending.
export const BOT_ROLES = {
  Ash: 'Entry',
  Coal: 'Anchor',
  Rust: 'Support',
  Soot: 'Mid Lurk',
  Brine: 'AWPer',
  Kelp: 'Entry',
  Fathom: 'Anchor',
  Salter: 'Support',
  Marrow: 'Mid Lurk',
};

export function roleOf(agent) {
  if (!agent) return '—';
  if (agent.isPlayer) return agent.role || 'Entry';
  return BOT_ROLES[agent.name] || '—';
}

export function createRadio(state) {
  // Counters rotate the callout wording so the feed never reads like one
  // canned line repeated — deterministic: same call order, same lines.
  let contactN = 0;
  let heardN = 0;
  const CONTACT_LINES = [
    (where) => `Contact${where} — eyes on one, holding the angle.`,
    (where) => `Eyes on one${where} — he is peeking the lane, I have the angle.`,
    (where) => `Contact${where} — one pushing in, I am holding the corner.`,
    (where) => `Spotted one${where} — keep the crossfire, do not chase.`,
  ];
  const HEARD_LINES = [
    'Heard shots close by — checking it, stay sharp.',
    'Shots from the yard — moving to look, cover my lane.',
  ];

  function say(agent, line) {
    if (!agent || !line) return;
    const role = roleOf(agent);
    addFeed(state, `[RADIO] ${agent.name} (${role}): ${line}`, agent.team);
  }

  return {
    // Opening call when the round goes live: the plan and the player's job.
    plan(attackSide, site, playerRole) {
      const s = site || 'A';
      const caller = (state.agents || []).find((a) => a && a.name === 'Ash') || null;
      if (attackSide === 'ember') {
        say(caller, `Split ${s} — I entry first through the west door, you follow me in.`);
      } else {
        say(caller, `Hold ${s} with me — you anchor the site, I watch the lane.`);
      }
      void playerRole;
    },

    // First sight of an enemy this engagement.
    contact(agent, site) {
      const where = site ? ` at site ${site}` : '';
      say(agent, CONTACT_LINES[contactN++ % CONTACT_LINES.length](where));
    },

    // The carrier starts the plant channel.
    plantStarted(agent, site) {
      say(agent, `Planting the charge at site ${site || 'A'} — cover me, do not peek wide.`);
    },

    // A defender rotates toward the planted bomb.
    rotation(agent, site) {
      say(agent, `Rotating to site ${site || 'A'} — charge is down, I am coming to you.`);
    },

    // A bot hears a shot and moves to check it.
    heardShot(agent) {
      say(agent, HEARD_LINES[heardN++ % HEARD_LINES.length]);
    },

    // The bomb was defused.
    defused(agent, site) {
      say(agent, `Charge defused at site ${site || 'A'} — site is clear, reset for next round.`);
    },
  };
}
