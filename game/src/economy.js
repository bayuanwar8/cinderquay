// economy.js — buy prices + round rewards for CINDERQUAY.
// Owns: the buy catalogue (prices are the v2 numbers, unchanged), buy(),
// and the round-end payout (win bonus / loss-bonus ladder / plant bonus).
// No timers, no bomb logic — those stay in rounds.js / bomb.js.

import { WEAPONS, GRENADES } from './weapons.js';

export const ARMOR_PRICE = 650;
export const ARMOR_AMOUNT = 50;
export const ARMOR_MAX = 100;
export const WIN_BONUS = 3250;
export const LOSS_BASE = 1900;
export const LOSS_PER_STREAK = 500;
export const LOSS_CAP = 2900;
export const PLANT_BONUS = 300;
export const KILL_BONUS = 300; // paid by state.damageAgent, listed here as the single source of the number
export const DEFUSE_PRICE = 400; // defuse kit (B): halves the defuse channel for its carrier

// The buy catalogue in rounds.js shape: { id, name, price }.
export function menuItems() {
  return [
    { id: 'rifle', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price },
    { id: 'smg', name: WEAPONS.smg.name, price: WEAPONS.smg.price },
    { id: 'sniper', name: WEAPONS.sniper.name, price: WEAPONS.sniper.price },
    { id: 'shotgun', name: WEAPONS.shotgun.name, price: WEAPONS.shotgun.price },
    { id: 'he', name: GRENADES.he.name, price: GRENADES.he.price },
    { id: 'smoke', name: GRENADES.smoke.name, price: GRENADES.smoke.price },
    { id: 'flash', name: GRENADES.flash.name, price: GRENADES.flash.price },
    { id: 'armor', name: 'Kevlar vest', price: ARMOR_PRICE },
    { id: 'defuse', name: 'Defuse kit', price: DEFUSE_PRICE },
  ];
}

// The same catalogue in main.js shape, with hotkeys and owned/count state
// for the buy menu the player sees.
export function menuItemsForPlayer(agent) {
  const items = [];
  for (const id of ['rifle', 'smg', 'shotgun', 'sniper']) {
    items.push({ id, name: WEAPONS[id].name, price: WEAPONS[id].price, key: id === 'rifle' ? '1' : id === 'smg' ? '2' : id === 'shotgun' ? '3' : '4', owned: agent.weaponId === id });
  }
  items.push({ id: 'he', name: GRENADES.he.name, price: GRENADES.he.price, key: '5', owned: false, count: agent.grenades.he });
  items.push({ id: 'smoke', name: GRENADES.smoke.name, price: GRENADES.smoke.price, key: '6', owned: false, count: agent.grenades.smoke });
  items.push({ id: 'flash', name: GRENADES.flash.name, price: GRENADES.flash.price, key: '7', owned: false, count: agent.grenades.flash });
  items.push({ id: 'armor', name: 'Kevlar vest (+50 armor)', price: ARMOR_PRICE, key: '8', owned: agent.armor >= ARMOR_MAX });
  items.push({ id: 'defuse', name: 'Defuse kit (defuse 2× faster)', price: DEFUSE_PRICE, key: '9', owned: !!agent.defuseKit });
  return items;
}

// Buy one item for `agent` during the buy phase. Returns false when the
// phase, the money or the item does not allow it; otherwise charges the
// agent and applies the item. `state` is only read for the phase check.
export function buy(agent, itemId, state) {
  if (!agent || !agent.alive) return false;
  if (state.phase !== 'buy') return false;
  const weapon = WEAPONS[itemId];
  const grenade = GRENADES[itemId];
  let price = -1;
  if (weapon) price = weapon.price;
  else if (grenade) price = grenade.price;
  else if (itemId === 'armor') price = ARMOR_PRICE;
  else if (itemId === 'defuse') price = DEFUSE_PRICE;
  else return false;
  if (price < 0 || agent.money < price) return false;
  if (itemId === 'armor' && agent.armor >= ARMOR_MAX) return false;
  if (itemId === 'defuse' && agent.defuseKit) return false;

  agent.money -= price;
  if (weapon) {
    agent.weaponId = itemId;
    agent.mag = weapon.mag;
    agent.reserve = weapon.reserve;
  } else if (grenade) {
    agent.grenades[itemId] = (agent.grenades[itemId] || 0) + 1;
  } else if (itemId === 'defuse') {
    agent.defuseKit = true;
  } else {
    agent.armor = Math.min(ARMOR_MAX, agent.armor + ARMOR_AMOUNT);
  }
  return true;
}

// Round-end payout. Winners +$3250, losers +$1900 plus $500 per
// consecutive loss, capped at +$2900 total. Kill money was already paid
// by damageAgent; the planter bonus is paid when the plant completes.
// Returns the loss bonus paid, for the caller to log if it wants.
export function payoutRound(state, winner) {
  const loser = winner === 'ember' ? 'tide' : 'ember';
  const lossBonus = Math.min(LOSS_BASE + LOSS_PER_STREAK * (state.losses[loser] - 1), LOSS_CAP);
  for (const a of state.agents) {
    if (!a) continue;
    a.money += a.team === winner ? WIN_BONUS : lossBonus;
  }
  return lossBonus;
}
