/* Product search. Text queries ("atorva 40") go through MiniSearch with
   prefix and typo matching; digit queries are treated as NDCs (any hyphen
   form, plain 10 or 11 digits, a 12-digit UPC from a barcode, or a partial
   NDC). Results are ordered by match quality, then by `rank` (most common
   NDC first). No DOM; also loads in Node. */
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

  // Edit distance, used only to order typo matches (closest first).
  function distance(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function strengthNumber(p) {
    var m = /\d+(?:\.\d+)?/.exec(p.strength || '');
    return m ? Number(m[0]) : Infinity;
  }
  // Results sort by tier, then rank, strength, drug, NDC. The last four are
  // fixed per product, so they are folded into one precomputed order number.
  function productOrder(products) {
    var keyed = products.map(function (p) { return { p: p, r: p.rank != null ? p.rank : 999, s: strengthNumber(p) }; });
    keyed.sort(function (a, b) {
      return (a.r - b.r) || (a.s - b.s) ||
        (a.p.drug < b.p.drug ? -1 : a.p.drug > b.p.drug ? 1 : 0) || (a.p.ndc < b.p.ndc ? -1 : 1);
    });
    var order = Object.create(null);
    keyed.forEach(function (k, i) { order[k.p.ndc] = i; });
    return order;
  }

  function createIndex(products) {
    var byNdc = Object.create(null), byTen = Object.create(null), order = productOrder(products);
    products.forEach(function (p) {
      byNdc[p.ndc] = p;
      ndc.tenDigitForms(p.ndc).forEach(function (t) { (byTen[t] = byTen[t] || []).push(p); });
    });

    var ms = new MiniSearch({
      idField: 'ndc',
      fields: ['drug', 'brand', 'aka', 'strength', 'form', 'manufacturer'],
      tokenize: tokenize,
      processTerm: function (t) { return t; },
      searchOptions: {
        // Words match by their start as you type; numbers only whole, so
        // "prednisone 1 mg" never finds 10 mg (version-40).
        prefix: function (term) { return !/^\d/.test(term); },
        // Typo tolerance only for words of 4+ letters, never for numbers.
        fuzzy: function (term) { return /^[a-z]{4,}$/.test(term) ? 0.25 : false; },
        combineWith: 'AND',
        boost: { drug: 3, brand: 3, aka: 2, strength: 2, form: 1, manufacturer: 0.5 }
      }
    });
    ms.addAll(products.map(function (p) {
      return { ndc: p.ndc, drug: p.drug, brand: p.brand || '', aka: (p.aka || []).join(' '), strength: p.strength || '', form: p.form || '', manufacturer: p.manufacturer || '' };
    }));

    function textSearch(q) {
      var qterms = tokenize(q);
      if (!qterms.length) return [];
      var hits = ms.search(qterms.join(' '));
      var out = [];
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i], p = byNdc[h.id];
        // Match quality: 0 per exact word, 1 per prefix, 1 + edit distance per typo match.
        var tier = 0, typo = false;
        for (var j = 0; j < qterms.length; j++) {
          var qt = qterms[j];
          if (h.terms.indexOf(qt) >= 0) continue;
          var best = Infinity;
          for (var k = 0; k < h.terms.length && best > 1; k++) {
            var t = h.terms[k];
            best = Math.min(best, t.indexOf(qt) === 0 ? 1 : 1 + distance(qt, t.slice(0, qt.length + 2)));
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
        var first = tokenize(p.drug)[0] || '', btoks = tokenize(p.brand), akas = tokenize((p.aka || []).join(' ')), lead = 1;
        var words = qterms.filter(function (t) { return /^[a-z]/.test(t); });
        for (j = 0; j < words.length; j++) {
          var w = words[j];
          if (first.indexOf(w) === 0 || (btoks.length && btoks.every(function (b) { return words.indexOf(b) >= 0; }))) { lead = 0; break; }
          if (akas.some(function (a) { return a.indexOf(w) === 0; })) lead = Math.min(lead, 0.25);
          if (btoks.length && btoks[0].indexOf(w) === 0) lead = Math.min(lead, 0.5);
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

    // Returns { mode: 'empty' | 'text' | 'ndc', results: [{ product, tier }], total }
    function search(query, limit) {
      var q = String(query || '').trim();
      if (!q) return { mode: 'empty', results: [], total: 0 };
      // "NDC 99999-0123-01", "NDC# 99999012301": the label in front of an NDC is not a word to search for (version-50)
      q = q.replace(/^ndc\s*[#:]?\s*(?=\d)/i, '');
      var digitsOnly = !/[a-z]/i.test(q) && ndc.digits(q).length >= 5;
      var mode = digitsOnly ? 'ndc' : 'text';
      var nd = digitsOnly ? ndcSearch(q) : null;
      var res = nd ? nd.results : textSearch(q);
      res.sort(function (a, b) { return (a.tier - b.tier) || ((a.lead || 0) - (b.lead || 0)) || (a.o - b.o); });
      var total = res.length;
      // `complete`: the full NDC or barcode searched for, when the query was one.
      return { mode: mode, results: limit ? res.slice(0, limit) : res, total: total, complete: nd ? nd.complete : null, badShape: !!(nd && nd.badShape), badCheck: !!(nd && nd.badCheck) };
    }

    return { search: search, byNdc: byNdc };
  }

  return { createIndex: createIndex, tokenize: tokenize };
});
