#!/usr/bin/env node
// wiki-thread — turn an Obsidian vault into a Threads-style feed.
// Zero dependencies. Run:  node server.js [vaultDir] [port]
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const VAULT = path.resolve(process.argv[2] || path.join(__dirname, 'vault'));
const PORT = Number(process.argv[3] || 4173);
const PUBLIC = path.join(__dirname, 'public');
const STATE_DIR = path.join(VAULT, '.wiki-thread');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

// ---------- state sidecar (views etc. — keeps the .md files clean) ----------
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { views: {} }; }
}
function saveState(s) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
  catch (e) { console.error('state save failed', e.message); }
}
let STATE = loadState();

// ---------- parsing ----------
const STOP = new Set(('a an the and or but if then of to in on at for with by from as is are was were be been being it its this that these those you your i we he she they them not no so do does did just can will would your about into out up down over under more most than'.split(' ')));

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      fm[k] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      fm[k] = v.replace(/^["']|["']$/g, '');
    }
  }
  return { fm, body: m[2] };
}

function idFromLink(target) {
  return decodeURIComponent(target).replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\.?\//, '');
}

function extractEdges(body) {
  const links = new Set(), mentions = new Set(), tags = new Set();
  let m;
  const mdLink = /\[[^\]]*\]\(([^)]+\.md)\)/g;
  while ((m = mdLink.exec(body))) links.add(idFromLink(m[1]));
  const wiki = /\[\[([^\]|#]+)(?:[^\]]*)?\]\]/g;
  while ((m = wiki.exec(body))) links.add(idFromLink(m[1].trim()));
  const at = /(^|[^\w/])@([a-z0-9][a-z0-9-]*)/gi;
  while ((m = at.exec(body))) mentions.add(m[2].toLowerCase());
  const tag = /(^|[^\w])#([a-z0-9][a-z0-9-]*)/gi;
  while ((m = tag.exec(body))) tags.add(m[2].toLowerCase());
  return { links: [...links], mentions: [...mentions], tags: [...tags] };
}

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter(w => w.length > 2 && !STOP.has(w));
}

// ---------- index ----------
let INDEX = {};   // id -> record
let IDF = {};     // term -> idf

function walk(dir, base) {
  let out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) out = out.concat(walk(full, rel));
    else if (name.endsWith('.md')) out.push({ full, rel });
  }
  return out;
}

function buildIndex() {
  const idx = {};
  let files = [];
  try { files = walk(VAULT, ''); } catch { files = []; }
  for (const { full, rel } of files) {
    const raw = fs.readFileSync(full, 'utf8');
    const { fm, body } = parseFrontmatter(raw);
    const id = rel.replace(/\.md$/i, '');
    const st = fs.statSync(full);
    const edges = extractEdges(body);
    const fmTags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []);
    const tags = [...new Set([...fmTags, ...edges.tags].map(t => String(t).toLowerCase()))];
    idx[id] = {
      id,
      file: full,
      author: fm.author || 'You',
      time: fm.time || st.mtime.toISOString(),
      title: fm.title || '',
      text: body.trim(),
      tags,
      links: edges.links,
      mentions: edges.mentions,
      tf: termFreq(body + ' ' + (fm.title || '') + ' ' + tags.join(' ')),
    };
  }
  // resolve @mentions to ids when a note's basename matches
  for (const r of Object.values(idx)) {
    r.mentions = r.mentions.map(slug => {
      const hit = Object.keys(idx).find(id => id.split('/').pop().toLowerCase() === slug);
      return hit || slug;
    });
    r.links = r.links.filter(id => idx[id]); // keep only resolvable links as replies
  }
  INDEX = idx;
  computeIdf();
  buildInverted();
}

