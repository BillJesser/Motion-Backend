// Simple rule-based classifier that selects up to 3 tags
// from the allowed list based on title and location text.

export const ALLOWED_TAGS = [
  'Concert',
  'Festival',
  'Theatre',
  'Market',
  'Comedy',
  'Sports',
  'Outdoor',
  'Cultural',
  'Charity',
  'Drinks',
  'Netwroking', // Note: preserved spelling from requirements
  'Wellness',
  'Lifestyle'
];

const KEYWORDS = {
  Concert: ['concert', 'live music', 'gig', 'band', 'dj', 'orchestra'],
  Festival: ['festival', 'fair', 'carnival', 'fête'],
  Theatre: ['theatre', 'theater', 'play', 'musical', 'stage'],
  Market: ['market', 'farmers', 'bazaar', 'flea'],
  Comedy: ['comedy', 'stand-up', 'standup', 'improv'],
  Sports: ['sports', 'game', 'match', 'tournament', 'league', 'race', 'marathon'],
  Outdoor: ['outdoor', 'hike', 'hiking', 'picnic', 'park', 'trail', 'camp'],
  Cultural: ['cultural', 'heritage', 'museum', 'art', 'exhibit', 'gallery'],
  Charity: ['charity', 'fundraiser', 'benefit', 'donation', 'nonprofit'],
  Drinks: ['drinks', 'beer', 'wine', 'cocktail', 'brewery', 'bar', 'happy hour'],
  Netwroking: ['networking', 'mixer', 'meetup', 'connect'], // user-provided tag spelling preserved
  Wellness: ['wellness', 'yoga', 'meditation', 'fitness', 'health'],
  Lifestyle: ['lifestyle', 'fashion', 'beauty', 'home', 'design']
};

function textFromLocation(loc) {
  if (!loc || typeof loc !== 'object') return '';
  const parts = [];
  for (const k of ['name', 'address', 'city', 'state', 'zip']) {
    const v = loc[k];
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  }
  return parts.join(' ');
}

function scoreTags(text) {
  const lc = (text || '').toLowerCase();
  const scores = new Map(ALLOWED_TAGS.map(t => [t, 0]));
  for (const tag of ALLOWED_TAGS) {
    const kws = KEYWORDS[tag] || [];
    for (const kw of kws) {
      if (!kw) continue;
      // simple occurrence check
      if (lc.includes(kw)) scores.set(tag, (scores.get(tag) || 0) + 1);
    }
  }
  return scores;
}

export function selectTags({ title, location }) {
  const titleText = typeof title === 'string' ? title : '';
  const locText = typeof location === 'string' ? location : textFromLocation(location);
  const combined = `${titleText} ${locText}`.trim();
  const scores = scoreTags(combined);

  // Rank tags by score desc, then alphabetically to keep it deterministic
  const ranked = Array.from(scores.entries())
    .filter(([, s]) => s > 0)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([t]) => t)
    .slice(0, 3);
  return ranked;
}

// Case-insensitive canonicalization to allowed tags, with a helpful alias
export function canonicalizeTags(input) {
  if (!input) return [];
  const alias = new Map([
    // common misspelling fix to match provided list
    ['networking', 'Netwroking']
  ]);
  const lowerToTag = new Map(ALLOWED_TAGS.map(t => [t.toLowerCase(), t]));
  const parts = Array.isArray(input) ? input : String(input).split(',');
  const out = [];
  for (let p of parts) {
    const s = String(p).trim();
    if (!s) continue;
    const direct = lowerToTag.get(s.toLowerCase());
    if (direct) { out.push(direct); continue; }
    const aliased = alias.get(s.toLowerCase());
    if (aliased && ALLOWED_TAGS.includes(aliased)) out.push(aliased);
  }
  // dedupe preserving order
  return Array.from(new Set(out));
}

