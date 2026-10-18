'use strict';
/* ============ constants ============ */
const SECTIONS = [
  ['home','Home','<path d="M4 11l8-6 8 6v8h-5v-5H9v5H4z"/>'],
  ['wardrobe','Wardrobe','<path d="M12 4a2 2 0 0 1 2 2c0 1-1 1.6-2 2.2V9l8 6H4l8-6"/><path d="M4 15v1h16v-1"/>'],
  ['inspo','Inspo','<rect x="4" y="4" width="7" height="10"/><rect x="13" y="4" width="7" height="6"/><rect x="13" y="12" width="7" height="8"/><rect x="4" y="16" width="7" height="4"/>'],
  ['style','Style','<rect x="4" y="3" width="16" height="18"/><path d="M8 8h5M8 12h8M8 16h3"/>'],
  ['trips','Trips','<path d="M3 13l18-7-7 18-2-8z"/>'],
  ['profile','Profile','<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'],
];
const CATS = ['Outerwear','Tops','Knitwear','Bottoms','Dresses','Shoes','Bags','Accessories'];
const CAT_HINT = {Outerwear:'Coats, jackets, blazers, trench coats',Tops:'T-shirts, shirts, blouses',Knitwear:'Sweaters, cardigans, thermals',Bottoms:'Jeans, trousers, skirts',Dresses:'Dresses',Shoes:'Boots, trainers, loafers, heels',Bags:'Bags',Accessories:'Scarves, belts, glasses, hats, jewellery'};
const SEASONS = ['Spring','Summer','Autumn','Winter'];
const LEVELS = ['Low','Medium','High'];
const STATUSES = ['Available','In laundry','Packed','Stored','At tailor'];
const LOOK_STATUS = ['Draft','Ready','Worn'];
const BASE_TAGS = ['Scandinavian','Minimal','Classic','Winter','Travel','Evening'];
const BASE_COLLECTIONS = ['Europe Winter 2026','Everyday Uniform','Dinner Looks','The Row Inspired'];
const BOARD_BG = ['#F4F3F1','#FFFFFF','#E6E2DB','#C9C4BB','#6B5E50','#1A1A1A'];
const PROMPTS = [
  'Create three outfits for walking around Amsterdam at 6 °C',
  'A minimalist look inspired by The Row',
  'Style my grey coat with pieces I rarely wear',
  'A comfortable outfit for a long train journey',
  'An elegant look for dinner in Madrid',
];

/* ============ state ============ */
const S = {
  view: 'home', garments: [], looks: [], inspo: [], trips: [], tryons: [], profile: {},
  mode: 'connecting', loaded: {},
  wview: 'grid', wf: {}, ifl: {tag:'', col:''}, styleTab: 'looks', lookFilter: '',
  ed: null, sel: {ed: -1, fit: -1}, styl: {q: '', busy: false, res: null, err: ''},
  tripId: null, tripTab: 'days', fit: {photo: null, lookId: null, items: null, inspoId: null},
  imgMax: null, pending: false, tone: 'colour', coverBusy: false, dnaBusy: false, decAll: null,
};
try { const v = localStorage.getItem('edit.view'); if (v && SECTIONS.some(s => s[0] === v)) S.view = v; const t = localStorage.getItem('edit.tone'); if (t) S.tone = t; } catch (e) {}
function applyTone() { document.documentElement.classList.toggle('tone-archive', S.tone === 'archive'); }
applyTone();
let db = null, assets = null, sample = null, downloads = null;
const blobCache = {};

/* ============ helpers ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayISO = () => iso(new Date());
const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const fmt = (s, o) => parseISO(s).toLocaleDateString('en-GB', o);
const range = (a, b) => { const out = []; if (!a || !b || b < a) return out; for (let d = a; d <= b && out.length < 120; d = addDays(d, 1)) out.push(d); return out; };
const byId = (col, id) => S[col].find(x => x.id === id);
const src = o => srcOf(o);
const clean = o => JSON.parse(JSON.stringify(o));
const uniq = a => [...new Set(a.filter(Boolean))];
const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label ?? v)}</option>`;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200);
}

/* ============ persistence ============ */
const chains = {};
function queue(key, fn) { const p = (chains[key] || Promise.resolve()).then(fn, fn); chains[key] = p.catch(() => {}); return p; }

async function put(col, obj) {
  obj = clean(obj);
  const { id, ...data } = obj;
  const arr = S[col]; const i = arr.findIndex(x => x.id === id);
  if (i >= 0) arr[i] = obj; else arr.unshift(obj);
  softRender();
  if (!db) return;
  try { await queue(col + '/' + id, () => db.collection(col).doc(id).set(data)); }
  catch (e) { dbErr(e); }
}
async function del(col, id) {
  S[col] = S[col].filter(x => x.id !== id); softRender();
  if (!db) return;
  try { await queue(col + '/' + id, () => db.collection(col).doc(id).delete()); } catch (e) { dbErr(e); }
}
async function saveProfile(patch) {
  S.profile = clean({ ...S.profile, ...patch }); softRender();
  if (!db) return;
  try { await queue('profile', () => db.doc('profile/main').set(S.profile)); } catch (e) { dbErr(e); }
}
function dbErr(e) {
  const c = e && e.code;
  if (c === 'quota_exceeded') toast('Storage is full. Delete a few items, then try again.');
  else if (c === 'invalid_argument') toast('That change could not be saved. Only the owner can edit THE EDIT.');
  else toast('Could not save just now. Check your connection and try again.');
}

function subscribe() {
  for (const col of ['garments','looks','inspo','trips','tryons']) {
    db.collection(col).onSnapshot(snap => {
      S[col] = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      S.loaded[col] = true; softRender();
    }, e => dbErr(e));
  }
  db.doc('profile/main').onSnapshot(s => { S.profile = s.exists ? { ...s.data() } : {}; S.loaded.profile = true; if (!S.wxTried) { S.wxTried = true; autoWeather(); } softRender(); }, e => dbErr(e));
}

/* images */
function loadImg(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
async function shrink(fileOrBlob, max = 1600, type = 'image/jpeg') {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const im = await loadImg(url);
    const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    const x = c.getContext('2d');
    if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
    x.drawImage(im, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, type, .86));
  } finally { URL.revokeObjectURL(url); }
}
async function storeImage(blob) {
  if (assets) {
    const r = await assets.upload(blob);
    blobCache[r.url] = blob;
    return { imgId: r.id };
  }
  const reader = await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(blob); });
  blobCache[reader] = blob;
  return { img: reader };
}
async function getBlob(url) {
  if (blobCache[url]) return blobCache[url];
  const r = await fetch(url); if (!r.ok) throw new Error('image');
  const b = await r.blob(); blobCache[url] = b; return b;
}
function dropAsset(id) { if (assets && id) assets.delete(id).catch(() => {}); }

/* Clean background: flood-fill the near-uniform backdrop from the edges to transparent. */
async function removeBackground(url) {
  const im = await loadImg(url);
  const k = Math.min(1, 1200 / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h), p = d.data;
  const corners = [[2,2],[w-3,2],[2,h-3],[w-3,h-3],[w>>1,2]].map(([a,b]) => { const i = (b*w+a)*4; return [p[i],p[i+1],p[i+2]]; });
  const ref = corners.reduce((s, c) => [s[0]+c[0]/corners.length, s[1]+c[1]/corners.length, s[2]+c[2]/corners.length], [0,0,0]);
  const tol = 38, tol2 = tol * tol;
  const seen = new Uint8Array(w * h), stack = [];
  for (let i = 0; i < w; i++) { stack.push(i, (h-1)*w + i); }
  for (let j = 0; j < h; j++) { stack.push(j*w, j*w + w - 1); }
  while (stack.length) {
    const q = stack.pop(); if (seen[q]) continue; seen[q] = 1;
    const i = q * 4, dr = p[i]-ref[0], dg = p[i+1]-ref[1], db_ = p[i+2]-ref[2];
    if (dr*dr + dg*dg + db_*db_ > tol2) continue;
    p[i+3] = 0;
    const qx = q % w;
    if (qx > 0) stack.push(q-1); if (qx < w-1) stack.push(q+1);
    if (q >= w) stack.push(q-w); if (q < w*(h-1)) stack.push(q+w);
  }
  for (let q = 0; q < w*h; q++) {
    if (p[q*4+3] === 0) continue;
    const qx = q % w; let n = 0;
    if (qx > 0 && p[(q-1)*4+3] === 0) n++; if (qx < w-1 && p[(q+1)*4+3] === 0) n++;
    if (q >= w && p[(q-w)*4+3] === 0) n++; if (q < w*(h-1) && p[(q+w)*4+3] === 0) n++;
    if (n) p[q*4+3] = 150;
  }
  x.putImageData(d, 0, 0);
  return await new Promise(r => c.toBlob(r, 'image/png'));
}

/* ============ AI ============ */
function aiErrMsg(e) {
  const c = e && e.code;
  return ({
    not_granted: 'Claude access is off for this page. Allow it from the page’s permissions to use AI features.',
    rate_limited: 'Claude has reached a usage limit for now. Try again a little later.',
    images_unavailable: 'Image analysis is not available in this view.',
    image_rejected: 'This image format could not be read. Try a JPEG or PNG.',
    refused: 'Claude declined this request. Try rephrasing it.',
    invalid_json: 'The answer came back incomplete. Try again.',
    session_expired: 'Your session expired. Sign in again.',
    offline: 'You seem to be offline. Check your connection and try again.',
    not_configured: 'AI isn’t set up yet. Follow the AI step in LEEME.md.',
    too_large: 'That request was too large. Try fewer or smaller images.',
    upstream_error: 'Claude didn’t answer just now. Try again in a moment.',
  })[c] || (sample ? 'Something went wrong talking to Claude. Try again.' : 'AI isn’t set up yet. Follow the AI step in LEEME.md.');
}
function wardrobeBrief(list = S.garments) {
  return list.map(g => ({ id: g.id, name: g.name, category: g.category, type: g.sub, brand: g.brand, color: g.color, material: g.material,
    seasons: g.seasons, warmth: g.warmth, water: g.water, style: g.style, status: g.status || 'Available' }));
}

async function aiIdentify(blob) {
  return sample.json(
`You are cataloguing ONE garment photo for a private digital wardrobe.
Return only JSON with these keys:
{"name": short descriptive name such as "Oversized grey wool coat",
 "category": one of ${JSON.stringify(CATS)},
 "sub": specific type such as "Wool coat",
 "brand": brand only if a label or logo is clearly visible, else "",
 "color": main colour in plain words,
 "material": likely material, "" if you cannot tell,
 "seasons": array from ${JSON.stringify(SEASONS)},
 "warmth": one of "Low","Medium","High",
 "water": water resistance, one of "Low","Medium","High",
 "style": one or two words such as "Minimal",
 "notes": one short sentence on fit or shape,
 "uncertain": array of field names you are guessing}
Never invent a brand.`, { images: [blob], modelTier: 'default' });
}

async function aiDecode(blob) {
  return sample.json(
`This is a fashion inspiration photo (often a Pinterest screenshot). Decode the outfit.
Return only JSON:
{"title": an editorial 2–3 word title for this image, like "Edited Heritage" or "Quiet Tailoring",
 "note": a stylist's handwritten margin note on the look, at most 9 words, like "longer coat, narrow boot, keep it grey",
 "items":[{"name":"Oversized grey wool coat","category": one of ${JSON.stringify(CATS)},"confidence":"high"|"medium"|"low"}],
 "palette":[{"name":"Grey","hex":"#8a8a86"}],
 "style":"Scandinavian Minimalism","silhouette":"Relaxed tailoring","season":"Autumn / Winter","occasion":"City walking",
 "tags": up to 3 from ${JSON.stringify(BASE_TAGS)},
 "uncertain":["short notes on details you cannot see clearly"]}
List only garments and accessories that are visible. Use "low" confidence when a piece is cropped, blurred or hidden, and say so in "uncertain".`,
    { images: [blob], modelTier: 'default' });
}

async function aiRecreate(analysis) {
  const res = await sample.json(
`Recreate an inspiration outfit using ONLY garments from this person's wardrobe.

LOOK TO RECREATE: ${JSON.stringify({ items: analysis.items, style: analysis.style, palette: (analysis.palette||[]).map(p=>p.name), silhouette: analysis.silhouette })}

WARDROBE (the only garments that exist): ${JSON.stringify(wardrobeBrief())}

For each item in the look, pick the best wardrobe garment.
- "exact": a very similar piece (same type, close colour and material).
- "similar": a different piece that does the same job.
- "missing": nothing suitable. Before declaring missing, consider substitutions from other categories.
Return only JSON:
{"matches":[{"item": item name from the look, "type":"exact"|"similar"|"missing", "garmentId": a wardrobe id or null, "note": one sentence}],
 "swaps":["Sentences like: Your black tailored trousers could replace the grey trousers in this look."],
 "external":[{"item":"what to look for if they ever shop","why":"one sentence"}],
 "summary":"one or two sentences"}
Never use an id that is not in the wardrobe list. Prefer garments with status Available.`, { modelTier: 'complex' });
  const ok = new Set(S.garments.map(g => g.id));
  (res.matches || []).forEach(m => { if (m.garmentId && !ok.has(m.garmentId)) { m.garmentId = null; m.type = 'missing'; } if (!m.garmentId) m.type = 'missing'; });
  return res;
}

async function aiStylist(q) {
  const w = S.profile.weather;
  const res = await sample.json(
`You are a personal stylist for one person. Work ONLY with the garments in their wardrobe below.
Rules: 1) read the wardrobe; 2) use only listed garments, preferring status Available; 3) respect the weather and activity;
4) build coherent, complete outfits (outerwear when cold, shoes always if owned); 5) favour pieces that can be re-worn across looks;
6) explain each look in one or two sentences. Never claim they own something that is not listed.
If something would genuinely help but is not owned, put it in "external" and nowhere else.
Answer in the same language as the request.

REQUEST: ${q}
CURRENT WEATHER (may be irrelevant if the request names a place or temperature): ${w ? JSON.stringify(w) : 'unknown'}
STYLE NOTES FROM THE PERSON: ${S.profile.styleNotes || 'none'}
THEIR AESTHETIC, READ FROM THEIR PINTEREST MOODBOARD: ${S.profile.dna ? JSON.stringify({ name: S.profile.dna.name, keywords: S.profile.dna.keywords, silhouettes: S.profile.dna.silhouettes, signatures: S.profile.dna.signatures, avoid: S.profile.dna.avoid }) : 'not read yet'}
THEIR SAVED PINS (decoded): ${JSON.stringify(S.inspo.filter(i => i.analysis).slice(0, 40).map(i => ({ id: i.id, title: i.analysis.title || i.analysis.style, items: (i.analysis.items || []).map(x => x.name), palette: (i.analysis.palette || []).map(p => p.name), tags: i.tags })))}
WARDROBE: ${JSON.stringify(wardrobeBrief())}

Return only JSON:
{"looks":[{"name":"Amsterdam Morning","garmentIds":["id", "..."],"inspoId":"id of the saved pin this look echoes most, or null","why":"...","occasion":"Walking / Museums","style":"Minimal","tmin":5,"tmax":12}],
 "external":[{"item":"...","why":"..."}],
 "note":"optional one sentence, e.g. what is missing from the wardrobe"}
Give between 1 and 3 looks; three when asked for several.`, { modelTier: 'complex' });
  const ok = new Set(S.garments.map(g => g.id)); let dropped = 0;
  (res.looks || []).forEach(l => { const before = (l.garmentIds || []).length; l.garmentIds = uniq((l.garmentIds || []).filter(id => ok.has(id))); dropped += before - l.garmentIds.length; if (l.inspoId && !byId('inspo', l.inspoId)) l.inspoId = null; });
  res.dropped = dropped;
  return res;
}