// ---------- full-text inverted index ----------
let INVERTED = {};   // token -> Set(id)
let TOKENS = [];     // sorted unique tokens (for prefix lookup)
function buildInverted() {
  INVERTED = {};
  const set = new Set();
  for (const r of Object.values(INDEX)) {
    const toks = new Set(tokenize((r.title || '') + ' ' + r.text + ' ' + r.tags.join(' ') + ' ' + r.author + ' ' + r.id.replace(/[-/]/g, ' ')));
    for (const t of toks) { (INVERTED[t] = INVERTED[t] || new Set()).add(r.id); set.add(t); }
  }
  TOKENS = [...set].sort();
}
function countOcc(h, n) { if (!n) return 0; let c = 0, i = 0; while ((i = h.indexOf(n, i)) >= 0) { c++; i += n.length; } return c; }

function search(rawq) {
  const q = (rawq || '').trim();
  const all = Object.values(INDEX);
  if (!q) return all.slice().sort((a, b) => +new Date(b.time) - +new Date(a.time)).slice(0, 30).map(r => brief(r, []));
  const tagFilters = [], terms = [];
  for (const tok of q.toLowerCase().split(/\s+/)) {
    if (tok.startsWith('#') && tok.length > 1) tagFilters.push(tok.slice(1));
    else if (tok) terms.push(tok);
  }
  // candidate retrieval via inverted index (exact + prefix token match)
  let candIds;
  if (!terms.length) candIds = all.map(r => r.id);
  else {
    const ids = new Set();
    for (const term of terms) for (const tok of TOKENS) if (tok.startsWith(term)) for (const id of INVERTED[tok]) ids.add(id);
    // also catch substring matches in title/author/id that aren't whole tokens
    for (const r of all) {
      const hay = (r.title + ' ' + r.author + ' ' + r.id).toLowerCase();
      if (terms.some(t => hay.includes(t))) ids.add(r.id);
    }
    candIds = [...ids];
  }
  const scored = [];
  for (const id of candIds) {
    const r = INDEX[id]; if (!r) continue;
    if (tagFilters.length && !tagFilters.every(t => r.tags.some(x => x.includes(t)))) continue;
    const title = (r.title || '').toLowerCase(), body = r.text.toLowerCase(), author = r.author.toLowerCase(), rid = r.id.toLowerCase();
    let score = 0, matched = 0;
    for (const term of terms) {
      let hit = false;
      if (title.includes(term)) { score += 8; hit = true; }
      if (rid.includes(term)) { score += 4; hit = true; }
      if (author.includes(term)) { score += 4; hit = true; }
      if (r.tags.some(t => t.includes(term))) { score += 3; hit = true; }
      const bc = countOcc(body, term); if (bc) { score += Math.min(6, bc * 2); hit = true; }
      if (hit) matched++;
    }
    if (!terms.length) { score = 1; matched = 1; }              // tag-only query
    if (terms.length && matched === 0) continue;
    if (terms.length && matched < terms.length) score *= 0.4;   // partial match, downweight
    scored.push({ r, score, matched });
  }
  scored.sort((a, b) => b.matched - a.matched || b.score - a.score || +new Date(b.r.time) - +new Date(a.r.time));
  return scored.slice(0, 30).map(x => brief(x.r, terms));
}
function brief(r, terms) {
  return { id: r.id, title: r.title || r.id.split('/').pop(), author: r.author,
    tags: r.tags.filter(t => !['liked', 'saved', 'reposted'].includes(t)), snippet: snippet(r.text, terms), time: r.time };
}
function snippet(text, terms) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!terms.length) return clean.slice(0, 140);
  const low = clean.toLowerCase();
  let pos = -1;
  for (const t of terms) { const i = low.indexOf(t); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
  if (pos < 0) return clean.slice(0, 140);
  const start = Math.max(0, pos - 50);
  let s = clean.slice(start, start + 160);
  if (start > 0) s = '…' + s;
  if (start + 160 < clean.length) s += '…';
  return s;
}

