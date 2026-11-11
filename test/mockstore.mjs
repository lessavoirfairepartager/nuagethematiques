// Faux magasin Blobs en mémoire, avec ETag, pour tester l'API sans Netlify.
export function mockStore() {
  const m = new Map(); let n = 0;
  return {
    async getWithMetadata(k) { const e = m.get(k); return e ? { data: JSON.parse(e.v), etag: e.etag, metadata: {} } : null; },
    async setJSON(k, v, o = {}) {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      const e = m.get(k);
      if (o.onlyIfNew && e) return { modified: false };
      if (o.onlyIfMatch && (!e || e.etag !== o.onlyIfMatch)) return { modified: false };
      const etag = 'e' + ++n; m.set(k, { v: JSON.stringify(v), etag }); return { modified: true, etag };
    },
    async delete(k) { m.delete(k); },
  };
}
