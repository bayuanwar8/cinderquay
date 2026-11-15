// rounds.js — match flow, buy phase, economy and the bomb for CINDERQUAY.
// Owns: buy timer (12 s), live timer (100 s), plant/defuse channels,
// the planted-bomb timer, win checks, round/match end and buy().
// Channel progress lives here and here only: bots merely walk into
// position and set ai.state to 'plant'/'defuse'; this module advances
// state.bomb.progress every tick and resets it on any interruption.

import { WEAPONS, GRENADES } from './weapons.js';
import { addFeed, aliveAgents, damageAgent } from './state.js';

const BUY_TIME = 12;
const ROUND_TIME = 100;
const PLANT_TIME = 3.5;
const DEFUSE_TIME = 5;
const BOMB_TIME = 35;
const EXPLOSION_RADIUS = 6;
const EXPLOSION_MAX_DAMAGE = 120;
const ROUND_END_TIME = 4;
const ARMOR_PRICE = 650;
const ARMOR_AMOUNT = 50;
const ARMOR_MAX = 100;
const WIN_BONUS = 3250;
const LOSS_BASE = 1900;
const LOSS_PER_STREAK = 500;
const LOSS_CAP = 2900;
const PLANT_BONUS = 300;
const PICKUP_RADIUS = 1.5;
const DEFUSE_RADIUS = 2;

function agentById(state, id) {
  for (let i = 0; i < state.agents.length; i++) {
    if (state.agents[i] && state.agents[i].id === id) return state.agents[i];
  }
  return null;
}