function termFreq(text) {
  const tf = {};
  for (const w of tokenize(text)) tf[w] = (tf[w] || 0) + 1;
  return tf;
}
function computeIdf() {
  const N = Object.keys(INDEX).length || 1;
  const df = {};
  for (const r of Object.values(INDEX)) for (const w of Object.keys(r.tf)) df[w] = (df[w] || 0) + 1;
  IDF = {};
  for (const w of Object.keys(df)) IDF[w] = Math.log(1 + N / df[w]);
}
function vec(r) {
  const v = {};
  for (const w of Object.keys(r.tf)) v[w] = r.tf[w] * (IDF[w] || 0);
  return v;
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const w in a) { na += a[w] * a[w]; if (b[w]) dot += a[w] * b[w]; }
  for (const w in b) nb += b[w] * b[w];
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// ---------- feed shaping ----------
function handleOf(author) {
  return '@' + (author.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'you');
}
function toPost(r) {
  return {
    id: r.id,
    author: r.author,
    handle: handleOf(r.author),
    time: r.time,
    title: r.title,
    text: r.text,
    tags: r.tags,
    liked: r.tags.includes('liked'),
    reposted: r.tags.includes('reposted'),
    saved: r.tags.includes('saved'),
    replyCount: r.links.length,
    mentions: r.mentions,
    views: STATE.views[r.id] || 0,
  };
}

function rankForYou() {
  const all = Object.values(INDEX);
  const liked = all.filter(r => r.tags.includes('liked'));
  if (!liked.length) return all.slice().sort((a, b) => +new Date(b.time) - +new Date(a.time)); // cold start: recency
  // centroid of liked vectors
  const centroid = {};
  for (const r of liked) { const v = vec(r); for (const w in v) centroid[w] = (centroid[w] || 0) + v[w]; }
  const likedTags = new Set(liked.flatMap(r => r.tags));
  const likedIds = new Set(liked.map(r => r.id));
  return all.map(r => {
    let score = cosine(vec(r), centroid);
    const shared = r.tags.filter(t => likedTags.has(t) && t !== 'liked').length;
    score += 0.15 * shared;                                  // tag overlap bonus
    if (r.links.some(id => likedIds.has(id)) || liked.some(l => l.links.includes(r.id))) score += 0.2; // link adjacency
    if (likedIds.has(r.id)) score += 0.05;                   // keep faves around
    return { r, score };
  }).sort((a, b) => b.score - a.score).map(x => x.r);
}

function feed(tab) {
  const list = tab === 'following'
    ? Object.values(INDEX).slice().sort((a, b) => +new Date(b.time) - +new Date(a.time))
    : rankForYou();
  return list.map(toPost);
}

function thread(id) {
  const r = INDEX[id];
  if (!r) return null;
  return { post: toPost(r), replies: r.links.map(cid => INDEX[cid]).filter(Boolean).map(toPost) };
}

// ---------- writes ----------
function rewriteTags(r, newTags) {
  const raw = fs.readFileSync(r.file, 'utf8');
  const { fm, body } = parseFrontmatter(raw);
  fm.tags = newTags;
  let head = '---\n';
  const order = ['author', 'time', 'title', 'tags'];
  const keys = [...new Set([...order.filter(k => fm[k] != null), ...Object.keys(fm)])];
  for (const k of keys) {
    const v = fm[k];
    head += `${k}: ${Array.isArray(v) ? '[' + v.join(', ') + ']' : v}\n`;
  }
  head += '---\n';
  fs.writeFileSync(r.file, head + body.replace(/^\n*/, '') + (body.endsWith('\n') ? '' : '\n'));
}

function toggleTag(id, tag, on) {
  const r = INDEX[id]; if (!r) return null;
  const base = new Set(r.tags);
  if (on) base.add(tag); else base.delete(tag);
  rewriteTags(r, [...base]);
  buildIndex();
  return INDEX[id];
}

function repost(id) {
  const r = INDEX[id]; if (!r) return null;
  const on = !r.tags.includes('reposted');
  toggleTag(id, 'reposted', on);
  // also drop a line into a running repost log note
  const logFile = path.join(VAULT, 'reposts.md');
  if (on) {
    if (!fs.existsSync(logFile)) {
      fs.writeFileSync(logFile, `---\nauthor: You\ntime: ${new Date().toISOString()}\ntags: [log]\n---\nNotes I reposted to resurface later.\n\n`);
    }
    fs.appendFileSync(logFile, `[${r.title || r.id}](${path.basename(r.file)})\n`);
  }
  buildIndex();
  return INDEX[id];
}

