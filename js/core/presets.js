/* Basket presets: what decides a script's group. A preset is a named list of
   groups (at least 3); each group has a label and one or two basket colours.
   Built-in presets ship in the data file (basketSchemes); users make their
   own in the app and can save them as .json files and load them again.
   This file checks presets and reads and writes the .json format. No DOM;
   also loads in Node. */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.Alpha = root.Alpha || {}).presets = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_GROUPS = 3, MAX_GROUPS = 40, MAX_BASKETS = 2;
  var MAX_NAME = 60, MAX_LABEL = 40, MAX_FILE_BYTES = 256 * 1024;
  var FILE_TYPE = 'alpha-basket-preset', FILE_VERSION = 1;

  // Colours offered in the editor, besides any a preset already uses.
  var COLOUR_CHOICES = [
    { id: 'black', name: 'Black', hex: '#1a1a1a' },
    { id: 'yellow', name: 'Yellow', hex: '#f2c500' },
    { id: 'blue', name: 'Blue', hex: '#1f5fd1' },
    { id: 'red', name: 'Red', hex: '#c8102e' },
    { id: 'green', name: 'Green', hex: '#1e8a3a' },
    { id: 'orange', name: 'Orange', hex: '#f07f13' },
    { id: 'purple', name: 'Purple', hex: '#6c3fb5' },
    { id: 'pink', name: 'Pink', hex: '#e86ab0' },
    { id: 'white', name: 'White', hex: '#ffffff' },
    { id: 'grey', name: 'Grey', hex: '#8a8a8a' }
  ];

  function isStr(s) { return typeof s === 'string'; }
  function clean(s) { return isStr(s) ? s.trim() : ''; }
  function map() { return Object.create(null); } // no inherited keys such as "constructor"

  // Problems with a preset, as plain sentences. Empty list = valid.
  function check(p) {
    var errors = [];
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['Not a preset.'];
    if (!isStr(p.name) || !clean(p.name)) errors.push('Give the preset a name.');
    else if (clean(p.name).length > MAX_NAME) errors.push('The name is longer than ' + MAX_NAME + ' characters.');

    var colours = map(), names = map(), hexes = map();
    if (!Array.isArray(p.colours)) errors.push('The preset has no colour list.');
    (Array.isArray(p.colours) ? p.colours : []).forEach(function (c) {
      if (!c || !isStr(c.id) || !clean(c.id) || !isStr(c.name) || !clean(c.name) || !isStr(c.hex) || !/^#[0-9a-f]{6}$/i.test(c.hex)) {
        errors.push('A colour is missing its id, name or hex code (like #1a1a1a).');
        return;
      }
      if (colours[c.id]) errors.push('The colour id "' + c.id + '" is listed twice.');
      // Two colours that look the same, or share a name, cannot tell groups apart.
      else if (names[c.name.toLowerCase()] || hexes[c.hex.toLowerCase()]) errors.push('The colour "' + c.name + '" looks the same as, or has the same name as, another colour in the preset.');
      colours[c.id] = c; names[c.name.toLowerCase()] = 1; hexes[c.hex.toLowerCase()] = 1;
    });

    if (!Array.isArray(p.groups)) { errors.push('The preset has no group list.'); return errors; }
    var groups = p.groups;
    if (groups.length < MIN_GROUPS) errors.push('A preset needs at least ' + MIN_GROUPS + ' groups (it has ' + groups.length + ').');
    if (groups.length > MAX_GROUPS) { errors.push('A preset can have at most ' + MAX_GROUPS + ' groups (it has ' + groups.length + ').'); return errors; }
    var labels = map(), combos = map();
    groups.forEach(function (g, i) {
      var n = 'Group ' + (i + 1);
      if (!g || typeof g !== 'object') { errors.push(n + ' is not a group.'); return; }
      var label = clean(g.label);
      if (!isStr(g.label) || !label) errors.push(n + ' needs a label.');
      else if (label.length > MAX_LABEL) errors.push(n + ': the label is longer than ' + MAX_LABEL + ' characters.');
      else if (labels[label.toLowerCase()]) errors.push(n + ': the label "' + label + '" is already used by group ' + labels[label.toLowerCase()] + '.');
      else labels[label.toLowerCase()] = i + 1;
      var b = g.baskets;
      if (!Array.isArray(b) || !b.every(isStr)) { errors.push(n + ': baskets must be a list of colour ids.'); return; }
      if (b.length < 1 || b.length > MAX_BASKETS) errors.push(n + ' needs 1 or ' + MAX_BASKETS + ' baskets.');
      var ok = true;
      b.forEach(function (id) { if (!colours[id]) { ok = false; errors.push(n + ' uses a colour that is not in the preset ("' + id + '").'); } });
      if (!ok || !b.length) return;
      // What staff see is the colours, so compare by colour, in order.
      var key = b.map(function (id) { return colours[id].hex.toLowerCase(); }).join('+');
      if (combos[key]) errors.push(n + ' has the same baskets as group ' + combos[key] + ' (' + b.map(function (id) { return colours[id].name; }).join(' + ') + ').');
      else combos[key] = i + 1;
    });
    return errors;
  }

  function slug(s) { return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'preset'; }

  // Keeps only the fields a preset has, and only the colours it uses.
  // Call on a preset that passed check().
  function tidy(p) {
    var used = map();
    p.groups.forEach(function (g) { g.baskets.forEach(function (b) { used[b] = 1; }); });
    return {
      id: clean(p.id) || 'user-' + slug(p.name),
      name: clean(p.name),
      colours: p.colours.filter(function (c) { return used[c.id]; }).map(function (c) { return { id: c.id, name: clean(c.name), hex: c.hex }; }),
      groups: p.groups.map(function (g) { return { label: clean(g.label), baskets: g.baskets.slice() }; })
    };
  }

  function toFile(p) {
    var t = tidy(p);
    return JSON.stringify({ type: FILE_TYPE, version: FILE_VERSION, preset: { name: t.name, colours: t.colours, groups: t.groups } }, null, 2) + '\n';
  }

  /* Reads a preset .json file. Returns { preset, errors, warnings }.
     warnings: fields that were ignored (the preset still loads). */
  function fromFile(text) {
    var out = { preset: null, errors: [], warnings: [] };
    text = String(text == null ? '' : text);
    if (text.length > MAX_FILE_BYTES) { out.errors.push('The file is too large to be a preset (over ' + (MAX_FILE_BYTES / 1024) + ' KB).'); return out; }
    var data;
    try { data = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { out.errors.push('This file is not valid JSON.'); return out; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { out.errors.push('This file has no preset in it.'); return out; }
    var p = data;
    if ('type' in data) {
      if (data.type !== FILE_TYPE) { out.errors.push('This is not a basket preset file.'); return out; }
      if (data.version !== FILE_VERSION) { out.errors.push('This preset file is version ' + JSON.stringify(data.version) + '; this app reads version ' + FILE_VERSION + '.'); return out; }
      Object.keys(data).forEach(function (k) { if (['type', 'version', 'preset'].indexOf(k) < 0) out.warnings.push('ignored "' + k + '"'); });
      p = data.preset;
    }
    if (!p || typeof p !== 'object' || !Array.isArray(p.groups)) { out.errors.push('This file has no preset in it (no "groups" list).'); return out; }
    Object.keys(p).forEach(function (k) { if (['name', 'colours', 'groups', 'id'].indexOf(k) < 0) out.warnings.push('ignored "' + k + '"'); });
    var errs = check(p);
    if (errs.length) { out.errors = errs.slice(0, 10).concat(errs.length > 10 ? ['…and ' + (errs.length - 10) + ' more problems.'] : []); return out; }
    p.groups.forEach(function (g, i) { Object.keys(g).forEach(function (k) { if (k !== 'label' && k !== 'baskets') out.warnings.push('ignored "' + k + '" in group ' + (i + 1)); }); });
    var t = tidy({ id: '', name: p.name, colours: p.colours, groups: p.groups });
    if (t.colours.length < p.colours.length) out.warnings.push('dropped ' + (p.colours.length - t.colours.length) + ' unused colour(s)');
    out.preset = t;
    return out;
  }

  return { check: check, tidy: tidy, toFile: toFile, fromFile: fromFile, slug: slug,
    COLOUR_CHOICES: COLOUR_CHOICES, MIN_GROUPS: MIN_GROUPS, MAX_GROUPS: MAX_GROUPS, MAX_BASKETS: MAX_BASKETS,
    MAX_NAME: MAX_NAME, MAX_LABEL: MAX_LABEL, MAX_FILE_BYTES: MAX_FILE_BYTES, FILE_TYPE: FILE_TYPE };
});
