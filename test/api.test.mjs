import assert from 'node:assert/strict';
import handler, { __setStore } from '../netlify/functions/api.mjs';
import { mockStore } from './mockstore.mjs';
__setStore(mockStore());

const post = async (route, body) => { const r = await handler(new Request('http://x/api/' + route, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
const get = async (route, q) => { const r = await handler(new Request('http://x/api/' + route + '?' + new URLSearchParams(q))); return { status: r.status, ...(await r.json()) }; };

const { code: s, key: k } = await post('create', { title: 'Test', themes: ['Différenciation', 'Motivation', 'différenciation'] });
assert.match(s, /^[A-Z2-9]{5}$/);
let st = await get('state', { s, c: 'anim', k });
assert.equal(st.themes.length, 2, 'doublon de thème ignoré');
const [T1, T2] = st.themes.map((t) => t.id);

// 12 participants envoient 3 phrases en même temps : aucune ne doit se perdre
const sends = [];
for (let p = 0; p < 12; p++) for (let i = 0; i < 3; i++) sends.push(post('act', { s, c: 'p' + p, action: 'addContribution', text: `Phrase ${p}-${i}`, themes: i === 0 ? [T1, T2] : [T1], newThemes: i === 2 ? ['Gestion de classe'] : [] }));
const out = await Promise.all(sends);
assert.ok(out.every((o) => o.status === 200), 'toutes les écritures concurrentes passent');
st = await get('state', { s, c: 'anim', k });
assert.equal(st.total, 36); assert.equal(st.contributions.length, 36);
assert.equal(st.themes.length, 3, 'thème proposé 12 fois créé une seule fois');
assert.equal(st.counts[T1], 36); assert.equal(st.counts[T2], 12);

// un participant ne voit que ses phrases pendant la collecte, et jamais la clé
let p0 = await get('state', { s, c: 'p0' });
assert.equal(p0.contributions.length, 3); assert.equal(p0.total, 36); assert.equal(p0.admin, false);
assert.ok(!JSON.stringify(p0).includes(k)); assert.equal(p0.results, null);
assert.equal((await get('state', { s, c: 'p0', v: p0.version })).unchanged, true);
assert.equal((await get('state', { s, c: 'p0', k: 'faux' })).status, 403);

// droits
const other = st.contributions.find((c) => !c.text.startsWith('Phrase 0-')).id;
assert.equal((await post('act', { s, c: 'p0', action: 'deleteContribution', id: other })).status, 403);
assert.equal((await post('act', { s, c: 'p0', action: 'setPhase', phase: 'vote' })).status, 403);
assert.equal((await post('act', { s, c: 'p0', action: 'addNeed', text: 'trop tôt' })).status, 403);

// phase besoins : thème majoritaire retenu, phrases du thème visibles par tous
st = await post('act', { s, c: 'anim', k, action: 'setPhase', phase: 'besoins' });
assert.equal(st.selectedTheme, T1);
p0 = await get('state', { s, c: 'p0' });
assert.equal(p0.contributions.length, 36);
assert.equal((await post('act', { s, c: 'p0', action: 'addContribution', text: 'trop tard' })).status, 400);
await post('act', { s, c: 'p0', action: 'addNeed', text: 'Outils pour différencier' });
await post('act', { s, c: 'p1', action: 'addNeed', text: 'outils pour différencier' });
st = await post('act', { s, c: 'p1', action: 'addNeed', text: 'Banque d’exercices à niveaux' });
assert.equal(st.needs.length, 2, 'besoin en double ignoré');
const [N1, N2] = st.needs.map((n) => n.id);

// fusion de thèmes
st = await post('act', { s, c: 'anim', k, action: 'mergeTheme', from: T2, into: T1 });
assert.equal(st.themes.length, 2); assert.equal(st.counts[T1], 36);
assert.equal((await post('act', { s, c: 'anim', k, action: 'renameTheme', id: T1, name: 'gestion de classe' })).status, 400);

// vote
assert.equal((await post('act', { s, c: 'p0', action: 'vote', needIds: [N1] })).status, 403);
await post('act', { s, c: 'anim', k, action: 'setMaxVotes', maxVotes: 1 });
await post('act', { s, c: 'anim', k, action: 'setPhase', phase: 'vote' });
assert.equal((await post('act', { s, c: 'p0', action: 'vote', needIds: [N1, N2] })).status, 400);
await Promise.all([...Array(12)].map((_, p) => post('act', { s, c: 'p' + p, action: 'vote', needIds: [p < 8 ? N1 : N2] })));
await post('act', { s, c: 'p0', action: 'vote', needIds: [N2] }); // change d'avis : ne compte qu'une fois
p0 = await get('state', { s, c: 'p0' });
assert.equal(p0.results, null, 'résultats cachés aux participants pendant le vote'); assert.deepEqual(p0.myVote, [N2]);
st = await get('state', { s, c: 'anim', k });
assert.deepEqual(st.results, { [N1]: 7, [N2]: 5 }); assert.equal(st.voters, 12);

// bilan + export + suppression
await post('act', { s, c: 'anim', k, action: 'setObjective', text: 'Construire une séance différenciée' });
await post('act', { s, c: 'anim', k, action: 'setPhase', phase: 'bilan' });
p0 = await get('state', { s, c: 'p0' });
assert.equal(p0.results[N1], 7); assert.equal(p0.objective, 'Construire une séance différenciée');
assert.equal((await get('export', { s, k: 'x' })).status, 403);
const ex = await get('export', { s, k });
assert.ok(!JSON.stringify(ex).includes('author') && !JSON.stringify(ex).includes(k) && !('votes' in ex));
assert.equal((await post('act', { s, c: 'p0', action: 'deleteSession' })).status, 403);
await post('act', { s, c: 'anim', k, action: 'deleteSession' });
assert.equal((await get('state', { s, c: 'p0' })).status, 404);
console.log('OK — tous les tests API passent');
