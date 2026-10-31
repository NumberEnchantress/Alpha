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
  var FILE_TYPE = 'alpha-basket-preset';

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

  function clean(s) { return String(s == null ? '' : s).trim(); }

  // Problems with a preset, as plain sentences. Empty list = valid.
  function check(p) {
    var errors = [];
    if (!p || typeof p !== 'object') return ['Not a preset.'];
    if (!clean(p.name)) errors.push('Give the preset a name.');
    var colours = {};
    (Array.isArray(p.colours) ? p.colours : []).forEach(function (c) {
      if (!c || !clean(c.id) || !clean(c.name) || !/^#[0-9a-f]{6}$/i.test(c.hex || '')) errors.push('A colour is missing its id, name or hex code.');
      else colours[c.id] = c;
    });
    var groups = Array.isArray(p.groups) ? p.groups : [];
    if (groups.length < MIN_GROUPS) errors.push('A preset needs at least ' + MIN_GROUPS + ' groups (it has ' + groups.length + ').');
    if (groups.length > MAX_GROUPS) errors.push('A preset can have at most ' + MAX_GROUPS + ' groups.');
    var labels = {}, combos = {};
    groups.forEach(function (g, i) {
      var n = 'Group ' + (i + 1);
      var label = clean(g && g.label);
      if (!label) errors.push(n + ' needs a label.');
      else if (labels[label.toLowerCase()]) errors.push(n + ': the label "' + label + '" is already used by group ' + labels[label.toLowerCase()] + '.');
      else labels[label.toLowerCase()] = i + 1;
      var b = Array.isArray(g && g.baskets) ? g.baskets : [];
      if (b.length < 1 || b.length > MAX_BASKETS) errors.push(n + ' needs 1 or ' + MAX_BASKETS + ' baskets.');
      b.forEach(function (id) { if (!colours[id]) errors.push(n + ' uses a colour that is not in the preset ("' + id + '").'); });
      // Baskets are what staff see, so two groups must never look the same.
      var key = b.join('+');
      if (b.length && combos[key]) {
        errors.push(n + ' has the same baskets as group ' + combos[key] + ' (' + b.map(function (id) { return colours[id] ? colours[id].name : id; }).join(' + ') + ').');
      } else if (b.length) combos[key] = i + 1;
    });
    return errors;
  }

  function slug(s) { return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset'; }

  // Keeps only the fields a preset has, and only the colours it uses.
  function tidy(p) {
    var used = {};
    (p.groups || []).forEach(function (g) { (g.baskets || []).forEach(function (b) { used[b] = 1; }); });
    return {
      id: clean(p.id) || 'user-' + slug(p.name),
      name: clean(p.name),
      colours: (p.colours || []).filter(function (c) { return used[c.id]; }).map(function (c) { return { id: c.id, name: clean(c.name), hex: c.hex }; }),
      groups: (p.groups || []).map(function (g) { return { label: clean(g.label), baskets: (g.baskets || []).slice() }; })
    };
  }

  function toFile(p) {
    var t = tidy(p);
    return JSON.stringify({ type: FILE_TYPE, version: 1, preset: { name: t.name, colours: t.colours, groups: t.groups } }, null, 2) + '\n';
  }

  // Reads a preset .json file. Returns { preset, errors }.
  function fromFile(text) {
    var data;
    try { data = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch (e) { return { preset: null, errors: ['This file is not valid JSON.'] }; }
    var p = data && data.type === FILE_TYPE ? data.preset : data;
    if (data && data.type && data.type !== FILE_TYPE) return { preset: null, errors: ['This is not a basket preset file.'] };
    if (!p || typeof p !== 'object' || !Array.isArray(p.groups)) return { preset: null, errors: ['This file has no preset in it (no "groups" list).'] };
    var t = tidy({ id: '', name: p.name, colours: p.colours, groups: p.groups });
    var errors = check(t);
    return { preset: errors.length ? null : t, errors: errors };
  }

  return { check: check, tidy: tidy, toFile: toFile, fromFile: fromFile, slug: slug,
    COLOUR_CHOICES: COLOUR_CHOICES, MIN_GROUPS: MIN_GROUPS, MAX_BASKETS: MAX_BASKETS, FILE_TYPE: FILE_TYPE };
});
