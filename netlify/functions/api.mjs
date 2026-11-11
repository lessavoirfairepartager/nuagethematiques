// Nuage de thématiques — API (Netlify Functions v2 + Netlify Blobs)
// Une séance = un seul blob JSON, écrit avec contrôle de concurrence (ETag).
import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';

export const config = { path: '/api/*' };

const PHASES = ['collecte', 'besoins', 'vote', 'bilan'];
const LIMITS = { text: 600, name: 60, contributions: 400, themes: 40, needs: 40, title: 100 };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1

let storeOverride = null; // utilisé uniquement par les tests locaux
export function __setStore(s) { storeOverride = s; }
const store = () => storeOverride || getStore({ name: 'nuage-thematiques', consistency: 'strong' });

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
class ApiError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const fail = (msg, status = 400) => { throw new ApiError(msg, status); };

const rid = (p) => p + randomBytes(5).toString('hex');
const code = () => Array.from(randomBytes(5), (b) => ALPHABET[b % ALPHABET.length]).join('');
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const same = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0;
const key = (c) => 'seance/' + c;

function themeCounts(s) {
  const counts = {};
  for (const t of s.themes) counts[t.id] = 0;
  for (const c of s.contributions) for (const id of c.themes) if (id in counts) counts[id]++;
  return counts;
}
function majorTheme(s) {
  const counts = themeCounts(s);
  let best = null;
  for (const t of s.themes) if (counts[t.id] > 0 && (!best || counts[t.id] > counts[best])) best = t.id;
  return best;
}
function tally(s) {
  const res = {};
  for (const n of s.needs) res[n.id] = 0;
  for (const ids of Object.values(s.votes)) for (const id of ids) if (id in res) res[id]++;
  return res;
}

// Ce que voit un client : jamais la clé animateur ni l'identité des auteurs.
function view(s, clientId, isAdmin) {
  const selected = s.selectedTheme || (s.phase !== 'collecte' ? majorTheme(s) : null);
  let contributions = s.contributions;
  if (!isAdmin) {
    contributions = s.phase === 'collecte'
      ? contributions.filter((c) => c.author === clientId)
      : contributions.filter((c) => c.author === clientId || (selected && c.themes.includes(selected)));
  }
  const showResults = isAdmin || s.phase === 'bilan';
  return {
    code: s.code, title: s.title, phase: s.phase, version: s.version, admin: isAdmin,
    themes: s.themes, counts: themeCounts(s), total: s.contributions.length,
    selectedTheme: selected,
    contributions: contributions.map((c) => ({ id: c.id, text: c.text, themes: c.themes, mine: c.author === clientId })),
    needs: s.needs.map((n) => ({ id: n.id, text: n.text, mine: n.author === clientId })),
    maxVotes: s.maxVotes, myVote: s.votes[clientId] || [], voters: Object.keys(s.votes).length,
    results: showResults ? tally(s) : null,
    objective: s.objective,
  };
}

const validThemes = (s, ids) => [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => s.themes.some((t) => t.id === id));
function addTheme(s, rawName) {
  const name = clean(rawName, LIMITS.name);
  if (!name) fail('Nom de thème vide.');
  const existing = s.themes.find((t) => same(t.name, name));
  if (existing) return existing;
  if (s.themes.length >= LIMITS.themes) fail('Nombre maximal de thèmes atteint.');
  const t = { id: rid('t'), name };
  s.themes.push(t);
  return t;
}