async function aiDNA(blobs) {
  const res = await sample.json(
`These ${blobs.length} images are this person's own Pinterest saves: fashion, editorial photography, typography, interiors and art.
Read them together as ONE moodboard and describe the personal aesthetic they share, for a private styling app.
Their own notes: ${S.profile.styleNotes || 'none'}
Their wardrobe (the only garments that exist): ${JSON.stringify(wardrobeBrief())}
Return only JSON:
{"name": an evocative 2–3 word name for the aesthetic, like "Edited Heritage",
 "summary": two sentences in the voice of a fashion editor,
 "keywords": 5 single words,
 "palette": 4 to 6 of {"name","hex"},
 "silhouettes": up to 3 short phrases,
 "signatures": up to 5 garments or details that define it,
 "avoid": up to 3 things that would break it,
 "wardrobeFit": up to 6 wardrobe ids that already embody it,
 "gaps": up to 3 pieces that would complete it (these are outside suggestions, not owned)}
Never use an id that is not in the wardrobe list.`, { images: blobs, modelTier: 'complex' });
  const ok = new Set(S.garments.map(g => g.id));
  res.wardrobeFit = (res.wardrobeFit || []).filter(id => ok.has(id));
  return res;
}
async function aiCover(blob, look) {
  const w = S.profile.weather && S.profile.weather.date === todayISO() ? S.profile.weather : null;
  const gs = look ? (look.garments || []).map(id => (byId('garments', id) || {}).name).filter(Boolean) : [];
  return sample.json(
`Write today's cover line for THE EDIT, a private style magazine with one reader. The image is a photo from the reader's own Pinterest saves, chosen as today's cover.
Today: ${new Date().toDateString()}. Weather: ${w ? JSON.stringify(w) : 'unknown'}.
Today's planned outfit: ${gs.length ? gs.join(', ') : 'not chosen yet'}.
Their aesthetic: ${S.profile.dna ? S.profile.dna.name + ' — ' + (S.profile.dna.keywords || []).join(', ') : 'unknown'}.
Return only JSON:
{"headline": 3 to 7 words in the manner of a fashion magazine cover, no quotation marks,
 "dek": one sentence, at most 22 words, linking what the image suggests to what to wear today,
 "note": a handwritten margin note, at most 7 words, like a stylist scribbling on a print}
Write in English. Only mention garments from the planned outfit, or none.`, { images: [blob], modelTier: 'default' });
}

/* ============ collage ============ */
const CAT_SLOTS = {
  Outerwear: [[31,36,50]], Dresses: [[33,46,46],[70,30,34]], Tops: [[72,25,34],[52,50,28]], Knitwear: [[72,27,36],[52,50,28]],
  Bottoms: [[36,74,34],[62,72,30]], Shoes: [[73,86,24],[50,91,20]], Bags: [[86,58,24]], Accessories: [[15,11,18],[88,10,16],[12,90,16]],
};
const EXTRA = [[50,52,24],[18,58,20],[84,38,20],[46,14,18],[26,88,18]];
const RANK = c => { const i = CATS.indexOf(c); return i < 0 ? 9 : i; };
function autoItems(gids) {
  const gs = gids.map(id => byId('garments', id) || { id, name: 'Removed piece', category: 'Accessories' });
  if (gs.length === 1) return [{ t: 'g', gid: gs[0].id, x: 50, y: 50, w: 62, r: 0 }];
  if (gs.length === 2) return [{ t:'g', gid: gs[0].id, x: 31, y: 50, w: 46, r: 0 }, { t:'g', gid: gs[1].id, x: 72, y: 52, w: 40, r: 0 }];
  const sorted = [...gs].sort((a, b) => RANK(a.category) - RANK(b.category));
  const used = {}; const hasOuter = sorted.some(g => g.category === 'Outerwear'); let ex = 0;
  return sorted.map(g => {
    let cat = g.category;
    if (cat === 'Dresses' && !hasOuter && !used.Outerwear) { used.Outerwear = 1; return { t:'g', gid: g.id, x: 32, y: 44, w: 50, r: 0 }; }
    const slots = CAT_SLOTS[cat] || []; const n = used[cat] || 0; used[cat] = n + 1;
    const s = slots[n] || EXTRA[ex++ % EXTRA.length];
    return { t: 'g', gid: g.id, x: s[0], y: s[1], w: s[2], r: 0 };
  });
}
function itemHTML(it, i) {
  if (it.t === 'x') return `<div class="it txt" data-i="${i}" style="left:${it.x}%;top:${it.y}%;--s:${it.w};--r:${it.r||0}deg;z-index:${i+1}">${esc(it.text)}</div>`;
  const g = byId('garments', it.gid);
  const inner = g && src(g) ? `<img src="${esc(src(g))}" alt="${esc(g.name)}" draggable="false">` : `<div class="ph">${esc(g ? g.name : 'Removed piece')}</div>`;
  return `<div class="it" data-i="${i}" style="left:${it.x}%;top:${it.y}%;width:${it.w}%;--r:${it.r||0}deg;z-index:${i+1}">${inner}</div>`;
}
function lookItems(l) { return l.mode === 'free' && l.canvas && l.canvas.items ? l.canvas.items : autoItems(l.garments || []); }
function boardHTML(l, { mini = false, ctx = '', items = null, photo = '' } = {}) {
  const its = items || lookItems(l);
  const bg = (l && l.canvas && l.canvas.bg) || '#F4F3F1';
  const empty = !its.length && !photo ? `<div class="empty">${mini ? 'Empty look' : 'Pick garments to start the look'}</div>` : '';
  return `<div class="board${mini ? ' mini' : ''}${ctx ? ' live' : ''}" ${ctx ? `data-ctx="${ctx}"` : ''} style="background:${esc(bg)}">${photo ? `<img class="bgphoto" src="${esc(photo)}" alt="Your photo">` : ''}${its.map(itemHTML).join('')}${empty}</div>`;
}

