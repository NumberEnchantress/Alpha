/* Product search. Text queries ("atorva 40") go through MiniSearch with
   prefix and typo matching; digit queries are treated as NDCs (any hyphen
   form, plain 10 or 11 digits, a 12-digit UPC from a barcode, or a partial
   NDC). When nothing matches, each word is matched to the most similar
   words of names in the index (this reaches a typo in a name still being
   typed). Anything found only by a different spelling is marked `typo` and
   sorts after every exact or prefix match.

   Staged search (2026-11-19): a query with a number or an NDC lists
   products at once; a query of words lists drug names (`query`), and the
   chosen name's products are then split by form, strength (dose) and NDC
   (`forms`, `doses`, `ndcs`). No DOM; also loads in Node. */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Alpha = root.Alpha || {}).search = mod;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var isNode = typeof require === 'function';
  var MiniSearch = isNode ? require('minisearch') : root.MiniSearch;
  var ndc = isNode ? require('./ndc') : root.Alpha.ndc;

  // Numbers (with decimals) and words are separate tokens: "40mg" -> 40, mg.
  var TOKEN = /\d+(?:\.\d+)?|[a-z]+/g;
  function tokenize(s) {
    return String(s || '').toLowerCase()
      .replace(/(^|[^\d])\.(\d)/g, function (m, a, b) { return a + '0.' + b; }) // ".5" means 0.5
      // Micrograms: "µg" (micro sign or Greek mu) and "ug" are all "mcg".
      .replace(/[µμ]/g, 'mc').replace(/(^|[^a-z])ug(?![a-z])/g, '$1mcg')
      .match(TOKEN) || [];
  }

  // How far a typed word is from the closest start of an indexed word: the
  // fewest letters added, dropped, changed or swapped (two neighbours swapped
  // count as one) to turn the typed word into the first n-1 to n+2 letters
  // of the indexed one (n: the typed length). 0 when it is a start of it.
  function closeness(q, t) {
    var n = q.length, m = Math.min(t.length, n + 2), rows = [], i, j;
    for (i = 0; i <= n; i++) {
      var r = rows[i] = [i];
      for (j = 1; j <= m; j++) {
        if (!i) { r[j] = j; continue; }
        var v = Math.min(rows[i - 1][j] + 1, r[j - 1] + 1, rows[i - 1][j - 1] + (q[i - 1] === t[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && q[i - 1] === t[j - 2] && q[i - 2] === t[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
        r[j] = v;
      }
    }
    var best = Infinity;
    for (j = Math.min(Math.max(0, n - 1), m); j <= m; j++) best = Math.min(best, rows[n][j]);
    return best;
  }
  // The most edits a typed word may be from a name's word for the name to be listed as a similar spelling.
  function maxEdits(len) { return len < 3 ? 0 : len <= 4 ? 1 : len <= 7 ? 2 : 3; }

  /* ---------- orders ---------- */
  // Forms: tablets, capsules and caplets, chewables, solutions, then everything else
  // (transdermals, ointments, vaginals, suppositories...); a missing form last.
  // Within a group the plain form comes first ("tablet" before "tablet, extended release"), then A-Z.
  function formGroup(f) {
    f = String(f || '').toLowerCase();
    if (!f) return 9;
    if (/chew/.test(f)) return 2;
    if (/capsule|caplet|\bcaps?\b/.test(f)) return 1;
    if (/tablet|\btabs?\b|\bodt\b/.test(f)) return 0;
    if (/^(oral )?(solution|syrup|elixir|liquid)\b/.test(f)) return 3;
    return 4;
  }
  function formKey(f) {
    var s = String(f || '').toLowerCase();
    return [formGroup(s), /^(tablet|capsule|solution|chewable tablet|tablet, chewable)$/.test(s) ? 0 : 1, s];
  }

  // Strengths: low to high by the first number (the first part of a
  // combination: "5 mg; 325 mg" and "10-40 mg" by 5 and 10), in one unit:
  // mcg, mg and g as mg, an amount per volume as per mL ("125 mg/5 mL" is 25).
  // Plain amounts first, then per mL, per g, percentages, other units; unknown last.
  var MASS = { mcg: 0.001, mg: 1, g: 1000, gm: 1000, kg: 1e6 };
  var VOLUME = { ml: 1, l: 1000 };
  function doseKey(s) {
    var str = String(s || '').toLowerCase().replace(/[µμ]g/g, 'mcg').replace(/(^|[^a-z])ug(?![a-z])/g, '$1mcg');
    var m = /(\d+(?:\.\d+)?|\.\d+)/.exec(str);
    if (!m) return [9, Infinity, str];
    var v = Number(m[1]);
    var u = /^\s*(?:[-\/]\s*\d+(?:\.\d+)?\s*)*([a-z%][a-z]*)?(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*([a-z]+))?/.exec(str.slice(m.index + m[1].length)) || [];
    var unit = u[1] || '', perN = u[2] ? Number(u[2]) : 1, per = u[3] || '';
    if (unit === '%') return [3, v, str];
    if (MASS[unit] != null) {
      var mg = v * MASS[unit];
      if (VOLUME[per] != null) return [1, mg / (perN * VOLUME[per]), str];
      if (per === 'g' || per === 'gm') return [2, mg / perN, str];
      return [0, mg, str]; // a plain amount, a combination ("5 mg/325 mg") by its first part, or a rate
    }
    return [4, v / perN, unit + '/' + per + ' ' + str];
  }
  function cmpKeys(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  }
  function nameOf(p) { return p.drug + (p.brand ? ' (' + p.brand + ')' : ''); }
  function sortName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ''); }

  var SCHED_WORD = { CII: 'ctwo', CIII: 'cthree', CIV: 'cfour', CV: 'cfive', OTC: 'otc', Rx: 'rx' };

  // opts.layout (optional): the store layout, so NDCs at fast-mover (FM) and robot locations sort first.
  function createIndex(products, opts) {
    var layout = opts && opts.layout, kindOf = Object.create(null);
    ((layout && layout.locations) || []).forEach(function (l) { if (l && l.code != null) kindOf[String(l.code).toUpperCase()] = l.kind || ''; });

    var byNdc = Object.create(null), byTen = Object.create(null), M = Object.create(null);
    products.forEach(function (p) {
      byNdc[p.ndc] = p;
      ndc.tenDigitForms(p.ndc).forEach(function (t) { (byTen[t] = byTen[t] || []).push(p); });
      var kind = p.location != null ? kindOf[String(p.location).toUpperCase()] || '' : '';
      var name = nameOf(p);
      M[p.ndc] = {
        name: name, key: name.toLowerCase(), sort: sortName(name),
        form: formKey(p.form), dose: doseKey(p.strength),
        // NDCs: fast movers first, then by the optional private `useRank` (1 = most used at this store;
        // never in public data), then the robot, then by maker name.
        ndcKey: [kind === 'fm' ? 0 : 1, p.useRank != null ? p.useRank : Infinity, kind === 'robot' || p.robot === true ? 0 : 1, String(p.manufacturer || '￿').toLowerCase(), p.ndc],
        first: tokenize(p.drug)[0] || '', btoks: tokenize(p.brand), akas: tokenize((p.aka || []).join(' '))
      };
    });
    // One order number per product: name (A-Z), form, strength, then the NDC order.
    var order = Object.create(null);
    products.slice().sort(function (a, b) {
      var x = M[a.ndc], y = M[b.ndc];
      return (x.sort < y.sort ? -1 : x.sort > y.sort ? 1 : 0) || cmpKeys(x.form, y.form) || cmpKeys(x.dose, y.dose) || cmpKeys(x.ndcKey, y.ndcKey);
    }).forEach(function (p, i) { order[p.ndc] = i; });

    // The words of names (drug, brand, other names), for typos MiniSearch does not reach.
    var vocab = Object.create(null);
    products.forEach(function (p) {
      tokenize(p.drug + ' ' + (p.brand || '') + ' ' + (p.aka || []).join(' ')).forEach(function (t) { if (/^[a-z]{3,}$/.test(t)) vocab[t] = 1; });
    });
    var nameWords = Object.keys(vocab);

    var ms = new MiniSearch({
      idField: 'ndc',
      fields: ['drug', 'brand', 'aka', 'strength', 'form', 'manufacturer', 'schedule', 'flags'],
      tokenize: tokenize,
      processTerm: function (t) { return t; },
      searchOptions: {
        // Words match by their start as you type; numbers only whole, so
        // "prednisone 1 mg" never finds 10 mg (version-40).
        prefix: function (term) { return !/^\d/.test(term); },
        // Typo tolerance only for words of 4+ letters, never for numbers.
        fuzzy: function (term) { return /^[a-z]{4,}$/.test(term) ? 0.25 : false; },
        combineWith: 'AND',
        boost: { drug: 3, brand: 3, aka: 2, strength: 2, form: 1, manufacturer: 0.5, schedule: 1, flags: 1 }
      }
    });
    ms.addAll(products.map(function (p) {
      // the schedule as a word to search by (version-51): "ctwo" ... "cfive" (no word is the start of
      // another, as "cii" is of "ciii"), "controlled" for all four, "otc", "rx"
      var sch = p.schedule ? (SCHED_WORD[p.schedule] || p.schedule.toLowerCase()) + (/^C/.test(p.schedule) ? ' controlled' : '') : '';
      return { ndc: p.ndc, drug: p.drug, brand: p.brand || '', aka: (p.aka || []).join(' '), schedule: sch, flags: p.niosh === true ? 'hazardous niosh' : '', strength: p.strength || '', form: p.form || '', manufacturer: p.manufacturer || '' };
    }));

    // When nothing matches: each word of 3+ letters stands for the name words most like it.
    function similarSearch(qterms) {
      var any = false;
      var queries = qterms.map(function (qt) {
        if (!/^[a-z]{3,}$/.test(qt)) return qt;
        var lim = maxEdits(qt.length), near = [];
        for (var i = 0; i < nameWords.length; i++) {
          var w = nameWords[i];
          if (w.length < qt.length - lim) continue;
          var d = closeness(qt, w);
          if (d <= lim && d * 2 < qt.length) near.push({ w: w, d: d });
        }
        if (!near.length) return qt;
        any = true;
        near.sort(function (a, b) { return a.d - b.d || (a.w < b.w ? -1 : 1); });
        return { combineWith: 'OR', prefix: false, fuzzy: false, queries: near.slice(0, 12).map(function (x) { return x.w; }) };
      });
      return any ? ms.search({ combineWith: 'AND', queries: queries }) : [];
    }

    function textSearch(q) {
      var qterms = tokenize(q);
      if (!qterms.length) return [];
      var hits = ms.search(qterms.join(' '));
      if (!hits.length) hits = similarSearch(qterms);
      var out = [];
      var words = qterms.filter(function (t) { return /^[a-z]/.test(t); });
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i], p = byNdc[h.id], m = M[h.id];
        // Match quality: 0 per exact word, 1 per prefix, 1 + edits per word found only by a different spelling.
        var tier = 0, typo = false;
        for (var j = 0; j < qterms.length; j++) {
          var qt = qterms[j];
          if (h.terms.indexOf(qt) >= 0) continue;
          var best = Infinity;
          for (var k = 0; k < h.terms.length && best > 1; k++) {
            var t = h.terms[k];
            best = Math.min(best, t.indexOf(qt) === 0 ? 1 : 1 + closeness(qt, t));
          }
          tier += best;
          if (best > 1) typo = true;
        }
        // typo: found only by a different spelling. It may be another drug
        // ("hydralazine" finds hydroxyzine), so it is never chosen unasked.
        // lead: 1 when the drug's name does not start with a word searched for,
        // so "atorvastatin 40" lists atorvastatin before amlodipine-atorvastatin.
        // A brand counts too (version-48): a brand or other name (aka) the words name whole
        // leads ("eliquis": the Eliquis tablets), one whose brand only starts so comes next
        // ("Eliquis Sprinkle").
        var btoks = m.btoks, lead = 1;
        for (j = 0; j < words.length; j++) {
          var w = words[j];
          if (m.first.indexOf(w) === 0 || (btoks.length && btoks.every(function (b) { return words.indexOf(b) >= 0; }))) { lead = 0; break; }
          if (m.akas.some(function (a) { return a.indexOf(w) === 0; })) lead = Math.min(lead, 0.25);
          if (btoks.length && btoks[0].indexOf(w) === 0) lead = Math.min(lead, 0.5);
        }
        // A different spelling of the name's first word (or brand's) is nearer than one of a later word
        // ("metfro": metformin before metronidazole combinations).
        if (typo) {
          lead = words.some(function (w) {
            var lim = maxEdits(w.length);
            return closeness(w, m.first) <= lim || (btoks.length > 0 && closeness(w, btoks[0]) <= lim);
          }) ? 0 : 1;
        }
        out.push({ product: p, tier: tier, lead: lead, o: order[p.ndc], typo: typo });
      }
      return out;
    }

    function ndcSearch(q) {
      var d = ndc.digits(q), out = [], seen = Object.create(null);
      function add(p, tier) { if (p && !seen[p.ndc]) { seen[p.ndc] = 1; out.push({ product: p, tier: tier, o: order[p.ndc] }); } }
      var n11 = ndc.normalize(q);
      var ten = ndc.fromUpc(d) || (d.length === 10 ? d : null);
      if (n11) add(byNdc[n11], 0);
      else if (ten) (byTen[ten] || []).forEach(function (p) { add(p, 0); });
      // A complete NDC or barcode that is not here must never fall back to a
      // partial match: that would show a different product as if it were it.
      // A 12-digit "3..." code whose check digit is wrong: a misread barcode.
      if (!n11 && ndc.isUpcShape(d) && !ndc.fromUpc(d)) return { results: out, complete: null, badCheck: true };
      // Separators in a full-length NDC that fit none of the four shapes.
      if (!n11 && /[\s\-]/.test(q.trim()) && d.length >= 10) return { results: out, complete: null, badShape: true };
      if (n11 || ten || d.length >= 10) {
        return { results: out, complete: n11 ? ndc.format(n11) : ndc.fromUpc(d) ? 'barcode ' + d : d };
      }
      // Partial NDC: digits found anywhere in the 11-digit form.
      for (var i = 0; i < products.length; i++) {
        var p = products[i], at = p.ndc.indexOf(d);
        if (at >= 0) add(p, at === 0 ? 1 : 2);
      }
      return { results: out, complete: null };
    }

    // The query as the index reads it: no "NDC" label, schedules as one word.
    function clean(text) {
      var q = String(text || '').trim();
      // "NDC 99999-0123-01", "NDC# 99999012301": the label in front of an NDC is not a word to search for (version-50)
      q = q.replace(/^ndc\s*[#:]?\s*(?=\d)/i, '');
      // "C-II", "c 2", "schedule 2", "CII": one word, as the index holds it (version-51)
      return q.replace(/\b(?:c|schedule)[\s-]*(ii|iii|iv|v|2|3|4|5)\b/gi, function (m, n) { return ' ' + SCHED_WORD['C' + ({ 2: 'II', 3: 'III', 4: 'IV', 5: 'V' }[n] || n.toUpperCase())] + ' '; }).trim();
    }
    function isNdcQuery(q) { return !/[a-z]/i.test(q) && ndc.digits(q).length >= 5; }
    // Exact and prefix matches first, then anything found only by a different spelling.
    function byQuality(a, b) { return ((a.typo ? 1 : 0) - (b.typo ? 1 : 0)) || (a.tier - b.tier) || ((a.lead || 0) - (b.lead || 0)) || (a.o - b.o); }

    // Products. Returns { mode: 'empty' | 'text' | 'ndc', kind: 'products', results: [{ product, tier, typo }], total }
    function search(text, limit) {
      var q = clean(text);
      if (!q) return { mode: 'empty', kind: 'products', results: [], total: 0 };
      var digitsOnly = isNdcQuery(q);
      var nd = digitsOnly ? ndcSearch(q) : null;
      var res = nd ? nd.results : textSearch(q);
      res.sort(byQuality);
      var total = res.length;
      // `complete`: the full NDC or barcode searched for, when the query was one.
      return { mode: digitsOnly ? 'ndc' : 'text', kind: 'products', results: limit ? res.slice(0, limit) : res, total: total, complete: nd ? nd.complete : null, badShape: !!(nd && nd.badShape), badCheck: !!(nd && nd.badCheck) };
    }

    // The first stage. An NDC, or words with a number ("atorva 40"), lists products
    // at once (as search does); words alone list drug names, each with the products
    // the words matched: { kind: 'names', options: [{ label, drug, products, typo, tier, lead }], total }.
    // Names that start with a word typed come first, then other names (combinations,
    // brands, other names), each A-Z; names found only by a different spelling come
    // last, the most similar first.
    function query(text, limit) {
      var q = clean(text);
      if (!q || isNdcQuery(q) || tokenize(q).some(function (t) { return /^\d/.test(t); })) return search(text, limit);
      var hits = textSearch(q), groups = Object.create(null), list = [];
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i], m = M[h.product.ndc], g = groups[m.key];
        if (!g) { g = groups[m.key] = { value: m.key, label: m.name, sort: m.sort, drug: h.product.drug, products: [], typo: true, tier: Infinity, lead: 1 }; list.push(g); }
        g.products.push(h.product);
        if (!h.typo && g.typo) { g.typo = false; g.tier = Infinity; g.lead = 1; }
        if (h.typo === g.typo) { g.tier = Math.min(g.tier, h.tier); g.lead = Math.min(g.lead, h.lead); }
      }
      list.sort(function (a, b) {
        return ((a.typo ? 1 : 0) - (b.typo ? 1 : 0)) || (a.typo ? a.tier - b.tier : 0) || (a.lead - b.lead) || (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);
      });
      var shown = limit ? list.slice(0, limit) : list;
      shown.forEach(function (g) { g.products.sort(function (a, b) { return order[a.ndc] - order[b.ndc]; }); });
      return { mode: 'text', kind: 'names', options: shown, total: list.length };
    }

    // The later stages: the products split into options, each { value, label, products }.
    function split(pool, valueOf, keyOf, labelOf) {
      var by = Object.create(null), list = [];
      pool.forEach(function (p) {
        var v = valueOf(p), o = by[v];
        if (!o) { o = by[v] = { value: v, label: labelOf(p), k: keyOf(p), products: [] }; list.push(o); }
        o.products.push(p);
      });
      list.sort(function (a, b) { return cmpKeys(a.k, b.k); });
      list.forEach(function (o) { o.products.sort(function (a, b) { return order[a.ndc] - order[b.ndc]; }); });
      return list;
    }
    function forms(pool) {
      return split(pool, function (p) { return String(p.form || '').toLowerCase(); }, function (p) { return M[p.ndc].form; }, function (p) { return p.form || ''; });
    }
    function doses(pool) {
      return split(pool, function (p) { return String(p.strength || '').toLowerCase().replace(/\s+/g, ' '); }, function (p) { return M[p.ndc].dose; }, function (p) { return p.strength || ''; });
    }
    function ndcs(pool) {
      return pool.slice().sort(function (a, b) { return cmpKeys(M[a.ndc].ndcKey, M[b.ndc].ndcKey); });
    }

    return { search: search, query: query, forms: forms, doses: doses, ndcs: ndcs, byNdc: byNdc };
  }

  // Narrowing a later stage by typing: every word typed starts a word of the
  // option, every number is a whole number of it (as in search: "1" never
  // finds "10 mg"); digits alone may also be any part of the NDC.
  function narrows(text, words, ndc11) {
    var qt = tokenize(text);
    if (!qt.length) return true;
    var d = String(text).replace(/\D/g, '');
    if (ndc11 && /^[\d\s-]+$/.test(String(text).trim()) && ndc11.indexOf(d) >= 0) return true;
    var ot = tokenize(words);
    return qt.every(function (t) {
      return /^\d/.test(t) ? ot.indexOf(t) >= 0 : ot.some(function (o) { return o.indexOf(t) === 0; });
    });
  }
  // A whole NDC or barcode, typed or scanned (with or without its "NDC" label).
  function isWholeNdc(text) {
    var q = String(text || '').trim().replace(/^ndc\s*[#:]?\s*/i, '');
    return /^[\d\s-]+$/.test(q) && ndc.digits(q).length >= 10;
  }

  return { createIndex: createIndex, tokenize: tokenize, closeness: closeness, formGroup: formGroup, formKey: formKey, doseKey: doseKey, cmpKeys: cmpKeys, narrows: narrows, isWholeNdc: isWholeNdc, nameOf: nameOf };
});
