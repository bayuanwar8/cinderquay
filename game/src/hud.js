// HUD CINDERQUAY — presentation only. main.js pushes numbers in; this
// module never reads or mutates simulation state, it only writes DOM.
// Every setter remembers its last value and skips the DOM when nothing
// changed, so the per-frame push from main stays cheap.
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
    hint: $('hint'),
    weaponSlots: $('weapon-slots'),
  };

  // Last-written values, one slot per setter.
  const last = {
    hp: -1, armor: -1, mag: -1, reserve: -1, weapon: '',
    he: -1, smoke: -1, timer: '', ember: -1, tide: -1, round: -1,
    money: -1, bomb: '', gap: -1, hint: '', channel: '', channelProg: -2,
    scoreboard: '', slots: '',
  };
  let hitTimer = 0;
  let bannerTimer = 0;
  let flashTimer = 0;
  let playCb = null;
  let restartCb = null;
  let overlayMode = '';

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

    setGrenades(he, smoke) {
      if (he === last.he && smoke === last.smoke) return;
      last.he = he;
      last.smoke = smoke;
      if (el.grenadeCount) {
        el.grenadeCount.textContent = 'HE ' + he + ' · SMOKE ' + smoke;
      }
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

    drawMinimap(agents, sites, bomb, playerYaw, visibleEnemies) {
      const canvas = el.minimap;
      if (!canvas) return;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      const W = canvas.width || 180;
      const H = canvas.height || 140;
      // Yard x [-32, 32], z [-24, 24] -> canvas, north (-z) at the top.
      const scale = Math.min(W / 64, H / 48);
      const ox = (W - 64 * scale) / 2;
      const oy = (H - 48 * scale) / 2;
      const px = (x) => ox + (x + 32) * scale;
      const py = (z) => oy + (z + 24) * scale;
      const visible = visibleEnemies instanceof Set ? visibleEnemies : new Set();

      ctx2d.clearRect(0, 0, W, H);
      ctx2d.fillStyle = '#2a2726';
      ctx2d.fillRect(0, 0, W, H);
      // Yard border (perimeter walls).
      ctx2d.strokeStyle = '#6b6560';
      ctx2d.lineWidth = 2;
      ctx2d.strokeRect(px(-32), py(-24), 64 * scale, 48 * scale);
      // Mid container block hint.
      ctx2d.fillStyle = '#4a5560';
      ctx2d.fillRect(px(-3), py(-1.3), 6 * scale, 2.6 * scale);
      // Sites.
      const siteList = [];
      if (sites) {
        if (sites.A) siteList.push(['A', sites.A]);
        if (sites.B) siteList.push(['B', sites.B]);
        if (Array.isArray(sites)) sites.forEach((s, i) => siteList.push([s.label || String(i), s]));
      }
      ctx2d.font = 'bold 10px sans-serif';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      for (const [label, s] of siteList) {
        const r = (s.r || 3.4) * scale;
        ctx2d.beginPath();
        ctx2d.arc(px(s.x), py(s.z), r, 0, Math.PI * 2);
        ctx2d.fillStyle = 'rgba(255, 140, 46, 0.18)';
        ctx2d.fill();
        ctx2d.strokeStyle = '#ff8c2e';
        ctx2d.lineWidth = 1;
        ctx2d.stroke();
        ctx2d.fillStyle = '#ff8c2e';
        ctx2d.fillText(label, px(s.x), py(s.z));
      }
      // Bomb dot (planted position, or site centre when only the site is known).
      let bombXY = null;
      if (bomb) {
        if (bomb.pos && typeof bomb.pos.x === 'number') bombXY = { x: bomb.pos.x, z: bomb.pos.z };
        else if (typeof bomb.x === 'number') bombXY = { x: bomb.x, z: bomb.z };
        else if (bomb.site && sites && sites[bomb.site]) bombXY = sites[bomb.site];
      }
      if (bombXY) {
        ctx2d.beginPath();
        ctx2d.arc(px(bombXY.x), py(bombXY.z), 4, 0, Math.PI * 2);
        ctx2d.fillStyle = '#ff3b30';
        ctx2d.fill();
        ctx2d.strokeStyle = '#fff';
        ctx2d.lineWidth = 1;
        ctx2d.stroke();
      }
      // Agents: player triangle, teammates amber, visible enemies teal.
      const list = agents || [];
      for (const a of list) {
        if (!a || a.alive === false) continue;
        const pos = a.pos || a;
        if (typeof pos.x !== 'number' || typeof pos.z !== 'number') continue;
        const x = px(pos.x);
        const y = py(pos.z);
        if (a.isPlayer || a.id === 0) {
          const yaw = typeof playerYaw === 'number' ? playerYaw : (a.yaw || 0);
          // Yaw 0 faces north (-z); triangle points along facing.
          ctx2d.save();
          ctx2d.translate(x, y);
          ctx2d.rotate(Math.PI - yaw);
          ctx2d.beginPath();
          ctx2d.moveTo(0, -7);
          ctx2d.lineTo(5, 5);
          ctx2d.lineTo(-5, 5);
          ctx2d.closePath();
          ctx2d.fillStyle = '#ffb347';
          ctx2d.fill();
          ctx2d.strokeStyle = '#fff';
          ctx2d.lineWidth = 1;
          ctx2d.stroke();
          ctx2d.restore();
        } else if (a.team === 'ember') {
          ctx2d.beginPath();
          ctx2d.arc(x, y, 3, 0, Math.PI * 2);
          ctx2d.fillStyle = '#ff8c2e';
          ctx2d.fill();
        } else if (visible.has(a.id)) {
          ctx2d.beginPath();
          ctx2d.arc(x, y, 3, 0, Math.PI * 2);
          ctx2d.fillStyle = '#2ec4b6';
          ctx2d.fill();
        }
      }
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

    setScoreboard(agents) {
      if (!el.scoreboard || !el.scoreboardBody) return;
      const rows = (agents || []).map((a) => [
        a.team || '', a.name || ('#' + a.id), a.kills || 0, a.deaths || 0, a.money || 0, a.alive ? '' : 'dead',
      ].join('|')).join('\n');
      if (rows === last.scoreboard) {
        show(el.scoreboard, true);
        return;
      }
      last.scoreboard = rows;
      el.scoreboardBody.textContent = '';
      for (const a of agents || []) {
        const tr = document.createElement('tr');
        tr.className = (a.team || '') + (a.alive ? '' : ' dead');
        const cells = [
          (a.isPlayer ? 'You (' + (a.name || '') + ')' : (a.name || ('#' + a.id))),
          String(a.kills || 0),
          String(a.deaths || 0),
          '$' + (a.money || 0),
        ];
        cells.forEach((text, i) => {
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