/* export collage */
async function exportBoard(items, bg, name, photo) {
  const W = 1200, H = 1500, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = bg || '#FFFFFF'; x.fillRect(0, 0, W, H);
  if (photo) { try { const im = await loadImg(photo); const k = Math.max(W / im.naturalWidth, H / im.naturalHeight); const w = im.naturalWidth * k, h = im.naturalHeight * k; x.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); } catch (e) {} }
  for (let it of items) {
    x.save(); x.translate(it.x / 100 * W, it.y / 100 * H); x.rotate((it.r || 0) * Math.PI / 180);
    if (it.t === 'x') { x.font = `400 ${it.w / 100 * W}px Inter, Helvetica, Arial, sans-serif`; x.fillStyle = '#1A1A1A'; if (x.letterSpacing !== undefined) x.letterSpacing = (it.w / 100 * W * .3) + 'px'; it = { ...it, text: String(it.text).toUpperCase() }; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(it.text, 0, 0); }
    else {
      const g = byId('garments', it.gid); const w = it.w / 100 * W;
      try { const im = await loadImg(src(g)); const h = w * im.naturalHeight / im.naturalWidth; x.drawImage(im, -w / 2, -h / 2, w, h); }
      catch (e) { const h = w * 4 / 3; x.fillStyle = '#E9E5DD'; x.fillRect(-w/2, -h/2, w, h); x.fillStyle = '#282824'; x.font = `${w/9}px Garamond, serif`; x.textAlign = 'center'; x.fillText(g ? g.name : '', 0, 0, w * .9); }
    }
    x.restore();
  }
  x.fillStyle = 'rgba(26,26,26,.5)'; x.font = '400 18px Inter, sans-serif'; if (x.letterSpacing !== undefined) x.letterSpacing = '5px'; x.textAlign = 'left'; x.fillText('THE EDIT  ·  ' + (name || 'Look').toUpperCase(), 40, H - 40);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  try { await downloads.save({ filename: (name || 'look').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.png', data: blob }); toast('Collage saved.'); }
  catch (e) { if (e && e.code !== 'declined') toast('The image could not be saved.'); }
}

/* ============ shared derived data ============ */
function upcomingTrip() {
  const t = todayISO();
  return S.trips.filter(tr => tr.end >= t).sort((a, b) => a.start < b.start ? -1 : 1)[0] || null;
}
function tripStats(tr) {
  const days = range(tr.start, tr.end); const d = tr.days || {};
  const planned = days.filter(x => d[x] && d[x].lookId && byId('looks', d[x].lookId)).length;
  const items = packingList(tr); const packed = items.filter(g => (tr.packed || {})[g.id]).length;
  return { total: days.length, planned, items: items.length, packed, left: Math.max(0, diffDays(todayISO(), tr.start)) };
}
function packingList(tr) {
  const ids = [];
  Object.values(tr.days || {}).forEach(d => { [d.lookId, d.altId].forEach(lid => { const l = byId('looks', lid); if (l) ids.push(...(l.garments || [])); }); });
  ids.push(...(tr.extras || []));
  return uniq(ids).map(id => byId('garments', id)).filter(Boolean).sort((a, b) => RANK(a.category) - RANK(b.category));
}
function stopFor(tr, date) { return (tr.stops || []).find(s => s.from <= date && date <= s.to); }
function todayPlan() {
  const t = todayISO();
  for (const tr of S.trips) { const d = (tr.days || {})[t]; if (d && d.lookId && byId('looks', d.lookId)) return { look: byId('looks', d.lookId), alt: byId('looks', d.altId), trip: tr }; }
  const p = S.profile.today;
  if (p && p.date === t) return { look: byId('looks', p.lookId), alt: byId('looks', p.altId) };
  return { look: null, alt: null };
}
function weatherAdvice(w) {
  if (!w || w.temp === '' || w.temp == null) return '';
  const t = Number(w.feels !== '' && w.feels != null ? w.feels : w.temp), rain = Number(w.rain || 0);
  let a = t <= 0 ? 'Freezing. Thermal base layer, your warmest coat, scarf, gloves and insulated boots.'
    : t <= 8 ? 'Cold. A wool coat over knitwear, closed boots and a scarf.'
    : t <= 14 ? 'Cool. A light coat or trench over a knit or shirt.'
    : t <= 21 ? 'Mild. A blazer or light layer you can take off.'
    : 'Warm. Breathable fabrics and light colours.';
  if (rain >= 50) a += ' Rain is likely: water-resistant outerwear and shoes, plus an umbrella.';
  else if (rain >= 25) a += ' Some chance of rain: keep a layer that copes with a shower.';
  const pick = S.garments.filter(g => (g.status || 'Available') === 'Available' && (
    (t <= 8 && g.category === 'Outerwear' && g.warmth === 'High') || (rain >= 50 && g.water === 'High'))).slice(0, 3);
  return a + (pick.length ? ` From your wardrobe: ${pick.map(g => g.name).join(', ')}.` : '');
}

/* ============ render ============ */
function navHTML() {
  return SECTIONS.map(([k, label, ic]) => `<button data-a="go" data-v="${k}" ${S.view === k ? 'aria-current="page"' : ''}><span>${label}</span></button>`).join('');
}
function render() {
  if (S.mode !== 'live') { renderGate(); return; }
  const nb = ([k, label]) => `<button data-a="go" data-v="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${label}</button>`;
  $('#nav').innerHTML = SECTIONS.slice(1, 4).map(nb).join('');
  $('#nav2').innerHTML = SECTIONS.slice(4).map(nb).join('');
  $('#botnav').innerHTML = navHTML();
  $('#banner').innerHTML = S.mode === 'preview'
    ? `<div class="banner">Preview mode. Open THE EDIT on claude.ai to save your wardrobe and use the AI stylist; changes made here disappear when you close the page.</div>` : '';
  const V = { home: vHome, wardrobe: vWardrobe, inspo: vInspo, style: vStyle, trips: vTrips, profile: vProfile }[S.view] || vHome;
  $('#main').innerHTML = `<div class="view">${V()}</div>`;
}
function softRender() {
  const a = document.activeElement;
  if (a && $('#main').contains(a) && a.matches('input,textarea,select')) { S.pending = true; return; }
  render(); refreshSheet();
}
document.addEventListener('focusout', () => setTimeout(() => { if (S.pending) { S.pending = false; softRender(); } }, 0));

/* ---- HOME ---- */
function coverInspo() {
  const c = S.profile.cover;
  if (c && c.date === todayISO() && byId('inspo', c.inspoId)) return byId('inspo', c.inspoId);
  if (S.profile.pinnedCover && byId('inspo', S.profile.pinnedCover)) return byId('inspo', S.profile.pinnedCover);
  const { look } = todayPlan();
  if (look && look.inspoId && byId('inspo', look.inspoId)) return byId('inspo', look.inspoId);
  return S.inspo[0] || null;
}
function issueNo(d = new Date()) { return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); }
function seasonName(d = new Date()) { const m = d.getMonth(); return m < 2 || m === 11 ? 'Winter' : m < 5 ? 'Spring' : m < 8 ? 'Summer' : 'Autumn'; }
function dnaHTML(full) {
  const d = S.profile.dna;
  if (!d) {
    if (S.inspo.length < 2) return '';
    return `<section class="dna empty"><p class="eyebrow">Your aesthetic</p><p class="dna-name">Not yet read</p>
      <p class="sum" style="margin-inline:auto">Claude can study your saved pins together and name the aesthetic they share, then use it to style you.</p>
      <button class="btn primary mt" data-a="readDNA" ${S.dnaBusy ? 'disabled' : ''}>${S.dnaBusy ? 'Reading your pins…' : 'Read my moodboard'}</button></section>`;
  }
  const imgs = (d.inspoIds || []).map(id => byId('inspo', id)).filter(Boolean).slice(0, 6);
  const fit = (d.wardrobeFit || []).map(id => byId('garments', id)).filter(Boolean);
  const list = (title, arr) => arr && arr.length ? `<div><p class="lbl">${title}</p><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `<section class="dna"><div>
    <p class="eyebrow">Your aesthetic · read from ${(d.inspoIds || []).length} pins</p>
    <h2 class="dna-name">${esc(d.name)}</h2>
    <p class="sum">${esc(d.summary)}</p>
    <div class="kw">${(d.keywords || []).map(k => `<span>${esc(k)}</span>`).join('')}</div>
    <p class="small mt"><span class="dots">${(d.palette || []).map(p => `<i style="background:${/^#[0-9a-f]{3,8}$/i.test(p.hex) ? p.hex : 'transparent'}"></i>`).join('')}</span>${esc((d.palette || []).map(p => p.name).join(' / '))}</p>
    ${full ? `<div class="dna-cols">${list('Silhouettes', d.silhouettes)}${list('Signatures', d.signatures)}${list('Leave out', d.avoid)}</div>
      ${fit.length ? `<p class="lbl mt">Already in your wardrobe</p><div class="dna-fit">${fit.map(g => `<button class="gimg" data-a="openGarment" data-v="${g.id}" title="${esc(g.name)}" style="border:0;padding:0;cursor:pointer">${src(g) ? `<img src="${esc(src(g))}" alt="${esc(g.name)}">` : `<div class="ph" style="font-size:10px">${esc(g.name)}</div>`}</button>`).join('')}</div>` : ''}
      ${(d.gaps || []).length ? `<div class="ext"><p class="eyebrow" style="color:var(--burgundy)">Would complete it · outside your wardrobe</p>${d.gaps.map(x => `<p style="margin-top:4px">${esc(typeof x === 'string' ? x : x.item)}</p>`).join('')}</div>` : ''}` : ''}
    <div class="row mt"><button class="btn sm" data-a="${full ? 'readDNA' : 'go'}" data-v="inspo" ${S.dnaBusy ? 'disabled' : ''}>${full ? (S.dnaBusy ? 'Reading your pins…' : 'Read again with newest pins') : 'Open the moodboard'}</button></div>
  </div>
  <div class="dna-grid">${imgs.map(i => `<button data-a="openInspo" data-v="${i.id}" style="border:0;padding:0;background:none;cursor:pointer"><img class="photo" src="${esc(src(i))}" alt="Pin" loading="lazy"></button>`).join('')}</div></section>`;
}
function vHome() {
  const now = new Date(), h = now.getHours();
  const greet = h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
  const { look, alt, trip } = todayPlan();
  const w = S.profile.weather && S.profile.weather.date === todayISO() ? S.profile.weather : null;
  const tr = upcomingTrip();
  const st = tr && tripStats(tr);
  const ci = coverInspo();
  const cv = S.profile.cover && S.profile.cover.date === todayISO() && ci && S.profile.cover.inspoId === ci.id && S.profile.cover.headline ? S.profile.cover : null;
  return `
  <section class="hero" aria-label="Today’s image">
    <div class="hero-img">${ci && src(ci) ? `<img class="photo" src="${esc(src(ci))}" alt="Today’s image, from your inspiration">` : `<div class="hero-ph">Your Pinterest photos will appear here</div>`}
      ${ci ? `<p class="hero-cap">From your pins${cv && cv.note ? ' — ' + esc(cv.note) : ''}</p>` : ''}</div>
    <div class="greet">
    <p class="eyebrow tab">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · No. ${issueNo(now)} · ${seasonName(now)} ${now.getFullYear()}</p>
    <h1>${esc((greet + (S.profile.name ? ', ' + S.profile.name : '') + '.').toUpperCase())}</h1>
    <p class="q">What are we wearing today?</p>
    ${cv ? `<p class="headline">${esc(cv.headline)}</p><p class="dek">${esc(cv.dek)}</p>` : ''}
    <div class="acts">
      ${ci ? (sample ? `<button class="btn sm ${cv ? 'ghost' : ''}" data-a="composeCover" ${S.coverBusy ? 'disabled' : ''}>${S.coverBusy ? 'Writing…' : cv ? 'Rewrite' : 'Write today’s edit'}</button>` : '')
           + (S.inspo.length > 1 ? `<button class="btn sm ghost" data-a="nextCover">Another image</button>` : '')
        : `<button class="btn sm" data-a="addInspo">Add your Pinterest photos</button>`}
    </div>
    </div>
  </section>
  <div class="homegrid">
    <section class="card today" aria-labelledby="tl">
      <div class="row" style="justify-content:space-between"><p class="eyebrow" id="tl">Today’s look${trip ? ' · ' + esc(trip.name) : ''}</p>${look ? `<span class="pill ${(look.status||'Draft').toLowerCase()}">${esc(look.status || 'Draft')}</span>` : ''}</div>
      ${look ? `<h2 style="margin-top:8px">${esc(look.name || 'Untitled look')}</h2>
        <button class="lk" data-a="openLook" data-v="${look.id}" style="display:block;width:100%;background:none;border:0;padding:0;cursor:pointer" aria-label="View look">${boardHTML(look)}</button>
        ${alt ? `<p class="small muted mt">Alternative saved: <button class="link" data-a="openLook" data-v="${alt.id}">${esc(alt.name)}</button></p>` : ''}
        <div class="today-acts">
          <button class="btn sm" data-a="openLook" data-v="${look.id}">View outfit</button>
          <button class="btn sm" data-a="editLook" data-v="${look.id}">Edit garments</button>
          <button class="btn sm" data-a="pickToday" data-v="lookId">Change outfit</button>
          <button class="btn sm ghost" data-a="pickToday" data-v="altId">Save an alternative</button>
        </div>`
      : `<h2 style="margin-top:8px">Nothing chosen yet</h2>
        <div class="board" style="max-width:440px;margin:16px auto 0"><div class="empty">${S.looks.length ? 'Choose one of your looks for today' : 'Create your first look in Style Studio'}</div></div>
        <div class="today-acts">${S.looks.length ? `<button class="btn primary" data-a="pickToday" data-v="lookId">Choose today’s look</button>` : ''}<button class="btn" data-a="newLook">Create outfit</button><button class="btn ghost" data-a="stylistGo">Ask the stylist</button></div>`}
    </section>
    <div class="homeside">
      <section class="card" aria-labelledby="wt">
        <div class="row" style="justify-content:space-between"><p class="eyebrow" id="wt">Weather today</p><button class="link small" data-a="editWeather">${w ? 'Update' : 'Add weather'}</button></div>
        ${w ? `<div class="wx"><div class="deg tab">${esc(w.temp)}°</div><div><h2 style="font-size:24px">${esc(w.city || '')}</h2>
          <dl class="tab"><dt>Feels like</dt><dd>${w.feels !== '' && w.feels != null ? esc(w.feels) + ' °C' : '—'}</dd><dt>Chance of rain</dt><dd>${w.rain !== '' && w.rain != null ? esc(w.rain) + '%' : '—'}</dd></dl></div></div>
          <p class="advice">${esc(weatherAdvice(w))}</p>`
        : `<p class="muted" style="margin-top:10px">Add today’s temperature and chance of rain for ${esc(S.profile.city || 'your city')} and THE EDIT will tell you what to reach for.</p>`}
      </section>
      <section class="card" aria-labelledby="ut">
        <p class="eyebrow" id="ut">Upcoming trip</p>
        ${tr ? `<button data-a="openTrip" data-v="${tr.id}" style="background:none;border:0;padding:0;text-align:left;cursor:pointer;width:100%">
          <h2 style="margin-top:8px;font-family:var(--display);font-weight:400;letter-spacing:.06em">${esc(tr.name).toUpperCase()}</h2>
          <p class="eyebrow tab" style="margin-top:6px;color:var(--charcoal)">${fmt(tr.start, {day:'2-digit',month:'short'}).toUpperCase()} — ${fmt(tr.end, {day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}</p></button>
          <div class="trip-k tab"><div><b>${st.left}</b><span>${st.left === 1 ? 'Day' : 'Days'} to go</span></div><div><b>${st.planned}/${st.total}</b><span>Outfits planned</span></div><div><b>${st.items}</b><span>Pieces selected</span></div></div>
          <div class="bar" role="progressbar" aria-label="Packing progress" aria-valuenow="${st.items ? Math.round(st.packed / st.items * 100) : 0}" aria-valuemin="0" aria-valuemax="100"><i style="width:${st.items ? st.packed / st.items * 100 : 0}%"></i></div>
          <p class="small muted tab" style="margin-top:6px">Packing ${st.packed} of ${st.items}</p>`
        : `<p class="muted" style="margin-top:10px">No trips planned.</p><button class="btn sm mt" data-a="newTrip">Plan a trip</button>`}
      </section>
    </div>
  </div>
  ${dnaHTML(false)}
  <nav class="qa" aria-label="Quick actions">
    <button data-a="addGarment"><span class="eyebrow">Wardrobe</span><b>Add garment</b></button>
    <button data-a="newLook"><span class="eyebrow">Style Studio</span><b>Create outfit</b></button>
    <button data-a="addInspo"><span class="eyebrow">Inspo</span><b>Save inspiration</b></button>
    <button data-a="planDay"><span class="eyebrow">Trips</span><b>Plan a day</b></button>
  </nav>`;
}

/* ---- WARDROBE ---- */
function filteredGarments() {
  const f = S.wf, q = (f.q || '').toLowerCase();
  return S.garments.filter(g =>
    (!f.cat || g.category === f.cat) && (!f.color || (g.color || '').toLowerCase() === f.color) && (!f.brand || g.brand === f.brand) &&
    (!f.season || (g.seasons || []).includes(f.season)) && (!f.warmth || g.warmth === f.warmth) && (!f.status || (g.status || 'Available') === f.status) &&
    (!q || [g.name, g.brand, g.color, g.sub, g.material, g.notes].join(' ').toLowerCase().includes(q)));
}
function gCard(g) {
  return `<button class="gcard" data-a="openGarment" data-v="${g.id}"><div class="gimg">${src(g) ? `<img src="${esc(src(g))}" alt="" loading="lazy">` : `<div class="ph">${esc(g.name)}</div>`}</div>
    <div><p class="gname">${esc(g.name || 'Untitled')}</p><p class="gmeta">${esc([g.brand, g.color].filter(Boolean).join(' · ') || g.category)}${(g.status && g.status !== 'Available') ? ` · <em>${esc(g.status)}</em>` : ''}</p></div></button>`;
}
function vWardrobe() {
  const f = S.wf; const list = filteredGarments();
  const colors = uniq(S.garments.map(g => (g.color || '').toLowerCase())).sort();
  const brands = uniq(S.garments.map(g => g.brand)).sort();
  const sel = (k, label, vals) => `<select aria-label="${label}" data-f="${k}"><option value="">${label}</option>${vals.map(v => opt(v, f[k])).join('')}</select>`;
  let body;
  if (!S.garments.length) body = emptyState('Your wardrobe starts here', 'Photograph a piece, import a shop image, or add it by hand. Everything else in THE EDIT builds on these garments.', `<button class="btn primary" data-a="addGarment">Add garment</button>`);
  else if (!list.length) body = `<p class="muted">No garments match these filters. <button class="link" data-a="clearF">Clear filters</button></p>`;
  else if (S.wview === 'grid') body = `<div class="ggrid">${list.map(gCard).join('')}</div>`;
  else body = CATS.map(c => { const gs = list.filter(g => g.category === c); return gs.length ? `<section class="catblock"><h2>${c} <small>${gs.length} · ${esc(CAT_HINT[c])}</small></h2><div class="ggrid">${gs.map(gCard).join('')}</div></section>` : ''; }).join('');
  return `
  <div class="shead"><div><p class="eyebrow">My wardrobe</p><h1>Wardrobe</h1><p class="sub tab">${S.garments.length} ${S.garments.length === 1 ? 'piece' : 'pieces'} across ${uniq(S.garments.map(g => g.category)).length} categories.</p></div>
    <button class="btn primary" data-a="addGarment">Add garment</button></div>
  ${S.garments.length ? `<div class="toolbar">
    <div class="seg" role="group" aria-label="View"><button data-a="wview" data-v="grid" aria-pressed="${S.wview === 'grid'}">Grid view</button><button data-a="wview" data-v="cat" aria-pressed="${S.wview === 'cat'}">Category view</button></div>
    <span class="sp"></span><input class="inp" id="wq" style="max-width:240px" placeholder="Search garments" value="${esc(f.q || '')}" data-f="q" aria-label="Search garments">
  </div>
  <div class="filters">${sel('cat', 'Category', CATS)}${sel('color', 'Colour', colors)}${sel('brand', 'Brand', brands)}${sel('season', 'Season', SEASONS)}${sel('warmth', 'Warmth', LEVELS)}${sel('status', 'Availability', STATUSES)}
    ${Object.values(f).some(Boolean) ? `<button class="btn ghost sm" data-a="clearF">Clear</button>` : ''}</div>` : ''}
  ${body}`;
}
function emptyState(h, p, actions) { return `<div class="empty-state"><h2>${h}</h2><p>${p}</p><div class="row" style="justify-content:center">${actions}</div></div>`; }

/* ---- INSPO ---- */
function allCollections() { return uniq([...BASE_COLLECTIONS, ...(S.profile.collections || []), ...S.inspo.flatMap(i => i.collections || [])]); }
function allTags() { return uniq([...BASE_TAGS, ...S.inspo.flatMap(i => i.tags || [])]); }
function vInspo() {
  const f = S.ifl;
  const list = S.inspo.filter(i => (!f.tag || (i.tags || []).includes(f.tag)) && (!f.col || (i.collections || []).includes(f.col)));
  const undecoded = S.inspo.filter(i => !i.analysis).length;
  return `
  <div class="shead"><div><p class="eyebrow">Inspo library · ${S.inspo.length} pins</p><h1>Inspiration</h1><p class="sub">Your Pinterest saves, decoded by Claude into looks you can wear with what you own.</p></div>
    <div class="row"><button class="btn primary" data-a="addInspo">Save inspiration</button>
    ${sample && undecoded ? `<button class="btn" data-a="decodeAll" ${S.decAll ? 'disabled' : ''}>${S.decAll ? `Decoding ${S.decAll.done + 1} of ${S.decAll.total}…` : `Decode ${Math.min(undecoded, 10)} new`}</button>` : ''}</div></div>
  ${dnaHTML(true)}
  ${S.inspo.length ? `
  <div class="toolbar"><span class="lbl">Tags</span><div class="chips">${allTags().map(t => `<button class="chip" data-a="ifTag" data-v="${esc(t)}" aria-pressed="${f.tag === t}">${esc(t)}</button>`).join('')}</div>
    <span class="sp"></span><div class="seg" role="group" aria-label="Photo tone"><button data-a="tone" data-v="archive" aria-pressed="${S.tone === 'archive'}">Archive</button><button data-a="tone" data-v="colour" aria-pressed="${S.tone !== 'archive'}">Colour</button></div></div>
  <div class="toolbar"><span class="lbl">Collections</span><div class="chips">${allCollections().map(t => `<button class="chip" data-a="ifCol" data-v="${esc(t)}" aria-pressed="${f.col === t}">${esc(t)}</button>`).join('')}</div></div>
  ${list.length ? `<div class="moodgrid mt">${list.map(i => `<button class="tile" data-a="openInspo" data-v="${i.id}"><img class="photo" src="${esc(src(i))}" alt="${esc(i.analysis ? i.analysis.title || i.analysis.style : 'Inspiration')}" loading="lazy">${i.analysis ? `<span class="mark">Decoded</span><span class="cap">${esc(i.analysis.title || i.analysis.style || '')}</span>` : ''}</button>`).join('')}</div>`
  : `<p class="muted mt">Nothing saved under this filter yet.</p>`}`
  : emptyState('A library for every look you love', 'Upload your Pinterest screenshots or any outfit photo. You can also paste an image straight from your clipboard on this page.', `<button class="btn primary" data-a="addInspo">Save inspiration</button>`)}`;
}

/* ---- STYLE STUDIO ---- */
function vStyle() {
  const tabs = [['looks','My looks'],['editor','Editor'],['stylist','AI stylist']];
  const body = S.styleTab === 'editor' ? vEditor() : S.styleTab === 'stylist' ? vStylist() : vLooks();
  return `
  <div class="shead"><div><p class="eyebrow">Style studio</p><h1>${S.styleTab === 'stylist' ? 'Your stylist' : 'Looks'}</h1></div><button class="btn primary" data-a="newLook">Create look</button></div>
  <div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button data-a="stab" data-v="${k}" aria-current="${S.styleTab === k}">${l}</button>`).join('')}</div>
  ${body}`;
}
function lookCard(l) {
  return `<button class="lcard" data-a="openLook" data-v="${l.id}">${boardHTML(l, { mini: true })}<h3>${esc(l.name || 'Untitled look')}</h3>
    <div class="meta"><span>${esc([l.occasion, (l.tmin != null && l.tmin !== '' ? `${l.tmin}–${l.tmax} °C` : '')].filter(Boolean).join(' · ') || (l.garments || []).length + ' pieces')}</span><span class="pill ${(l.status || 'Draft').toLowerCase()}">${esc(l.status || 'Draft')}</span></div></button>`;
}
function vLooks() {
  if (!S.looks.length) return emptyState('No looks yet', 'Build one by hand, recreate an inspiration photo, or ask the AI stylist to propose outfits from your wardrobe.', `<button class="btn primary" data-a="newLook">Create look</button><button class="btn" data-a="stab" data-v="stylist">Ask the stylist</button>`);
  const list = S.looks.filter(l => !S.lookFilter || (l.status || 'Draft') === S.lookFilter);
  return `<div class="toolbar"><div class="chips">${['', ...LOOK_STATUS].map(s => `<button class="chip" data-a="lookF" data-v="${s}" aria-pressed="${S.lookFilter === s}">${s || 'All'}</button>`).join('')}</div></div>
  <div class="lgrid">${list.map(lookCard).join('')}</div>`;
}
function newDraft(base = {}) {
  return { id: uid(), name: '', style: '', seasons: [], occasion: '', tmin: '', tmax: '', garments: [], notes: '', status: 'Draft', mode: 'auto', canvas: { bg: '#F4F3F1', items: [] }, createdAt: Date.now(), ...clean(base) };
}
function syncFree(l) {
  if (l.mode !== 'free') return;
  if (!l.canvas) l.canvas = { bg: '#FFFFFF', items: [] };
  const auto = autoItems(l.garments);
  const have = new Set(l.canvas.items.filter(i => i.t === 'g').map(i => i.gid));
  l.canvas.items = l.canvas.items.filter(i => i.t !== 'g' || l.garments.includes(i.gid));
  l.garments.forEach(gid => { if (!have.has(gid)) l.canvas.items.push(auto.find(a => a.gid === gid) || { t: 'g', gid, x: 50, y: 50, w: 30, r: 0 }); });
}
function vEditor() {
  if (!S.ed) S.ed = newDraft();
  const l = S.ed; const pf = S.ed._pf || '';
  const gs = S.garments.filter(g => !pf || g.category === pf);
  const sel = l.mode === 'free' ? S.sel.ed : -1; const si = sel >= 0 ? l.canvas.items[sel] : null;
  return `
  <div class="editor">
    <aside class="picker">
      <p class="lbl">Garments · ${l.garments.length} selected</p>
      <select class="inp mt" style="margin-top:8px;margin-bottom:10px" data-ed="_pf" aria-label="Filter by category"><option value="">All categories</option>${CATS.map(c => opt(c, pf)).join('')}</select>
      ${S.garments.length ? `<div class="plist">${gs.map(g => `<button class="pitem" data-a="toggleG" data-v="${g.id}" aria-pressed="${l.garments.includes(g.id)}" title="${esc(g.name)}"><div class="gimg">${src(g) ? `<img src="${esc(src(g))}" alt="${esc(g.name)}" loading="lazy">` : `<div class="ph" style="font-size:12px">${esc(g.name)}</div>`}</div></button>`).join('')}</div>`
      : `<p class="muted small">Add garments to your wardrobe first.</p><button class="btn sm mt" data-a="addGarment">Add garment</button>`}
    </aside>
    <section class="stage">
      <div class="row" style="justify-content:center"><div class="seg" role="group" aria-label="Editor mode"><button data-a="edMode" data-v="auto" aria-pressed="${l.mode !== 'free'}">Auto collage</button><button data-a="edMode" data-v="free" aria-pressed="${l.mode === 'free'}">Free canvas</button></div></div>
      ${boardHTML(l, { ctx: l.mode === 'free' ? 'ed' : '' })}
      ${l.mode === 'free' ? `<div class="ctrls">
        <div class="row"><span class="lbl">Background</span>${BOARD_BG.map(c => `<button class="sw" style="background:${c}" data-a="edBg" data-v="${c}" aria-pressed="${(l.canvas.bg || '#FFFFFF') === c}" aria-label="Background ${c}"></button>`).join('')}</div>
        <div class="row"><input class="inp" id="edText" placeholder="Add a caption, e.g. Amsterdam Morning" style="flex:1;min-width:0"><button class="btn sm" data-a="edAddText">Add text</button></div>
        ${si ? `<hr class="rule"><p class="lbl">Selected: ${esc(si.t === 'x' ? '“' + si.text + '”' : (byId('garments', si.gid) || {}).name || 'piece')}</p>
          <div class="row"><label for="edSize">Size</label><input type="range" id="edSize" min="${si.t === 'x' ? 2 : 8}" max="${si.t === 'x' ? 20 : 95}" value="${si.w}" data-it="w"></div>
          <div class="row"><label for="edRot">Rotate</label><input type="range" id="edRot" min="-180" max="180" value="${si.r || 0}" data-it="r"></div>
          <div class="row"><button class="btn sm" data-a="edLayer" data-v="up">Bring forward</button><button class="btn sm" data-a="edLayer" data-v="down">Send back</button><button class="btn sm ghost" data-a="edLayer" data-v="del">Remove</button></div>`
        : `<p class="small muted">Drag pieces to arrange them. Tap one to resize, rotate or change its layer.</p>`}
      </div>` : `<p class="small muted" style="text-align:center">THE EDIT arranges the pieces for you. Switch to Free canvas to place them yourself.</p>`}
    </section>
    <aside class="sheetform">
      <div class="field"><label for="lkName">Look name</label><input class="inp" id="lkName" data-ed="name" value="${esc(l.name)}" placeholder="Amsterdam Morning"></div>
      <div class="field"><label for="lkStyle">Style</label><input class="inp" id="lkStyle" data-ed="style" value="${esc(l.style)}" placeholder="Minimal / Casual chic"></div>
      <div class="field"><span class="lbl">Season</span><div class="chips">${SEASONS.map(s => `<button class="chip" data-a="edSeason" data-v="${s}" aria-pressed="${(l.seasons || []).includes(s)}">${s}</button>`).join('')}</div></div>
      <div class="field"><label for="lkOcc">Occasion</label><input class="inp" id="lkOcc" data-ed="occasion" value="${esc(l.occasion)}" placeholder="Walking / Museums"></div>
      <div class="grid2"><div class="field"><label for="lkMin">Min °C</label><input class="inp tab" id="lkMin" type="number" data-ed="tmin" value="${esc(l.tmin)}"></div><div class="field"><label for="lkMax">Max °C</label><input class="inp tab" id="lkMax" type="number" data-ed="tmax" value="${esc(l.tmax)}"></div></div>
      <div class="field"><label for="lkStatus">Status</label><select class="inp" id="lkStatus" data-ed="status">${LOOK_STATUS.map(s => opt(s, l.status)).join('')}</select></div>
      <div class="field"><label for="lkNotes">Notes</label><textarea class="inp" id="lkNotes" data-ed="notes">${esc(l.notes)}</textarea></div>
      <div class="row"><button class="btn primary" data-a="edSave">Save look</button><button class="btn" data-a="edDup">Duplicate</button></div>
      <div class="row"><button class="btn sm" data-a="edTrip">Add to trip</button><button class="btn sm" data-a="edTry">Try on</button><button class="btn sm" data-a="edExport">Export</button></div>
      ${byId('looks', l.id) ? `<button class="btn ghost sm danger" style="align-self:flex-start" data-a="edDelete">Delete look</button>` : ''}
    </aside>
  </div>`;
}
function vStylist() {
  const st = S.styl;
  return `<div class="styl">
    <p class="muted" style="max-width:62ch">Ask for outfits in your own words. The stylist uses only garments in your wardrobe, follows the aesthetic read from your pins, and shows which pin each look echoes. Anything you don’t own is marked as an outside suggestion.</p>
    <div class="prompt"><textarea class="inp" id="stQ" placeholder="Create three outfits for walking around Amsterdam at 6 °C">${esc(st.q)}</textarea><button class="btn primary" data-a="stylGo" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Styling…' : 'Style me'}</button></div>
    <div class="chips">${PROMPTS.map(p => `<button class="chip" style="text-transform:none;letter-spacing:0;font-size:12px" data-a="stylChip" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    ${!S.garments.length ? `<p class="err">Your wardrobe is empty, so the stylist has nothing to work with yet. <button class="link" data-a="addGarment">Add your first garment</button>.</p>` : ''}
    ${st.err ? `<p class="err">${esc(st.err)}</p>` : ''}
    ${st.busy ? `<p class="thinking">Going through your wardrobe…</p>` : ''}
    ${st.res ? `<div>${(st.res.looks || []).map((l, i) => {
        const d = newDraft({ garments: l.garmentIds });
        const ref = l.inspoId && byId('inspo', l.inspoId);
        return `<article class="sug"><div class="sugvis">${boardHTML(d)}${ref ? `<figure class="polaroid ref"><img class="photo" src="${esc(src(ref))}" alt="Your pin"><figcaption>after your pin</figcaption></figure>` : ''}</div><div>
          <p class="eyebrow">Look ${i + 1} of ${st.res.looks.length}${l.occasion ? ' · ' + esc(l.occasion) : ''}${l.tmin != null ? ` · ${esc(l.tmin)}–${esc(l.tmax)} °C` : ''}</p>
          <h3 style="margin-top:6px">${esc(l.name)}</h3><p class="why">${esc(l.why)}</p>
          <ul class="alist mt">${l.garmentIds.map(id => { const g = byId('garments', id); return `<li><span>${esc(g.name)}</span><span class="conf">${esc(g.category)}</span></li>`; }).join('')}</ul>
          <div class="row mt"><button class="btn primary sm" data-a="stylSave" data-v="${i}">Save look</button><button class="btn sm" data-a="stylEdit" data-v="${i}">Open in editor</button></div></div></article>`; }).join('')}
      ${(st.res.external || []).length ? `<div class="ext"><p class="eyebrow" style="color:var(--burgundy)">Outside your wardrobe</p>${st.res.external.map(e => `<p style="margin-top:6px"><b>${esc(e.item)}</b> — ${esc(e.why)}</p>`).join('')}</div>` : ''}
      ${st.res.note ? `<p class="small muted mt">${esc(st.res.note)}</p>` : ''}
      ${st.res.dropped ? `<p class="small muted">Removed ${st.res.dropped} suggested piece${st.res.dropped > 1 ? 's' : ''} that isn’t in your wardrobe.</p>` : ''}</div>` : ''}
  </div>`;
}

/* ---- TRIPS ---- */
function vTrips() {
  const tr = S.tripId && byId('trips', S.tripId);
  if (tr) return vTrip(tr);
  const list = [...S.trips].sort((a, b) => a.start < b.start ? -1 : 1);
  return `<div class="shead"><div><p class="eyebrow">Trips</p><h1>Travel edits</h1><p class="sub">Plan a look for every day, see the weather by city, and pack only what the plan needs.</p></div><button class="btn primary" data-a="newTrip">New trip</button></div>
  ${list.length ? list.map(t => { const s = tripStats(t); return `<button class="tripcard" data-a="openTrip" data-v="${t.id}"><div><p class="eyebrow tab">${fmt(t.start, {day:'2-digit',month:'short'})} — ${fmt(t.end, {day:'2-digit',month:'short',year:'numeric'})}${(t.stops || []).length ? ' · ' + esc(t.stops.map(x => x.city).join(', ')) : ''}</p><h2 style="margin-top:6px">${esc(t.name)}</h2></div>
    <div class="tab small muted" style="text-align:right">${t.end < todayISO() ? 'Past trip' : s.left ? s.left + ' days to go' : 'Under way'}<br>${s.planned}/${s.total} days planned</div></button>`; }).join('')
  : emptyState('No trips yet', 'Create a trip with its dates and cities, then assign a look to each day.', `<button class="btn primary" data-a="newTrip">New trip</button>`)}`;
}
function vTrip(tr) {
  const s = tripStats(tr), days = range(tr.start, tr.end), t = todayISO();
  const pl = packingList(tr);
  return `<button class="btn ghost sm" data-a="tripBack" style="margin-bottom:12px">← All trips</button>
  <div class="shead"><div><p class="eyebrow tab">${fmt(tr.start, {day:'2-digit',month:'short'}).toUpperCase()} — ${fmt(tr.end, {day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}</p><h1>${esc(tr.name)}</h1></div>
    <div class="trip-k tab" style="min-width:min(100%,360px);margin:0"><div><b>${s.left}</b><span>Days to go</span></div><div><b>${s.planned}/${s.total}</b><span>Planned</span></div><div><b>${s.packed}/${s.items}</b><span>Packed</span></div></div></div>
  <div class="stops">${(tr.stops || []).map((st, i) => `<div class="stop"><b>${esc(st.city)}</b><span class="tab muted">${fmt(st.from, {day:'numeric',month:'short'})} – ${fmt(st.to, {day:'numeric',month:'short'})}</span><button class="link small" data-a="rmStop" data-v="${i}">Remove</button></div>`).join('')}
    <div class="row" style="margin-top:6px"><input class="inp" id="stCity" placeholder="City" style="max-width:180px"><input class="inp tab" type="date" id="stFrom" min="${tr.start}" max="${tr.end}" value="${tr.start}" style="max-width:170px" aria-label="From"><input class="inp tab" type="date" id="stTo" min="${tr.start}" max="${tr.end}" value="${tr.end}" style="max-width:170px" aria-label="To"><button class="btn sm" data-a="addStop">Add destination</button></div></div>
  <div class="subtabs"><button data-a="tripTab" data-v="days" aria-current="${S.tripTab === 'days'}">Day by day</button><button data-a="tripTab" data-v="pack" aria-current="${S.tripTab === 'pack'}">Packing · ${s.packed}/${s.items}</button><button data-a="tripTab" data-v="edit" aria-current="${S.tripTab === 'edit'}">Trip details</button></div>
  ${S.tripTab === 'pack' ? (pl.length ? `<div class="bar" style="margin:0 0 18px"><i style="width:${s.items ? s.packed / s.items * 100 : 0}%"></i></div><div class="pack">${pl.map(g => { const on = !!(tr.packed || {})[g.id]; return `<label class="${on ? 'done' : ''}"><input type="checkbox" data-pack="${g.id}" ${on ? 'checked' : ''}><div class="gimg">${src(g) ? `<img src="${esc(src(g))}" alt="">` : `<div class="ph" style="font-size:11px">${esc(g.name)}</div>`}</div><span><span class="gname">${esc(g.name)}</span><br><span class="gmeta">${esc(g.category)}${(tr.extras || []).includes(g.id) ? ' · added by hand' : ''}</span></span></label>`; }).join('')}</div>
      <p class="small muted mt">Pieces come from the looks you planned. Add anything else below.</p>` : `<p class="muted">Assign looks to days and their garments will appear here as a packing list.</p>`)
      + `<div class="row mt"><select class="inp" id="extraG" style="max-width:280px" aria-label="Add a garment"><option value="">Add a garment to pack…</option>${S.garments.filter(g => !pl.includes(g)).map(g => opt(g.id, '', g.name)).join('')}</select><button class="btn sm" data-a="addExtra">Add</button></div>`
  : S.tripTab === 'edit' ? `<div class="sheetform" style="max-width:520px">
      <div class="field"><label for="trName">Trip name</label><input class="inp" id="trName" value="${esc(tr.name)}"></div>
      <div class="grid2"><div class="field"><label for="trStart">Start</label><input class="inp tab" type="date" id="trStart" value="${tr.start}"></div><div class="field"><label for="trEnd">End</label><input class="inp tab" type="date" id="trEnd" value="${tr.end}"></div></div>
      <div class="row"><button class="btn primary" data-a="saveTripMeta">Save details</button><button class="btn ghost danger" data-a="delTrip">Delete trip</button></div></div>`
  : `<div class="row" style="justify-content:flex-end;margin-bottom:10px"><button class="btn sm ghost" data-a="tripForecast" ${S.fcBusy ? 'disabled' : ''}>${S.fcBusy ? 'Checking the forecast…' : 'Fill in the forecast'}</button></div><div class="days">${days.map(d => { const x = (tr.days || {})[d] || {}; const l = byId('looks', x.lookId); const stop = stopFor(tr, d);
      return `<div class="day${d === t ? ' today' : ''}"><div class="d"><b class="tab">${fmt(d, {day:'2-digit'})}</b><span>${fmt(d, {weekday:'short'})} · ${fmt(d, {month:'short'})}</span></div>
      <button class="lk" data-a="pickTripDay" data-v="${d}" aria-label="${l ? 'Change look' : 'Assign a look'} for ${fmt(d, {weekday:'long', day:'numeric', month:'long'})}">${l ? boardHTML(l, { mini: true }) : `<div class="board mini"><div class="empty">+ Look</div></div>`}</button>
      <div class="info"><div class="field" style="grid-column:1/-1"><span class="lbl">${esc(x.city || (stop && stop.city) || 'Add a destination')}${l ? ' · ' + esc(l.name) : ''}</span></div>
        <div class="field"><label for="ac-${d}">Activity</label><input class="inp" id="ac-${d}" data-day="${d}" data-k="activity" value="${esc(x.activity || '')}" placeholder="Museums"></div>
        <div class="field"><label for="ci-${d}">City</label><input class="inp" id="ci-${d}" data-day="${d}" data-k="city" value="${esc(x.city || '')}" placeholder="${esc(stop ? stop.city : '')}"></div>
        <div class="field"><label for="te-${d}">°C</label><input class="inp tab" type="number" id="te-${d}" data-day="${d}" data-k="temp" value="${esc(x.temp ?? '')}"></div>
        <div class="field"><label for="ra-${d}">Rain %</label><input class="inp tab" type="number" min="0" max="100" id="ra-${d}" data-day="${d}" data-k="rain" value="${esc(x.rain ?? '')}"></div>
      </div></div>`; }).join('')}</div>`}`;
}

/* ---- PROFILE + FITTING ROOM ---- */
function vProfile() {
  const p = S.profile, photos = p.photos || [];
  const f = S.fit; if (!f.photo && photos[0]) f.photo = photos[0].id;
  const ph = photos.find(x => x.id === f.photo);
  const look = byId('looks', f.lookId);
  const insp = look && look.inspoId ? byId('inspo', look.inspoId) : null;
  if (look && !f.items) f.items = autoItems(look.garments || []).map(i => ({ ...i, w: i.w * .62, x: 50 + (i.x - 50) * .55, y: 50 + (i.y - 50) * .9 }));
  const fsel = S.sel.fit, fi = fsel >= 0 && f.items ? f.items[fsel] : null;
  return `<div class="shead"><div><p class="eyebrow">Profile</p><h1>${esc(p.name || 'Your profile')}</h1></div></div>
  <div class="prof">
    <section class="sheetform">
      <div class="field"><label for="pfName">Your name</label><input class="inp" id="pfName" data-pf="name" value="${esc(p.name || '')}" placeholder="Used in your greeting"></div>
      <div class="field"><label for="pfCity">Home city</label><input class="inp" id="pfCity" data-pf="city" value="${esc(p.city || '')}" placeholder="Mexico City"></div>
      <div class="field"><label for="pfNotes">Style notes for the stylist</label><textarea class="inp" id="pfNotes" data-pf="styleNotes" placeholder="I love neutral palettes, relaxed tailoring, flat boots. I avoid very tight fits.">${esc(p.styleNotes || '')}</textarea></div>
      <hr class="rule mt">
      <h2 style="font-size:26px" class="mt">Privacy</h2>
      <p class="small muted">Your photos stay inside THE EDIT. They are sent to Claude, through your own API key, only when you press an AI button on a specific image. Anthropic’s API terms say it doesn’t train on that data by default.</p>
      <div class="row"><button class="btn sm danger" data-a="wipePhotos">Delete my photos</button><button class="btn sm danger" data-a="wipeTryons">Delete try-on visualisations</button></div>
      <p class="small muted tab">${photos.length} personal photo${photos.length === 1 ? '' : 's'} · ${S.tryons.length} saved try-on${S.tryons.length === 1 ? '' : 's'} · ${S.garments.length} garments · ${S.looks.length} looks · ${S.inspo.length} inspirations</p>
      <hr class="rule mt"><h2 class="mt">Account</h2>
      <p class="small muted">Signed in as ${esc((S.user || {}).email || '')}</p>
      <div class="row"><button class="btn sm" data-a="exportData">Export my data</button><label class="btn sm" style="position:relative">Import backup<input type="file" accept="application/json,.json" data-up="backup" style="position:absolute;inset:0;opacity:0" aria-label="Import a backup file"></label><button class="btn sm ghost" data-a="signOut">Sign out</button></div>
    </section>
    <section>
      <p class="eyebrow">The fitting room</p>
      <h2 style="font-size:36px;margin-top:4px">Try it on</h2>
      <p class="disclaim mt" style="margin-top:10px">This is a simulation. Garment cut-outs are placed over your photo so you can judge proportions and colour together; fit, drape and length on your body can differ.</p>
      <div class="mt"><span class="lbl">1 · Your photo</span>
        <div class="photos" style="margin-top:8px">${photos.map(x => `<button class="photo" data-a="fitPhoto" data-v="${x.id}" aria-pressed="${f.photo === x.id}"><img src="${esc(src(x))}" alt="Your photo"></button>`).join('')}
          <label class="opt" style="width:92px;padding:10px;justify-content:center;text-align:center"><b style="font-size:9.5px">Add photo</b><span style="font-size:11px">Full length</span><input type="file" accept="image/*" data-up="photo" aria-label="Upload a full-length photo"></label></div>
        <p class="small muted" style="margin-top:6px">Plain background, good light, natural pose, clothes that show your silhouette.</p></div>
      <div class="mt"><label class="lbl" for="fitLook">2 · Outfit</label><select class="inp" id="fitLook" style="margin-top:8px;max-width:360px"><option value="">Choose a look…</option>${S.looks.map(l => opt(l.id, f.lookId, l.name || 'Untitled look')).join('')}</select></div>
      ${look && ph ? `<div class="fit3 mt2">
        <div class="panel"><span class="lbl">Original inspo</span>${insp ? `<div class="gimg cover" style="aspect-ratio:4/5"><img class="photo" src="${esc(src(insp))}" alt="Inspiration"></div>` : `<div class="board mini"><div class="empty">This look wasn’t made from an inspiration photo</div></div>`}</div>
        <div class="panel"><span class="lbl">My look</span>${boardHTML(look, { mini: true })}</div>
        <div class="panel"><span class="lbl">Virtual try-on · simulation</span>${boardHTML(null, { ctx: 'fit', items: f.items, photo: src(ph) })}</div>
      </div>
      <div class="ctrls mt" style="margin-left:0">${fi ? `<p class="lbl">Selected: ${esc((byId('garments', fi.gid) || {}).name || 'piece')}</p>
        <div class="row"><label for="fSize">Size</label><input type="range" id="fSize" min="5" max="95" value="${fi.w}" data-fit="w"></div>
        <div class="row"><label for="fRot">Rotate</label><input type="range" id="fRot" min="-180" max="180" value="${fi.r || 0}" data-fit="r"></div>
        <div class="row"><button class="btn sm" data-a="fitLayer" data-v="up">Bring forward</button><button class="btn sm" data-a="fitLayer" data-v="down">Send back</button><button class="btn sm ghost" data-a="fitLayer" data-v="del">Hide piece</button></div>` : `<p class="small muted">Drag each piece onto your photo. Tap one to resize or rotate it. Cut-outs work best after using Clean background on the garment.</p>`}
        <div class="row"><button class="btn primary sm" data-a="fitSave">Save try-on</button><button class="btn sm" data-a="fitExport">Export image</button><button class="btn sm ghost" data-a="fitReset">Reset</button></div></div>`
      : `<p class="muted mt">${!photos.length ? 'Add a full-length photo to begin.' : !S.looks.length ? 'Create a look in Style Studio first.' : 'Choose a look to see it on your photo.'}</p>`}
      ${S.tryons.length ? `<div class="mt2"><span class="lbl">Saved try-ons</span><div class="lgrid" style="margin-top:10px;grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${S.tryons.map(t => { const tp = (p.photos || []).find(x => x.id === t.photoId); return `<div class="lcard" style="cursor:default">${boardHTML(null, { mini: true, items: t.items, photo: tp ? src(tp) : '' })}<div class="meta"><span>${esc((byId('looks', t.lookId) || {}).name || 'Look')}</span><button class="link small" data-a="delTryon" data-v="${t.id}">Delete</button></div></div>`; }).join('')}</div></div>` : ''}
    </section>
  </div>`;
}

/* ============ sheets ============ */
let sheetFn = null;
function openSheet(fn, narrow) { sheetFn = { fn, narrow }; refreshSheet(true); }
function refreshSheet(first) {
  if (!sheetFn) { $('#sheet').innerHTML = ''; return; }
  if (!first) { const a = document.activeElement; if (a && $('#sheet').contains(a) && a.matches('input,textarea,select')) return; }
  const scroll = $('.sheet') ? $('.sheet').scrollTop : 0;
  $('#sheet').innerHTML = `<div class="sheet-bg" data-a="bgClose"><div class="sheet${sheetFn.narrow ? ' narrow' : ''}" role="dialog" aria-modal="true"><button class="x" data-a="closeSheet" aria-label="Close">×</button>${sheetFn.fn()}</div></div>`;
  if (!first) $('.sheet').scrollTop = scroll;
}
function closeSheet() { sheetFn = null; $('#sheet').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetFn) closeSheet(); });

function confirmSheet(msg, yes, label = 'Delete') {
  S.confirmYes = yes;
  openSheet(() => `<h2 style="font-size:28px">${esc(msg)}</h2><p class="muted mt" style="margin-top:10px">This can’t be undone.</p><div class="row mt"><button class="btn primary" data-a="confirmYes">${esc(label)}</button><button class="btn" data-a="closeSheet">Cancel</button></div>`, true);
}

/* add garment */
function sAddGarment() {
  return `<p class="eyebrow">Wardrobe</p><h2>Add garment</h2>
  <div class="opt3">
    <label class="opt"><b>Upload photo</b><span>Take or choose a photo of the piece.</span><input type="file" accept="image/*" data-up="garment" aria-label="Upload photo"></label>
    <label class="opt"><b>Import image</b><span>Use a product image saved from a shop.</span><input type="file" accept="image/*" data-up="garment" aria-label="Import image"></label>
    <button class="opt" data-a="manualGarment"><b>Add manually</b><span>Record a piece without a photo.</span></button>
  </div>
  <p class="small muted mt">${sample ? 'After uploading, Claude reads the photo and fills in the details. You can correct anything.' : 'You can fill in the details yourself after uploading.'}</p>`;
}
function sGarment() {
  const g = S.gEdit; if (!g) return '';
  const looks = S.looks.filter(l => (l.garments || []).includes(g.id));
  const fld = (k, label, ph = '') => `<div class="field"><label for="g-${k}">${label}</label><input class="inp" id="g-${k}" data-g="${k}" value="${esc(g[k] || '')}" placeholder="${esc(ph)}"></div>`;
  const sel = (k, label, vals) => `<div class="field"><label for="g-${k}">${label}</label><select class="inp" id="g-${k}" data-g="${k}">${vals.map(v => opt(v, g[k] || (k === 'status' ? 'Available' : ''))).join('')}</select></div>`;
  return `<p class="eyebrow">${esc(g.category || 'Garment')}${g._new ? ' · new' : ''}</p><h2>${esc(g.name || 'New garment')}</h2>
  <div class="sheetcols">
    <div>
      <div class="gimg" style="aspect-ratio:4/5">${src(g) ? `<img src="${esc(src(g))}" alt="${esc(g.name)}">` : `<div class="ph">${esc(g.name || 'No photo')}</div>`}</div>
      <div class="row mt" style="margin-top:12px">
        ${src(g) && sample ? `<button class="btn sm" data-a="gAI" ${S.gBusy ? 'disabled' : ''}>${S.gBusy === 'ai' ? 'Reading photo…' : 'Identify with AI'}</button>` : ''}
        ${src(g) ? `<button class="btn sm" data-a="gClean" ${S.gBusy ? 'disabled' : ''}>${S.gBusy === 'clean' ? 'Cleaning…' : 'Clean background'}</button>` : ''}
        <label class="btn sm" style="position:relative">${src(g) ? 'Replace photo' : 'Add photo'}<input type="file" accept="image/*" data-up="gphoto" style="position:absolute;inset:0;opacity:0" aria-label="Choose photo"></label>
      </div>
      ${g._uncertain && g._uncertain.length ? `<p class="small muted mt">Claude wasn’t sure about: ${esc(g._uncertain.join(', '))}. Check those fields.</p>` : ''}
      ${S.gErr ? `<p class="err mt">${esc(S.gErr)}</p>` : ''}
      ${!g._new ? `<div class="mt2"><p class="lbl">See all looks</p>
        <p class="stylecount">${looks.length ? `You’ve styled this ${esc((g.sub || g.category || 'piece').toLowerCase())} in ${looks.length} look${looks.length > 1 ? 's' : ''}.` : 'Not styled in any look yet.'}</p>
        ${looks.length ? `<div class="lgrid" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:12px">${looks.map(l => `<button class="lcard" data-a="openLook" data-v="${l.id}">${boardHTML(l, { mini: true })}<span class="small">${esc(l.name || 'Untitled')}</span></button>`).join('')}</div>` : ''}
        <button class="btn sm mt" data-a="styleThis">Style this piece</button></div>` : ''}
    </div>
    <div class="sheetform">
      ${fld('name', 'Name', 'Oversized grey wool coat')}
      <div class="grid2">${sel('category', 'Category', CATS)}${fld('sub', 'Subcategory', 'Wool coat')}</div>
      <div class="grid2">${fld('brand', 'Brand', 'COS')}${fld('color', 'Colour', 'Grey')}</div>
      <div class="grid2">${fld('material', 'Material', 'Wool')}${fld('style', 'Style', 'Minimal')}</div>
      <div class="field"><span class="lbl">Season</span><div class="chips">${SEASONS.map(s => `<button class="chip" data-a="gSeason" data-v="${s}" aria-pressed="${(g.seasons || []).includes(s)}">${s}</button>`).join('')}</div></div>
      <div class="grid2">${sel('warmth', 'Warmth', LEVELS)}${sel('water', 'Water resistance', LEVELS)}</div>
      ${sel('status', 'Status', STATUSES)}
      <div class="field"><label for="g-notes">Notes</label><textarea class="inp" id="g-notes" data-g="notes" placeholder="Long and roomy">${esc(g.notes || '')}</textarea></div>
      <div class="row"><button class="btn primary" data-a="gSave">${g._new ? 'Add to wardrobe' : 'Save changes'}</button>${!g._new ? `<button class="btn ghost danger" data-a="gDelete">Delete</button>` : ''}</div>
    </div>
  </div>`;
}

/* inspo */
function sAddInspo() {
  return `<p class="eyebrow">Inspo library</p><h2>Save inspiration</h2>
  <div class="opt3">
    <label class="opt"><b>Pinterest screenshot</b><span>Upload a screenshot of a pin.</span><input type="file" accept="image/*" multiple data-up="inspo" aria-label="Upload screenshot"></label>
    <label class="opt"><b>Import image</b><span>Any outfit photo from your device.</span><input type="file" accept="image/*" multiple data-up="inspo" aria-label="Import image"></label>
  </div>
  <div class="field mt2"><label for="inLink">Import from a Pinterest link</label>
    <div class="row"><input class="inp" id="inLink" placeholder="https://pin.it/…" style="flex:1;min-width:0" value="${esc(S.inLink || '')}"><button class="btn sm" data-a="inspoLink" ${S.linkBusy ? 'disabled' : ''}>${S.linkBusy ? 'Importing…' : 'Import'}</button></div>
    <p class="small muted">Paste a pin’s link and THE EDIT brings in its image. If Pinterest doesn’t allow it, save a screenshot instead. You can also paste a copied image (⌘V / Ctrl+V) anywhere in the app.</p></div>`;
}
function sInspo() {
  const i = byId('inspo', S.inspoId); if (!i) return '<p>Not found.</p>';
  const a = i.analysis, m = i.matches; const busy = S.iBusy;
  return `<p class="eyebrow">Inspiration${a && a.style ? ' · ' + esc(a.style) : ''}</p><h2>${esc(a ? a.title || a.style : 'Saved look')}</h2>
  <div class="sheetcols">
    <div><figure class="polaroid"><img class="photo" src="${esc(src(i))}" alt="Inspiration">${a && a.note ? `<figcaption>${esc(a.note)}</figcaption>` : ''}</figure>
      ${i.source ? `<p class="small muted mt" style="overflow-wrap:anywhere">Source: <a href="${esc(i.source)}" target="_blank" rel="noopener" style="color:inherit">${esc(i.source)}</a></p>` : ''}
      <div class="field mt"><span class="lbl">Tags</span><div class="chips">${allTags().map(t => `<button class="chip" data-a="iTag" data-v="${esc(t)}" aria-pressed="${(i.tags || []).includes(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="row"><input class="inp" id="newTag" placeholder="New tag" style="max-width:160px"><button class="btn sm" data-a="iNewTag">Add tag</button></div></div>
      <div class="field mt"><span class="lbl">Collections</span><div class="chips">${allCollections().map(t => `<button class="chip" data-a="iCol" data-v="${esc(t)}" aria-pressed="${(i.collections || []).includes(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="row"><input class="inp" id="newCol" placeholder="New collection" style="max-width:200px"><button class="btn sm" data-a="iNewCol">Create</button></div></div>
      <div class="row mt"><button class="btn sm" data-a="iCover" ${S.profile.pinnedCover === i.id ? 'disabled' : ''}>${S.profile.pinnedCover === i.id ? 'Your cover image' : 'Use as cover'}</button><button class="btn ghost sm danger" data-a="iDelete">Delete inspiration</button></div>
    </div>
    <div class="analysis">
      ${!a ? `<p class="muted">Let Claude identify each visible piece, the palette and the mood of this look.</p>
        <button class="btn primary" data-a="iDecode" ${busy ? 'disabled' : ''} style="align-self:flex-start">${busy === 'decode' ? 'Decoding…' : 'Decode this look'}</button>`
      : `<div><p class="lbl">Look analysis</p><ul class="alist" style="margin-top:8px">${(a.items || []).map(x => `<li><span>${esc(x.name)}</span><span class="conf ${x.confidence === 'low' ? 'low' : ''}">${x.confidence === 'low' ? 'Not certain' : esc(x.category)}</span></li>`).join('')}</ul></div>
        <dl class="attrs"><dt>Colour palette</dt><dd><span class="dots">${(a.palette || []).map(p => `<i style="background:${/^#[0-9a-f]{3,8}$/i.test(p.hex) ? p.hex : 'transparent'}"></i>`).join('')}</span>${esc((a.palette || []).map(p => p.name).join(' / '))}</dd>
          <dt>Style</dt><dd>${esc(a.style)}</dd><dt>Silhouette</dt><dd>${esc(a.silhouette)}</dd><dt>Season</dt><dd>${esc(a.season)}</dd><dt>Occasion</dt><dd>${esc(a.occasion)}</dd></dl>
        ${(a.uncertain || []).length ? `<p class="small" style="color:var(--warn)">Couldn’t read with confidence: ${esc(a.uncertain.join('; '))}</p>` : ''}
        <hr class="rule">
        ${!m ? `<button class="btn primary" data-a="iRecreate" ${busy || !S.garments.length ? 'disabled' : ''} style="align-self:flex-start">${busy === 'recreate' ? 'Searching your wardrobe…' : 'Recreate with my wardrobe'}</button>${!S.garments.length ? '<p class="small muted">Add garments to your wardrobe to recreate looks.</p>' : ''}`
        : `<div><p class="lbl">Recreated with my wardrobe</p>${(m.matches || []).map(x => { const g = byId('garments', x.garmentId); return `<div class="match"><div class="gimg">${g ? (src(g) ? `<img src="${esc(src(g))}" alt="">` : `<div class="ph" style="font-size:11px">${esc(g.name)}</div>`) : `<div class="ph" style="font-size:20px">—</div>`}</div>
            <div><p class="mtype ${esc(x.type)}">${x.type === 'exact' ? 'Exact match' : x.type === 'similar' ? 'Similar match' : 'Missing item'}</p><p><b style="font-weight:500">${esc(x.item)}</b>${g ? ' → ' + esc(g.name) : ''}</p><p class="small muted">${esc(x.note || '')}</p></div></div>`; }).join('')}</div>
          ${(m.swaps || []).length ? `<div>${m.swaps.map(s => `<p class="serif" style="font-size:19px;font-style:italic;line-height:1.3;margin-top:6px">${esc(s)}</p>`).join('')}</div>` : ''}
          ${(m.external || []).length ? `<div class="ext"><p class="eyebrow" style="color:var(--burgundy)">Outside your wardrobe</p>${m.external.map(e => `<p style="margin-top:6px"><b>${esc(e.item)}</b> — ${esc(e.why)}</p>`).join('')}</div>` : ''}
          <div class="row"><button class="btn primary" data-a="iSaveLook" ${(m.matches || []).some(x => x.garmentId) ? '' : 'disabled'}>Save as look</button><button class="btn ghost sm" data-a="iRecreate" ${busy ? 'disabled' : ''}>${busy === 'recreate' ? 'Searching…' : 'Try again'}</button></div>`}`}
      ${S.iErr ? `<p class="err">${esc(S.iErr)}</p>` : ''}
    </div>
  </div>`;
}

/* look picker / look view */
function sLookPicker() {
  return `<p class="eyebrow">${esc(S.pick.title)}</p><h2>Choose a look</h2>
  ${S.looks.length ? `<div class="lgrid mt" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px">${S.looks.map(l => `<button class="lcard" data-a="pickLook" data-v="${l.id}">${boardHTML(l, { mini: true })}<h3 style="font-size:17px">${esc(l.name || 'Untitled')}</h3></button>`).join('')}</div>` : `<p class="muted mt">No looks yet.</p>`}
  <div class="row mt">${S.pick.clear ? `<button class="btn ghost sm" data-a="pickLook" data-v="">Clear this day</button>` : ''}<button class="btn sm" data-a="newLook">Create a new look</button></div>`;
}
function sLook() {
  const l = byId('looks', S.lookView); if (!l) return '<p>Not found.</p>';
  const gs = (l.garments || []).map(id => byId('garments', id)).filter(Boolean);
  const trips = S.trips.filter(t => Object.values(t.days || {}).some(d => d.lookId === l.id || d.altId === l.id));
  return `<p class="eyebrow">${esc(l.style || 'Look')}</p><h2>${esc(l.name || 'Untitled look')}</h2>
  <div class="sheetcols"><div>${boardHTML(l)}</div><div class="sheetform">
    <dl class="attrs"><dt>Status</dt><dd><span class="pill ${(l.status || 'Draft').toLowerCase()}">${esc(l.status || 'Draft')}</span></dd><dt>Season</dt><dd>${esc((l.seasons || []).join(' / ') || '—')}</dd><dt>Occasion</dt><dd>${esc(l.occasion || '—')}</dd><dt>Temperature</dt><dd class="tab">${l.tmin !== '' && l.tmin != null ? esc(l.tmin) + '–' + esc(l.tmax) + ' °C' : '—'}</dd>${trips.length ? `<dt>Trips</dt><dd>${esc(trips.map(t => t.name).join(', '))}</dd>` : ''}</dl>
    ${l.notes ? `<p class="serif" style="font-size:18px;font-style:italic">${esc(l.notes)}</p>` : ''}
    <ul class="alist">${gs.map(g => `<li><button class="link" data-a="openGarment" data-v="${g.id}">${esc(g.name)}</button><span class="conf">${esc(g.category)}</span></li>`).join('')}</ul>
    <div class="row"><button class="btn primary" data-a="editLook" data-v="${l.id}">Edit look</button><button class="btn" data-a="dupLook" data-v="${l.id}">Duplicate</button><button class="btn" data-a="setToday" data-v="${l.id}">Wear today</button></div>
    <div class="row"><button class="btn sm" data-a="lookTrip" data-v="${l.id}">Add to trip</button><button class="btn sm" data-a="lookTry" data-v="${l.id}">Try on</button><button class="btn sm" data-a="lookExport" data-v="${l.id}">Export</button>${l.status !== 'Worn' ? `<button class="btn sm ghost" data-a="markWorn" data-v="${l.id}">Mark as worn</button>` : ''}</div>
  </div></div>`;
}
function sNewLook() {
  return `<p class="eyebrow">Style studio</p><h2>Create look</h2>
  <div class="opt3">
    <button class="opt" data-a="nlScratch"><b>Start from scratch</b><span>Pick pieces and arrange them.</span></button>
    <button class="opt" data-a="nlInspo"><b>From inspiration</b><span>Recreate a saved Pinterest look.</span></button>
    <button class="opt" data-a="nlAI"><b>AI suggestion</b><span>Ask the stylist for a proposal.</span></button>
    <button class="opt" data-a="nlExisting"><b>From existing look</b><span>Duplicate a look and change it.</span></button>
  </div>`;
}
function sInspoPicker() {
  return `<p class="eyebrow">From inspiration</p><h2>Choose a photo</h2>
  ${S.inspo.length ? `<div class="masonry mt" style="columns:3 140px">${S.inspo.map(i => `<button class="pin" data-a="openInspo" data-v="${i.id}"><img src="${esc(src(i))}" alt="Inspiration" loading="lazy"></button>`).join('')}</div>` : `<p class="muted mt">Your inspo library is empty.</p><button class="btn mt" data-a="addInspo">Save inspiration</button>`}`;
}
function sTripAssign() {
  const l = byId('looks', S.assignLook) || S.ed; const t = byId('trips', S.assignTrip) || S.trips[0];
  if (!S.trips.length) return `<h2>Add to trip</h2><p class="muted mt">You don’t have a trip yet.</p><button class="btn primary mt" data-a="newTrip">New trip</button>`;
  const days = range(t.start, t.end);
  return `<p class="eyebrow">${esc(l ? l.name || 'Look' : 'Look')}</p><h2>Add to trip</h2>
  <div class="sheetform mt">
    <div class="field"><label for="asTrip">Trip</label><select class="inp" id="asTrip">${S.trips.map(x => opt(x.id, t.id, x.name)).join('')}</select></div>
    <div class="field"><label for="asDay">Day</label><select class="inp" id="asDay">${days.map(d => { const x = (t.days || {})[d]; const cur = x && byId('looks', x.lookId); return opt(d, '', fmt(d, {weekday:'short', day:'numeric', month:'short'}) + (cur ? ' · ' + (cur.name || 'look planned') : '')); }).join('')}</select></div>
    <div class="row"><button class="btn primary" data-a="asDo" data-v="lookId">Set as the day’s look</button><button class="btn" data-a="asDo" data-v="altId">Save as alternative</button></div>
  </div>`;
}
function sWeather() {
  const w = S.profile.weather && S.profile.weather.date === todayISO() ? S.profile.weather : {};
  return `<p class="eyebrow">Weather today</p><h2>${esc(w.city || S.profile.city || 'Your city')}</h2>
  <div class="sheetform mt">
    <div class="field"><label for="wCity">City</label><input class="inp" id="wCity" value="${esc(w.city || S.profile.city || '')}"></div>
    <div class="grid2"><div class="field"><label for="wTemp">Temperature °C</label><input class="inp tab" type="number" id="wTemp" value="${esc(w.temp ?? '')}"></div><div class="field"><label for="wFeels">Feels like °C</label><input class="inp tab" type="number" id="wFeels" value="${esc(w.feels ?? '')}"></div></div>
    <div class="field"><label for="wRain">Chance of rain %</label><input class="inp tab" type="number" min="0" max="100" id="wRain" value="${esc(w.rain ?? '')}"></div>
    <div class="row"><button class="btn primary" data-a="wxLive">Get live weather</button><button class="btn" data-a="saveWeather">Save these numbers</button></div>
    <p class="small muted">Live weather comes from Open-Meteo. Set your home city in Profile and THE EDIT checks it every day.</p>
  </div>`;
}
function sNewTrip() {
  return `<p class="eyebrow">Trips</p><h2>New trip</h2>
  <div class="sheetform mt">
    <div class="field"><label for="ntName">Trip name</label><input class="inp" id="ntName" placeholder="Europe Edit"></div>
    <div class="grid2"><div class="field"><label for="ntStart">Start</label><input class="inp tab" type="date" id="ntStart" value="${todayISO()}"></div><div class="field"><label for="ntEnd">End</label><input class="inp tab" type="date" id="ntEnd" value="${addDays(todayISO(), 7)}"></div></div>
    <p class="small muted">You can add cities and dates inside the trip.</p>
    <button class="btn primary" data-a="createTrip" style="align-self:flex-start">Create trip</button>
  </div>`;
}

/* ============ actions ============ */
function go(v) { S.view = v; S.tripId = v === 'trips' ? S.tripId : null; try { localStorage.setItem('edit.view', v); } catch (e) {} closeSheet(); render(); window.scrollTo(0, 0); }
function openEditor(look) { S.ed = look; S.sel.ed = -1; S.styleTab = 'editor'; S.view = 'style'; closeSheet(); render(); window.scrollTo(0, 0); }
function openGarment(g) { S.gEdit = clean(g); S.gErr = ''; S.gBusy = ''; openSheet(sGarment); }

const A = {
  go: v => go(v), closeSheet, bgClose: (v, e) => { if (e.target.classList.contains('sheet-bg')) closeSheet(); },
  confirmYes: () => { const f = S.confirmYes; closeSheet(); f && f(); },
  /* home */
  pickToday: v => { S.pick = { kind: 'today', field: v, title: v === 'altId' ? 'An alternative for today' : 'Today’s look' }; openSheet(sLookPicker); },
  pickTripDay: d => { S.pick = { kind: 'trip', tripId: S.tripId, date: d, field: 'lookId', clear: true, title: fmt(d, {weekday:'long', day:'numeric', month:'long'}) }; openSheet(sLookPicker); },
  pickLook: id => {
    const p = S.pick;
    if (p.kind === 'today') { const t = S.profile.today && S.profile.today.date === todayISO() ? S.profile.today : { date: todayISO() }; saveProfile({ today: { ...t, [p.field]: id } }); toast(p.field === 'altId' ? 'Alternative saved.' : 'Today’s look is set.'); }
    if (p.kind === 'trip') { const tr = clean(byId('trips', p.tripId)); tr.days = tr.days || {}; tr.days[p.date] = { ...(tr.days[p.date] || {}), lookId: id || null }; put('trips', tr); }
    closeSheet();
  },
  setToday: id => { saveProfile({ today: { date: todayISO(), lookId: id } }); closeSheet(); toast('Today’s look is set.'); },
  editWeather: () => openSheet(sWeather, true),
  saveWeather: () => { saveProfile({ weather: { date: todayISO(), city: $('#wCity').value.trim(), temp: $('#wTemp').value, feels: $('#wFeels').value, rain: $('#wRain').value } }); closeSheet(); },
  planDay: () => { const tr = upcomingTrip(); if (tr) { S.view = 'trips'; S.tripId = tr.id; S.tripTab = 'days'; render(); } else A.pickToday('lookId'); },
  composeCover: async () => {
    const ci = coverInspo(); if (!sample || !ci) { toast(aiErrMsg(null)); return; }
    S.coverBusy = true; render();
    try { const r = await aiCover(await getBlob(src(ci)), todayPlan().look); await saveProfile({ cover: { date: todayISO(), inspoId: ci.id, headline: String(r.headline || ''), dek: String(r.dek || ''), note: String(r.note || '') } }); }
    catch (e) { toast(e && e.code ? aiErrMsg(e) : 'This image could not be loaded.'); }
    S.coverBusy = false; render();
  },
  nextCover: () => { const ci = coverInspo(); if (!ci || S.inspo.length < 2) return; const i = S.inspo.findIndex(x => x.id === ci.id); saveProfile({ cover: { date: todayISO(), inspoId: S.inspo[(i + 1) % S.inspo.length].id } }); },
  readDNA: async () => {
    if (!sample) { toast(aiErrMsg(null)); return; }
    if (S.imgMax === 0) { toast(aiErrMsg({ code: 'images_unavailable' })); return; }
    const pick = S.inspo.slice(0, Math.min(S.imgMax || 4, 8));
    if (pick.length < 2) { toast('Save at least two inspiration photos first.'); return; }
    S.dnaBusy = true; render();
    try { const blobs = []; for (const i of pick) blobs.push(await getBlob(src(i))); const r = await aiDNA(blobs); await saveProfile({ dna: { ...r, inspoIds: pick.map(i => i.id), date: todayISO() } }); toast(`Your aesthetic: ${r.name}.`); }
    catch (e) { toast(e && e.code ? aiErrMsg(e) : 'One of the images could not be loaded.'); }
    S.dnaBusy = false; render();
  },
  decodeAll: async () => {
    if (!sample || S.decAll) return;
    const todo = S.inspo.filter(i => !i.analysis).slice(0, 10); if (!todo.length) return;
    S.decAll = { done: 0, total: todo.length }; render();
    for (const i of todo) {
      try { const a = await aiDecode(await getBlob(src(i))); const ii = byId('inspo', i.id); if (!ii) continue; const c = clean(ii); c.analysis = a; c.tags = uniq([...(c.tags || []), ...(a.tags || []).filter(t => BASE_TAGS.includes(t))]); await put('inspo', c); S.decAll.done++; render(); }
      catch (e) { toast(aiErrMsg(e)); break; }
    }
    toast(`${S.decAll.done} pin${S.decAll.done === 1 ? '' : 's'} decoded.`); S.decAll = null; render();
  },
  tone: v => { S.tone = v; applyTone(); try { localStorage.setItem('edit.tone', v); } catch (e) {} render(); },
  signIn: () => doAuth('in'),
  signUp: () => doAuth('up'),
  signOut: () => { sb.auth.signOut(); },
  exportData: () => exportBackup().catch(() => toast('The backup could not be saved.')),
  wxLive: async () => {
    const city = ($('#wCity').value || '').trim(); if (!city) { toast('Type a city first.'); return; }
    try { const w = await liveWeather(city); await saveProfile({ weather: w, city: S.profile.city || w.city }); closeSheet(); toast(`Live weather for ${w.city}.`); }
    catch (e) { toast('That city wasn’t found, or the weather service didn’t answer.'); }
  },
  inspoLink: async () => {
    const url = ($('#inLink').value || '').trim();
    if (!/^https:\/\//i.test(url)) { toast('Paste a full Pinterest link that starts with https://'); return; }
    S.linkBusy = true; S.inLink = url; refreshSheet(true);
    try {
      const j = await fnCall({ action: 'fetchImage', url });
      const r = await storeImage(await shrink(b64ToBlob(j.data, j.type), 1600));
      const item = { id: uid(), ...r, source: url, tags: [], collections: S.ifl.col ? [S.ifl.col] : [], createdAt: Date.now() };
      await put('inspo', item); S.linkBusy = false; S.inLink = '';
      if (S.view !== 'inspo') go('inspo');
      A.openInspo(item.id);
    } catch (e) {
      S.linkBusy = false; refreshSheet(true);
      toast(e && e.code === 'unsupported_site' ? 'Only Pinterest links can be imported.' : e && e.code === 'no_image' ? 'Pinterest didn’t share an image for this link. Save a screenshot instead.' : aiErrMsg(e));
    }
  },
  tripForecast: async () => {
    const tr = clean(byId('trips', S.tripId)); const t = todayISO(), lim = addDays(t, 15); let n = 0;
    if (!(tr.stops || []).length) { toast('Add a destination first.'); return; }
    S.fcBusy = true; render();
    try {
      for (const st of tr.stops) {
        const a = st.from > t ? st.from : t, b = st.to < lim ? st.to : lim; if (a > b) continue;
        const p = await geocode(st.city);
        const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&daily=temperature_2m_max,precipitation_probability_max&start_date=${a}&end_date=${b}&timezone=auto`).then(r => r.json());
        ((f.daily && f.daily.time) || []).forEach((d, i) => { tr.days = tr.days || {}; tr.days[d] = { ...(tr.days[d] || {}), temp: String(Math.round(f.daily.temperature_2m_max[i])), rain: String(f.daily.precipitation_probability_max[i] ?? '') }; n++; });
      }
      if (n) { await put('trips', tr); toast(`Forecast added for ${n} day${n === 1 ? '' : 's'}.`); }
      else toast('Forecasts reach about 16 days ahead. Try again closer to the trip.');
    } catch (e) { toast('The forecast service didn’t answer. Try again later.'); }
    S.fcBusy = false; render();
  },
  stylistGo: () => { S.view = 'style'; S.styleTab = 'stylist'; render(); },
  /* wardrobe */
  addGarment: () => openSheet(sAddGarment),
  manualGarment: () => openGarment({ id: uid(), _new: true, category: 'Tops', status: 'Available', seasons: [], warmth: 'Medium', water: 'Low' }),
  openGarment: id => { const g = byId('garments', id); if (g) openGarment(g); },
  wview: v => { S.wview = v; render(); },
  clearF: () => { S.wf = {}; render(); },
  gSeason: s => { const g = S.gEdit; g.seasons = (g.seasons || []).includes(s) ? g.seasons.filter(x => x !== s) : [...(g.seasons || []), s]; refreshSheet(); },
  gSave: async () => {
    const g = clean(S.gEdit); if (!g.name) g.name = [g.color, g.sub || g.category].filter(Boolean).join(' ') || 'Untitled piece';
    const wasNew = g._new; delete g._new; delete g._uncertain; g.createdAt = g.createdAt || Date.now();
    closeSheet(); await put('garments', g); toast(wasNew ? 'Added to your wardrobe.' : 'Saved.');
  },
  gDelete: () => { const g = S.gEdit; confirmSheet(`Delete ${g.name || 'this garment'}?`, () => { dropAsset(g.imgId); del('garments', g.id); }); },
  gAI: () => runIdentify(),
  gClean: async () => {
    const g = S.gEdit; S.gBusy = 'clean'; S.gErr = ''; refreshSheet();
    try { const b = await removeBackground(src(g)); const old = g.imgId; const r = await storeImage(b); Object.assign(g, r); if (!r.imgId) delete g.imgId; else delete g.img; if (old && !g._new) { const saved = byId('garments', g.id); if (saved) await put('garments', { ...saved, ...r, img: r.img || null }); dropAsset(old); } }
    catch (e) { S.gErr = 'The background could not be removed from this photo. Plain, light backgrounds work best.'; }
    S.gBusy = ''; refreshSheet();
  },
  styleThis: () => { const g = S.gEdit; S.styl.q = `Create three different outfits around my ${g.name}.`; closeSheet(); S.view = 'style'; S.styleTab = 'stylist'; render(); },
  /* inspo */
  addInspo: () => { S.inLink = ''; openSheet(sAddInspo); },
  openInspo: id => { S.inspoId = id; S.iErr = ''; S.iBusy = ''; openSheet(sInspo); },
  ifTag: v => { S.ifl.tag = S.ifl.tag === v ? '' : v; render(); },
  ifCol: v => { S.ifl.col = S.ifl.col === v ? '' : v; render(); },
  iTag: t => { const i = clean(byId('inspo', S.inspoId)); i.tags = (i.tags || []).includes(t) ? i.tags.filter(x => x !== t) : [...(i.tags || []), t]; put('inspo', i); refreshSheet(); },
  iCol: t => { const i = clean(byId('inspo', S.inspoId)); i.collections = (i.collections || []).includes(t) ? i.collections.filter(x => x !== t) : [...(i.collections || []), t]; put('inspo', i); refreshSheet(); },
  iNewTag: () => { const v = $('#newTag').value.trim(); if (!v) return; const i = clean(byId('inspo', S.inspoId)); i.tags = uniq([...(i.tags || []), v]); put('inspo', i); refreshSheet(true); },
  iNewCol: () => { const v = $('#newCol').value.trim(); if (!v) return; saveProfile({ collections: uniq([...(S.profile.collections || []), v]) }); const i = clean(byId('inspo', S.inspoId)); i.collections = uniq([...(i.collections || []), v]); put('inspo', i); refreshSheet(true); },
  iCover: () => { saveProfile({ pinnedCover: S.inspoId, cover: null }); refreshSheet(true); toast('Cover image updated.'); },
  iDelete: () => { const i = byId('inspo', S.inspoId); confirmSheet('Delete this inspiration?', () => { dropAsset(i.imgId); del('inspo', i.id); }); },
  iDecode: async () => {
    if (!sample) { S.iErr = aiErrMsg(null); refreshSheet(); return; }
    const i = byId('inspo', S.inspoId); S.iBusy = 'decode'; S.iErr = ''; refreshSheet();
    try { const blob = await getBlob(src(i)); const a = await aiDecode(blob); const ii = clean(byId('inspo', i.id)); ii.analysis = a; ii.matches = null; ii.tags = uniq([...(ii.tags || []), ...(a.tags || []).filter(t => BASE_TAGS.includes(t))]); await put('inspo', ii); }
    catch (e) { S.iErr = e && e.code ? aiErrMsg(e) : 'This image could not be loaded for analysis.'; }
    S.iBusy = ''; refreshSheet(true);
  },
  iRecreate: async () => {
    if (!sample) { S.iErr = aiErrMsg(null); refreshSheet(); return; }
    const i = byId('inspo', S.inspoId); S.iBusy = 'recreate'; S.iErr = ''; refreshSheet();
    try { const m = await aiRecreate(i.analysis); await put('inspo', { ...clean(byId('inspo', i.id)), matches: m }); }
    catch (e) { S.iErr = aiErrMsg(e); }
    S.iBusy = ''; refreshSheet(true);
  },
  iSaveLook: async () => {
    const i = byId('inspo', S.inspoId), a = i.analysis || {};
    const look = newDraft({ name: a.style ? a.style + ' recreated' : 'Recreated look', style: a.style || '', occasion: a.occasion || '', garments: uniq((i.matches.matches || []).map(x => x.garmentId)), inspoId: i.id,
      seasons: SEASONS.filter(s => (a.season || '').toLowerCase().includes(s.toLowerCase()) || (s === 'Autumn' && /fall/i.test(a.season || ''))), notes: (i.matches.swaps || []).join(' ') });
    await put('looks', look); toast('Look saved. Fine-tune it in the editor.'); openEditor(clean(look));
  },
  /* style */
  stab: v => { S.styleTab = v; if (v === 'editor' && !S.ed) S.ed = newDraft(); S.view = 'style'; render(); },
  lookF: v => { S.lookFilter = v; render(); },
  newLook: () => openSheet(sNewLook),
  nlScratch: () => openEditor(newDraft()),
  nlInspo: () => openSheet(sInspoPicker),
  nlAI: () => { closeSheet(); S.view = 'style'; S.styleTab = 'stylist'; render(); },
  nlExisting: () => { S.pick = { kind: 'dup', title: 'From existing look' }; openSheet(() => sLookPicker().replace(/data-a="pickLook"/g, 'data-a="dupLook"')); },
  openLook: id => { S.lookView = id; openSheet(sLook); },
  editLook: id => { const l = byId('looks', id); if (l) openEditor(clean({ mode: 'auto', canvas: { bg: '#FFFFFF', items: [] }, ...l })); },
  dupLook: id => { const l = byId('looks', id); if (l) openEditor(newDraft({ ...clean(l), id: uid(), name: (l.name || 'Look') + ' — variant', status: 'Draft', createdAt: Date.now() })); },
  markWorn: id => { const l = byId('looks', id); put('looks', { ...l, status: 'Worn' }); refreshSheet(true); },
  lookTrip: id => { S.assignLook = id; S.assignTrip = upcomingTrip() ? upcomingTrip().id : (S.trips[0] || {}).id; openSheet(sTripAssign, true); },
  lookTry: id => { S.fit.lookId = id; S.fit.items = null; S.sel.fit = -1; go('profile'); },
  lookExport: id => { const l = byId('looks', id); exportBoard(lookItems(l), (l.canvas || {}).bg, l.name); },
  toggleG: id => { const l = S.ed; l.garments = l.garments.includes(id) ? l.garments.filter(x => x !== id) : [...l.garments, id]; syncFree(l); S.sel.ed = -1; render(); },
  edMode: v => { const l = S.ed; if (v === 'free' && l.mode !== 'free') { l.mode = 'free'; const texts = (l.canvas.items || []).filter(i => i.t === 'x'); l.canvas.items = [...autoItems(l.garments), ...texts]; } else if (v === 'auto') l.mode = 'auto'; S.sel.ed = -1; render(); },
  edBg: c => { S.ed.canvas.bg = c; render(); },
  edAddText: () => { const v = $('#edText').value.trim(); if (!v) return; S.ed.canvas.items.push({ t: 'x', text: v, x: 50, y: 10, w: 6, r: 0 }); S.sel.ed = S.ed.canvas.items.length - 1; render(); },
  edLayer: v => layer('ed', v),
  edSeason: s => { const l = S.ed; l.seasons = (l.seasons || []).includes(s) ? l.seasons.filter(x => x !== s) : [...(l.seasons || []), s]; render(); },
  edSave: async () => { const l = clean(S.ed); delete l._pf; if (!l.garments.length) { toast('Pick at least one garment for this look.'); return; } l.name = l.name || 'Untitled look'; S.ed.name = l.name; await put('looks', l); toast('Look saved.'); },
  edDup: () => { const l = S.ed; S.ed = newDraft({ ...clean(l), id: uid(), name: (l.name || 'Look') + ' — variant', status: 'Draft', createdAt: Date.now() }); render(); toast('Variant created. Save it to keep it.'); },
  edTrip: async () => { if (!byId('looks', S.ed.id)) await A.edSave(); if (byId('looks', S.ed.id)) A.lookTrip(S.ed.id); },
  edTry: async () => { if (!byId('looks', S.ed.id)) await A.edSave(); if (byId('looks', S.ed.id)) A.lookTry(S.ed.id); },
  edExport: () => exportBoard(lookItems(S.ed), S.ed.canvas.bg, S.ed.name),
  edDelete: () => { const l = S.ed; confirmSheet(`Delete ${l.name || 'this look'}?`, () => { del('looks', l.id); S.ed = newDraft(); S.styleTab = 'looks'; render(); }); },
  asDo: field => {
    const tr = clean(byId('trips', $('#asTrip').value)); const d = $('#asDay').value; tr.days = tr.days || {};
    tr.days[d] = { ...(tr.days[d] || {}), [field]: S.assignLook || S.ed.id }; put('trips', tr); closeSheet(); toast(`Added to ${tr.name}, ${fmt(d, {weekday:'short', day:'numeric', month:'short'})}.`);
  },
  stylChip: v => { S.styl.q = v; render(); $('#stQ') && $('#stQ').focus(); },
  stylGo: async () => {
    const q = ($('#stQ') || {}).value || S.styl.q; S.styl.q = q.trim(); if (!S.styl.q) { toast('Tell the stylist what you need.'); return; }
    if (!sample) { S.styl.err = aiErrMsg(null); render(); return; }
    if (!S.garments.length) { S.styl.err = 'Add garments to your wardrobe first.'; render(); return; }
    Object.assign(S.styl, { busy: true, err: '', res: null }); render();
    try { S.styl.res = await aiStylist(S.styl.q); if (!(S.styl.res.looks || []).some(l => l.garmentIds.length)) S.styl.err = 'The stylist couldn’t build a look from your current wardrobe for this request.'; }
    catch (e) { S.styl.err = aiErrMsg(e); }
    S.styl.busy = false; render();
  },
  stylSave: async i => { const d = stylDraft(i); await put('looks', d); toast(`Saved “${d.name}”.`); },
  stylEdit: i => openEditor(stylDraft(i)),
  /* trips */
  newTrip: () => openSheet(sNewTrip, true),
  createTrip: async () => {
    const name = $('#ntName').value.trim() || 'New trip', start = $('#ntStart').value, end = $('#ntEnd').value;
    if (!start || !end || end < start) { toast('The end date must be on or after the start date.'); return; }
    const tr = { id: uid(), name, start, end, stops: [], days: {}, packed: {}, extras: [], createdAt: Date.now() };
    await put('trips', tr); closeSheet(); S.view = 'trips'; S.tripId = tr.id; S.tripTab = 'days'; render();
  },
  openTrip: id => { S.view = 'trips'; S.tripId = id; S.tripTab = 'days'; render(); window.scrollTo(0, 0); },
  tripBack: () => { S.tripId = null; render(); },
  tripTab: v => { S.tripTab = v; render(); },
  addStop: () => { const tr = clean(byId('trips', S.tripId)); const city = $('#stCity').value.trim(), from = $('#stFrom').value, to = $('#stTo').value; if (!city || !from || !to || to < from) { toast('Add a city and a valid date range.'); return; } tr.stops = [...(tr.stops || []), { city, from, to }].sort((a, b) => a.from < b.from ? -1 : 1); put('trips', tr); },
  rmStop: i => { const tr = clean(byId('trips', S.tripId)); tr.stops.splice(Number(i), 1); put('trips', tr); },
  addExtra: () => { const v = $('#extraG').value; if (!v) return; const tr = clean(byId('trips', S.tripId)); tr.extras = uniq([...(tr.extras || []), v]); put('trips', tr); },
  saveTripMeta: () => { const tr = clean(byId('trips', S.tripId)); const s = $('#trStart').value, e = $('#trEnd').value; if (!s || !e || e < s) { toast('The end date must be on or after the start date.'); return; } Object.assign(tr, { name: $('#trName').value.trim() || tr.name, start: s, end: e }); put('trips', tr); toast('Trip updated.'); },
  delTrip: () => { const tr = byId('trips', S.tripId); confirmSheet(`Delete ${tr.name}?`, () => { del('trips', tr.id); S.tripId = null; render(); }); },
  /* profile / fitting */
  fitPhoto: id => { S.fit.photo = id; render(); },
  fitLayer: v => layer('fit', v),
  fitReset: () => { S.fit.items = null; S.sel.fit = -1; render(); },
  fitSave: async () => { await put('tryons', { id: uid(), photoId: S.fit.photo, lookId: S.fit.lookId, items: S.fit.items, createdAt: Date.now() }); toast('Try-on saved.'); },
  fitExport: () => { const ph = (S.profile.photos || []).find(x => x.id === S.fit.photo); exportBoard(S.fit.items, '#FFFFFF', 'try-on ' + ((byId('looks', S.fit.lookId) || {}).name || ''), ph && src(ph)); },
  delTryon: id => confirmSheet('Delete this try-on?', () => del('tryons', id)),
  wipePhotos: () => confirmSheet('Delete all your personal photos?', () => { (S.profile.photos || []).forEach(p => dropAsset(p.imgId)); saveProfile({ photos: [] }); S.tryons.forEach(t => del('tryons', t.id)); S.fit.photo = null; toast('Your photos and try-ons were deleted.'); }, 'Delete photos'),
  wipeTryons: () => confirmSheet('Delete all try-on visualisations?', () => { S.tryons.forEach(t => del('tryons', t.id)); toast('Try-ons deleted.'); }, 'Delete try-ons'),
};
function stylDraft(i) {
  const l = S.styl.res.looks[i];
  return newDraft({ name: l.name || 'Stylist look', garments: l.garmentIds, inspoId: l.inspoId || null, notes: l.why || '', occasion: l.occasion || '', style: l.style || '', tmin: l.tmin ?? '', tmax: l.tmax ?? '', status: 'Draft' });
}
function layer(ctx, v) {
  const arr = ctx === 'ed' ? S.ed.canvas.items : S.fit.items; const i = S.sel[ctx]; if (i < 0 || !arr[i]) return;
  if (v === 'del') { const it = arr[i]; arr.splice(i, 1); if (ctx === 'ed' && it.t === 'g') S.ed.garments = S.ed.garments.filter(g => g !== it.gid); S.sel[ctx] = -1; }
  else if (v === 'up' && i < arr.length - 1) { [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]; S.sel[ctx] = i + 1; }
  else if (v === 'down' && i > 0) { [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]; S.sel[ctx] = i - 1; }
  render();
}
async function runIdentify() {
  const g = S.gEdit; if (!sample) { S.gErr = aiErrMsg(null); refreshSheet(); return; }
  S.gBusy = 'ai'; S.gErr = ''; refreshSheet();
  try {
    const r = await aiIdentify(await getBlob(src(g)));
    if (S.gEdit !== g) return;
    for (const k of ['name','sub','brand','color','material','style','notes']) if (r[k]) g[k] = String(r[k]);
    if (CATS.includes(r.category)) g.category = r.category;
    if (Array.isArray(r.seasons)) g.seasons = r.seasons.filter(s => SEASONS.includes(s));
    if (LEVELS.includes(r.warmth)) g.warmth = r.warmth; if (LEVELS.includes(r.water)) g.water = r.water;
    g._uncertain = Array.isArray(r.uncertain) ? r.uncertain : [];
  } catch (e) { S.gErr = aiErrMsg(e); }
  S.gBusy = ''; refreshSheet(true);
}

/* uploads */
async function handleUpload(kind, files) {
  if (!files || !files.length) return;
  try {
    if (kind === 'garment' || kind === 'gphoto') {
      toast('Uploading…');
      const blob = await shrink(files[0], 1400); const r = await storeImage(blob);
      if (kind === 'gphoto') { const old = S.gEdit.imgId; delete S.gEdit.img; delete S.gEdit.imgId; Object.assign(S.gEdit, r); if (old && !S.gEdit._new) dropAsset(old); refreshSheet(true); return; }
      openGarment({ id: uid(), _new: true, category: 'Tops', status: 'Available', seasons: [], warmth: 'Medium', water: 'Low', ...r });
      if (sample) runIdentify();
    } else if (kind === 'inspo') {
      const link = ($('#inLink') || {}).value || ''; let last;
      toast(files.length > 1 ? `Uploading ${files.length} images…` : 'Uploading…');
      for (const f of files) { const r = await storeImage(await shrink(f, 1600)); last = { id: uid(), ...r, source: link.trim(), tags: [], collections: S.ifl.col ? [S.ifl.col] : [], createdAt: Date.now() }; await put('inspo', last); }
      if (S.view !== 'inspo') go('inspo');
      if (files.length === 1) A.openInspo(last.id); else { closeSheet(); toast(`${files.length} inspirations saved.`); }
    } else if (kind === 'backup') {
      toast('Importing your backup…'); const n = await importBackup(files[0]); toast(`Imported ${n} items.`); render();
    } else if (kind === 'photo') {
      const r = await storeImage(await shrink(files[0], 1600)); const ph = { id: uid(), ...r };
      await saveProfile({ photos: [...(S.profile.photos || []), ph] }); S.fit.photo = ph.id; render();
    }
  } catch (e) {
    toast(e && e.code === 'too_large' ? 'That image is too large.' : e && e.code === 'not_granted' ? 'Uploading needs permission to store files on this page.' : 'The image could not be uploaded. Try another file.');
  }
}

/* ============ events ============ */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  if (t.tagName === 'LABEL') return;
  const fn = A[t.dataset.a]; if (!fn) return;
  if (t.dataset.a === 'bgClose' && e.target !== t) return;
  e.preventDefault(); fn(t.dataset.v, e);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.up) { handleUpload(t.dataset.up, [...t.files]); t.value = ''; return; }
  if (t.dataset.f) { S.wf[t.dataset.f] = t.value; render(); return; }
  if (t.dataset.g) { S.gEdit[t.dataset.g] = t.value; if (t.dataset.g === 'category') refreshSheet(true); return; }
  if (t.dataset.ed) { S.ed[t.dataset.ed] = t.value; if (t.dataset.ed === '_pf') render(); return; }
  if (t.dataset.pf) { if ((S.profile[t.dataset.pf] || '') !== t.value) saveProfile({ [t.dataset.pf]: t.value.trim() }); return; }
  if (t.dataset.pack) { const tr = clean(byId('trips', S.tripId)); tr.packed = tr.packed || {}; if (t.checked) tr.packed[t.dataset.pack] = true; else delete tr.packed[t.dataset.pack]; put('trips', tr); return; }
  if (t.dataset.day) { const tr = clean(byId('trips', S.tripId)); tr.days = tr.days || {}; const d = tr.days[t.dataset.day] || {}; if ((d[t.dataset.k] ?? '') === t.value) return; d[t.dataset.k] = t.value; tr.days[t.dataset.day] = d; put('trips', tr); return; }
  if (t.id === 'fitLook') { S.fit.lookId = t.value || null; S.fit.items = null; S.sel.fit = -1; render(); return; }
  if (t.id === 'asTrip') { S.assignTrip = t.value; refreshSheet(true); return; }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f === 'q') { S.wf.q = t.value; clearTimeout(S.qT); S.qT = setTimeout(() => { render(); const q = $('#wq'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); return; }
  if (t.dataset.g) { S.gEdit[t.dataset.g] = t.value; return; }
  if (t.dataset.ed) { S.ed[t.dataset.ed] = t.value; return; }
  if (t.id === 'stQ') { S.styl.q = t.value; return; }
  if (t.id === 'inLink') { S.inLink = t.value; return; }
  if (t.dataset.it || t.dataset.fit) {
    const ctx = t.dataset.it ? 'ed' : 'fit', key = t.dataset.it || t.dataset.fit;
    const arr = ctx === 'ed' ? S.ed.canvas.items : S.fit.items; const i = S.sel[ctx]; const it = arr[i]; if (!it) return;
    it[key] = Number(t.value);
    const el = $(`.board[data-ctx="${ctx}"] .it[data-i="${i}"]`);
    if (el) { if (key === 'r') el.style.setProperty('--r', it.r + 'deg'); else if (it.t === 'x') el.style.setProperty('--s', it.w); else el.style.width = it.w + '%'; }
  }
});
/* paste an image anywhere = save inspiration */
document.addEventListener('paste', e => {
  const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault(); handleUpload('inspo', files);
});

