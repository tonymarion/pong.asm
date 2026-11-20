// ==UserScript==
// @name         Vinted Fit
// @namespace    vinted-fit
// @version      0.2.0
// @description  Size/brand filtering, like/dislike voting with reasons, taste scoring, closet and outfit builder on top of vinted.com
// @match        https://www.vinted.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__vintedFit) return;
  window.__vintedFit = true;

  // ---------------------------------------------------------------- state
  const KEY = 'vintedFit.v1';
  const DEFAULTS = {
    sizes: { waist: ['29'], length: ['28', '29'], tops: ['S', 'M'], shoes: ['8.5', '41'] },
    brands: {
      liked: ['Hiroshi Kato', 'Mizzen+Main', 'Mizzen and Main', 'Rhone', 'Jordan', 'Oliver Cabell'],
      blocked: [
        'Goodfellow & Co', 'Goodfellow', 'Original Use', 'All in Motion', 'Mossimo', 'Merona',
        'Cat & Jack', 'Art Class', 'Xhilaration', 'C9 Champion', 'Target',
        'George', 'Time and Tru', 'No Boundaries', 'Athletic Works', 'Free Assembly', 'Faded Glory', 'Walmart',
      ],
      tooHigh: [],
    },
    votes: {},   // id -> { v: 1|-1, reasons: [], src, ts }
    stats: {},   // feature -> { l, d }
    items: {},   // id -> item
    outfits: [], // { id, name, pieces: [{ kind: 'vinted'|'own', id }] }
    feedSeenAt: 0,
  };
  let S = load();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      const s = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), raw);
      s.sizes = Object.assign({}, DEFAULTS.sizes, raw.sizes);
      s.brands = Object.assign({}, DEFAULTS.brands, raw.brands);
      return s;
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const ids = Object.keys(S.items);
      if (ids.length > 1500) { // keep voted / outfit items and the most recent rest
        const keep = new Set(S.outfits.flatMap(o => o.pieces.filter(p => p.kind === 'vinted').map(p => String(p.id))));
        ids.sort((a, b) => (S.items[a].seen || 0) - (S.items[b].seen || 0))
          .slice(0, ids.length - 1500)
          .forEach(id => { if (!keep.has(id)) delete S.items[id]; });
      }
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { console.warn('[vinted-fit] save failed', e); }
    }, 300);
  }

  // closet photos live in IndexedDB (too big for localStorage)
  const closet = {
    db: null,
    open() {
      return this.db || (this.db = new Promise((res, rej) => {
        const r = indexedDB.open('vintedFit', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('closet', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }));
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('closet', mode);
        const rq = fn(t.objectStore('closet'));
        t.oncomplete = () => res(rq && rq.result);
        t.onerror = () => rej(t.error);
      });
    },
    all() { return this.tx('readonly', s => s.getAll()).catch(() => []); },
    put(x) { return this.tx('readwrite', s => s.put(x)); },
    del(id) { return this.tx('readwrite', s => s.delete(id)); },
  };

  // ---------------------------------------------------------------- features
  const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['black', 'white', 'grey', 'gray', 'navy', 'blue', 'red', 'green', 'olive', 'brown', 'tan', 'khaki', 'beige', 'cream', 'pink', 'purple', 'yellow', 'orange', 'burgundy', 'maroon', 'charcoal', 'indigo'];
  const STYLE = ['graphic', 'cargo', 'slim', 'skinny', 'relaxed', 'baggy', 'distressed', 'ripped', 'logo', 'striped', 'plaid', 'floral', 'camo', 'linen', 'denim', 'leather', 'suede', 'polo', 'hoodie', 'flannel', 'henley', 'selvedge', 'vintage', 'athletic', 'dress', 'tapered', 'straight', 'corduroy', 'knit', 'wool', 'cashmere', 'merino', 'pleated', 'oxford', 'chore', 'overshirt'];

  function typeOf(title) {
    const t = ' ' + String(title || '').toLowerCase() + ' ';
    if (/\b(pants?|jeans?|chinos?|trousers?|shorts|joggers?|denim|slacks|sweatpants)\b/.test(t)) return 'pants';
    if (/\b(t-?shirts?|shirts?|tees?|polos?|hoodies?|sweaters?|jackets?|henleys?|pullovers?|coats?|blazers?|vests?|tops?|crewnecks?|sweatshirts?|cardigans?)\b/.test(t)) return 'top';
    if (/\b(shoes?|sneakers?|boots?|loafers?|trainers?|sandals?|slides?|dunks?|runners?|jordans?|retro)\b/.test(t)) return 'shoes';
    return 'other';
  }
  function priceBucket(p) {
    if (p == null || isNaN(p)) return null;
    return p < 25 ? '<25' : p < 50 ? '25-50' : p < 100 ? '50-100' : p < 200 ? '100-200' : '200+';
  }
  function features(it) {
    const f = {};
    const title = String(it.title || '').toLowerCase();
    if (it.brand) f.brand = ['brand:' + norm(it.brand)];
    f.color = COLORS.filter(c => new RegExp('\\b' + c + '\\b').test(title)).map(c => 'color:' + (c === 'gray' ? 'grey' : c));
    f.style = STYLE.filter(k => new RegExp('\\b' + k).test(title)).map(k => 'kw:' + k);
    const pb = priceBucket(it.price);
    if (pb) f.price = ['price:' + pb];
    if (it.cond) f.condition = ['cond:' + norm(it.cond)];
    const ty = it.type || typeOf(it.title);
    f.type = ['type:' + ty];
    if (it.size) f.size = ['size:' + ty + ':' + norm(it.size)];
    return f;
  }
  const stat = k => S.stats[k] || (S.stats[k] = { l: 0, d: 0 });

  function brandIn(list, brand, exact) {
    const b = norm(brand);
    if (!b) return false;
    return list.some(x => { const n = norm(x); return n && (exact ? b === n : b.includes(n)); });
  }

  function score(it) {
    let s = 0;
    const f = features(it);
    for (const group of Object.keys(f)) {
      for (const k of f[group] || []) {
        const st = S.stats[k];
        if (st) s += Math.log((st.l + 1) / (st.d + 1)) * (group === 'brand' ? 1.5 : 1);
      }
    }
    if (brandIn(S.brands.liked, it.brand)) s += 2;
    return Math.round(s * 10) / 10;
  }

  // ---------------------------------------------------------------- size fit
  const up = a => a.map(x => String(x).trim().toUpperCase()).filter(Boolean);
  const LETTER = { SMALL: 'S', MEDIUM: 'M', LARGE: 'L', 'X-LARGE': 'XL', 'X-SMALL': 'XS', '2XL': 'XXL' };
  function letters(sz) {
    const out = [];
    String(sz).toUpperCase().replace(/X-?(SMALL|LARGE)/g, m => m.replace('-', '')).split(/[^A-Z0-9]+/).forEach(tok => {
      tok = LETTER[tok] || tok;
      if (/^(X{0,3}S|M|X{0,3}L)$/.test(tok)) out.push(tok);
    });
    return out;
  }
  /** true = fits, false = confidently wrong size, null = can't tell (never hidden) */
  function sizeFits(it) {
    const sz = String(it.size || '').trim();
    if (!sz) return null;
    const ty = it.type || typeOf(it.title);
    const nums = (sz.match(/\d+(\.\d+)?/g) || []);
    const tops = up(S.sizes.tops);
    if (ty === 'shoes') {
      const mine = up(S.sizes.shoes);
      if (!nums.length || !mine.length) return null;
      return nums.some(n => mine.includes(String(parseFloat(n))));
    }
    if (ty === 'pants') {
      const waist = up(S.sizes.waist), len = up(S.sizes.length);
      const wn = nums.filter(n => +n >= 24 && +n <= 50);
      if (wn.length && waist.length) {
        if (!waist.includes(String(parseFloat(wn[0])))) return false;
        if (wn.length > 1 && len.length && !len.includes(String(parseFloat(wn[1])))) return false;
        return true;
      }
      const ls = letters(sz);
      if (ls.length && tops.length) return ls.some(l => tops.includes(l));
      return null;
    }
    if (ty === 'top') {
      const ls = letters(sz);
      if (!ls.length || !tops.length) return null;
      return ls.some(l => tops.includes(l));
    }
    return null;
  }

  /** returns a reason string if the item should be hidden, else '' */
  function hiddenWhy(it) {
    const v = S.votes[it.id];
    if (v && v.v < 0) return 'disliked';
    if (brandIn(S.brands.blocked, it.brand, true)) return 'blocked brand';
    if (brandIn(S.brands.tooHigh, it.brand, true)) return 'too high end';
    if (sizeFits(it) === false) return 'wrong size';
    return '';
  }

  // ---------------------------------------------------------------- style profile
  let closetCache = [], famCache = null;
  const ownItem = c => ({ id: c.id, title: c.name + ' ' + (c.color || ''), type: c.type || typeOf(c.name) });
  /** how familiar each attribute is: pieces you own + items you liked */
  function fam() {
    if (famCache) return famCache;
    const own = {}, like = {}, titles = [];
    closetCache.forEach(c => { titles.push(ownItem(c).title.toLowerCase()); Object.values(features(ownItem(c))).flat().forEach(k => { own[k] = (own[k] || 0) + 1; }); });
    const prices = [];
    Object.keys(S.votes).forEach(id => {
      const v = S.votes[id], it = S.items[id];
      if (v.v <= 0 || !it) return;
      titles.push(String(it.title || '').toLowerCase());
      if (it.price != null) prices.push(it.price);
      Object.values(features(it)).flat().forEach(k => { like[k] = (like[k] || 0) + 1; });
    });
    prices.sort((a, b) => a - b);
    return (famCache = { own, like, titles, prices, total: titles.length, n: k => (own[k] || 0) + (like[k] || 0) });
  }
  const rejected = k => { const s = S.stats[k]; return !!s && s.d > s.l; };
  // a point of view on a versatile wardrobe: core pieces first, then pieces that push further
  const ESSENTIALS = [
    [1, 'Dark indigo jeans', 'dark selvedge jeans', /jeans|denim/],
    [1, 'White leather sneakers', 'white leather sneakers', /white.*(sneaker|low|trainer)|(sneaker|trainer).*white/],
    [1, 'Chinos in tan or olive', 'chinos', /chino/],
    [1, 'Oxford button-down', 'oxford button down shirt', /oxford/],
    [1, 'Fine-knit sweater', 'merino crewneck sweater', /sweater|merino|cashmere|crewneck/],
    [1, 'Leather or suede boots', 'suede chukka boots', /chukka|chelsea|boots?\b/],
    [2, 'Overshirt / chore jacket', 'overshirt', /overshirt|chore|shacket/],
    [2, 'Unstructured blazer', 'unstructured blazer', /blazer|sport ?coat/],
    [2, 'Knit polo', 'knit polo', /knit.*polo|polo.*knit|sweater polo/],
    [2, 'Loafers', 'leather loafers', /loafer/],
    [2, 'Linen shirt', 'linen shirt', /linen/],
    [2, 'Pleated or relaxed trousers', 'pleated trousers', /pleat|trousers?/],
    [2, 'Suede or leather jacket', 'suede jacket', /(suede|leather).*(jacket|bomber)/],
  ];
  const gaps = () => { const t = fam().titles; return ESSENTIALS.filter(e => !t.some(x => e[3].test(x))); };
  const EXPAND = ['olive', 'burgundy', 'cream', 'brown', 'tan', 'green', 'charcoal', 'beige', 'khaki', 'maroon'];
  const TEXTURE = ['suede', 'linen', 'corduroy', 'knit', 'wool', 'cashmere', 'merino', 'flannel', 'leather', 'pleated', 'selvedge'];
  /** reasons an item would stretch the user's style; [] if it is inside the comfort zone or low quality */
  function stretchWhy(it) {
    const F = fam(), st = it.brand ? S.stats['brand:' + norm(it.brand)] : null;
    const quality = brandIn(S.brands.liked, it.brand) || (st && st.l > st.d) || (it.price != null && it.price >= 30);
    if (!quality || !it.title) return [];
    const f = features(it), why = [], title = it.title.toLowerCase();
    if (F.total >= 3) {
      (f.color || []).forEach(k => { const c = k.slice(6); if (EXPAND.includes(c) && !F.n(k) && !rejected(k)) why.push('New color: ' + c); });
      (f.style || []).forEach(k => { const w = k.slice(3); if (TEXTURE.includes(w) && !F.n(k) && !rejected(k)) why.push('New texture: ' + w); });
    }
    const g = gaps().find(e => e[3].test(title));
    if (g) why.push('Missing piece: ' + g[1]);
    return why;
  }
  const PALETTE = { black: [20, 20, 20], white: [240, 240, 240], grey: [128, 128, 128], charcoal: [55, 55, 60], navy: [25, 35, 70], blue: [50, 90, 180], red: [190, 30, 40], burgundy: [110, 20, 40], green: [40, 130, 60], olive: [95, 100, 50], brown: [100, 65, 40], tan: [200, 170, 130], cream: [230, 220, 195], pink: [235, 160, 180], purple: [110, 60, 150], yellow: [235, 205, 60], orange: [230, 120, 40] };
  function photoColor(cv) {
    try {
      const w = cv.width, hh = cv.height, d = cv.getContext('2d').getImageData(w * 0.3, hh * 0.3, w * 0.4, hh * 0.4).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      r /= n; g /= n; b /= n;
      return Object.keys(PALETTE).map(k => [Math.hypot(PALETTE[k][0] - r, PALETTE[k][1] - g, PALETTE[k][2] - b), k]).sort((a, b2) => a[0] - b2[0])[0][1];
    } catch (e) { return ''; }
  }
  const nameColor = name => { const c = COLORS.find(x => new RegExp('\\b' + x + '\\b', 'i').test(name)); return c === 'gray' ? 'grey' : c || ''; };

  // ---------------------------------------------------------------- voting
  const REASONS = [
    ['item', 'Just this one'], ['condition', 'Looks worn / not clean'], ['color', 'Color'],
    ['style', 'Style / cut'], ['size', 'Size / fit'], ['price', 'Price'], ['brand', 'The brand'],
  ];
  function applyVote(it, v, reasons, src, undo) {
    const sign = undo ? -1 : 1;
    const f = features(it);
    if (v > 0) {
      Object.values(f).flat().forEach(k => { stat(k).l = Math.max(0, stat(k).l + sign * (src === 'offer' ? 3 : 1)); });
    } else {
      // a dislike only counts against the attributes the user blamed
      (reasons || []).forEach(r => (f[r] || []).forEach(k => { stat(k).d = Math.max(0, stat(k).d + sign); }));
    }
  }
  function vote(it, v, reasons, src) {
    const prev = S.votes[it.id];
    if (prev) applyVote(it, prev.v, prev.reasons, prev.src, true);
    S.items[it.id] = Object.assign(S.items[it.id] || {}, it);
    S.votes[it.id] = { v, reasons: reasons || [], src: src || 'vote', ts: Date.now() };
    applyVote(it, v, reasons, src);
    let msg = v > 0 ? 'Liked' : 'Hidden';
    // blaming a brand twice with no likes blocks it; brands you've liked are never auto-blocked
    if (v < 0 && (reasons || []).includes('brand') && it.brand) {
      const st = stat('brand:' + norm(it.brand));
      if (st.d >= 2 && st.l === 0 && !brandIn(S.brands.liked, it.brand) && !brandIn(S.brands.blocked, it.brand, true)) {
        S.brands.blocked.push(it.brand);
        msg = 'Hidden · ' + it.brand + ' is now blocked';
      }
    }
    save(); refresh();
    toast(msg, () => unvote(it.id));
  }
  function unvote(id) {
    const prev = S.votes[id], it = S.items[id];
    if (!prev) return;
    if (it) applyVote(it, prev.v, prev.reasons, prev.src, true);
    delete S.votes[id];
    save(); refresh();
  }

  // ---------------------------------------------------------------- capture
  function remember(it) {
    if (!it || !it.id) return;
    it.id = String(it.id);
    const old = S.items[it.id];
    const merged = Object.assign({ first: Date.now() }, old, Object.fromEntries(Object.entries(it).filter(([, v]) => v != null && v !== '')));
    merged.seen = Date.now();
    merged.type = typeOf(merged.title);
    S.items[it.id] = merged;
    return merged;
  }
  function fromApi(o) {
    const price = o.price && typeof o.price === 'object' ? o.price.amount : o.price;
    return {
      id: o.id, title: o.title, brand: o.brand_title || (o.brand_dto && o.brand_dto.title) || '',
      size: o.size_title || '', cond: o.status || '', price: price != null ? parseFloat(price) : null,
      img: (o.photo && o.photo.url) || (o.photos && o.photos[0] && o.photos[0].url) || '',
      url: o.url || o.path || '', seller: o.user && (o.user.login || o.user.id),
    };
  }
  function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, depth + 1)); return; }
    if (o.id && typeof o.title === 'string' && (o.photo || o.photos || o.price) && /\/items\//.test(String(o.url || o.path || ''))) {
      remember(fromApi(o));
      return;
    }
    Object.keys(o).forEach(k => walk(o[k], depth + 1));
  }
  // read the item JSON the site itself loads while you browse (no extra requests are made)
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      const p = origFetch.apply(this, arguments);
      try {
        const url = String(arguments[0] && arguments[0].url || arguments[0]);
        if (/\/api\/v2\/|\/web\/api\//.test(url)) {
          p.then(r => r.clone().json()).then(j => { walk(j, 0); save(); schedule(); }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      return p;
    };
  }
  /** "Title, brand: X, condition: Y, size: Z, $12.00, ..." (card link title / image alt) */
  function parseLabel(txt) {
    const out = {};
    if (!txt) return out;
    const g = (re) => { const m = txt.match(re); return m ? m[1].trim() : ''; };
    out.brand = g(/brand:\s*([^,]+)/i);
    out.cond = g(/condition:\s*([^,]+)/i);
    out.size = g(/size:\s*([^,]+?)(?=,\s*[$€£]|,\s*\d|$)/i);
    const pm = txt.match(/[$€£]\s?(\d+(?:[.,]\d{1,2})?)/);
    if (pm) out.price = parseFloat(pm[1].replace(',', '.'));
    out.title = txt.split(/,\s*brand:/i)[0].trim();
    return out;
  }

  // ---------------------------------------------------------------- page cards
  const idOf = href => { const m = String(href || '').match(/\/items\/(\d+)/); return m ? m[1] : null; };
  function cardFor(a, id) {
    const known = a.closest('[data-testid="grid-item"], .feed-grid__item, .new-item-box__container');
    if (known) return known;
    let el = a;
    for (let i = 0; i < 6 && el.parentElement && el.parentElement !== document.body; i++) {
      const p = el.parentElement;
      const others = Array.from(p.querySelectorAll('a[href*="/items/"]')).some(x => idOf(x.getAttribute('href')) !== id);
      if (others) break;
      el = p;
    }
    return el === a ? null : el;
  }
  function scan() {
    if (!document.body) return;
    const seenCards = new Set();
    document.querySelectorAll('a[href*="/items/"]').forEach(a => {
      if (a.closest('.vf-root')) return;
      const id = idOf(a.getAttribute('href'));
      if (!id) return;
      const card = cardFor(a, id);
      if (!card || seenCards.has(card)) return;
      seenCards.add(card);
      const img = card.querySelector('img');
      const label = [a.getAttribute('title'), img && img.getAttribute('alt'), a.getAttribute('aria-label')].find(t => t && /brand:|size:/i.test(t)) || (img && img.getAttribute('alt')) || '';
      const parsed = parseLabel(label);
      const it = remember(Object.assign({ id, url: a.getAttribute('href'), img: img ? (img.currentSrc || img.src) : '' }, parsed.title ? parsed : {}));
      decorate(card, it);
    });
    save();
  }
  function decorate(card, it) {
    const why = hiddenWhy(it);
    card.style.display = why ? 'none' : '';
    if (why) return;
    let bar = card.querySelector(':scope > .vf-bar');
    if (!bar) {
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      bar = document.createElement('div');
      bar.className = 'vf-bar vf-root';
      bar.innerHTML = '<span class="vf-score"></span><button data-a="like" aria-label="Like">👍</button><button data-a="outfit" aria-label="Add to outfit">＋</button><button data-a="nope" aria-label="Dislike and hide">👎</button>';
      bar.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        e.preventDefault(); e.stopPropagation();
        const cur = S.items[bar.dataset.id];
        if (b.dataset.a === 'like') (S.votes[cur.id] && S.votes[cur.id].v > 0) ? unvote(cur.id) : vote(cur, 1);
        if (b.dataset.a === 'nope') askWhy(cur);
        if (b.dataset.a === 'outfit') pickOutfit({ kind: 'vinted', id: cur.id });
      }, true);
      card.appendChild(bar);
    }
    bar.dataset.id = it.id;
    const sc = score(it), v = S.votes[it.id];
    const el = bar.querySelector('.vf-score');
    el.textContent = (stretchWhy(it).length ? '↗ ' : '') + (sc > 0 ? '+' : '') + sc;
    el.className = 'vf-score ' + (sc >= 1 ? 'vf-good' : sc <= -1 ? 'vf-bad' : '');
    bar.querySelector('[data-a="like"]').classList.toggle('vf-on', !!(v && v.v > 0));
    card.style.opacity = sc <= -1.5 ? '0.45' : '';
  }

  // favourites / offers / purchases on Vinted itself are the strongest signal
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button, a, [role="button"]');
    if (!t || t.closest('.vf-root')) return;
    const text = (t.textContent || '').trim().toLowerCase();
    const tid = (t.getAttribute('data-testid') || '').toLowerCase();
    const strong = /^(make an offer|buy now|send offer)/.test(text) || /offer|buy-button/.test(tid);
    const fav = /favou?rite/.test(tid) || /favou?rite/.test((t.getAttribute('aria-label') || '').toLowerCase());
    if (!strong && !fav) return;
    let id = idOf(location.pathname);
    const cardLink = !id || fav ? (t.closest('[data-testid="grid-item"], .feed-grid__item') || document.createElement('i')).querySelector('a[href*="/items/"]') : null;
    if (cardLink) id = idOf(cardLink.getAttribute('href'));
    if (!id) return;
    const og = p => { const m = document.querySelector('meta[property="og:' + p + '"]'); return m ? m.content : ''; };
    const it = S.items[id] || remember({ id, title: og('title') || document.title, img: og('image'), url: location.pathname });
    const prev = S.votes[id];
    if (prev && prev.v > 0 && (prev.src === 'offer' || !strong)) return;
    setTimeout(() => vote(it, 1, [], strong ? 'offer' : 'fav'), 0);
  }, true);

  // ---------------------------------------------------------------- UI
  const CSS = `
  .vf-root, .vf-root * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; }
  .vf-bar { position: absolute; top: 6px; left: 6px; right: 6px; display: flex; gap: 6px; align-items: center; z-index: 5; pointer-events: none; }
  .vf-bar button { pointer-events: auto; width: 36px; height: 36px; border-radius: 18px; border: 0; background: rgba(255,255,255,.92); box-shadow: 0 1px 4px rgba(0,0,0,.3); font-size: 17px; line-height: 1; padding: 0; color: #111; }
  .vf-bar button.vf-on { background: #0a7; }
  .vf-bar [data-a="like"] { margin-left: auto; }
  .vf-score { font-size: 12px; font-weight: 700; padding: 3px 7px; border-radius: 10px; background: rgba(255,255,255,.92); color: #444; }
  .vf-score.vf-good { background: #0a7; color: #fff; } .vf-score.vf-bad { background: #c33; color: #fff; }
  .vf-fab { position: fixed; right: 14px; bottom: 84px; z-index: 2147483000; width: 52px; height: 52px; border-radius: 26px; border: 0; background: #111; color: #fff; font-size: 22px; box-shadow: 0 3px 10px rgba(0,0,0,.4); }
  .vf-fab i { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: #0a7; font: 700 11px/20px system-ui; font-style: normal; }
  .vf-panel { position: fixed; inset: 0; z-index: 2147483001; background: #f6f6f4; color: #111; display: flex; flex-direction: column; font-size: 15px; }
  .vf-tabs { display: flex; background: #111; padding-top: env(safe-area-inset-top); }
  .vf-tabs button { flex: 1; padding: 14px 2px; border: 0; background: none; color: #aaa; font-size: 13px; font-weight: 600; }
  .vf-tabs button.vf-on { color: #fff; box-shadow: inset 0 -3px #0a7; }
  .vf-body { flex: 1; overflow-y: auto; padding: 12px 12px calc(24px + env(safe-area-inset-bottom)); -webkit-overflow-scrolling: touch; }
  .vf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .vf-card { background: #fff; border-radius: 10px; overflow: hidden; position: relative; display: flex; flex-direction: column; }
  .vf-card img { width: 100%; aspect-ratio: 3/4; object-fit: cover; background: #ddd; display: block; }
  .vf-card .vf-meta { padding: 7px 8px 9px; font-size: 12px; line-height: 1.35; }
  .vf-card .vf-meta b { display: block; font-size: 13px; }
  .vf-card .vf-new { position: absolute; bottom: 74px; left: 6px; background: #0a7; color: #fff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 8px; }
  .vf-tag { color: #0a7; font-weight: 700; }
  .vf-x { position: absolute; top: 6px; right: 6px; width: 30px; height: 30px; border-radius: 15px; border: 0; background: rgba(0,0,0,.6); color: #fff; font-size: 14px; }
  .vf-h { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #666; margin: 18px 0 8px; }
  .vf-h:first-child { margin-top: 2px; }
  .vf-btn { padding: 11px 14px; border-radius: 10px; border: 0; background: #111; color: #fff; font-size: 14px; font-weight: 600; }
  .vf-btn.vf-alt { background: #e4e4e0; color: #111; }
  .vf-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .vf-panel input[type=text], .vf-panel textarea { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 8px; font-size: 16px; background: #fff; color: #111; }
  .vf-panel label { display: block; font-size: 13px; color: #444; margin: 10px 0 4px; }
  .vf-chip { display: inline-block; padding: 8px 12px; border-radius: 18px; background: #fff; border: 1px solid #ccc; color: #111; font-size: 14px; text-decoration: none; }
  .vf-empty { color: #666; padding: 24px 4px; line-height: 1.5; }
  .vf-sheet-bg { position: fixed; inset: 0; z-index: 2147483002; background: rgba(0,0,0,.45); display: flex; align-items: flex-end; }
  .vf-sheet { width: 100%; background: #fff; color: #111; border-radius: 16px 16px 0 0; padding: 16px 14px calc(18px + env(safe-area-inset-bottom)); max-height: 80vh; overflow-y: auto; }
  .vf-sheet h3 { margin: 0 0 4px; font-size: 16px; } .vf-sheet p { margin: 0 0 12px; font-size: 13px; color: #666; }
  .vf-sheet .vf-opt { display: block; width: 100%; text-align: left; padding: 13px 12px; margin-bottom: 8px; border-radius: 10px; border: 1px solid #ddd; background: #fafafa; font-size: 15px; color: #111; }
  .vf-sheet .vf-opt.vf-on { border-color: #0a7; background: #e6f7f1; }
  .vf-sheet .vf-opt small { color: #777; margin-left: 6px; }
  .vf-toast { position: fixed; left: 12px; right: 12px; bottom: 150px; z-index: 2147483003; background: #111; color: #fff; padding: 12px 14px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
  .vf-toast button { background: none; border: 0; color: #5fd; font-weight: 700; font-size: 14px; }
  `;
  const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  let fab, panel, tab = 'feed', toastEl, toastTimer;

  function toast(msg, undo) {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = h('<div class="vf-toast vf-root"><span>' + esc(msg) + '</span>' + (undo ? '<button>Undo</button>' : '') + '</div>');
    if (undo) toastEl.querySelector('button').onclick = () => { undo(); toastEl.remove(); };
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(() => toastEl && toastEl.remove(), 4000);
  }
  function sheet(title, sub, build) {
    const bg = h('<div class="vf-sheet-bg vf-root"><div class="vf-sheet"><h3>' + esc(title) + '</h3><p>' + esc(sub) + '</p></div></div>');
    const close = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    build(bg.firstElementChild, close);
    document.body.appendChild(bg);
    return close;
  }
  function askWhy(it) {
    const picked = new Set();
    const bst = it.brand ? S.stats['brand:' + norm(it.brand)] : null;
    sheet('Why not this one?', 'Pick any that apply. Only what you pick is held against future items.', (el, close) => {
      REASONS.forEach(([k, label]) => {
        if (k === 'brand' && !it.brand) return;
        let hint = '';
        if (k === 'brand') hint = it.brand + (bst && bst.l ? ' · liked ' + bst.l + '×' : '');
        if (k === 'size' && it.size) hint = it.size;
        if (k === 'price' && it.price != null) hint = '$' + it.price;
        if (k === 'condition' && it.cond) hint = it.cond;
        const b = h('<button class="vf-opt">' + esc(label) + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</button>');
        b.onclick = () => {
          if (k === 'item') { close(); vote(it, -1, []); return; }
          picked.has(k) ? picked.delete(k) : picked.add(k);
          b.classList.toggle('vf-on', picked.has(k));
        };
        el.appendChild(b);
      });
      const done = h('<button class="vf-btn" style="width:100%">Hide it</button>');
      done.onclick = () => { close(); vote(it, -1, Array.from(picked)); };
      el.appendChild(done);
    });
  }
  function pickOutfit(piece) {
    sheet('Add to outfit', 'Choose an outfit or start a new one.', (el, close) => {
      const add = o => {
        if (!o.pieces.some(p => p.kind === piece.kind && String(p.id) === String(piece.id))) o.pieces.push(piece);
        save(); close(); toast('Added to ' + o.name); if (panel) render();
      };
      S.outfits.forEach(o => {
        const b = h('<button class="vf-opt">' + esc(o.name) + '<small>' + o.pieces.length + ' pieces</small></button>');
        b.onclick = () => add(o);
        el.appendChild(b);
      });
      const b = h('<button class="vf-btn" style="width:100%">＋ New outfit</button>');
      b.onclick = () => {
        const name = prompt('Outfit name', 'Outfit ' + (S.outfits.length + 1));
        if (!name) return;
        const o = { id: 'o' + Date.now(), name, pieces: [] };
        S.outfits.push(o); add(o);
      };
      el.appendChild(b);
    });
  }

  const safeUrl = u => { u = String(u || ''); return u.startsWith('/') ? u : /^https:\/\/([a-z0-9-]+\.)*vinted\.[a-z.]+\//.test(u) ? u : '#'; };
  const safeImg = u => /^(https:\/\/|data:image\/)/.test(String(u || '')) ? u : '';
  function itemCard(it, opts) {
    opts = opts || {};
    const v = S.votes[it.id], sc = score(it);
    const c = h('<div class="vf-card"><a href="' + esc(safeUrl(it.url)) + '"><img loading="lazy" src="' + esc(safeImg(it.img)) + '" alt=""></a>' +
      (opts.isNew ? '<span class="vf-new">NEW</span>' : '') +
      '<div class="vf-meta"><b>' + esc(it.brand || 'Unbranded') + (it.price != null ? ' · $' + esc(it.price) : '') + '</b>' +
      esc(it.title || '') + '<br>' + esc([it.size, it.cond].filter(Boolean).join(' · ')) + (opts.tag ? '<br><span class="vf-tag">' + esc(opts.tag) + '</span>' : '') + '</div></div>');
    if (opts.remove) {
      const x = h('<button class="vf-x">✕</button>'); x.onclick = opts.remove; c.appendChild(x);
    } else {
      const bar = h('<div class="vf-bar" style="pointer-events:auto"><span class="vf-score ' + (sc >= 1 ? 'vf-good' : sc <= -1 ? 'vf-bad' : '') + '">' + (sc > 0 ? '+' : '') + sc + '</span><button class="' + (v && v.v > 0 ? 'vf-on' : '') + '" style="margin-left:auto">👍</button><button>＋</button><button>👎</button></div>');
      const [like, add, nope] = bar.querySelectorAll('button');
      like.onclick = () => (v && v.v > 0) ? unvote(it.id) : vote(it, 1);
      add.onclick = () => pickOutfit({ kind: 'vinted', id: it.id });
      nope.onclick = () => askWhy(it);
      c.appendChild(bar);
    }
    return c;
  }
  const feedItems = () => Object.values(S.items)
    .filter(it => it.title && !S.votes[it.id] && !hiddenWhy(it))
    .map(it => [score(it), it]).sort((a, b) => b[0] - a[0] || (b[1].first || 0) - (a[1].first || 0)).map(x => x[1]);

  async function render() {
    if (!panel) return;
    panel.querySelectorAll('.vf-tabs button').forEach(b => b.classList.toggle('vf-on', b.dataset.t === tab));
    const body = panel.querySelector('.vf-body');
    const keep = body.scrollTop;
    body.innerHTML = '';
    const add = x => body.appendChild(typeof x === 'string' ? h(x) : x);

    if (tab === 'feed') {
      add('<div class="vf-h">Jump to newest listings</div>');
      const row = add('<div class="vf-row"></div>');
      Array.from(new Set(S.brands.liked.map(b => b.trim()).filter(Boolean))).forEach(b =>
        row.appendChild(h('<a class="vf-chip" href="/catalog?search_text=' + encodeURIComponent(b) + '&order=newest_first">' + esc(b) + '</a>')));
      const items = feedItems();
      add('<div class="vf-h">Best matches from what you’ve browsed (' + items.length + ')</div>');
      if (!items.length) add('<div class="vf-empty">Nothing yet. Browse or search Vinted and every item in your sizes shows up here, best match first.</div>');
      const grid = add('<div class="vf-grid"></div>');
      items.slice(0, 120).forEach(it => grid.appendChild(itemCard(it, { isNew: (it.first || 0) > S.feedSeenAt })));
      const liked = Object.keys(S.votes).filter(id => S.votes[id].v > 0 && S.items[id]).sort((a, b) => S.votes[b].ts - S.votes[a].ts);
      if (liked.length) {
        add('<div class="vf-h">Liked (' + liked.length + ')</div>');
        const lg = add('<div class="vf-grid"></div>');
        liked.slice(0, 60).forEach(id => lg.appendChild(itemCard(S.items[id])));
      }
    }

    if (tab === 'style') {
      const F = fam();
      const link = (label, q) => '<a class="vf-chip" style="margin:0 6px 6px 0" href="/catalog?search_text=' + encodeURIComponent(q) + '&order=newest_first">' + esc(label) + '</a>';
      const top = (prefix, n) => Object.keys(Object.assign({}, F.own, F.like)).filter(k => k.startsWith(prefix))
        .map(k => [F.n(k), k]).sort((a, b) => b[0] - a[0]).slice(0, n);
      const chips = rows => rows.map(r => '<span class="vf-chip" style="margin:0 6px 6px 0">' + esc(r[1].split(':').pop()) + ' <small style="color:#777">own ' + (F.own[r[1]] || 0) + ' · liked ' + (F.like[r[1]] || 0) + '</small></span>').join('');
      add('<div class="vf-h">Your style right now</div>');
      if (F.total < 3) {
        add('<div class="vf-empty" style="padding:0 4px 8px">Not enough to go on yet. Add the pieces you wear most in the Closet tab and 👍 a few listings — the profile is built from what you own plus what you like.</div>');
      } else {
        const cols = top('color:', 3).map(r => r[1].slice(6)), kws = top('kw:', 3).map(r => r[1].slice(3));
        const med = F.prices.length ? F.prices[Math.floor(F.prices.length / 2)] : null;
        add('<div class="vf-empty" style="padding:0 4px 10px;color:#111">' + esc('Mostly ' + (cols.join(', ') || 'unlabelled colors') + (kws.length ? '; leaning ' + kws.join(', ') : '') + (med != null ? '; you like things around $' + med : '') + '. Based on ' + closetCache.length + ' pieces you own and ' + (F.total - closetCache.length) + ' likes.') + '</div>');
        [['Colors', 'color:'], ['Cuts and fabrics', 'kw:'], ['Brands', 'brand:']].forEach(([label, pre]) => {
          const rows = top(pre, 8);
          if (rows.length) { add('<label>' + label + '</label>'); add('<div>' + chips(rows) + '</div>'); }
        });
        const combos = {};
        closetCache.forEach(c => { const k = [(c.color || ''), (c.type || typeOf(c.name))].join(' ').trim(); combos[k] = (combos[k] || 0) + 1; });
        const plenty = Object.entries(combos).filter(e => e[1] >= 3 && !/other$/.test(e[0]));
        if (plenty.length) {
          add('<div class="vf-h">You already have plenty of</div>');
          add('<div>' + plenty.map(e => '<span class="vf-chip" style="margin:0 6px 6px 0">' + esc(e[0]) + ' ×' + e[1] + '</span>').join('') + '</div>');
        }
      }
      const g = gaps();
      [[1, 'Missing foundations'], [2, 'Next-level pieces you don’t have']].forEach(([lvl, label]) => {
        const rows = g.filter(e => e[0] === lvl);
        if (rows.length) { add('<div class="vf-h">' + label + '</div>'); add('<div>' + rows.map(e => link(e[1], e[2])).join('') + '</div>'); }
      });
      if (F.total >= 3) {
        const newCols = EXPAND.filter(c => !F.n('color:' + c) && !rejected('color:' + c)).slice(0, 5);
        const newTex = TEXTURE.filter(w => !F.n('kw:' + w) && !rejected('kw:' + w)).slice(0, 5);
        const garment = ['chinos', 'shirt', 'sweater', 'jacket', 'sneakers'];
        if (newCols.length || newTex.length) {
          add('<div class="vf-h">Push your style</div>');
          add('<div class="vf-empty" style="padding:0 4px 8px">Colors and textures that are absent from your closet and likes, and that you haven’t rejected.</div>');
          add('<div>' + newCols.map((c, i) => link(c + ' ' + garment[i % garment.length], c + ' ' + garment[i % garment.length])).join('') + newTex.map(w => link(w, w + ' mens')).join('') + '</div>');
        }
      }
      const picks = Object.values(S.items).filter(it => it.title && !S.votes[it.id] && !hiddenWhy(it))
        .map(it => [stretchWhy(it), it]).filter(x => x[0].length && score(x[1]) > -1)
        .sort((a, b) => (b[0].length + 0.3 * score(b[1])) - (a[0].length + 0.3 * score(a[1])));
      add('<div class="vf-h">Stretch picks from what you’ve browsed (' + picks.length + ')</div>');
      if (!picks.length) add('<div class="vf-empty" style="padding:0 4px">None yet. Tap a suggestion above and browse; anything that fits you and widens your wardrobe lands here, and is marked ↗ on Vinted.</div>');
      const grid = add('<div class="vf-grid"></div>');
      picks.slice(0, 60).forEach(x => grid.appendChild(itemCard(x[1], { tag: x[0].join(' · ') })));
    }

    if (tab === 'outfits') {
      const mine = closetCache;
      const nb = add('<button class="vf-btn">＋ New outfit</button>');
      nb.onclick = () => { const name = prompt('Outfit name', 'Outfit ' + (S.outfits.length + 1)); if (name) { S.outfits.push({ id: 'o' + Date.now(), name, pieces: [] }); save(); render(); } };
      if (!S.outfits.length) add('<div class="vf-empty">Create an outfit, then add Vinted items with the ＋ button on any listing and your own pieces from the Closet tab.</div>');
      S.outfits.forEach(o => {
        let total = 0;
        const head = add('<div class="vf-h vf-row"><span style="flex:1"></span></div>');
        const grid = add('<div class="vf-grid"></div>');
        o.pieces.forEach((p, i) => {
          const rm = () => { o.pieces.splice(i, 1); save(); render(); };
          if (p.kind === 'vinted') {
            const it = S.items[p.id]; if (!it) return;
            total += it.price || 0;
            grid.appendChild(itemCard(it, { remove: rm }));
          } else {
            const c = mine.find(m => m.id === p.id); if (!c) return;
            grid.appendChild(itemCard({ id: c.id, title: c.name, brand: 'Yours', img: c.img, url: '#' }, { remove: rm }));
          }
        });
        head.firstElementChild.textContent = o.name + ' · $' + total.toFixed(2) + ' to buy';
        const addOwn = h('<button class="vf-btn vf-alt">＋ From closet</button>');
        addOwn.onclick = () => sheet('Add from your closet', mine.length ? 'Tap a piece.' : 'Your closet is empty — add photos in the Closet tab.', (el, close) => {
          mine.forEach(c => { const b = h('<button class="vf-opt">' + esc(c.name) + '</button>'); b.onclick = () => { o.pieces.push({ kind: 'own', id: c.id }); save(); close(); render(); }; el.appendChild(b); });
        });
        const del = h('<button class="vf-btn vf-alt">Delete</button>');
        del.onclick = () => { if (confirm('Delete outfit "' + o.name + '"?')) { S.outfits = S.outfits.filter(x => x !== o); save(); render(); } };
        head.appendChild(addOwn); head.appendChild(del);
      });
    }

    if (tab === 'closet') {
      const mine = closetCache;
      add('<div class="vf-empty" style="padding:4px 4px 12px">Photos of clothes and shoes you already own. They stay on this device and feed your style profile, so add the things you wear most.</div>');
      const inp = h('<input type="file" accept="image/*" style="display:none">');
      const btn = add('<button class="vf-btn">＋ Add a photo</button>');
      body.appendChild(inp);
      btn.onclick = () => inp.click();
      inp.onchange = () => {
        const file = inp.files[0]; if (!file) return;
        const name = prompt('What is it?', 'e.g. White Oliver Cabell Low 1'); if (!name) return;
        const img = new Image();
        img.onload = async () => {
          const k = Math.min(1, 480 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = img.width * k; cv.height = img.height * k;
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          await closet.put({ id: 'c' + Date.now(), name, img: cv.toDataURL('image/jpeg', 0.8), type: typeOf(name), color: nameColor(name) || photoColor(cv) });
          URL.revokeObjectURL(img.src); await reloadCloset();
        };
        img.src = URL.createObjectURL(file);
      };
      const grid = add('<div class="vf-grid" style="margin-top:12px"></div>');
      mine.forEach(c => {
        const card = itemCard({ id: c.id, title: c.name, brand: 'Yours', img: c.img, url: '#', size: c.type || typeOf(c.name), cond: c.color }, { remove: async () => { if (confirm('Remove "' + c.name + '"?')) { await closet.del(c.id); await reloadCloset(); } } });
        const ed = h('<button class="vf-btn vf-alt" style="margin:0 8px 8px">Edit type / color</button>');
        ed.onclick = async () => {
          const type = prompt('Type: top, pants, shoes or other', c.type || typeOf(c.name)); if (type == null) return;
          const color = prompt('Main color', c.color || ''); if (color == null) return;
          await closet.put(Object.assign({}, c, { type: type.trim().toLowerCase(), color: color.trim().toLowerCase() })); await reloadCloset();
        };
        card.appendChild(ed);
        const b = h('<button class="vf-btn vf-alt" style="margin:0 8px 8px">＋ Outfit</button>');
        b.onclick = () => pickOutfit({ kind: 'own', id: c.id });
        card.appendChild(b); grid.appendChild(card);
      });
    }

    if (tab === 'settings') {
      const field = (label, val, on, area) => {
        add('<label>' + esc(label) + '</label>');
        const i = add(area ? '<textarea rows="3"></textarea>' : '<input type="text">');
        i.value = val.join(', ');
        i.onchange = () => { on(i.value.split(',').map(s => s.trim()).filter(Boolean)); save(); refresh(true); };
      };
      add('<div class="vf-h">My sizes (comma separated, leave blank to not filter)</div>');
      field('Pants waist', S.sizes.waist, v => S.sizes.waist = v);
      field('Pants length / inseam', S.sizes.length, v => S.sizes.length = v);
      field('Tops', S.sizes.tops, v => S.sizes.tops = v);
      field('Shoes (US and/or EU)', S.sizes.shoes, v => S.sizes.shoes = v);
      add('<div class="vf-h">Brands</div>');
      field('Brands I like (boosted, never auto-blocked)', S.brands.liked, v => S.brands.liked = v, true);
      field('Blocked brands (always hidden)', S.brands.blocked, v => S.brands.blocked = v, true);
      field('Too high end (always hidden)', S.brands.tooHigh, v => S.brands.tooHigh = v, true);

      add('<div class="vf-h">What I’ve learned</div>');
      const rows = Object.entries(S.stats).filter(([, s]) => s.l + s.d > 0)
        .map(([k, s]) => [Math.log((s.l + 1) / (s.d + 1)), k, s]).sort((a, b) => b[0] - a[0]);
      const votes = Object.values(S.votes);
      add('<div class="vf-empty" style="padding:0 4px 8px">' + votes.filter(v => v.v > 0).length + ' liked · ' + votes.filter(v => v.v < 0).length + ' hidden</div>');
      const fmt = r => '<span class="vf-chip" style="margin:0 6px 6px 0">' + esc(r[1].replace(':', ': ')) + ' 👍' + r[2].l + ' 👎' + r[2].d + '</span>';
      add('<div>' + (rows.map(fmt).join('') || '<span class="vf-empty">Vote on a few items to start.</span>') + '</div>');

      add('<div class="vf-h">Data</div>');
      const r = add('<div class="vf-row"></div>');
      const ex = h('<button class="vf-btn vf-alt">Export backup</button>');
      ex.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' })); a.download = 'vinted-fit-backup.json'; a.click(); };
      const im = h('<button class="vf-btn vf-alt">Import backup</button>');
      const fi = h('<input type="file" accept="application/json,.json" style="display:none">');
      im.onclick = () => fi.click();
      fi.onchange = async () => { try { const j = JSON.parse(await fi.files[0].text()); if (!j.votes || !j.sizes) throw 0; localStorage.setItem(KEY, JSON.stringify(j)); S = load(); refresh(true); toast('Backup restored'); } catch (e) { toast('That file is not a Vinted Fit backup'); } };
      const un = h('<button class="vf-btn vf-alt">Un-hide everything</button>');
      un.onclick = () => { if (confirm('Clear all dislikes? Likes and settings are kept.')) { Object.keys(S.votes).forEach(id => { if (S.votes[id].v < 0) unvote(id); }); toast('All hidden items restored'); } };
      [ex, im, fi, un].forEach(x => r.appendChild(x));
    }
    body.scrollTop = keep;
  }

  function openPanel() {
    panel = h('<div class="vf-panel vf-root"><div class="vf-tabs"><button data-t="feed">Feed</button><button data-t="style">Style</button><button data-t="outfits">Outfits</button><button data-t="closet">Closet</button><button data-t="settings">Settings</button><button data-t="close">✕</button></div><div class="vf-body"></div></div>');
    panel.querySelector('.vf-tabs').onclick = e => {
      const t = e.target.dataset.t; if (!t) return;
      if (t === 'close') { panel.remove(); panel = null; S.feedSeenAt = Date.now(); save(); refresh(); return; }
      tab = t; panel.querySelector('.vf-body').scrollTop = 0; render();
    };
    document.body.appendChild(panel);
    render();
  }

  async function reloadCloset() { closetCache = await closet.all(); refresh(); }
  function refresh(rerender) {
    famCache = null;
    scan();
    if (fab) {
      const n = feedItems().filter(it => (it.first || 0) > S.feedSeenAt).length;
      fab.innerHTML = '✦' + (n ? '<i>' + (n > 99 ? '99+' : n) + '</i>' : '');
    }
    if (panel && (rerender !== false)) render();
  }
  let scanTimer = 0;
  function schedule() { clearTimeout(scanTimer); scanTimer = setTimeout(() => refresh(false), 250); }

  function init() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    fab = h('<button class="vf-fab vf-root" aria-label="Vinted Fit">✦</button>');
    fab.onclick = openPanel;
    document.body.appendChild(fab);
    new MutationObserver(muts => {
      if (muts.every(m => m.target.closest && m.target.closest('.vf-root'))) return;
      schedule();
    }).observe(document.body, { childList: true, subtree: true });
    refresh();
    reloadCloset();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.__vintedFitDebug = { get state() { return S; }, fam, gaps, stretchWhy, sizeFits, score, parseLabel, typeOf, hiddenWhy };
})();
