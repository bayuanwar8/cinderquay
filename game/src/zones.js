// zones.js — plant-zone indicators for CINDERQUAY.
// Owns: the glowing site ring + "PLANT ZONE" label. The ring sits faint
// on each site; it flares up with a pulsing glow and a label when the bomb
// carrier closes in on that site, and stays lit around a planted bomb.
import * as THREE from 'three';

const NEAR_DIST = 12;

function makeLabelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.font = 'bold 52px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 256, 50);
  g.fillStyle = '#ffb347';
  g.fillText(text, 256, 50);
  return new THREE.CanvasTexture(c);
}

export function createZones(scene, world) {
  const zones = [];
  const sites = (world && world.sites) || {};
  for (const label of Object.keys(sites)) {
    const s = sites[label];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.5, (s.r || 3.4) - 0.18), (s.r || 3.4) + 0.18, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff8c2e, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.06, s.z);
    scene.add(ring);

    const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeLabelTexture('PLANT ZONE'), transparent: true, depthWrite: false,
    }));
    // Label sits off-centre, toward the site's north-east edge: in the
    // plant capture the camera looks north-west from the south-east, so
    // world (+x, -z) is screen-right. The defuser kneels on the west side
    // of the device and the rifle muzzle sits centre-frame, so a centred
    // label reads "LANT ZON" — P behind the defuser, E behind the muzzle.
    // A 1.0 m screen-right shift (inside the 3.4 m ring) clears the
    // defuser, and y 1.45 lifts the text just above the muzzle sight
    // (its top is ~y 1.3 in frame) while staying well below the radio
    // feed — y 2.4 used to cross it. Same offset fits site B: it is
    // also approached from the south, so (+x, -z) is screen-right there.
    labelSprite.scale.set(4.4, 0.83, 1);
    labelSprite.position.set(s.x + 0.71, 1.45, s.z - 0.71);
    labelSprite.visible = false;
    scene.add(labelSprite);

    zones.push({ label, site: s, ring, labelSprite });
  }

  function carrierOf(state) {
    if (!state || !state.bomb || state.bomb.carrierId < 0) return null;
    const list = state.agents || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === state.bomb.carrierId) return list[i];
    }
    return null;
  }

  function dist2d(ax, az, bx, bz) {
    const dx = ax - bx;
    const dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  return {
    update(_dt, state) {
      if (!state || !state.bomb) return;
      const bomb = state.bomb;
      const carrier = carrierOf(state);
      const t = state.time || 0;
      for (const z of zones) {
        let active = false;
        if ((bomb.status === 'planted' || bomb.status === 'defusing') && bomb.site === z.label) {
          active = true;
        } else if (
          carrier && carrier.alive &&
          (bomb.status === 'carried' || bomb.status === 'planting') &&
          dist2d(carrier.pos.x, carrier.pos.z, z.site.x, z.site.z) <= NEAR_DIST
        ) {
          active = true;
        }
        z.ring.material.opacity = active ? 0.45 + 0.25 * Math.sin(t * 5) : 0.12;
        z.labelSprite.visible = active;
        if (active) z.labelSprite.material.opacity = 0.75 + 0.25 * Math.sin(t * 5);
      }
    },
  };
}