// Chaque action modifie la séance en place. Renvoie rien, ou lève une ApiError.
const ACTIONS = {
  addContribution(s, b, ctx) {
    if (s.phase !== 'collecte' && !ctx.admin) fail('La collecte est terminée.');
    const text = clean(b.text, LIMITS.text);
    if (!text) fail('Phrase vide.');
    if (s.contributions.length >= LIMITS.contributions) fail('Nombre maximal de contributions atteint.');
    const themes = validThemes(s, b.themes);
    for (const n of Array.isArray(b.newThemes) ? b.newThemes.slice(0, 3) : []) {
      const t = addTheme(s, n);
      if (!themes.includes(t.id)) themes.push(t.id);
    }
    s.contributions.push({ id: rid('c'), text, themes, author: ctx.client });
  },
  setThemes(s, b, ctx) {
    // Une fois la phrase envoyée, seul l'animateur peut modifier son classement.
    if (!ctx.admin) fail('Seul l’animateur peut modifier les thèmes d’une phrase envoyée.', 403);
    const c = s.contributions.find((x) => x.id === b.id) || fail('Contribution introuvable.', 404);
    c.themes = validThemes(s, b.themes);
  },
  deleteContribution(s, b, ctx) {
    const c = s.contributions.find((x) => x.id === b.id) || fail('Contribution introuvable.', 404);
    if (!ctx.admin && !(c.author === ctx.client && s.phase === 'collecte')) fail('Action non autorisée.', 403);
    s.contributions = s.contributions.filter((x) => x.id !== c.id);
  },
  addTheme(s, b, ctx) {
    if (!ctx.admin && s.phase !== 'collecte') fail('Action non autorisée.', 403);
    const t = addTheme(s, b.name);
    if (b.contributionId) {
      const c = s.contributions.find((x) => x.id === b.contributionId);
      if (c && ctx.admin && !c.themes.includes(t.id)) c.themes.push(t.id);
    }
  },
  addNeed(s, b, ctx) {
    if (!ctx.admin && s.phase !== 'besoins') fail('La formulation des besoins n’est pas ouverte.', 403);
    const text = clean(b.text, LIMITS.text);
    if (!text) fail('Besoin vide.');
    if (s.needs.length >= LIMITS.needs) fail('Nombre maximal de besoins atteint.');
    if (!s.needs.some((n) => same(n.text, text))) s.needs.push({ id: rid('n'), text, author: ctx.client });
  },
  deleteNeed(s, b, ctx) {
    const n = s.needs.find((x) => x.id === b.id) || fail('Besoin introuvable.', 404);
    if (!ctx.admin && !(n.author === ctx.client && s.phase === 'besoins')) fail('Action non autorisée.', 403);
    s.needs = s.needs.filter((x) => x.id !== n.id);
    for (const c of Object.keys(s.votes)) s.votes[c] = s.votes[c].filter((id) => id !== n.id);
  },
  vote(s, b, ctx) {
    if (s.phase !== 'vote') fail('Le vote n’est pas ouvert.', 403);
    const ids = [...new Set(Array.isArray(b.needIds) ? b.needIds : [])].filter((id) => s.needs.some((n) => n.id === id));
    if (ids.length > s.maxVotes) fail(`Maximum ${s.maxVotes} choix.`);
    if (ids.length) s.votes[ctx.client] = ids; else delete s.votes[ctx.client];
  },
};
const ADMIN_ACTIONS = {
  setPhase(s, b) {
    if (!PHASES.includes(b.phase)) fail('Phase inconnue.');
    s.phase = b.phase;
    if (b.phase !== 'collecte' && !s.selectedTheme) s.selectedTheme = majorTheme(s);
  },
  selectTheme(s, b) {
    if (b.id && !s.themes.some((t) => t.id === b.id)) fail('Thème introuvable.', 404);
    s.selectedTheme = b.id || null;
  },
  renameTheme(s, b) {
    const t = s.themes.find((x) => x.id === b.id) || fail('Thème introuvable.', 404);
    const name = clean(b.name, LIMITS.name);
    if (!name) fail('Nom de thème vide.');
    if (s.themes.some((x) => x.id !== t.id && same(x.name, name))) fail('Un thème porte déjà ce nom : utilise « Fusionner ».');
    t.name = name;
  },
  mergeTheme(s, b) {
    if (b.from === b.into) fail('Choisis deux thèmes différents.');
    const from = s.themes.find((x) => x.id === b.from) || fail('Thème introuvable.', 404);
    const into = s.themes.find((x) => x.id === b.into) || fail('Thème introuvable.', 404);
    for (const c of s.contributions) {
      if (c.themes.includes(from.id)) c.themes = [...new Set(c.themes.map((id) => (id === from.id ? into.id : id)))];
    }
    s.themes = s.themes.filter((x) => x.id !== from.id);
    if (s.selectedTheme === from.id) s.selectedTheme = into.id;
  },
  deleteTheme(s, b) {
    s.themes = s.themes.filter((x) => x.id !== b.id);
    for (const c of s.contributions) c.themes = c.themes.filter((id) => id !== b.id);
    if (s.selectedTheme === b.id) s.selectedTheme = null;
  },
  editNeed(s, b) {
    const n = s.needs.find((x) => x.id === b.id) || fail('Besoin introuvable.', 404);
    const text = clean(b.text, LIMITS.text);
    if (!text) fail('Besoin vide.');
    n.text = text;
  },
  setMaxVotes(s, b) {
    const n = Number(b.maxVotes);
    if (!Number.isInteger(n) || n < 1 || n > 5) fail('Nombre de choix invalide (1 à 5).');
    s.maxVotes = n;
    for (const c of Object.keys(s.votes)) s.votes[c] = s.votes[c].slice(0, n);
  },
  resetVotes(s) { s.votes = {}; },
  setObjective(s, b) { s.objective = clean(b.text, LIMITS.text); },
  setTitle(s, b) { s.title = clean(b.title, LIMITS.title) || s.title; },
};