/* free-canvas dragging */
let drag = null;
document.addEventListener('pointerdown', e => {
  const board = e.target.closest('.board.live'); if (!board) return;
  const ctx = board.dataset.ctx; const itEl = e.target.closest('.it');
  if (!itEl) { if (S.sel[ctx] !== -1) { S.sel[ctx] = -1; render(); } return; }
  const i = Number(itEl.dataset.i); const arr = ctx === 'ed' ? S.ed.canvas.items : S.fit.items;
  const rect = board.getBoundingClientRect();
  drag = { ctx, i, el: itEl, rect, sx: e.clientX, sy: e.clientY, ox: arr[i].x, oy: arr[i].y, moved: false, arr };
  $$('.it.sel', board).forEach(x => x.classList.remove('sel')); itEl.classList.add('sel');
  itEl.setPointerCapture && itEl.setPointerCapture(e.pointerId);
  e.preventDefault();
});
document.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = (e.clientX - drag.sx) / drag.rect.width * 100, dy = (e.clientY - drag.sy) / drag.rect.height * 100;
  if (Math.abs(dx) + Math.abs(dy) > .5) drag.moved = true;
  const it = drag.arr[drag.i]; it.x = Math.max(-10, Math.min(110, drag.ox + dx)); it.y = Math.max(-10, Math.min(110, drag.oy + dy));
  drag.el.style.left = it.x + '%'; drag.el.style.top = it.y + '%';
});
document.addEventListener('pointerup', () => {
  if (!drag) return; const d = drag; drag = null;
  if (S.sel[d.ctx] !== d.i) { S.sel[d.ctx] = d.i; render(); }
});


