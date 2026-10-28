/* Declarative rules: data in, warnings out. No DOM; also loads in Node.

   Rule:      { id, severity: info|warn|danger, message, when: Condition, enabled? }
   Condition: { all: [Condition...] } | { any: [...] } | { not: Condition }
            | { field, op, value }           op: see OPS below
            | { equivalent: { match: [field...], where: Condition } }
              true when another product shares every `match` field and passes
              `where`; that product is then available to the message as
              {{equivalent.<field>}}.
   Message:   text with {{field}} or {{equivalent.field}} placeholders. */
(function (root, factory) {
  var mod = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Alpha = root.Alpha || {}).rules = mod;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var ndc = typeof require === 'function' ? require('./ndc') : root.Alpha.ndc;

  var SEVERITIES = ['info', 'warn', 'danger'];
  var OPS = {
    eq: 1, ne: 1, in: 1, notIn: 1, between: 1, lt: 1, lte: 1, gt: 1, gte: 1,
    contains: 1, startsWith: 1, known: 0, unknown: 0
  };
  var NUM = /^-?\d+(\.\d+)?$/;

  function get(obj, path) {
    var parts = String(path).split('.');
    var v = obj;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function isUnknown(v) { return v === undefined || v === null || v === ''; }
  function norm(v) { return typeof v === 'string' ? v.trim().toLowerCase() : v; }
  function same(a, b) { return norm(a) === norm(b); }

  // Numbers if every value looks numeric, strings if none do, else not comparable.
  function cmp(a, b) {
    a = String(a).trim(); b = String(b).trim();
    var na = NUM.test(a), nb = NUM.test(b);
    if (na && nb) return Number(a) - Number(b);
    if (!na && !nb) { a = norm(String(a)); b = norm(String(b)); return a < b ? -1 : a > b ? 1 : 0; }
    return NaN;
  }

  function checkCondition(c, path, errors, warnings, fields) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push(path + ': condition must be an object'); return; }
    var keys = Object.keys(c);
    if ('all' in c || 'any' in c) {
      var k = 'all' in c ? 'all' : 'any', list = c[k];
      if (keys.length !== 1) errors.push(path + ': "' + k + '" must be the only key');
      if (!Array.isArray(list) || !list.length) { errors.push(path + '.' + k + ': must be a non-empty list'); return; }
      list.forEach(function (x, i) { checkCondition(x, path + '.' + k + '[' + i + ']', errors, warnings, fields); });
      return;
    }
    if ('not' in c) {
      if (keys.length !== 1) errors.push(path + ': "not" must be the only key');
      checkCondition(c.not, path + '.not', errors, warnings, fields);
      return;
    }
    if ('equivalent' in c) {
      var e = c.equivalent;
      if (keys.length !== 1) errors.push(path + ': "equivalent" must be the only key');
      if (!e || !Array.isArray(e.match) || !e.match.length) errors.push(path + '.equivalent.match: must be a non-empty list of fields');
      if (e && e.where) checkCondition(e.where, path + '.equivalent.where', errors, warnings, fields);
      return;
    }
    if (typeof c.field !== 'string' || !c.field) errors.push(path + ': missing "field"');
    else if (fields && !fields[c.field.split('.')[0]]) warnings.push(path + ': unknown field "' + c.field + '" (rule may never fire)');
    if (!Object.prototype.hasOwnProperty.call(OPS, c.op)) { errors.push(path + ': unknown op "' + c.op + '"'); return; }
    if (OPS[c.op] && !('value' in c)) errors.push(path + ': op "' + c.op + '" needs a "value"');
    if (c.op === 'between') {
      if (!(Array.isArray(c.value) && c.value.length === 2)) errors.push(path + ': "between" needs [low, high]');
      else {
        var d = cmp(c.value[0], c.value[1]);
        if (isNaN(d)) errors.push(path + ': "between" bounds must both be numbers or both be text');
        else if (d > 0) errors.push(path + ': "between" bounds are reversed');
      }
    }
    if ((c.op === 'in' || c.op === 'notIn') && !Array.isArray(c.value)) errors.push(path + ': "' + c.op + '" needs a list');
    keys.forEach(function (k) { if (k !== 'field' && k !== 'op' && k !== 'value') errors.push(path + ': unexpected key "' + k + '"'); });
  }

  // Returns { rules, errors, warnings }. Rules with errors are dropped.
  // `knownFields` (optional list) lets it warn about misspelt field names.
  function compile(list, knownFields) {
    var out = [], errors = [], warnings = [], fields = null;
    if (knownFields) { fields = {}; knownFields.forEach(function (f) { fields[f] = 1; }); }
    if (!Array.isArray(list)) return { rules: out, errors: ['rules must be a list'], warnings: warnings };
    var ids = {};
    list.forEach(function (r, i) {
      var errs = [], path = 'rules[' + i + ']' + (r && r.id ? ' (' + r.id + ')' : '');
      if (!r || typeof r !== 'object') { errors.push(path + ': must be an object'); return; }
      if (!r.id) errs.push(path + ': missing "id"');
      else if (ids[r.id]) errs.push(path + ': duplicate id'); else ids[r.id] = 1;
      if (SEVERITIES.indexOf(r.severity) < 0) errs.push(path + ': severity must be one of ' + SEVERITIES.join(', '));
      if (typeof r.message !== 'string' || !r.message) errs.push(path + ': missing "message"');
      checkCondition(r.when, path + '.when', errs, warnings, fields);
      if (errs.length) errors.push.apply(errors, errs); else out.push(r);
    });
    return { rules: out, errors: errors, warnings: warnings };
  }

  function test(c, p, ctx) {
    if (c.all) return c.all.every(function (x) { return test(x, p, ctx); });
    if (c.any) return c.any.some(function (x) { return test(x, p, ctx); });
    if (c.not) {
      // A match found inside "not" must not be reported as the equivalent.
      var saved = ctx.equivalent, r = !test(c.not, p, ctx);
      ctx.equivalent = saved;
      return r;
    }
    if (c.equivalent) {
      var e = c.equivalent, found = null;
      var pool = ctx.products || [];
      for (var i = 0; i < pool.length; i++) {
        var q = pool[i];
        if (q === p || q.ndc === p.ndc) continue;
        if (!e.match.every(function (f) { return !isUnknown(get(p, f)) && same(get(p, f), get(q, f)); })) continue;
        if (e.where && !test(e.where, q, ctx)) continue;
        if (!found || rankOf(q) < rankOf(found)) found = q;
      }
      if (found) ctx.equivalent = found;
      return !!found;
    }
    var v = get(p, c.field), w = c.value;
    if (c.op === 'known') return !isUnknown(v);
    if (c.op === 'unknown') return isUnknown(v);
    if (isUnknown(v)) return false;
    switch (c.op) {
      case 'eq': return same(v, w);
      case 'ne': return !same(v, w);
      case 'in': return w.some(function (x) { return same(v, x); });
      case 'notIn': return !w.some(function (x) { return same(v, x); });
      case 'between': return cmp(v, w[0]) >= 0 && cmp(v, w[1]) <= 0;
      case 'lt': return cmp(v, w) < 0;
      case 'lte': return cmp(v, w) <= 0;
      case 'gt': return cmp(v, w) > 0;
      case 'gte': return cmp(v, w) >= 0;
      case 'contains': return String(norm(v)).indexOf(norm(String(w))) >= 0;
      case 'startsWith': return String(norm(v)).indexOf(norm(String(w))) === 0;
    }
    return false;
  }

  function rankOf(p) { return p.rank != null ? p.rank : 999; }

  function fill(msg, p, eq) {
    return msg.replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (m, path) {
      var src = p;
      if (path.indexOf('equivalent.') === 0) { src = eq; path = path.slice(11); }
      var v = src ? get(src, path) : undefined;
      if (isUnknown(v)) return 'unknown';
      return path === 'ndc' ? ndc.format(v) : String(v);
    });
  }

  // Returns [{ id, severity, message, equivalent }] for rules that fire.
  // `disabled` is a set of rule ids the user switched off.
  function evaluate(rules, product, products, disabled) {
    var out = [];
    (rules || []).forEach(function (r) {
      if (r.enabled === false || (disabled && disabled[r.id])) return;
      var ctx = { products: products, equivalent: null };
      if (test(r.when, product, ctx)) {
        out.push({ id: r.id, severity: r.severity, message: fill(r.message, product, ctx.equivalent), equivalent: ctx.equivalent });
      }
    });
    var order = { danger: 0, warn: 1, info: 2 };
    out.sort(function (a, b) { return order[a.severity] - order[b.severity]; });
    return out;
  }

  // Product fields rules may refer to (matches tools/schema.json).
  var PRODUCT_FIELDS = ['ndc', 'drug', 'strength', 'form', 'manufacturer', 'countPerBottle', 'location', 'unit', 'shelf',
    'niosh', 'safetyCap', 'vialCapacity', 'robot', 'preferred', 'rank', 'notes', 'stock'];

  return { compile: compile, evaluate: evaluate, SEVERITIES: SEVERITIES, OPS: Object.keys(OPS), PRODUCT_FIELDS: PRODUCT_FIELDS };
});
