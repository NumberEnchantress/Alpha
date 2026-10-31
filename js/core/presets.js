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
  var MAX_NAME = 60, MAX_LABEL = 40, MAX_COLOUR_NAME = 24, MAX_FILE_BYTES = 256 * 1024;
  var MIN_COLOUR_DISTANCE = 70; // RGB distance below which two colours look alike
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
  // Runs of spaces, tabs and zero-width characters look like one space on
  // screen, and "\u00E9" can be one character or "e" plus an accent: both are
  // stored the same way (NFC), so look-alike text compares as equal.
  function clean(s) { return isStr(s) ? s.normalize('NFC').replace(/[\s\u200B\u200C\uFEFF]+/g, ' ').trim() : ''; }
  // The form used to compare names and labels: also folds compatibility
  // forms (fullwidth letters, ligatures such as "ﬁ") and case.
  // Letters from other alphabets that look like Latin letters, mapped to
  // them for comparing (Cyrillic, Greek and Armenian look-alikes), so a label
  // written wholly in Cyrillic "\u0410\u041C" compares equal to "AM".
  var SKELETON = {
    '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041A': 'K', '\u041C': 'M', '\u041D': 'H', '\u041E': 'O', '\u0420': 'P', '\u0421': 'C', '\u0422': 'T',
    '\u0425': 'X', '\u0423': 'Y', '\u0406': 'I', '\u0408': 'J', '\u0405': 'S', '\u051A': 'Q', '\u051C': 'W', '\u0417': '3',
    '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0458': 'j',
    '\u0455': 's', '\u0501': 'd', '\u051B': 'q', '\u051D': 'w', '\u04BB': 'h', '\u04CF': 'l', '\u0432': 'b', '\u043A': 'k', '\u043C': 'm',
    '\u043D': 'h', '\u0442': 't',
    '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z', '\u0397': 'H', '\u0399': 'I', '\u039A': 'K', '\u039C': 'M', '\u039D': 'N',
    '\u039F': 'O', '\u03A1': 'P', '\u03A4': 'T', '\u03A5': 'Y', '\u03A7': 'X', '\u03BF': 'o', '\u03BD': 'v', '\u03B9': 'i', '\u03BA': 'k',
    '\u03C1': 'p', '\u03C5': 'u', '\u03B1': 'a', '\u03F2': 'c', '\u03F3': 'j',
    '\u0555': 'O', '\u0585': 'o', '\u057D': 'u', '\u0581': 'g', '\u0570': 'h', '\u0578': 'n', '\u0566': 'q', '\u054D': 'U', '\u0544': 'U'
  };
  var IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
  // The form used to compare names and labels: compatibility forms folded
  // (fullwidth letters, ligatures such as "\uFB01"), invisible characters
  // dropped (a joiner between two emoji too), look-alike letters mapped,
  // and case ignored.
  function sameKey(s) {
    return clean(s).normalize('NFKC').replace(IGNORABLE, '').replace(/[^\x00-\x7F]/g, function (c) { return SKELETON[c] || c; }).toLowerCase();
  }
  // Text with nothing but accent marks shows as nothing.
  function blank(s) { return !clean(s).replace(/\p{M}/gu, '').trim(); }
  function map() { return Object.create(null); } // no inherited keys such as "constructor"
  // Invisible characters (control codes, zero-width, soft hyphen, direction
  // marks, variation selectors, tag characters, blank braille) are refused.
  var INVISIBLE = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{13430}-\u{1343F}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
  // Emoji joined by zero-width joiners, with their variation selectors, are visible.
  var EMOJI = /\p{Extended_Pictographic}[\uFE0E\uFE0F]?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?)*/gu;
  // Also refused: any format character, unassigned or private-use code point,
  // and control code other than spacing (a joiner inside an emoji is fine).
  var HIDDEN = /[\p{Cf}\p{Cn}\p{Co}]|(?![\t\n\r\f\v])\p{Cc}/u;
  function invisible(s) { if (!isStr(s)) return false; var t = s.replace(EMOJI, 'E'); return INVISIBLE.test(t) || HIDDEN.test(t); }
  // What is wrong with a piece of text that looks fine, or null.
  function textProblem(s) {
    if (!isStr(s)) return null;
    if (invisible(s)) return 'contains invisible characters; type it again';
    if (/\p{Cs}/u.test(s)) return 'contains a broken character; type it again';
    if (/\p{M}{4,}/u.test(s)) return 'has a letter with too many accent marks';
    var scripts = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u, /\p{Script=Armenian}/u, /\p{Script=Georgian}/u, /\p{Script=Cherokee}/u, /\p{Script=Coptic}/u].filter(function (re) { return re.test(s); });
    if (scripts.length > 1) return 'mixes letters from different alphabets (for example a Cyrillic "а" among Latin letters), which can look like other text; type it again';
    return null;
  }
  function rgb(hex) { return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); }); }
  function distance(a, b) { var x = rgb(a), y = rgb(b); return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2)); }
  function looksAlike(a, b) { return distance(a, b) < MIN_COLOUR_DISTANCE; }
  // A colour called by a standard name ("Black") must look like it.
  function standard(name) {
    var n = name.toLowerCase();
    return COLOUR_CHOICES.filter(function (c) { return c.name.toLowerCase() === n; })[0] || null;
  }
  // A name that contains one standard colour word ("Navy blue", "Light
  // grey") must be that kind of colour: the same hue family for colours,
  // dark for black, light for white, unsaturated for grey.
  // Hue ranges in degrees; pink also covers light reds (#ffc0cb), red only the darker ones.
  var FAMILY = { red: [340, 20], orange: [15, 45], yellow: [40, 70], green: [70, 170], blue: [170, 255], purple: [255, 320], pink: [280, 20] };
  function hsl(hex) {
    var c = rgb(hex).map(function (v) { return v / 255; }), max = Math.max.apply(null, c), min = Math.min.apply(null, c), l = (max + min) / 2, d = max - min, h = 0;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d) h = max === c[0] ? 60 * (((c[1] - c[2]) / d) % 6) : max === c[1] ? 60 * ((c[2] - c[0]) / d + 2) : 60 * ((c[0] - c[1]) / d + 4);
    return [(h + 360) % 360, s, l];
  }
  function wordMismatch(name, hex) {
    var words = name.toLowerCase().split(/[^a-z]+/).map(function (w) { return w === 'gray' ? 'grey' : w; });
    var found = COLOUR_CHOICES.map(function (c) { return c.id; }).filter(function (id) { return words.indexOf(id) >= 0; });
    if (found.length !== 1) return false; // none, or a mix such as "blue-green"
    var w = found[0], v = hsl(hex), h = v[0], s = v[1], l = v[2];
    if (w === 'black') return l > 0.3;
    if (w === 'white') return l < 0.8;
    if (w === 'grey') return s > 0.25 && l > 0.1 && l < 0.9;
    var f = FAMILY[w];
    if (s < 0.2 || l < 0.08 || l > 0.95) return true; // too grey, dark or light to be a colour
    if (w === 'red' && l > 0.7) return true;  // that light, it is pink
    if (w === 'pink' && (h >= 340 || h < 20) && l < 0.55) return true; // that dark a red is not pink
    return f[0] < f[1] ? !(h >= f[0] && h < f[1]) : !(h >= f[0] || h < f[1]);
  }

  // Problems with a preset, as plain sentences. Empty list = valid.
  function check(p) {
    var errors = [];
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['Not a preset.'];
    if (textProblem(p.name)) errors.push('The name ' + textProblem(p.name) + '.');
    else if (!isStr(p.name) || blank(p.name)) errors.push('Give the preset a name.');
    else if (clean(p.name).length > MAX_NAME) errors.push('The name is longer than ' + MAX_NAME + ' characters.');

    var colours = map(), names = map(), seenHex = [];
    if (!Array.isArray(p.colours)) errors.push('The preset has no colour list.');
    (Array.isArray(p.colours) ? p.colours : []).forEach(function (c) {
      if (!c || !isStr(c.id) || !/^[A-Za-z0-9_-]{1,24}$/.test(c.id) || !isStr(c.name) || blank(c.name) ||
          !isStr(c.hex) || !/^#[0-9a-f]{6}$/i.test(c.hex)) {
        errors.push('A colour needs an id (letters, digits, - or _, up to 24), a name and a hex code like #1a1a1a.');
        return;
      }
      var name = clean(c.name);
      if (textProblem(c.name)) { errors.push('The colour name "' + name.slice(0, 30) + '" ' + textProblem(c.name) + '.'); return; }
      if (name.length > MAX_COLOUR_NAME) { errors.push('The colour name "' + name.slice(0, 30) + '…" is longer than ' + MAX_COLOUR_NAME + ' characters.'); return; }
      if (colours[c.id]) { errors.push('The colour id "' + c.id + '" is listed twice.'); return; }
      var std = standard(name);
      // A colour named with a colour word ("Blue", "Navy blue") must be that kind of colour.
      if (wordMismatch(name, c.hex)) errors.push('The colour "' + name + '" (' + c.hex + ') does not look like ' + (std ? name.toLowerCase() : 'its name') + '.');
      // Two colours that look alike, or share a name, cannot tell groups apart.
      if (names[sameKey(name)]) errors.push('Two colours are called "' + name + '".');
      var near = seenHex.filter(function (s) { return looksAlike(s.hex, c.hex); })[0];
      if (near) errors.push('The colours "' + near.name + '" and "' + name + '" look too alike to tell baskets apart.');
      colours[c.id] = c; names[sameKey(name)] = 1; seenHex.push({ hex: c.hex, name: name });
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
      if (textProblem(g.label)) errors.push(n + ': the label ' + textProblem(g.label) + '.');
      else if (!isStr(g.label) || blank(g.label)) errors.push(n + ' needs a label.');
      else if (label.length > MAX_LABEL) errors.push(n + ': the label is longer than ' + MAX_LABEL + ' characters.');
      else if (labels[sameKey(label)]) errors.push(n + ': the label "' + label + '" is already used by group ' + labels[sameKey(label)] + '.');
      else labels[sameKey(label)] = i + 1;
      var b = g.baskets;
      if (!Array.isArray(b) || !b.every(isStr)) { errors.push(n + ': baskets must be a list of colour ids.'); return; }
      if (b.length < 1 || b.length > MAX_BASKETS) errors.push(n + ' needs 1 or ' + MAX_BASKETS + ' baskets.');
      var ok = true;
      b.forEach(function (id) { if (!colours[id]) { ok = false; errors.push(n + ' uses a colour that is not in the preset ("' + id + '").'); } });
      if (!ok || !b.length) return;
      // What staff see is the colours, so compare by colour, in order.
      var key = b.map(function (id) { return colours[id].hex.toLowerCase(); }).join('+');
      if (combos[key]) errors.push(n + ' has the same baskets as group ' + combos[key] + ' (' + b.map(function (id) { return clean(colours[id].name); }).join(' + ') + ').');
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
    // What is stored must pass the same checks when it is read back.
    var again = check(t);
    if (again.length) { out.errors = again.slice(0, 10); return out; }
    if (t.colours.length < p.colours.length) out.warnings.push('dropped ' + (p.colours.length - t.colours.length) + ' unused colour(s)');
    out.preset = t;
    return out;
  }

  return { check: check, tidy: tidy, clean: clean, sameKey: sameKey, looksAlike: looksAlike, toFile: toFile, fromFile: fromFile, slug: slug,
    COLOUR_CHOICES: COLOUR_CHOICES, MIN_GROUPS: MIN_GROUPS, MAX_GROUPS: MAX_GROUPS, MAX_BASKETS: MAX_BASKETS,
    MAX_NAME: MAX_NAME, MAX_LABEL: MAX_LABEL, MAX_COLOUR_NAME: MAX_COLOUR_NAME, MAX_FILE_BYTES: MAX_FILE_BYTES, FILE_TYPE: FILE_TYPE };
});
