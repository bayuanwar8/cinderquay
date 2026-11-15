// state.js — single game-state object for CINDERQUAY.
// Owns creation, the kill feed, damage/armor resolution and team queries.
// No rendering here; three.js is not needed (bomb.pos stays null until a
// plant/drop writes a Vector3 into it from rounds/bots).

import { mulberry32 } from './rng.js';

const FEED_MAX = 6;

// Fresh state for one match. `seed` drives state.rng, the only gameplay
// randomness source; every module reads it from here.
export function createState(seed) {
  return {
    time: 0,
    rng: mulberry32(seed),
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 1,
    firstTo: 5,
    maxRounds: 9,
    roundTimeLeft: 100,
    buyTimeLeft: 12,
    scores: { ember: 0, tide: 0 },
    losses: { ember: 0, tide: 0 }, // consecutive losses, for loss bonus
    attackSide: 'tide', // rounds 1-4 Tide attacks; rounds 5-9 Ember attacks
    bomb: {
      status: 'idle', // idle | carried | planting | planted | defusing | defused | exploded
      site: null, // 'A' | 'B'
      carrierId: -1,
      planterId: -1,
      defuserId: -1,
      progress: 0, // 0..1 channel progress
      timer: 35, // seconds left once planted
      pos: null, // THREE.Vector3 | null (planted / dropped position)
    },
    agents: [], // 10 agent objects, index 0 = player (filled by main/bots)
    feed: [], // [{ text, cls, t }], max 6, newest first
    banner: null, // { title, sub, until } | null
    roundWinner: null,
    matchWinner: null,
  };
}

// Push a kill-feed line, newest first, capped at FEED_MAX entries.
// cls: 'ember' | 'tide' | 'info'.
export function addFeed(state, text, cls) {
  state.feed.unshift({ text, cls: cls || 'info', t: state.time });
  if (state.feed.length > FEED_MAX) state.feed.length = FEED_MAX;
}

// Apply one hit to `target`. `amount` is final damage (the caller already
// folded in weapon damage and the head multiplier); `isHead` only affects
// the feed wording. Armor absorbs half the damage until it runs out, the
// rest goes to hp. On death: alive=false, deaths++, killer gets a kill and
// +$300, and a feed line is added. Returns 'hit' | 'kill', or null when the
// target was already dead (no double kill, no double payout).
export function damageAgent(state, target, amount, isHead, attacker) {
  if (!target || !target.alive) return null;
  if (!(amount > 0)) return 'hit';

  let remaining = amount;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, remaining * 0.5);
    target.armor -= absorbed;
    remaining -= absorbed;
  }
  target.hp -= remaining;

  if (target.hp > 0) return 'hit';

  target.hp = 0;
  target.alive = false;
  target.deaths += 1;

  if (attacker && attacker !== target) {
    attacker.kills += 1;
    attacker.money += 300;
  }

  const killerName = attacker ? attacker.name : 'The yard';
  const killerCls = attacker && attacker.team ? attacker.team : 'info';
  addFeed(
    state,
    `${killerName} ▸ ${target.name}${isHead ? ' (headshot)' : ''}`,
    killerCls,
  );
  return 'kill';
}

// Living agents of one team, in agents[] order.
export function aliveAgents(state, team) {
  const out = [];
  for (let i = 0; i < state.agents.length; i++) {
    const a = state.agents[i];
    if (a && a.alive && a.team === team) out.push(a);
  }
  return out;
}
