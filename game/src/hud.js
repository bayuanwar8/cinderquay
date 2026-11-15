// HUD CINDERQUAY — presentation only. main.js pushes numbers in; this
// module never reads or mutates simulation state, it only writes DOM.
// Every setter remembers its last value and skips the DOM when nothing
// changed, so the per-frame push from main stays cheap.
import { createMinimap } from './minimap.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    hud: $('hud'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    healthNum: $('health-num'),
    healthFill: $('health-fill'),
    armorNum: $('armor-num'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    grenadeCount: $('grenade-count'),
    timer: $('timer'),
    scoreEmber: $('score-ember'),
    scoreTide: $('score-tide'),
    roundNum: $('round-num'),
    money: $('money'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    bombStatus: $('bomb-status'),
    minimap: $('minimap'),
    minimapLabel: $('minimap-label'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    scoreboard: $('scoreboard'),
    scoreboardBody: $('scoreboard-body'),
    channel: $('channel'),
    channelLabel: $('channel-label'),
    channelFill: $('channel-fill'),
    damageVignette: $('damage-vignette'),
    flashOverlay: $('flash-overlay'),
    plan: $('plan'),
    hint: $('hint'),
    weaponSlots: $('weapon-slots'),
    scoreboardBanner: $('scoreboard-banner'),
    scoreboardStreak: $('scoreboard-streak'),
    scoreboardLegend: $('scoreboard-legend'),
  };

  // Last-written values, one slot per setter.
  const last = {
    hp: -1, armor: -1, mag: -1, reserve: -1, weapon: '',
    he: -1, smoke: -1, flash: -1, timer: '', ember: -1, tide: -1, round: -1,
    money: -1, bomb: '', gap: -1, hint: '', channel: '', channelProg: -2,
    scoreboard: '', slots: '', plan: '', flashOp: -1,
  };
  let hitTimer = 0;
  let bannerTimer = 0;
  let flashTimer = 0;
  let playCb = null;
  let restartCb = null;
  let overlayMode = '';

  // Minimap panel: layout + sites + dots + bomb + location label.
  const minimap = createMinimap(el.minimap, el.minimapLabel);

  const OVERLAY_COPY = {
    start: {
      title: 'CINDERQUAY',
      copy: 'A container terminal at dusk. Ember vs Tide — first to 5 rounds. Plant the charge at site A or B, or wipe the other team out.',
      action: 'PLAY',
    },
    paused: {
      title: 'PAUSED',
      copy: 'Game paused. Click to resume.',
      action: 'RESUME',
    },
    roundEnd: {
      title: 'ROUND OVER',
      copy: '',
      action: 'NEXT ROUND',
    },
    matchEnd: {
      title: 'MATCH OVER',
      copy: '',
      action: 'PLAY AGAIN',
    },
  };

  function fmtClock(s) {
    const total = Math.max(0, Math.ceil(s));
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return m + ':' + String(sec).padStart(2, '0');
  }

  function show(node, on) {
    if (!node) return;
    node.hidden = !on;
    node.classList.toggle('hidden', !on);
    // The stylesheet shows several panels via an .on class, so toggle that
    // too — hidden alone never displays #banner, #channel or #scoreboard.
    node.classList.toggle('on', on);
  }

  const api = {
    setHealth(hp, armor) {
      const h = Math.max(0, Math.round(hp));
      const a = Math.max(0, Math.round(armor || 0));
      if (h === last.hp && a === last.armor) return;
      last.hp = h;
      last.armor = a;
      if (el.healthNum) el.healthNum.textContent = String(h);
      if (el.armorNum) el.armorNum.textContent = String(a);
      if (el.healthNum) el.healthNum.classList.toggle('low', h <= 25);
      if (el.healthFill) {
        el.healthFill.style.width = h + '%';
        el.healthFill.classList.toggle('low', h <= 25);
      }
    },

    setAmmo(mag, reserve, weaponName) {
      const name = weaponName || '';
      if (mag === last.mag && reserve === last.reserve && name === last.weapon) return;
      last.mag = mag;
      last.reserve = reserve;
      last.weapon = name;
      if (el.ammoMag) el.ammoMag.textContent = String(mag);
      if (el.ammoReserve) el.ammoReserve.textContent = '/ ' + reserve;
      if (el.weaponName) el.weaponName.textContent = name;
      if (el.ammoMag) el.ammoMag.classList.toggle('empty', mag === 0);
    },

    setGrenades(he, smoke, flash) {
      const fl = flash || 0;
      if (he === last.he && smoke === last.smoke && fl === last.flash) return;
      last.he = he;
      last.smoke = smoke;
      last.flash = fl;
      if (el.grenadeCount) {
        el.grenadeCount.textContent = 'HE ' + he + ' · SMOKE ' + smoke + ' · FLASH ' + fl;
      }
    },

    // Team plan + the player's role for this round, under the top bar.
    setPlan(text) {
      const t = text || '';
      if (t === last.plan) return;
      last.plan = t;
      if (el.plan) {
        el.plan.textContent = t;
        el.plan.classList.toggle('on', t.length > 0);
      }
    },

    // White flash-blind overlay, 0 = clear, 1 = full whiteout.
    setFlash(opacity) {
      const o = Math.round(Math.max(0, Math.min(1, opacity || 0)) * 50) / 50;
      if (o === last.flashOp) return;
      last.flashOp = o;
      if (el.flashOverlay) el.flashOverlay.style.opacity = String(o);
    },

    setTimer(s) {
      const text = fmtClock(s);
      if (text === last.timer) return;
      last.timer = text;
      if (el.timer) {
        el.timer.textContent = text;
        el.timer.classList.toggle('urgent', s <= 10);
      }
    },

    setScore(e, t) {
      if (e === last.ember && t === last.tide) return;
      last.ember = e;
      last.tide = t;
      if (el.scoreEmber) el.scoreEmber.textContent = String(e);
      if (el.scoreTide) el.scoreTide.textContent = String(t);
    },

    setRound(r) {
      if (r === last.round) return;
      last.round = r;
      if (el.roundNum) el.roundNum.textContent = 'ROUND ' + r + '/9';
    },

    setMoney(m) {
      if (m === last.money) return;
      last.money = m;
      if (el.money) el.money.textContent = '$' + Math.round(m).toLocaleString('en-US');
    },

    feed(text, cls) {
      if (!el.killfeed) return;
      const entry = document.createElement('div');
      entry.className = 'feed-entry' + (cls ? ' ' + cls : '');
      entry.textContent = text;
      el.killfeed.prepend(entry);
      while (el.killfeed.children.length > 6) {
        el.killfeed.removeChild(el.killfeed.lastChild);
      }
      // In shot mode (window.__cqShot, set by main.js) the capture runs on
      // virtual time, which would fast-forward past the 5 s lifetime and
      // erase the feed before the screenshot — so entries stay put there.
      if (!window.__cqShot) {
        setTimeout(() => {
          if (entry.parentNode) entry.parentNode.removeChild(entry);
        }, 5000);
      }
    },

    banner(title, sub, ms) {
      if (!el.banner) return;
      if (el.bannerTitle) el.bannerTitle.textContent = title || '';
      if (el.bannerSub) el.bannerSub.textContent = sub || '';
      show(el.banner, true);
      clearTimeout(bannerTimer);
      // Same virtual-time note as feed(): in shot mode the banner must not
      // hide itself before the capture.
      if (!window.__cqShot) {
        bannerTimer = setTimeout(() => show(el.banner, false), ms || 4000);
      }
    },

    showOverlay(mode, data) {
      overlayMode = mode;
      const base = OVERLAY_COPY[mode] || OVERLAY_COPY.start;
      let title = base.title;
      let copy = base.copy;
      if (data) {
        if (mode === 'roundEnd') {
          const winner = (data.winner || '').toString().toUpperCase();
          if (winner) title = winner + ' TAKES THE ROUND';
          if (data.reason) copy = data.reason;
          if (data.score) {
            const sc = data.score;
            const e = sc.ember ?? sc[0] ?? '';
            const t = sc.tide ?? sc[1] ?? '';
            copy = (copy ? copy + ' — ' : '') + 'Score ' + e + ' – ' + t;
          }
        } else if (mode === 'matchEnd') {
          const winner = (data.winner || '').toString().toUpperCase();
          if (winner) title = winner + ' WINS THE MATCH';
          if (data.reason) copy = data.reason;
          if (data.score) {
            const sc = data.score;
            copy = (copy ? copy + ' — ' : '') + 'Final ' + (sc.ember ?? '') + ' – ' + (sc.tide ?? '');
          }
        }
      }
      if (el.overlayTitle) el.overlayTitle.textContent = title;
      if (el.overlayCopy) el.overlayCopy.textContent = copy;
      if (el.play) el.play.textContent = base.action;
      show(el.overlay, true);
      if (el.play) el.play.focus();
    },

    hideOverlay() {
      overlayMode = '';
      show(el.overlay, false);
    },

    onPlay(cb) {
      playCb = cb;
    },

    onRestart(cb) {
      restartCb = cb;
    },

    showBuyMenu(items, money, onBuy) {
      if (!el.buyMenu || !el.buyItems) return;
      el.buyItems.textContent = '';
      (items || []).forEach((item, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'buy-item';
        const hotkey = item.hotkey || item.key || String(i + 1);
        const price = item.price || 0;
        const owned = !!item.owned;
        const count = typeof item.count === 'number' ? ' ×' + item.count : '';
        btn.textContent = '[' + hotkey + '] ' + item.name + ' — $' + price + count + (owned ? ' (OWNED)' : '');
        btn.disabled = owned || money < price;
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          if (onBuy) onBuy(item.id);
        });
        el.buyItems.appendChild(btn);
      });
      show(el.buyMenu, true);
    },

    hideBuyMenu() {
      show(el.buyMenu, false);
    },

    setBombStatus(text) {
      const t = text || '';
      if (t === last.bomb) return;
      last.bomb = t;
      if (el.bombStatus) {
        el.bombStatus.textContent = t;
        el.bombStatus.classList.toggle('on', t.length > 0);
      }
    },

    // Same signature as before, plus an optional 6th arg: the world
    // collider list (world.colliders) the minimap draws its layout from.
    // The drawing itself lives in minimap.js.
    drawMinimap(agents, sites, bomb, playerYaw, visibleEnemies, layout) {
      minimap.draw(agents, sites, bomb, playerYaw, visibleEnemies, layout);
    },

    hitMarker(kill) {
      if (!el.hitmarker) return;
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', !!kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        el.hitmarker.classList.remove('on');
        el.hitmarker.classList.remove('kill');
      }, kill ? 220 : 120);
    },

    setCrosshairGap(pxVal) {
      if (pxVal === last.gap || !el.crosshair) return;
      last.gap = pxVal;
      el.crosshair.style.setProperty('--gap', pxVal + 'px');
    },

    setChannel(label, progress) {
      const prog = progress === null || progress === undefined ? null : Math.max(0, Math.min(1, progress));
      const key = (label || '') + '|' + (prog === null ? 'null' : prog.toFixed(3));
      if (key === last.channel) return;
      last.channel = key;
      if (!el.channel) return;
      if (prog === null) {
        show(el.channel, false);
        return;
      }
      show(el.channel, true);
      if (el.channelLabel) el.channelLabel.textContent = label || '';
      if (el.channelFill) el.channelFill.style.width = Math.round(prog * 100) + '%';
    },

    // Scoreboard: Name / Role / Team / K / D / DMG / HS% / MVP / Funds,
    // with the round-end banner above it, a W/L streak row and a legend.
    // meta: { banner, streakText } — both optional; the banner names the
    // round winner and its MVP, e.g. "EMBER WIN — MVP You".
    setScoreboard(agents, meta) {
      if (!el.scoreboard || !el.scoreboardBody) return;
      const list = (agents || []).slice();
      const mvpId = (() => {
        let best = null;
        for (const a of list) {
          if (!best || (a.kills || 0) > (best.kills || 0) ||
            ((a.kills || 0) === (best.kills || 0) && (a.dmg || 0) > (best.dmg || 0))) best = a;
        }
        return best && (best.kills || 0) > 0 ? best.id : -1;
      })();
      const rows = list.map((a) => [
        a.team || '', a.name || ('#' + a.id), a.kills || 0, a.deaths || 0,
        a.dmg || 0, a.hsKills || 0, a.money || 0, a.id === mvpId ? 'mvp' : '',
      ].join('|')).join('\n');
      const bannerText = (meta && meta.banner) || '';
      const streakText = (meta && meta.streakText) || '';
      const key = rows + '||' + bannerText + '||' + streakText;
      if (key === last.scoreboard) {
        show(el.scoreboard, true);
        return;
      }
      last.scoreboard = key;
      if (el.scoreboardBanner) {
        el.scoreboardBanner.textContent = bannerText;
        el.scoreboardBanner.classList.toggle('on', bannerText.length > 0);
      }
      if (el.scoreboardStreak) {
        el.scoreboardStreak.textContent = streakText;
        el.scoreboardStreak.classList.toggle('on', streakText.length > 0);
      }
      if (el.scoreboardLegend) {
        el.scoreboardLegend.textContent = '★ MVP — most kills · HS% = headshot kills ÷ kills · Funds = credits';
      }
      el.scoreboardBody.textContent = '';
      // Ember first, then by kills — the winning side reads top-down.
      list.sort((a, b) => {
        if ((a.team || '') !== (b.team || '')) return a.team === 'ember' ? -1 : 1;
        return (b.kills || 0) - (a.kills || 0);
      });
      for (const a of list) {
        const tr = document.createElement('tr');
        tr.className = (a.team || '') + (a.alive ? '' : ' dead');
        const hsPct = (a.kills || 0) > 0
          ? Math.round(100 * (a.hsKills || 0) / (a.kills || 0)) + '%'
          : '—';
        const cells = [
          (a.isPlayer ? 'You' : (a.name || ('#' + a.id))),
          a.role || '—',
          (a.team || '').toUpperCase(),
          String(a.kills || 0),
          String(a.deaths || 0),
          String(a.dmg || 0),
          hsPct,
          a.id === mvpId ? '★' : '',
          '$' + (a.money || 0),
        ];
        cells.forEach((text) => {
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        });
        el.scoreboardBody.appendChild(tr);
      }
      show(el.scoreboard, true);
    },

    hideScoreboard() {
      show(el.scoreboard, false);
    },

    setWeaponSlots(current, owned) {
      if (!el.weaponSlots) return;
      // Two shapes are accepted: an array of {id,name} (SPEC text) and the
      // slot map main.js passes: { primary: name|null, pistol: name,
      // he: count, smoke: count } with current = 'primary'|'pistol'|'he'|'smoke'.
      let entries;
      if (Array.isArray(owned)) {
        entries = owned.map((w, i) => ({
          id: typeof w === 'string' ? w : (w.id || w.name),
          label: (i + 1) + ' ' + (typeof w === 'string' ? w : (w.name || w.id)),
        }));
      } else {
        const o = owned || {};
        entries = [
          { id: 'primary', label: '1 ' + (o.primary || '—') },
          { id: 'pistol', label: '2 ' + (o.pistol || 'P9 Sidearm') },
          { id: 'he', label: '3 HE ×' + (o.he || 0) },
          { id: 'smoke', label: '4 SMOKE ×' + (o.smoke || 0) },
          { id: 'flash', label: '5 FLASH ×' + (o.flash || 0) },
        ];
      }
      const key = String(current) + '|' + entries.map((e) => e.id + '=' + e.label).join(',');
      if (key === last.slots) return;
      last.slots = key;
      el.weaponSlots.textContent = '';
      entries.forEach((e) => {
        const slot = document.createElement('div');
        slot.className = 'weapon-slot' + (e.id === current ? ' active' : '');
        slot.textContent = e.label;
        el.weaponSlots.appendChild(slot);
      });
    },

    damageFlash() {
      if (!el.damageVignette) return;
      el.damageVignette.classList.add('flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => el.damageVignette.classList.remove('flash'), 160);
    },

    setHint(text) {
      const t = text || '';
      if (t === last.hint) return;
      last.hint = t;
      if (el.hint) {
        el.hint.textContent = t;
        el.hint.classList.toggle('on', t.length > 0);
      }
    },
  };

  if (el.play) {
    el.play.addEventListener('click', () => {
      if ((overlayMode === 'roundEnd' || overlayMode === 'matchEnd') && restartCb) {
        restartCb();
      } else if (playCb) {
        playCb();
      }
    });
  }

  return api;
}