/* ============ backend: Supabase + your own AI function ============ */
let sb = null, UID = null;
const URLS = {}, URL_FAIL = new Set(), needUrl = new Set(); let urlTimer = null;
function srcOf(o) {
  if (!o) return '';
  if (o.imgId) {
    const u = URLS[o.imgId];
    if (!u && !URL_FAIL.has(o.imgId) && sb) { needUrl.add(o.imgId); clearTimeout(urlTimer); urlTimer = setTimeout(loadUrls, 20); }
    return u || '';
  }
  return o.img || '';
}
async function loadUrls() {
  const ids = [...needUrl]; needUrl.clear(); if (!ids.length) return;
  const { data } = await sb.storage.from('images').createSignedUrls(ids, 60 * 60 * 24 * 7);
  const got = new Set();
  (data || []).forEach(d => { if (d.signedUrl) { URLS[d.path] = d.signedUrl; got.add(d.path); } });
  ids.forEach(id => { if (!got.has(id)) URL_FAIL.add(id); });
  softRender();
}

function makeDb() {
  const listeners = {}, timers = {};
  async function refresh(col) {
    const set = listeners[col]; if (!set) return;
    const { data, error } = await sb.from('docs').select('id,data').eq('col', col);
    if (error) return;
    set.forEach(fn => fn(data || []));
  }
  const later = col => { clearTimeout(timers[col]); timers[col] = setTimeout(() => refresh(col), 250); };
  function listen(col, fn) { (listeners[col] = listeners[col] || new Set()).add(fn); refresh(col); return () => listeners[col].delete(fn); }
  async function write(col, id, data) {
    const { error } = await sb.from('docs').upsert({ user_id: UID, col, id, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id,col,id' });
    if (error) throw { code: 'unavailable', message: error.message };
  }
  async function remove(col, id) {
    const { error } = await sb.from('docs').delete().eq('col', col).eq('id', id);
    if (error) throw { code: 'unavailable', message: error.message };
  }
  sb.channel('docs-' + UID)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'user_id=eq.' + UID }, p => { const col = (p.new && p.new.col) || (p.old && p.old.col); if (col) later(col); })
    .subscribe();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Object.keys(listeners).forEach(later); });
  return {
    collection: col => ({
      doc: id => ({ set: d => write(col, id, d), delete: () => remove(col, id) }),
      onSnapshot: next => listen(col, rows => next({ docs: rows.map(r => ({ id: r.id, exists: true, data: () => r.data })) })),
    }),
    doc: path => {
      const [col, id] = path.split('/');
      return { set: d => write(col, id, d), onSnapshot: next => listen(col, rows => { const r = rows.find(x => x.id === id); next({ exists: !!r, data: () => r && r.data }); }) };
    },
  };
}
function makeAssets() {
  return {
    upload: async blob => {
      const ext = ((blob.type || 'image/jpeg').split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const path = `${UID}/${uid()}.${ext}`;
      const { error } = await sb.storage.from('images').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
      if (error) throw { code: /size|large/i.test(error.message) ? 'too_large' : 'upstream_error', message: error.message };
      const local = URL.createObjectURL(blob); URLS[path] = local;
      return { id: path, url: local };
    },
    delete: async id => { await sb.storage.from('images').remove([id]); return { deleted: true }; },
  };
}
async function fnCall(body) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw { code: 'session_expired' };
  let r;
  try {
    r = await fetch(`${EDIT_CONFIG.SUPABASE_URL}/functions/v1/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: EDIT_CONFIG.SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
    });
  } catch (e) { throw { code: 'offline' }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw { code: j.code || (r.status === 404 ? 'not_configured' : 'upstream_error'), message: j.error || '' };
  return j;
}
async function toJpegB64(blob) {
  const small = await shrink(blob, 1280);
  const buf = new Uint8Array(await small.arrayBuffer()); let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { type: 'image/jpeg', data: btoa(s) };
}
function b64ToBlob(b64, type) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); }
function parseJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw { code: 'invalid_json' };
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { throw { code: 'invalid_json' }; }
}
function makeSample() {
  async function call(prompt, opts = {}) {
    const imgs = [];
    for (const b of [].concat(opts.images || [])) imgs.push(await toJpegB64(b));
    const j = await fnCall({ action: 'ai', prompt: typeof prompt === 'string' ? prompt : prompt.map(m => m.content).join('\n\n'), images: imgs, tier: opts.modelTier || 'default' });
    return j.text || '';
  }
  const fn = async (p, o) => ({ text: await call(p, o), truncated: false });
  fn.json = async (p, o) => parseJSON(await call(p, o));
  fn.limits = async () => ({ maxPromptBytes: 400000, images: { maxCount: 8, maxInputBytes: 5e6, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } });
  return fn;
}
function makeDownloads() {
  return {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        try { await navigator.share({ files: [file] }); return { status: 'saved' }; } catch (e) { if (e && e.name === 'AbortError') throw { code: 'declined' }; }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return { status: 'saved' };
    },
  };
}

/* live weather (Open-Meteo, no key needed) */
async function geocode(city) {
  const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`).then(r => r.json());
  const p = g.results && g.results[0]; if (!p) throw new Error('city');
  return p;
}
async function liveWeather(city) {
  const p = await geocode(city);
  const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,apparent_temperature&daily=precipitation_probability_max&forecast_days=1&timezone=auto`).then(r => r.json());
  return { date: todayISO(), city: p.name, temp: Math.round(f.current.temperature_2m), feels: Math.round(f.current.apparent_temperature), rain: (f.daily.precipitation_probability_max || [])[0] ?? '', live: true };
}
function autoWeather() {
  const city = S.profile.city, w = S.profile.weather;
  if (!city || (w && w.date === todayISO() && w.live && w.city)) return;
  liveWeather(city).then(x => saveProfile({ weather: x })).catch(() => {});
}

/* backup */
async function importBackup(file) {
  const j = JSON.parse(await file.text());
  if (!j || !j.docs) throw new Error('format');
  const map = {};
  for (const [old, dataUrl] of Object.entries(j.images || {})) {
    const blob = await (await fetch(dataUrl)).blob();
    const r = await assets.upload(blob); map[old] = r.id;
  }
  const fix = o => { if (o && o.imgId && map[o.imgId]) o.imgId = map[o.imgId]; return o; };
  let n = 0;
  for (const col of ['garments', 'looks', 'inspo', 'trips', 'tryons']) for (const d of j.docs[col] || []) { await put(col, fix({ ...d })); n++; }
  if (j.docs.profile) { const p = { ...j.docs.profile }; if (p.photos) p.photos = p.photos.map(fix); await saveProfile(p); }
  return n;
}
async function exportBackup() {
  const docs = {}; for (const col of ['garments', 'looks', 'inspo', 'trips', 'tryons']) docs[col] = S[col];
  docs.profile = S.profile;
  await downloads.save({ filename: `the-edit-backup-${todayISO()}.json`, data: new Blob([JSON.stringify({ version: 1, docs, images: {} }, null, 1)], { type: 'application/json' }) });
}

/* gate: setup + sign in */
function renderGate() {
  $('#nav').innerHTML = ''; $('#nav2').innerHTML = ''; $('#botnav').innerHTML = ''; $('#banner').innerHTML = '';
  $('#main').innerHTML = S.mode === 'setup'
    ? `<div class="gate"><p class="muted">Add your Supabase project URL and key to <b>config.js</b> to finish setting up. The steps are in LEEME.md.</p></div>`
    : S.mode === 'connecting' ? `<div class="gate"><p class="muted">Opening…</p></div>`
    : `<form class="gate" id="authForm" novalidate>
        <p class="muted">Get dressed, thoughtfully.</p>
        <div class="field"><label for="auEmail">Email</label><input class="inp" id="auEmail" type="email" autocomplete="email" required></div>
        <div class="field"><label for="auPass">Password</label><input class="inp" id="auPass" type="password" autocomplete="current-password" minlength="8" required></div>
        <button class="btn primary" data-a="signIn" type="submit">Sign in</button>
        <button class="btn ghost" data-a="signUp" type="button">Create my account</button>
        <p class="small muted" id="auMsg" role="status">${esc(S.authMsg || '')}</p>
      </form>`;
}
async function doAuth(kind) {
  const email = ($('#auEmail') || {}).value || '', password = ($('#auPass') || {}).value || '';
  const msg = t => { S.authMsg = t; const m = $('#auMsg'); if (m) m.textContent = t; };
  if (!email || password.length < 8) { msg('Enter your email and a password of at least 8 characters.'); return; }
  msg(kind === 'up' ? 'Creating your account…' : 'Signing in…');
  const { data, error } = kind === 'up' ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
  if (error) { msg(kind === 'up' && /not allowed|disabled/i.test(error.message) ? 'New accounts are switched off for this app.' : error.message); return; }
  if (!data.session) { msg('Check your email and confirm your address, then sign in here.'); return; }
  S.authMsg = ''; start(data.session.user);
}
document.addEventListener('submit', e => { if (e.target.id === 'authForm') { e.preventDefault(); doAuth('in'); } });

/* ============ boot ============ */
function start(user) {
  UID = user.id; S.user = { email: user.email };
  db = makeDb(); assets = makeAssets(); sample = makeSample(); downloads = makeDownloads();
  S.mode = 'live'; S.imgMax = 8;
  subscribe(); render();
}
async function boot() {
  const cfg = window.EDIT_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || /YOUR-|your-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) { S.mode = 'setup'; renderGate(); return; }
  S.mode = 'connecting'; renderGate();
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
  const { data: { session } } = await sb.auth.getSession();
  if (session) start(session.user); else { S.mode = 'auth'; renderGate(); }
}
boot();