async function loadSession(c) {
  if (!/^[A-Z2-9]{5}$/.test(c || '')) fail('Code de séance invalide.', 404);
  const res = await store().getWithMetadata(key(c), { type: 'json' });
  if (!res) fail('Séance introuvable.', 404);
  return { session: res.data, etag: res.etag };
}

async function create(b) {
  const required = globalThis.process?.env?.CREATE_PASSWORD;
  if (required && b.password !== required) fail('Mot de passe de création incorrect.', 403);
  const names = (Array.isArray(b.themes) ? b.themes : []).map((n) => clean(n, LIMITS.name)).filter(Boolean);
  const themes = [];
  for (const n of names.slice(0, LIMITS.themes)) if (!themes.some((t) => same(t.name, n))) themes.push({ id: rid('t'), name: n });
  for (let i = 0; i < 6; i++) {
    const s = {
      code: code(), key: randomBytes(9).toString('hex'), title: clean(b.title, LIMITS.title) || 'Nuage de thématiques',
      createdAt: new Date().toISOString(), phase: 'collecte', version: 1,
      themes, contributions: [], selectedTheme: null, needs: [], votes: {}, maxVotes: 2, objective: '',
    };
    const w = await store().setJSON(key(s.code), s, { onlyIfNew: true });
    if (w.modified) return json({ code: s.code, key: s.key });
  }
  fail('Impossible de créer la séance, réessaie.', 503);
}

async function act(b) {
  const client = clean(b.c, 40);
  if (!client) fail('Identifiant client manquant.');
  const fn = ACTIONS[b.action] || ADMIN_ACTIONS[b.action];
  if (!fn && b.action !== 'deleteSession') fail('Action inconnue.');
  for (let attempt = 0; attempt < 8; attempt++) {
    const { session: s, etag } = await loadSession(b.s);
    const admin = !!b.k && b.k === s.key;
    if ((ADMIN_ACTIONS[b.action] || b.action === 'deleteSession') && !admin) fail('Réservé à l’animateur.', 403);
    if (b.action === 'deleteSession') { await store().delete(key(s.code)); return json({ deleted: true }); }
    fn(s, b, { client, admin });
    s.version++;
    const w = await store().setJSON(key(s.code), s, { onlyIfMatch: etag });
    if (w.modified) return json(view(s, client, admin));
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120)); // un autre a écrit : on relit et on rejoue
  }
  fail('Serveur occupé, réessaie dans un instant.', 503);
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const route = url.pathname.replace(/^.*\/api\//, '');
    if (req.method === 'GET' && route === 'state') {
      const { session: s } = await loadSession(url.searchParams.get('s'));
      const admin = !!url.searchParams.get('k') && url.searchParams.get('k') === s.key;
      if (url.searchParams.get('k') && !admin) fail('Clé animateur incorrecte.', 403);
      if (Number(url.searchParams.get('v')) === s.version) return json({ unchanged: true, version: s.version });
      return json(view(s, clean(url.searchParams.get('c'), 40), admin));
    }
    if (req.method === 'GET' && route === 'export') {
      const { session: s } = await loadSession(url.searchParams.get('s'));
      if (url.searchParams.get('k') !== s.key) fail('Réservé à l’animateur.', 403);
      const { key: _k, votes, ...rest } = s;
      return json({ ...rest, contributions: s.contributions.map(({ author, ...c }) => c), needs: s.needs.map(({ author, ...n }) => n), results: tally(s), voters: Object.keys(votes).length });
    }
    if (req.method === 'POST') {
      let b;
      try { b = await req.json(); } catch { fail('Requête illisible.'); }
      if (route === 'create') return await create(b || {});
      if (route === 'act') return await act(b || {});
    }
    fail('Route inconnue.', 404);
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Erreur serveur.' }, 500);
  }
}
