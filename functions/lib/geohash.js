// Minimal geohash encoder and neighbor utilities (Base32)
// Adapted from public domain references.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat, lon, precision = 6) {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = '';
  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;

  while (geohash.length < precision) {
    if (evenBit) {
      const lonMid = (lonMin + lonMax) / 2;
      if (lon >= lonMid) { idx = idx * 2 + 1; lonMin = lonMid; }
      else { idx = idx * 2; lonMax = lonMid; }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) { idx = idx * 2 + 1; latMin = latMid; }
      else { idx = idx * 2; latMax = latMid; }
    }
    evenBit = !evenBit;
    if (++bit == 5) {
      geohash += BASE32.charAt(idx);
      bit = 0; idx = 0;
    }
  }
  return geohash;
}

// Neighbor calculation using lookup tables
const neighbors = {
  right:  { even: 'bc01fg45238967deuvhjyznpkmstqrwx' },
  left:   { even: '238967debc01fg45kmstqrwxuvhjyznp' },
  top:    { even: 'p0r21436x8zb9dcf5h7kjnmqesgutwvy' },
  bottom: { even: '14365h7k9dcfesgujnmqp0r2twvyx8zb' }
};
neighbors.bottom.odd = neighbors.left.even;
neighbors.top.odd = neighbors.right.even;
neighbors.left.odd = neighbors.bottom.even;
neighbors.right.odd = neighbors.top.even;

const borders = {
  right:  { even: 'bcfguvyz' },
  left:   { even: '0145hjnp' },
  top:    { even: 'prxz' },
  bottom: { even: '028b' }
};
borders.bottom.odd = borders.left.even;
borders.top.odd = borders.right.even;
borders.left.odd = borders.bottom.even;
borders.right.odd = borders.top.even;

function calculateAdjacent(srcHash, dir) {
  srcHash = srcHash.toLowerCase();
  const lastChr = srcHash.charAt(srcHash.length - 1);
  const type = (srcHash.length % 2) ? 'odd' : 'even';
  let base = srcHash.substring(0, srcHash.length - 1);
  if (borders[dir][type].indexOf(lastChr) !== -1 && base !== '') {
    base = calculateAdjacent(base, dir);
  }
  const neighborIndex = neighbors[dir][type].indexOf(lastChr);
  const char = BASE32.charAt(neighborIndex);
  return base + char;
}

export function geohashNeighbors(hash) {
  const top = calculateAdjacent(hash, 'top');
  const bottom = calculateAdjacent(hash, 'bottom');
  const right = calculateAdjacent(hash, 'right');
  const left = calculateAdjacent(hash, 'left');
  return new Set([
    hash,
    top, bottom, right, left,
    calculateAdjacent(top, 'right'),
    calculateAdjacent(top, 'left'),
    calculateAdjacent(bottom, 'right'),
    calculateAdjacent(bottom, 'left')
  ]);
}

export function expandNeighbors(hash, steps = 1) {
  let set = new Set([hash]);
  for (let i = 0; i < steps; i++) {
    const next = new Set(set);
    for (const h of set) {
      for (const n of geohashNeighbors(h)) next.add(n);
    }
    set = next;
  }
  return set;
}

