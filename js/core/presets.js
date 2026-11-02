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
  // (A zero-width non-joiner is not turned into a space: Persian words need it;
  // where it is not needed, the check refuses it as invisible.)
  function clean(s) { return isStr(s) ? s.normalize('NFC').replace(/[\s\u200B\uFEFF]+/g, ' ').trim() : ''; }
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
    '\u0555': 'O', '\u0585': 'o', '\u057D': 'u', '\u0581': 'g', '\u0570': 'h', '\u0578': 'n', '\u0566': 'q', '\u054D': 'U', '\u0544': 'U',
    // Latin small capitals and dotless letters, Cherokee, Lisu, Coptic
    '\u0131': 'i', '\u01C0': 'l', '\u0237': 'j', '\u0251': 'a', '\u0261': 'g', '\u0262': 'g', '\u026A': 'i', '\u0274': 'n', '\u0280': 'r', '\u028F': 'y',
    '\u0299': 'b', '\u029C': 'h', '\u029F': 'l', '\u13A0': 'D', '\u13A1': 'R', '\u13A2': 'T', '\u13AA': 'A', '\u13AB': 'J', '\u13AC': 'E', '\u13B3': 'W',
    '\u13B7': 'M', '\u13BB': 'H', '\u13C0': 'G', '\u13C3': 'Z', '\u13D2': 'R', '\u13D9': 'V', '\u13DA': 'S', '\u13DE': 'L', '\u13DF': 'C', '\u13E2': 'P',
    '\u13E6': 'K', '\u13E7': 'd', '\u13F4': 'B', '\u1D00': 'a', '\u1D04': 'c', '\u1D05': 'd', '\u1D07': 'e', '\u1D0A': 'j', '\u1D0B': 'k', '\u1D0D': 'm',
    '\u1D0F': 'o', '\u1D18': 'p', '\u1D1B': 't', '\u1D1C': 'u', '\u1D20': 'v', '\u1D21': 'w', '\u1D22': 'z', '\u2C80': 'A', '\u2C81': 'a', '\u2C82': 'B',
    '\u2C88': 'E', '\u2C8E': 'H', '\u2C92': 'I', '\u2C94': 'K', '\u2C98': 'M', '\u2C9A': 'N', '\u2C9E': 'O', '\u2C9F': 'o', '\u2CA2': 'P', '\u2CA3': 'p',
    '\u2CA4': 'C', '\u2CA5': 'c', '\u2CA6': 'T', '\u2CA8': 'Y', '\u2CAC': 'X', '\uA4D0': 'B', '\uA4D1': 'P', '\uA4D3': 'D', '\uA4D4': 'T', '\uA4D6': 'G',
    '\uA4D7': 'K', '\uA4D9': 'J', '\uA4DA': 'C', '\uA4DC': 'Z', '\uA4DD': 'F', '\uA4DF': 'M', '\uA4E0': 'N', '\uA4E1': 'L', '\uA4E2': 'S', '\uA4E3': 'R',
    '\uA4E6': 'V', '\uA4E7': 'H', '\uA4EA': 'W', '\uA4EB': 'X', '\uA4EC': 'Y', '\uA4EE': 'A', '\uA4F0': 'E', '\uA4F2': 'I', '\uA4F3': 'O', '\uA4F4': 'U',
    '\uA731': 's',
    // more Cyrillic, Greek, Coptic and Latin look-alikes; Canadian syllabics
    '\u04AE': 'Y', '\u04AF': 'y', '\u050C': 'G', '\u03F9': 'C', '\u2C99': 'm', '\u0196': 'I',
    '\u15EA': 'D', '\u15C5': 'A', '\u1455': 'C', '\u146D': 'P', '\u14AA': 'L', '\u157C': 'H', '\u15F7': 'B', '\u144E': 'N', '\u1515': 'S',
    '\u142F': 'V', '\u15EF': 'W', '\u15F0': 'M', '\u166D': 'X', '\u1541': 'x', '\u1587': 'R',
    '\u04C0': 'I', '\u0474': 'V', '\u0475': 'v', '\uA646': 'I', '\uA647': 'i',
    '\u03C7': 'x', '\u03C9': 'w', '\u043F': 'n', '\u0433': 'r', '\u044C': 'b', '\u10BD': 'S',
    // dashes and apostrophes that look like "-" and "'"
    '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2212': '-', '\uFE63': '-', '\uFF0D': '-',
    '\u2018': "'", '\u2019': "'", '\u02BC': "'", '\u2032': "'", '\uFF07': "'",
    '\u13A5': 'i', '\u13A9': 'y', '\u2CAD': 'x', '\u2CAC': 'X', '\u2015': '-', '\u2500': '-', '\u30FC': '-', '\u2215': '/', '\u2044': '/',
    '\u2236': ':', '\u00D7': 'x', '\u3007': 'O'
  };
  var IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
  // The form used to compare names and labels: compatibility forms folded
  // (fullwidth letters, ligatures such as "\uFB01"), invisible characters
  // dropped (a joiner between two emoji too), look-alike letters mapped,
  // and case ignored.
  // words: the form for reading words (colour names), without the I/l fold.
  function sameKey(s, words) {
    // Joiners are dropped everywhere, so a family emoji and the same faces
    // side by side count as the same label: a refusal of two labels that
    // look different is harmless; two that look alike passing is not.
    // Look-alikes are mapped before and after NFKC, which turns some of
    // them (lunate sigma, U+03F9) into letters that look different.
    // Small Cherokee letters (U+AB70-ABBF) look like their capitals, which are mapped.
    var skel = function (x) { return x.replace(/[^\x00-\x7F]/g, function (c) { var u = c >= 'ꭰ' && c <= 'ꮿ' ? c.toUpperCase() : c; return SKELETON[u] || SKELETON[c] || c; }); };
    // NFD first, so precomposed letters ("Ё", "Ӓ") are mapped by their base letter.
    // Last, capital I and small l look the same in a sans-serif font ("Lab I",
    // "Lab l"): both compare as "l" (and so does i, to keep case ignored).
    var k = skel(skel(clean(s).normalize('NFD')).normalize('NFKC').replace(IGNORABLE, '')).normalize('NFC').toLowerCase();
    return words ? k : k.replace(/i/g, 'l');
  }
  // Text with nothing but accent marks shows as nothing.
  function blank(s) { return !clean(s).replace(/\p{M}/gu, '').trim(); }
  function map() { return Object.create(null); } // no inherited keys such as "constructor"
  // Invisible characters (control codes, zero-width, soft hyphen, direction
  // marks, variation selectors, tag characters, blank braille) are refused.
  var INVISIBLE = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\u{1BCA0}-\u{1BCA3}\u{1D159}\u{1D173}-\u{1D17A}\u{13430}-\u{1343F}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
  // Emoji joined by zero-width joiners, with their variation selectors, are visible.
  // So are keycaps ("1" + U+FE0F + U+20E3) and tag-sequence flags (England, Scotland, Wales).
  // Only the three flags made of tag characters exist (England, Scotland, Wales);
  // any other run of tag characters is hidden text.
  var EMOJI = /[0-9#*]\uFE0F?\u20E3|\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|[\uFE0E\uFE0F])*(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|[\uFE0E\uFE0F])*)*/gu;
  // A joiner or non-joiner between two letters of a script that uses them
  // (Hindi conjuncts, Persian words) is part of writing it, not hidden text.
  var JOINING = /(\p{Script=Arabic}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Gurmukhi}|\p{Script=Gujarati}|\p{Script=Oriya}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Kannada}|\p{Script=Malayalam}|\p{Script=Sinhala}|\p{Script=Syriac})[\u200C\u200D](?=\p{Script=Arabic}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Gurmukhi}|\p{Script=Gujarati}|\p{Script=Oriya}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Kannada}|\p{Script=Malayalam}|\p{Script=Sinhala}|\p{Script=Syriac})/gu;
  // Also refused: any format character, unassigned or private-use code point,
  // and control code other than spacing (a joiner inside an emoji is fine).
  var HIDDEN = /[\p{Cf}\p{Cn}\p{Co}]|(?![\t\n\r\f\v])\p{Cc}/u;
  function invisible(s) { if (!isStr(s)) return false; var t = s.replace(EMOJI, 'E').replace(JOINING, '$1'); return INVISIBLE.test(t) || HIDDEN.test(t); }
  // What is wrong with a piece of text that looks fine, or null.
  function textProblem(s) {
    if (!isStr(s)) return null;
    if (invisible(s)) return 'contains invisible characters; type it again';
    if (/\p{Cs}/u.test(s)) return 'contains a broken character; type it again';
    if (/\p{M}{4,}/u.test(s)) return 'has a letter with too many accent marks';
    var scripts = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u, /\p{Script=Armenian}/u, /\p{Script=Georgian}/u, /\p{Script=Cherokee}/u, /\p{Script=Coptic}/u, /\p{Script=Lisu}/u, /\p{Script=Canadian_Aboriginal}/u].filter(function (re) { return re.test(s); });
    if (scripts.length > 1) return 'mixes letters from different alphabets (for example a Cyrillic "а" among Latin letters), which can look like other text; type it again';
    return null;
  }
  function rgb(hex) { return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); }); }
  function distance(a, b) { var x = rgb(a), y = rgb(b); return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2)); }
  // Also by eye: CIE Lab difference (dark greys such as #000000 and #2a2a2a are
  // far apart in RGB but look the same). The closest standard pair, blue and
  // purple, is 24 apart.
  function lab(hex) {
    var c = rgb(hex).map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var x = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047, y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  var MIN_LAB_DISTANCE = 20;
  function labDistance(a, b) { var x = lab(a), y = lab(b); return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2)); }
  function looksAlike(a, b) { return distance(a, b) < MIN_COLOUR_DISTANCE || labDistance(a, b) < MIN_LAB_DISTANCE; }
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
    var words = sameKey(name, true).split(/[^a-z]+/).map(function (w) { return w.replace(/^gray/, 'grey'); });
    // a word that is, or starts with, a colour word: "blue", "bluish", "reddish"
    var STEM = { black: 'black', white: 'white', grey: 'grey', yellow: 'yellow', blue: 'blu', red: 'red', green: 'green', orange: 'orang', purple: 'purpl', pink: 'pink' };
    // Other common colour words, by the standard colour they must look like.
    var ALSO = { crimson: 'red', scarlet: 'red', ruby: 'red', maroon: 'red', burgundy: 'red', cherry: 'red', brick: 'red',
      navy: 'blue', azure: 'blue', cobalt: 'blue', sky: 'blue', teal: 'blue', turquois: 'blue', aqua: 'blue', cyan: 'blue', sapphire: 'blue',
      lime: 'green', mint: 'green', emerald: 'green', jade: 'green', forest: 'green', sage: 'green',
      violet: 'purple', lavender: 'purple', lilac: 'purple', plum: 'purple', indigo: 'purple', mauve: 'purple',
      magenta: 'pink', fuchsia: 'pink', rose: 'pink', salmon: 'pink',
      gold: 'yellow', lemon: 'yellow', mustard: 'yellow', khaki: 'yellow', amber: 'orange', brown: 'orange', tan: 'orange', bronze: 'orange', copper: 'orange', rust: 'orange', peach: 'orange',
      charcoal: 'grey', slate: 'grey', silver: 'grey', ivory: 'white', cream: 'white', snow: 'white', ebony: 'black', jet: 'black', onyx: 'black' };
    var found = COLOUR_CHOICES.map(function (c) { return c.id; }).filter(function (id) {
      return words.some(function (w) { return w.indexOf(STEM[id]) === 0 || Object.keys(ALSO).some(function (a) { return ALSO[a] === id && w.indexOf(a) === 0; }); });
    });
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
