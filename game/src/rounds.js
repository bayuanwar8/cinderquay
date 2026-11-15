// rounds.js — match flow, buy phase and win checks for CINDERQUAY.
// Owns: buy timer (12 s), live timer (100 s), round/match end and buy().
// The economy numbers live in economy.js, the bomb channels / timer /
// fuse in bomb.js (created here with endRound as its hook); this module
// only wires the round flow together.

import { WEAPONS } from './weapons.js';
import { buy as buyItem, payoutRound, menuItems } from './economy.js';
import { createBomb, BOMB_TIME } from './bomb.js';
import { aliveAgents } from './state.js';

const BUY_TIME = 12;
const ROUND_TIME = 100;
const ROUND_END_TIME = 4;
const MVP_BONUS = 300; // round MVP takes +$300 (B); other economy numbers live in economy.js/bomb.js

export function createRounds(state, world) {
  let ctx = null; // latest step ctx { hud, audio, bots, player, effects, input, world }
  let needsSetup = false;
  let roundEndT = 0;

  // Bomb channels / fuse, with this module's endRound as the hook that
  // fires when a defuse completes or the fuse runs out.
  const bomb = createBomb(state, world, { endRound });

  const defendSide = () => (state.attackSide === 'ember' ? 'tide' : 'ember');

  function playerAgent() {
    for (let i = 0; i < state.agents.length; i++) {
      if (state.agents[i] && state.agents[i].isPlayer) return state.agents[i];
    }
    return state.agents[0] || (ctx && ctx.player) || null;
  }

  function hud() {
    return ctx && ctx.hud ? ctx.hud : null;
  }

  function audio() {
    return ctx && ctx.audio ? ctx.audio : null;
  }

  function call(fn, ...args) {
    if (typeof fn === 'function') fn(...args);
  }

  function showBanner(title, sub) {
    state.banner = { title, sub, until: state.time + ROUND_END_TIME };
    const h = hud();
    if (h) call(h.banner, title, sub, ROUND_END_TIME * 1000);
  }

  // --- round setup ------------------------------------------------------------
  // Spawns bots (via bots.resetForRound, which also assigns the bomb
  // carrier) and resets the player. Runs lazily on the first step() of a
  // round because startRound() itself receives no ctx.
  function ensureSetup() {
    if (!needsSetup || !ctx) return;
    needsSetup = false;
    if (ctx.bots) ctx.bots.resetForRound();

    const p = playerAgent();
    if (p) {
      const spawns = world.spawns[p.team] || world.spawns.ember;
      const spawn = spawns[0];
      if (p.mover && p.mover.pos) {
        p.mover.pos.set(spawn.x, 0, spawn.z);
        if (p.mover.vel) p.mover.vel.set(0, 0, 0);
      } else if (p.pos) {
        if (typeof p.pos.set === 'function') p.pos.set(spawn.x, 0, spawn.z);
        else {
          p.pos.x = spawn.x;
          p.pos.y = 0;
          p.pos.z = spawn.z;
        }
      }
      p.hp = 100;
      p.alive = true;
      p.crouching = false;
      p.yaw = p.team === 'ember' ? 0 : Math.PI; // ember faces north (-z), tide faces south (+z)
      if (p.mover) p.mover.yaw = p.yaw;
      // Economy persists across rounds; only health and position reset.
      if (!p.weaponId) p.weaponId = 'pistol';
      const w = WEAPONS[p.weaponId] || WEAPONS.pistol;
      if (p.mag === undefined || p.reserve === undefined) {
        p.mag = w.mag;
        p.reserve = w.reserve;
      }
    }
  }

  // --- match / round lifecycle --------------------------------------------------
  function startMatch() {
    state.scores.ember = 0;
    state.scores.tide = 0;
    state.losses.ember = 0;
    state.losses.tide = 0;
    state.round = 1;
    state.matchWinner = null;
    startRound();
  }

  function startRound() {
    state.attackSide = state.round <= 4 ? 'tide' : 'ember';
    state.phase = 'buy';
    state.buyTimeLeft = BUY_TIME;
    state.roundTimeLeft = ROUND_TIME;
    state.roundWinner = null;
    state.banner = null;
    state.bomb.status = 'idle';
    state.bomb.site = null;
    state.bomb.carrierId = -1;
    state.bomb.planterId = -1;
    state.bomb.defuserId = -1;
    state.bomb.progress = 0;
    state.bomb.timer = BOMB_TIME;
    bomb.resetBeep();
    needsSetup = true;
    const h = hud();
    if (h) {
      call(h.setScore, state.scores.ember, state.scores.tide);
      call(h.setRound, state.round);
      call(h.setBombStatus, '');
      call(h.showBuyMenu, menuItems(), playerAgent() ? playerAgent().money : 0, (id) => buy(playerAgent(), id));
    }
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.scores[winner] += 1;
    const loser = winner === 'ember' ? 'tide' : 'ember';
    state.losses[winner] = 0;
    state.losses[loser] += 1;
    // Economy: winners +$3250, losers +$1900 plus $500 per consecutive
    // loss, capped at +$2900 total (economy.js).
    payoutRound(state, winner);
    state.roundWinner = winner;
    state.bomb.progress = 0;
    // Win streaks for the scoreboard, and the round MVP: most kills on
    // the winning team (ties broken by damage dealt) takes +$300.
    state.streak[winner] = (state.streak[winner] || 0) + 1;
    state.streak[loser] = 0;
    let mvp = null;
    for (const a of state.agents) {
      if (!a || a.team !== winner) continue;
      if (!mvp || (a.kills || 0) > (mvp.kills || 0) ||
        ((a.kills || 0) === (mvp.kills || 0) && (a.dmg || 0) > (mvp.dmg || 0))) {
        mvp = a;
      }
    }
    state.mvpId = mvp ? mvp.id : -1;
    state.mvpName = mvp ? mvp.name : '';
    if (mvp && (mvp.kills || 0) > 0) mvp.money += MVP_BONUS;
    const h = hud();
    const a = audio();
    const reasonText =
      reason === 'bomb'
        ? 'Bomb detonated'
        : reason === 'defuse'
          ? 'Bomb defused'
          : reason === 'time'
            ? 'Time expired'
            : 'Team eliminated';
    const title = winner === 'ember' ? 'EMBER TAKES THE ROUND' : 'TIDE TAKES THE ROUND';
    const sub = `${reasonText} — ${state.scores.ember} : ${state.scores.tide}`;

    const matchOver =
      state.scores[winner] >= state.firstTo || state.round >= state.maxRounds;
    if (matchOver) {
      state.phase = 'matchEnd';
      state.matchWinner = winner;
      showBanner(winner === 'ember' ? 'EMBER WINS THE MATCH' : 'TIDE WINS THE MATCH', sub);
      if (h) call(h.showOverlay, 'matchEnd', { score: { ...state.scores }, winner, reason });
    } else {
      state.phase = 'roundEnd';
      roundEndT = ROUND_END_TIME;
      showBanner(title, sub);
      if (h) call(h.showOverlay, 'roundEnd', { score: { ...state.scores }, winner, reason });
    }
    if (a) {
      const p = playerAgent();
      if (p && winner === p.team) call(a.win);
      else call(a.lose);
    }
    if (h) call(h.setScore, state.scores.ember, state.scores.tide);
  }

  // --- buy -----------------------------------------------------------------------
  // The buy rules live in economy.js; this is the rounds-facing delegate
  // main.js calls (rounds.buy).
  function buy(agent, itemId) {
    return buyItem(agent, itemId, state);
  }

  // --- per-frame ---------------------------------------------------------------------
  function step(dt, nextCtx) {
    if (nextCtx) ctx = nextCtx;
    if (!ctx) return;
    ensureSetup();
    const h = hud();
    const p = playerAgent();

    if (state.phase === 'buy') {
      state.buyTimeLeft -= dt;
      if (h) {
        call(h.setTimer, Math.max(0, Math.ceil(state.buyTimeLeft)));
        call(h.setScore, state.scores.ember, state.scores.tide);
        call(h.setRound, state.round);
        if (p) call(h.setMoney, p.money);
      }
      if (state.buyTimeLeft <= 0) {
        state.phase = 'live';
        state.roundTimeLeft = ROUND_TIME;
        if (h) {
          call(h.hideBuyMenu);
          call(h.setTimer, ROUND_TIME);
        }
        const side = state.attackSide === 'ember' ? 'Ember' : 'Tide';
        showBanner(`ROUND ${state.round}`, `${side} attacks — plant or defend the bomb`);
        // Opening radio call: the plan for this round.
        if (ctx.radio) {
          const p = playerAgent();
          const playerRole = state.attackSide === 'ember' ? 'Entry' : 'Anchor';
          if (p) p.role = playerRole;
          ctx.radio.plan(state.attackSide, state.bomb.site, playerRole);
        }
      }
      return;
    }

    if (state.phase === 'roundEnd') {
      roundEndT -= dt;
      if (roundEndT <= 0) {
        state.round += 1;
        startRound();
      }
      return;
    }

    if (state.phase !== 'live') return;

    state.roundTimeLeft -= dt;
    if (h) call(h.setTimer, Math.max(0, Math.ceil(state.roundTimeLeft)));

    // Bomb: pickup, dead-carrier drop, plant / defuse channels, fuse.
    bomb.step(dt, ctx);
    if (state.phase !== 'live') return; // endRound may have fired

    // Win checks.
    const attackersAlive = aliveAgents(state, state.attackSide).length;
    const defendersAlive = aliveAgents(state, defendSide()).length;
    if (defendersAlive === 0) {
      endRound(state.attackSide, 'elimination');
      return;
    }
    if (attackersAlive === 0 && state.bomb.status !== 'planted' && state.bomb.status !== 'defusing') {
      endRound(defendSide(), 'elimination');
      return;
    }
    if (state.roundTimeLeft <= 0 && state.bomb.status !== 'planted' && state.bomb.status !== 'defusing') {
      endRound(defendSide(), 'time');
    }
  }

  return { startMatch, startRound, endRound, step, buy };
}
