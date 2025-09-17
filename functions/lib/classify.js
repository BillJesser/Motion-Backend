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
  'Networking',
  'Wellness',
  'Lifestyle'
];

const KEYWORDS = {
  Concert: [
    'concert','live music','gig','band','dj','orchestra','symphony','recital','choir','choral','setlist','tour','show',
    'headliner','opening act','support act','festival stage','rave','edm','electronic','hip hop','rap','rock','indie',
    'punk','metal','jazz','blues','folk','country','bluegrass','singer-songwriter','acoustic','unplugged','residency',
    'venue','tickets','mosh','pit','soundcheck','backline'
  ],
  Festival: [
    'festival','fest','street fair','fair','carnival','parade','block party','mardi gras','oktoberfest','pride','food fest',
    'beer fest','wine fest','film festival','music festival','arts festival','culture fest','lantern festival','harvest',
    'dragon boat','diwali','holi','moon festival','solstice','market festival','night market','street festival','fete'
  ],
  Theatre: [
    'theatre','theater','play','drama','musical','stage','broadway','off-broadway','shakespeare','matinee','performance',
    'cast','tickets','box office','black box','rehearsal','opera','operetta','ballet','dance theatre','monologue',
    'improv theatre','script reading','table read','curtain call','orchestra pit','mezzanine','balcony','usher'
  ],
  Market: [
    'market','farmers market','farmers','bazaar','flea','swap meet','craft fair','artisan market','makers market','night market',
    'pop-up','popup','vendor','stall','booth','handmade','vintage','thrift','antique','food hall','food market','street market',
    'mercado','produce','baked goods','artisan','locally made','crafts'
  ],
  Comedy: [
    'comedy','stand-up','standup','improv','open mic','roast','sketch','satire','parody','comic','humor','laughs','comedic',
    'laugh factory','comedy club','headline set','mc','host','crowd work','one-liner','bits','banter','riff','giggle','chuckle'
  ],
  Sports: [
    'sports','game','match','tournament','league','playoffs','finals','championship','race','marathon','half marathon','5k','10k',
    'triathlon','duathlon','ironman','soccer','football','basketball','baseball','softball','hockey','lacrosse','rugby','cricket',
    'tennis','pickleball','badminton','table tennis','volleyball','golf','disc golf','bowling','boxing','mma','wrestling','fencing',
    'swim','swimming','diving','water polo','rowing','crew','sailing','surfing','skiing','snowboard','snowboarding','skating',
    'ice skating','figure skating','track','field','athletics','crossfit','strength','powerlifting','cycling','biking','mountain bike',
    'bmx','motorsport','motocross','karting','esports','stadium','arena','ballpark','court','pitch','rink','field','gym'
  ],
  Outdoor: [
    'outdoor','hike','hiking','picnic','park','trail','camp','camping','campfire','backpacking','kayak','canoe','paddle','paddleboard',
    'sup','rafting','climb','climbing','bouldering','mountaineering','trek','nature walk','birding','wildlife','stargazing','beach',
    'bonfire','orchard','pumpkin patch','farm tour','garden','gardening','cleanup','conservation','outdoors','national park','state park'
  ],
  Cultural: [
    'cultural','heritage','tradition','traditional','ethnic','multicultural','diaspora','folklore','folk dance','world music','cuisine',
    'cultural center','language','history','historical','museum','art','exhibit','gallery','curator','lecture','talk','workshop',
    'film screening','international','global','customs','ritual','ceremony','cultural festival','storytelling','poetry','literary'
  ],
  Charity: [
    'charity','fundraiser','benefit','donation','donate','nonprofit','non-profit','giveback','for a cause','cause','relief','aid',
    'charitable','drive','food drive','toy drive','book drive','blood drive','auction','silent auction','gala','banquet','philanthropy',
    'volunteer','volunteering','service','charity run','charity walk','telethon'
  ],
  Drinks: [
    'drinks','beer','wine','cocktail','brewery','bar','happy hour','taproom','mixology','distillery','cidery','meadery','tasting',
    'flight','pairing','sommelier','vinyl night','trivia night','pub','speakeasy','nightcap','bartender','craft beer','ipa','stout',
    'lager','pilsner','sour','cabernet','merlot','pinot','rose','sparkling','bubbles'
  ],
  Networking: [
    'networking','mixer','meetup','connect','professional','career','industry','coworking','co-working','founders','entrepreneurs',
    'startup','pitch night','demo day','happy hour networking','roundtable','panel','fireside chat','speed networking','job fair',
    'hiring event','recruiting','alumni','community meetup','link-up','schmooze','social hour','business cards','linkedin'
  ],
  Wellness: [
    'wellness','yoga','meditation','fitness','health','pilates','spin','zumba','bootcamp','run club','wellbeing','mindfulness',
    'nutrition','healthy cooking','sound bath','breathwork','stretch','mobility','crossfit','barre','aerobics','tai chi','qigong',
    'spa','recovery','mental health','self-care','holistic','wellness retreat','detox'
  ],
  Lifestyle: [
    'lifestyle','fashion','beauty','home','design','home decor','interior','interior design','diy','gardening','sustainability',
    'eco','minimalism','vintage style','wardrobe','styling','runway','fashion week','thrifting','brunch','influencer','blogger',
    'parenting','family','pets','dog-friendly','cat cafe','travel','photography','plants','houseplants','crafting','maker'
  ]
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

// Case-insensitive canonicalization to allowed tags, with helpful aliases
export function canonicalizeTags(input) {
  if (!input) return [];
  const alias = new Map([
    // Back-compat and common misspelling fixes
    ['netwroking', 'Networking'],
    ['networking', 'Networking']
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