function newPost(text, author) {
  const ts = new Date();
  const base = text.trim().split(/\s+/).slice(0, 5).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'note';
  const dir = path.join(VAULT, 'posts');
  fs.mkdirSync(dir, { recursive: true });
  const id = 'posts/' + base + '-' + ts.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  fs.writeFileSync(path.join(VAULT, id + '.md'), `---\nauthor: ${author || 'You'}\ntime: ${ts.toISOString()}\ntags: [post]\n---\n${text}\n`);
  buildIndex();
  return toPost(INDEX[id]);
}

function reply(parentId, text, author) {
  const p = INDEX[parentId]; if (!p) return null;
  const ts = new Date();
  const slug = 'reply-' + ts.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const dir = path.join(VAULT, 'replies');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug + '.md');
  fs.writeFileSync(file, `---\nauthor: ${author || 'You'}\ntime: ${ts.toISOString()}\ntags: [reply]\n---\n${text}\n`);
  // append the link into the parent so the new note threads under it
  const relFromParent = path.relative(path.dirname(p.file), file).split(path.sep).join('/');
  fs.appendFileSync(p.file, `\n[${text.slice(0, 40).replace(/\n/g, ' ')}…](${relFromParent})\n`);
  buildIndex();
  return toPost(INDEX['replies/' + slug]);
}

// ---------- http ----------
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise(resolve => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    if (p === '/' || p === '/index.html') return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), 'text/html; charset=utf-8');
    if (p.startsWith('/vault/')) {
      const fp = path.normalize(path.join(VAULT, decodeURIComponent(p.slice(7))));
      if (!fp.startsWith(VAULT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res, 404, { error: 'not found' });
      const MT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
      return send(res, 200, fs.readFileSync(fp), MT[path.extname(fp).toLowerCase()] || 'application/octet-stream');
    }
    if (p === '/api/meta') return send(res, 200, { vault: path.basename(VAULT) });
    if (p === '/api/feed') return send(res, 200, { posts: feed(u.searchParams.get('tab') || 'foryou') });
    if (p.startsWith('/api/note/')) { const t = thread(decodeURIComponent(p.slice(10))); return t ? send(res, 200, t) : send(res, 404, { error: 'not found' }); }
    if (p === '/api/search') return send(res, 200, { hits: search(u.searchParams.get('q')) });
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (p === '/api/like') { const r = toggleTag(b.id, 'liked', !!b.liked); return r ? send(res, 200, toPost(r)) : send(res, 404, {}); }
      if (p === '/api/save') { const r = toggleTag(b.id, 'saved', !!b.saved); return r ? send(res, 200, toPost(r)) : send(res, 404, {}); }
      if (p === '/api/repost') { const r = repost(b.id); return r ? send(res, 200, toPost(r)) : send(res, 404, {}); }
      if (p === '/api/reply') { const r = reply(b.parentId, b.text || '', b.author); return r ? send(res, 200, r) : send(res, 404, {}); }
      if (p === '/api/post') { const r = newPost(b.text || '', b.author); return r ? send(res, 200, r) : send(res, 400, {}); }
      if (p === '/api/view') { if (INDEX[b.id]) { STATE.views[b.id] = (STATE.views[b.id] || 0) + 1; saveState(STATE); } return send(res, 200, { views: STATE.views[b.id] || 0 }); }
    }
    // SPA fallback: deep links like /@author/post/<id>[/media] serve the app
    if (req.method === 'GET' && !p.startsWith('/api')) return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), 'text/html; charset=utf-8');
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.message });
  }
});

// ---------- boot ----------
buildIndex();
let watchTimer = null;
try {
  fs.watch(VAULT, { recursive: true }, () => { clearTimeout(watchTimer); watchTimer = setTimeout(buildIndex, 120); });
} catch { /* recursive watch unsupported — index still rebuilds on writes */ }
server.listen(PORT, () => {
  console.log(`\n  wiki-thread  ·  vault: ${VAULT}`);
  console.log(`  ${Object.keys(INDEX).length} notes indexed`);
  console.log(`  → http://localhost:${PORT}\n`);
});