function dist2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function createRounds(state, world) {
  let ctx = null; // latest step ctx { hud, audio, bots, player, effects, input, world }
  let needsSetup = false;
  let roundEndT = 0;
  let beepT = 0;

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
    beepT = 0;
    needsSetup = true;
    const h = hud();
    if (h) {
      call(h.setScore, state.scores.ember, state.scores.tide);
      call(h.setRound, state.round);
      call(h.setBombStatus, '');
      call(h.showBuyMenu, buyMenuItems(), playerAgent() ? playerAgent().money : 0, (id) => buy(playerAgent(), id));
    }
  }

  function buyMenuItems() {
    return [
      { id: 'rifle', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price },
      { id: 'smg', name: WEAPONS.smg.name, price: WEAPONS.smg.price },
      { id: 'sniper', name: WEAPONS.sniper.name, price: WEAPONS.sniper.price },
      { id: 'shotgun', name: WEAPONS.shotgun.name, price: WEAPONS.shotgun.price },
      { id: 'he', name: GRENADES.he.name, price: GRENADES.he.price },
      { id: 'smoke', name: GRENADES.smoke.name, price: GRENADES.smoke.price },
      { id: 'armor', name: 'Kevlar vest', price: ARMOR_PRICE },
    ];
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.scores[winner] += 1;
    const loser = winner === 'ember' ? 'tide' : 'ember';
    state.losses[winner] = 0;
    state.losses[loser] += 1;
    // Economy: winners +$3250, losers +$1900 plus $500 per consecutive
    // loss, capped at +$2900 total. Kill money was already paid by
    // damageAgent; the planter bonus is paid when the plant completes.
    const lossBonus = Math.min(LOSS_BASE + LOSS_PER_STREAK * (state.losses[loser] - 1), LOSS_CAP);
    for (const a of state.agents) {
      if (!a) continue;
      a.money += a.team === winner ? WIN_BONUS : lossBonus;
    }
    state.roundWinner = winner;
    state.bomb.progress = 0;
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
  function buy(agent, itemId) {
    if (!agent || !agent.alive) return false;
    if (state.phase !== 'buy') return false;
    const weapon = WEAPONS[itemId];
    const grenade = GRENADES[itemId];
    let price = -1;
    if (weapon) price = weapon.price;
    else if (grenade) price = grenade.price;
    else if (itemId === 'armor') price = ARMOR_PRICE;
    else return false;
    if (price < 0 || agent.money < price) return false;
    if (itemId === 'armor' && agent.armor >= ARMOR_MAX) return false;

    agent.money -= price;
    if (weapon) {
      agent.weaponId = itemId;
      agent.mag = weapon.mag;
      agent.reserve = weapon.reserve;
    } else if (grenade) {
      agent.grenades[itemId] = (agent.grenades[itemId] || 0) + 1;
    } else {
      agent.armor = Math.min(ARMOR_MAX, agent.armor + ARMOR_AMOUNT);
    }
    return true;
  }

  // --- bomb channels (owned entirely by step) --------------------------------------
  function stepPlant(dt) {
    const bomb = state.bomb;
    if (bomb.status !== 'carried' && bomb.status !== 'planting') return;
    const carrier = agentById(state, bomb.carrierId);
    const site = bomb.site ? world.sites[bomb.site] : null;
    let channeling = false;
    if (carrier && carrier.alive && site) {
      const inSite = dist2d(carrier.pos.x, carrier.pos.z, site.x, site.z) <= site.r;
      if (inSite) {
        if (carrier.isPlayer) {
          channeling = !!(ctx && ctx.input && ctx.input.isDown('KeyE'));
        } else {
          channeling = carrier.ai && carrier.ai.state === 'plant';
        }
      }
    }
    const h = hud();
    if (!channeling) {
      if (bomb.status === 'planting') {
        bomb.status = 'carried';
        bomb.progress = 0;
        if (h) call(h.setChannel, null, null);
      }
      return;
    }
    bomb.status = 'planting';
    bomb.planterId = carrier.id;
    bomb.progress += dt / PLANT_TIME;
    if (h) call(h.setChannel, 'Planting the bomb', Math.min(1, bomb.progress));
    if (bomb.progress < 1) return;

    // Plant complete.
    bomb.progress = 0;
    bomb.status = 'planted';
    bomb.timer = BOMB_TIME;
    beepT = 0;
    if (bomb.pos) bomb.pos.set(carrier.pos.x, 0.4, carrier.pos.z);
    carrier.money += PLANT_BONUS;
    addFeed(state, `${carrier.name} planted the bomb at site ${bomb.site}`, carrier.team);
    if (h) {
      call(h.setChannel, null, null);
      call(h.setBombStatus, `BOMB PLANTED — ${Math.ceil(bomb.timer)}`);
    }
    const a = audio();
    if (a) call(a.plantTick);
  }

  function stepDefuse(dt) {
    const bomb = state.bomb;
    if (bomb.status !== 'planted' && bomb.status !== 'defusing') return;
    if (!bomb.pos) return;
    const defTeam = defendSide();
    let defuser = null;
    for (const a of state.agents) {
      if (!a || !a.alive || a.team !== defTeam) continue;
      if (dist2d(a.pos.x, a.pos.z, bomb.pos.x, bomb.pos.z) > DEFUSE_RADIUS) continue;
      if (a.isPlayer) {
        if (ctx && ctx.input && ctx.input.isDown('KeyE')) defuser = a;
      } else if (a.ai && a.ai.state === 'defuse') {
        defuser = a;
      }
      if (defuser) break;
    }
    const h = hud();
    if (!defuser) {
      if (bomb.status === 'defusing') {
        bomb.status = 'planted';
        bomb.progress = 0;
        if (h) call(h.setChannel, null, null);
      }
      return;
    }
    bomb.status = 'defusing';
    bomb.defuserId = defuser.id;
    bomb.progress += dt / DEFUSE_TIME;
    if (h) call(h.setChannel, 'Defusing the bomb', Math.min(1, bomb.progress));
    if (bomb.progress < 1) return;
    bomb.progress = 0;
    bomb.status = 'defused';
    if (h) call(h.setChannel, null, null);
    addFeed(state, `${defuser.name} defused the bomb`, defuser.team);
    endRound(defTeam, 'defuse');
  }

  function stepBombTimer(dt) {
    const bomb = state.bomb;
    if (bomb.status !== 'planted' && bomb.status !== 'defusing') return;
    bomb.timer -= dt;
    const h = hud();
    if (h) call(h.setBombStatus, `BOMB PLANTED — ${Math.max(0, Math.ceil(bomb.timer))}`);
    // Beeps accelerate as the timer runs down.
    beepT -= dt;
    if (beepT <= 0) {
      const a = audio();
      if (a) call(a.beep);
      const frac = Math.max(0, bomb.timer / BOMB_TIME);
      beepT = 0.25 + frac * 0.85;
    }
    if (bomb.timer > 0) return;

    // Detonation: linear falloff to every agent within 6 m, no team exception.
    bomb.status = 'exploded';
    if (bomb.pos) {
      if (ctx && ctx.effects) call(ctx.effects.addExplosion, bomb.pos);
      const a = audio();
      const p = playerAgent();
      if (a && p) call(a.explosion, p.pos.distanceTo(bomb.pos));
      for (const target of state.agents) {
        if (!target || !target.alive) continue;
        const d = Math.sqrt(
          (target.pos.x - bomb.pos.x) ** 2 +
            (target.pos.y - bomb.pos.y) ** 2 +
            (target.pos.z - bomb.pos.z) ** 2,
        );
        if (d > EXPLOSION_RADIUS) continue;
        const dmg = EXPLOSION_MAX_DAMAGE * (1 - d / EXPLOSION_RADIUS);
        damageAgent(state, target, dmg, false, null);
      }
    }
    endRound(state.attackSide, 'bomb');
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

    // Player picks up a dropped bomb by walking over it.
    const bomb = state.bomb;
    if (bomb.status === 'idle' && bomb.pos && p && p.alive) {
      if (dist2d(p.pos.x, p.pos.z, bomb.pos.x, bomb.pos.z) <= PICKUP_RADIUS) {
        bomb.status = 'carried';
        bomb.carrierId = p.id;
        if (h) call(h.setBombStatus, `BOMB CARRIED — take it to site ${bomb.site || 'A/B'}`);
        addFeed(state, 'You picked up the bomb', 'ember');
      }
    }

    // A dead carrier drops the bomb where they fell (covers the player
    // carrier; bots report their own drop via bots.onAgentKilled).
    if ((bomb.status === 'carried' || bomb.status === 'planting') && bomb.carrierId >= 0) {
      const carrier = agentById(state, bomb.carrierId);
      if (!carrier || !carrier.alive) {
        bomb.status = 'idle';
        bomb.carrierId = -1;
        bomb.planterId = -1;
        bomb.progress = 0;
        if (carrier && bomb.pos) bomb.pos.set(carrier.pos.x, 0.4, carrier.pos.z);
        if (h) call(h.setChannel, null, null);
      }
    }

    state.roundTimeLeft -= dt;
    if (h) call(h.setTimer, Math.max(0, Math.ceil(state.roundTimeLeft)));

    stepPlant(dt);
    if (state.phase !== 'live') return; // endRound may have fired
    stepDefuse(dt);
    if (state.phase !== 'live') return;
    stepBombTimer(dt);
    if (state.phase !== 'live') return;

    // Win checks.
    const attackersAlive = aliveAgents(state, state.attackSide).length;
    const defendersAlive = aliveAgents(state, defendSide()).length;
    if (defendersAlive === 0) {
      endRound(state.attackSide, 'elimination');
      return;
    }
    if (attackersAlive === 0 && bomb.status !== 'planted' && bomb.status !== 'defusing') {
      endRound(defendSide(), 'elimination');
      return;
    }
    if (state.roundTimeLeft <= 0 && bomb.status !== 'planted' && bomb.status !== 'defusing') {
      endRound(defendSide(), 'time');
    }
  }

  return { startMatch, startRound, endRound, step, buy };
}
