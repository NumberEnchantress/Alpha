/* Basket presets page (opened from Settings). Lists the built-in presets
   (from the data file) and the user's own (kept in this browser), and edits
   them: each group gets a label picked from a list or typed, and one or two
   basket colours. Presets can be saved as .json files and loaded again. */
(function (Alpha) {
  'use strict';
  var ui = Alpha.ui, esc = ui.esc, store = ui.store, P = Alpha.presets;
  var OWN = '__own__', NONE = '';

  /* Storage: each preset is its own entry, "alpha.preset.<id>". Saving or
     deleting one never rewrites the others, so two open windows cannot erase
     each other's presets, and an entry that fails the checks is never
     written over: it is listed as unreadable and left as it is. Windows
     reload the list when another window changes it (the storage event). */
  var KEY = 'preset.', ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var mine = [], broken = [], memoryOnly = false;
  // id -> the first of today's checks a stored preset fails (saved by an older
  // version, or with rules that grew stricter): it is listed and usable, with
  // a warning here and in the info pane, until it is edited.
  var warns = Object.create(null);
  // A stored preset whose name looks the same as an earlier one's: id -> that name.
  var alike = Object.create(null);
  // The later of two (by storage key): the one a window renames when it saved it.
  var alikeLater = Object.create(null);
  function alikeText(id) { return alike[id] != null ? 'Its name looks the same on screen as the preset "' + alike[id] + '". Rename one of them so they can be told apart.' : null; }
  var dlg = null, editing = null, status = '';

  function builtInIds() {
    var ids = Object.create(null);
    (((Alpha.state && Alpha.state.ds) || window.ALPHA_DATASETS && (window.ALPHA_DATASETS.real || window.ALPHA_DATASETS.sim || window.ALPHA_DATASETS.sample) || {}).basketSchemes || [])
      .forEach(function (p) { ids[p.id] = 1; });
    return ids;
  }

  function builtInNames() {
    var ds = (Alpha.state && Alpha.state.ds) || (window.ALPHA_DATASETS && (window.ALPHA_DATASETS.real || window.ALPHA_DATASETS.sim || window.ALPHA_DATASETS.sample)) || {};
    return (ds.basketSchemes || []).map(function (p) { return P.sameKey(p.name); });
  }

  // Stored presets are compared by plain letters (case aside): look-alike
  // names are refused when a preset is saved, but one already stored stays
  // usable when the look-alike rules grow stricter in a later version.
  function plainKey(x) { return P.clean(x).toLowerCase(); }
  function loadMine() {
    var ok = [], bad = [], names = Object.create(null), builtins = builtInIds();
    var ds0 = (Alpha.state && Alpha.state.ds) || (window.ALPHA_DATASETS && (window.ALPHA_DATASETS.real || window.ALPHA_DATASETS.sim || window.ALPHA_DATASETS.sample)) || {};
    (ds0.basketSchemes || []).forEach(function (p) { names[plainKey(p.name)] = 1; });
    if (memoryOnly) return; // storage is blocked: keep what is in memory
    migrateOldList();
    store.keys(KEY).forEach(function (k) {
      var id = k.slice(KEY.length), raw = store.raw(k), p = null, why = null;
      try { p = JSON.parse(raw); } catch (e) { p = null; }
      if (!p || typeof p !== 'object' || Array.isArray(p)) why = 'it is not readable preset data';
      else if (!ID_RE.test(id) || p.id !== id) why = 'its id does not match its storage key';
      else if (builtins[id]) why = 'it has the id of a built-in preset';
      else if (P.check(p, { stored: true }).length) why = P.check(p, { stored: true })[0];
      else if (names[plainKey(p.name)]) why = 'another preset (built in or yours) already has the name "' + P.clean(p.name) + '"';
      if (!why) { names[plainKey(p.name)] = 1; ok.push(p); } else bad.push({ key: k, why: why });
    });
    mine = ok; broken = bad;
    warns = Object.create(null);
    ok.forEach(function (p) { var e = P.check(p); if (e.length) warns[p.id] = e[0]; });
    // Names that look the same as an earlier one (built in first, then by
    // storage key) stay usable but are said; a window renames its own.
    alike = Object.create(null); alikeLater = Object.create(null);
    var seen = Object.create(null);
    (ds0.basketSchemes || []).forEach(function (p) { seen[P.sameKey(p.name)] = P.clean(p.name); });
    // (both are said, so the one in use shows it too; built-in names are kept)
    var seenId = Object.create(null);
    ok.forEach(function (p) {
      var sk = P.sameKey(p.name);
      if (seen[sk] == null) { seen[sk] = P.clean(p.name); seenId[sk] = p.id; return; }
      alike[p.id] = seen[sk]; alikeLater[p.id] = seen[sk];
      if (seenId[sk] && alike[seenId[sk]] == null) alike[seenId[sk]] = P.clean(p.name);
    });
  }
  function isBroken(key) { return broken.some(function (b) { return b.key === key; }); }

  /* The old one-list format ("alpha.presets", versions 14-16). On a first
     move each entry is copied to its own entry and taken out of the list, so
     it moves once; one that does not fit waits and is retried. Once any
     version has moved or copied the list (its flag, or presets stored per
     entry), nothing is copied unasked: an exact copy counts as moved, and the
     rest is listed with Restore. See NOTES.md, Decisions, for the history. */
  var notMigrated = 0, oldLeft = null;
  function freeId(name, used) {
    var base = 'user-' + P.slug(typeof name === 'string' ? name : 'old preset'), id = base, n = 2;
    while (used[id] || store.raw(KEY + id) != null) id = base + '-' + n++;
    return id;
  }
  // Everything but the id, exactly as written (names and labels with their
  // letter case, colour names too): only a true copy counts as the same.
  function contentKey(p) {
    return JSON.stringify([p.name, (Array.isArray(p.colours) ? p.colours : []).map(function (c) { return c && typeof c === 'object' ? [c.id, String(c.hex).toLowerCase(), c.name] : c; }),
      (Array.isArray(p.groups) ? p.groups : []).map(function (g) { return g && typeof g === 'object' ? [g.label, g.baskets] : g; })]);
  }
  function presetLike(p) { return !!p && typeof p === 'object' && !Array.isArray(p); }
  function oldList() {
    var raw = store.raw('presets'), v = null;
    if (raw != null) { try { v = JSON.parse(raw); } catch (e) { v = null; } }
    return { raw: raw, list: Array.isArray(v) ? v : null };
  }
  function writeOld(keep) { return keep.length ? store.setRaw('presets', JSON.stringify(keep)) : (store.remove('presets'), true); }
  function migrateOldList() {
    notMigrated = 0; oldLeft = null;
    var o = oldList(), backup = store.raw('presets-unreadable');
    // A list seen after a move was written again by an older version in another tab.
    var ranBefore = store.raw('presets-migrated') != null || store.raw('presets-migrated-2') != null ||
      store.raw('presets-moved') != null || store.keys(KEY).length > 0, notPresets = 0, unsure = 0, waiting = [], stillWaiting = [];
    var waitRoom = []; // entries this version could not copy for lack of room (by contents)
    try { waitRoom = JSON.parse(store.raw('presets-waiting') || '[]'); } catch (e) { waitRoom = []; }
    if (!Array.isArray(waitRoom)) waitRoom = [];
    if (o.list) {
      var used = builtInIds(), seenIds = Object.create(null), have = Object.create(null), keep = [], moved = false, freeName = null, movedKeys = [];
      store.keys(KEY).forEach(function (k) { var q = null; try { q = JSON.parse(store.raw(k)); } catch (e) { q = null; } if (presetLike(q)) have[contentKey(q)] = 1; });
      o.list.forEach(function (p) {
        if (!presetLike(p)) { notPresets++; keep.push(p); return; }
        var firstOfId = typeof p.id === 'string' && ID_RE.test(p.id) && !seenIds[p.id];
        var goodId = firstOfId && !used[p.id];
        if (typeof p.id === 'string') seenIds[p.id] = 1;
        if (have[contentKey(p)] || restoredKeys().indexOf(entryKey(p)) >= 0) { moved = true; return; } // an exact copy is stored, or it was restored (perhaps renamed): already moved
        if (ranBefore && waitRoom.indexOf(contentKey(p)) < 0) { unsure++; waiting.push({ k: entryKey(p), name: typeof p.name === 'string' && p.name.trim() ? P.clean(p.name) : '(no name)' }); keep.push(p); return; } // deleted or changed since, or never copied: ask, never bring back unasked
        var stored = goodId && store.raw(KEY + p.id) != null;
        var id = goodId && !stored ? p.id : freeId(p.name, used);
        if (!freeName) freeName = nameFreer();
        var newName = freeName(p.name);
        if (store.set(KEY + id, Object.assign({}, p, { id: id, name: newName }))) { used[id] = 1; have[contentKey(p)] = 1; moved = true; if (newName !== p.name) movedKeys.push(entryKey(p)); }
        else { notMigrated++; keep.push(p); stillWaiting.push(contentKey(p)); }
      });
      // Renamed on the way (its name was taken): remembered as moved, so an
      // older tab writing the list again does not offer it for Restore.
      if (movedKeys.length) store.setRaw('presets-restored', JSON.stringify(restoredKeys().concat(movedKeys).slice(-500)));
      if (moved) writeOld(keep);
      // This version moved (part of) the list: say so, and remember the
      // entries still waiting for room, the only ones tried again unasked.
      if (!ranBefore || waitRoom.length) {
        if (stillWaiting.length) store.setRaw('presets-waiting', JSON.stringify(stillWaiting)); else store.remove('presets-waiting');
      }
      // The flags versions 17-28 check, set whenever an old list is seen, so they leave it alone.
      ['presets-moved', 'presets-migrated', 'presets-migrated-2'].forEach(function (f) { if (store.raw(f) == null) store.setRaw(f, '1'); });
    }
    if ((o.raw != null && !o.list) || notPresets || unsure || backup != null) {
      oldLeft = { unreadableList: o.raw != null && !o.list, notPresets: notPresets, unsure: unsure, waiting: waiting, backup: backup != null };
    }
  }
  // "Restore": entries an older version may have copied, which are not
  // stored now, are moved as new presets (with new ids, and with " (2)" added
  // to a name already in use), one (only = its place in the old list) or all.
  // A function that returns a name not used by any preset (built in or
  // stored), adding " (2)" and so on, and counts it as used.
  function nameFreer() {
    var taken = Object.create(null);
    builtInNames().forEach(function (k) { taken[k] = 1; });
    store.keys(KEY).forEach(function (k) { var q = null; try { q = JSON.parse(store.raw(k)); } catch (e) { q = null; } if (presetLike(q) && typeof q.name === 'string') taken[P.sameKey(q.name)] = 1; });
    return function (name) {
      if (typeof name !== 'string') return name;
      var out = cut(P.clean(name), P.MAX_NAME), k = 2;
      while (taken[P.sameKey(out)]) { var sfx = ' (' + k++ + ')'; out = cut(P.clean(name), P.MAX_NAME - sfx.length).trim() + sfx; }
      taken[P.sameKey(out)] = 1;
      return out;
    };
  }
  // A short key for an old entry's contents: Restore buttons name entries by
  // it, not by their place in a list another tab can rewrite.
  function entryKey(p) {
    var s = contentKey(p), h1 = 5381, h2 = 52711;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = (h1 * 33) ^ c; h2 = (h2 * 33) ^ c; }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
  }
  // Entries already restored (by contents key), so an older tab writing its list
  // again does not offer one again after its name got " (2)".
  function restoredKeys() { try { var r = JSON.parse(store.raw('presets-restored') || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  // Returns the names restored. only: an entry's key (one entry), or null (all).
  var gone = false, already = 0;
  function restoreOld(only) {
    gone = false; already = 0;
    var o = oldList(); if (!o.list) { gone = only != null; return []; }
    var used = builtInIds(), keep = [], names = [], found = false, restoredNow = [], have = Object.create(null), free = nameFreer();
    store.keys(KEY).forEach(function (k) { var q = null; try { q = JSON.parse(store.raw(k)); } catch (e) { q = null; } if (presetLike(q)) have[contentKey(q)] = 1; });
    o.list.forEach(function (p) {
      if (!presetLike(p) || (only != null && (found || entryKey(p) !== only))) { keep.push(p); return; }
      found = true;
      if (have[contentKey(p)] || restoredKeys().indexOf(entryKey(p)) >= 0) { already++; return; } // stored already (perhaps renamed, or restored in another window)
      have[contentKey(p)] = 1;
      var id = freeId(p.name, used), name = free(p.name);
      if (store.set(KEY + id, Object.assign({}, p, { id: id, name: name }))) { used[id] = 1; names.push(typeof name === 'string' ? name : '(no name)'); restoredNow.push(entryKey(p)); } else keep.push(p);
    });
    gone = only != null && !found;
    if (restoredNow.length) store.setRaw('presets-restored', JSON.stringify(restoredKeys().concat(restoredNow).slice(-500)));
    writeOld(keep);
    return names;
  }
  function downloadOld() {
    var a = document.createElement('a'), out = { 'alpha.presets': store.raw('presets'), 'alpha.presets-unreadable': store.raw('presets-unreadable') };
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' }));
    a.download = 'old-basket-presets.json';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* Two windows saving one name at the same moment both get through; the
     name check then lists the later one (by key) as unreadable. Each window
     renames only presets it saved itself, so the two never both rename.
     Called after this window's save and on every change from another window.
     Returns the messages to show. */
  var mySaves = Object.create(null), lastArrowAt = 0, justSaved = Object.create(null), ownStatusAt = 0;
  function renameClashes() {
    var out = [];
    if (memoryOnly) return out;
    broken.forEach(function (b) {
      var id = b.key.slice(KEY.length);
      if (!mySaves[id] || !/already has the name/.test(b.why)) return;
      var p = null; try { p = JSON.parse(store.raw(b.key)); } catch (e) { p = null; }
      if (!p || typeof p.name !== 'string') return;
      var was = p.name; p.name = uniqueName(was);
      if (store.set(b.key, p)) out.push('Another window saved a preset named "' + was + '" at the same moment, so yours is now "' + p.name + '".');
    });
    // Saved here with a name that looks the same as an earlier preset's
    // (another window saved it at the same moment): this one is renamed.
    mine.forEach(function (q) {
      if (!mySaves[q.id] || alikeLater[q.id] == null) return;
      var p = null; try { p = JSON.parse(store.raw(KEY + q.id)); } catch (e) { p = null; }
      if (!p || typeof p.name !== 'string') return;
      var was = p.name; p.name = uniqueName(was);
      if (p.name !== was && store.set(KEY + q.id, p)) out.push('Another window saved a preset named "' + alikeLater[q.id] + '", which looks the same as "' + was + '", at the same moment, so yours is now "' + p.name + '".');
    });
    if (out.length) loadMine();
    return out;
  }

  // Returns false when the browser would not store it (for example, full).
  function saveOne(p) {
    if (memoryOnly) { mine = mine.filter(function (x) { return x.id !== p.id; }).concat([p]); return true; }
    var ok = store.set(KEY + p.id, p);
    loadMine();
    return ok;
  }
  function removeOne(id) {
    delete justSaved[id]; // deleted here: another window's later save of it is not "over yours"
    if (memoryOnly) { mine = mine.filter(function (x) { return x.id !== id; }); return true; }
    store.remove(KEY + id);
    var gone = store.raw(KEY + id) == null;
    loadMine();
    return gone;
  }

  // Storage blocked altogether? Then presets live in memory for this page.
  // (Full storage is not blocked: saved presets are still read, and a save
  // that does not fit says "Not saved".)
  memoryOnly = !store.usable();

  // Unsaved changes in the editor?
  function dirty() { return !!editing && JSON.stringify(strip(editing.draft)) !== editing.start; }
  function strip(d) { return { name: d.name, colours: d.colours, groups: d.groups.map(function (g) { return { label: g.label, baskets: g.baskets }; }) }; }
  function okToDiscard() { return !dirty() || window.confirm('Discard the changes to this preset?'); }

  function builtIn(ds) { return (ds && ds.basketSchemes) || []; }
  // The list is read on first use: the app asks for it while loading, before init().
  var loaded = false;
  function all(ds) { if (!loaded) { loaded = true; loadMine(); } return builtIn(ds).concat(mine); }
  function isMine(id) { return mine.some(function (p) { return p.id === id; }); }
  function find(ds, id) { return all(ds).filter(function (p) { return p.id === id; })[0] || null; }

  // Labels offered in the drop-downs: the data file's list, then labels
  // already used in any preset.
  function labelChoices(ds) {
    var seen = Object.create(null), out = [];
    function add(l) { l = String(l || '').trim(); if (l && !seen[l.toLowerCase()]) { seen[l.toLowerCase()] = 1; out.push(l); } }
    ((ds && ds.groupLabels) || []).forEach(add);
    all(ds).forEach(function (p) { p.groups.forEach(function (g) { add(g.label); }); });
    return out;
  }
  function colourChoices(draft) {
    var seen = Object.create(null), out = [];
    (draft.colours || []).concat(P.COLOUR_CHOICES).forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; out.push(c); } });
    return out;
  }

  // Ids carry a time and random part, so an id is never used again after a
  // delete (a save from another window can then never land on a different preset).
  function uniqueId(name) {
    var base = 'user-' + P.slug(name) + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), id = base, n = 2;
    while (find(Alpha.state.ds, id) || isBroken(KEY + id)) id = base + '-' + n++;
    return id;
  }
  // A free name that still fits the length limit.
  // Cuts text to n UTF-16 units without splitting a character (an emoji is two).
  // Cuts between characters as seen on screen (an emoji with its joiners and
  // skin tone, a flag, a Hindi conjunct stays whole), so no stray joiner is left.
  function cut(s, n) {
    if (s.length <= n) return s;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      var out = '', it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator](), g;
      while (!(g = it.next()).done && out.length + g.value.segment.length <= n) out += g.value.segment;
      return out;
    }
    s = s.slice(0, n); return /[\uD800-\uDBFF]$/.test(s) ? s.slice(0, -1) : s;
  }
  function uniqueName(name) {
    var taken = Object.create(null), out = cut(name, P.MAX_NAME), n = 2;
    all(Alpha.state.ds).forEach(function (p) { taken[P.sameKey(p.name)] = 1; });
    while (taken[P.sameKey(out)]) {
      var suffix = ' (' + n++ + ')';
      out = cut(name, P.MAX_NAME - suffix.length).trim() + suffix;
    }
    return out;
  }

  /* ---------- drawing ---------- */
  function swatches(p, g) {
    var byId = Object.create(null);
    p.colours.forEach(function (c) { byId[c.id] = c; });
    return g.baskets.map(function (b) {
      var c = byId[b] || { name: b, hex: '#ffffff' };
      return '<span class="swatch" style="background:' + (/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#ffffff') + '" aria-hidden="true"></span>';
    }).join('') + ' ' + g.baskets.map(function (b) { return esc((byId[b] || { name: b }).name); }).join(' + ');
  }

  function listHtml(ds) {
    var cur = Alpha.settings.scheme(ds);
    var row = function (p, own) {
      var inUse = cur && cur.id === p.id;
      return '<li class="preset-row' + (inUse ? ' in-use' : '') + '" data-id="' + esc(p.id) + '">' +
        '<div class="preset-name"><strong>' + esc(p.name) + '</strong> <span class="muted small">' + p.groups.length + ' groups' +
        (own ? ', yours' : ', built in') + (inUse ? ', <strong>in use</strong>' : '') + '</span></div>' +
        (own && warns[p.id] ? '<p class="note-bad small">Saved by an older version, and it does not pass today\'s checks: ' + esc(warns[p.id]) + ' Edit it to fix this.</p>' : '') +
        (own && alike[p.id] != null ? '<p class="note-bad small">' + esc(alikeText(p.id)) + '</p>' : '') +
        '<div class="preset-groups small">' + p.groups.map(function (g) { return '<span class="pg"><strong>' + esc(g.label) + '</strong> ' + swatches(p, g) + '</span>'; }).join('') + '</div>' +
        '<div class="preset-actions">' +
        (inUse ? '' : '<button type="button" class="btn small" data-act="use">Use</button> ') +
        (own ? '<button type="button" class="btn small" data-act="edit">Edit</button> ' : '<button type="button" class="btn small" data-act="copy">Copy and edit</button> ') +
        '<button type="button" class="btn small" data-act="download">Download .json</button>' +
        (own ? ' <button type="button" class="btn small" data-act="delete">Delete</button>' : '') +
        '</div></li>';
    };
    return '<ul class="preset-list">' + builtIn(ds).map(function (p) { return row(p, false); }).join('') +
      mine.map(function (p) { return row(p, true); }).join('') + '</ul>';
  }

  function labelCell(i, g, choices) {
    var known = choices.some(function (c) { return c === g.label; }), own = g.own || (!!g.label && !known);
    var opts = '<option value="">Choose a label…</option>' + choices.map(function (c) {
      return '<option value="' + esc(c) + '"' + (!own && c === g.label ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('') + '<option value="' + OWN + '"' + (own ? ' selected' : '') + '>Type your own…</option>';
    return '<select id="pl-' + i + '" data-i="' + i + '" data-f="label" aria-label="Group ' + (i + 1) + ' label" title="' + esc(g.label) + '">' + opts + '</select>' +
      '<input type="text" id="po-' + i + '" data-i="' + i + '" data-f="own" class="own-label" aria-label="Group ' + (i + 1) + ' label, typed"' +
      ' data-max="' + P.MAX_LABEL + '" value="' + esc(own ? g.label : '') + '"' + (own ? '' : ' hidden') + ' placeholder="Label">';
  }

  function basketCell(i, b, value, colours) {
    var opts = (b === 1 ? '<option value="' + NONE + '"' + (value ? '' : ' selected') + '>none</option>' : '') +
      colours.map(function (c) { return '<option value="' + esc(c.id) + '"' + (value === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    return '<select data-i="' + i + '" data-f="b' + b + '" aria-label="Group ' + (i + 1) + ' basket ' + (b + 1) + '">' + opts + '</select> ' +
      '<span class="swatch" id="sw-' + i + '-' + b + '" aria-hidden="true" style="background:' + hexOf(colours, value) + '"></span>';
  }
  function hexOf(colours, id) {
    var c = colours.filter(function (x) { return x.id === id; })[0];
    return c && /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : 'transparent';
  }

  function editorHtml(ds) {
    var d = editing.draft, choices = labelChoices(ds), colours = colourChoices(d);
    return '<fieldset class="preset-editor"><legend>' + (editing.origId ? 'Edit preset' : 'New preset') + '</legend>' +
      '<label>Name <input type="text" id="pe-name" data-max="' + P.MAX_NAME + '" value="' + esc(d.name) + '" placeholder="e.g. Our 9 baskets"></label>' +
      '<table class="pe-table"><thead><tr><th>#</th><th>Group label</th><th>Basket 1</th><th>Basket 2</th><th><span class="sr">Remove</span></th></tr></thead><tbody>' +
      d.groups.map(function (g, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + labelCell(i, g, choices) + '</td><td>' + basketCell(i, 0, g.baskets[0], colours) + '</td>' +
          '<td>' + basketCell(i, 1, g.baskets[1] || '', colours) + '</td>' +
          '<td><button type="button" class="btn small" data-act="remove-group" data-i="' + i + '" aria-label="Remove group ' + (i + 1) + '"' +
          (d.groups.length <= P.MIN_GROUPS ? ' disabled title="A preset needs at least ' + P.MIN_GROUPS + ' groups"' : '') + '>Remove</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<button type="button" class="btn small" data-act="add-group"' + (d.groups.length >= P.MAX_GROUPS ? ' disabled' : '') + '>Add a group</button>' +
      '<ul id="pe-errors" class="pe-errors" role="status" aria-live="polite"></ul>' +
      '<div class="pe-buttons"><button type="button" class="btn" data-act="save">Save</button> ' +
      '<button type="button" class="btn" data-act="save-use">Save and use</button> ' +
      '<button type="button" class="btn" data-act="cancel">Cancel</button> ' +
      '<button type="button" class="btn" data-act="dl-draft">Download draft</button></div></fieldset>';
  }

  // The page is drawn into #pe-body; #pe-live stays, so screen readers hear status changes.
  function body() {
    var b = dlg.querySelector('#pe-body');
    if (!b) { dlg.innerHTML = '<div id="pe-body"></div><p id="pe-live" class="sr" role="status" aria-live="polite"></p>'; b = dlg.querySelector('#pe-body'); }
    return b;
  }
  // again: say it even if it is the same text as before (a second failed save).
  function announce(text, again) {
    var l = dlg.querySelector('#pe-live'); if (!l) return;
    if (again && l.textContent === text) { l.textContent = ''; setTimeout(function () { l.textContent = text; }, 60); }
    else if (l.textContent !== text) l.textContent = text;
  }
  function render(focusSel) {
    if (focusSel === '#pe-status') ownStatusAt = Date.now();
    var ds = Alpha.state.ds;
    // The file picker is kept across redraws: a file being chosen while
    // another window changes presets (which redraws this page) still loads.
    var keepFile = body().querySelector('#pe-file');
    body().innerHTML = '<h2 id="presets-title">Basket presets</h2>' +
      '<p class="small">A preset sets the groups a script can belong to and the baskets for each group (at least ' + P.MIN_GROUPS + ' groups). ' +
      'Built-in presets come with the data; yours are kept in this browser' + (memoryOnly ? ' <strong class="note-bad">(this browser is not saving them: download them to keep them)</strong>' : '') + '.</p>' +
      (broken.length ? '<div class="note-bad small">' + broken.length + ' saved preset(s) could not be read; they are left unchanged in this browser\'s storage:<ul class="broken-list">' +
        broken.map(function (b) {
          return '<li>' + esc('alpha.' + b.key) + ': ' + esc(String(b.why).replace(/\.$/, '')) + '. <button type="button" class="btn small" data-act="broken-dl" data-key="' + esc(b.key) + '">Download as is</button> ' +
            '<button type="button" class="btn small" data-act="broken-rm" data-key="' + esc(b.key) + '">Remove</button></li>';
        }).join('') + '</ul></div>' : '') +
      (notMigrated ? '<p class="note-bad small">' + notMigrated + ' preset(s) saved by an older version of Alpha could not be copied to the new storage because this browser\'s storage is full. ' +
        'They are kept as they were and will be copied once space is freed.</p>' : '') +
      (oldLeft ? '<div class="note-bad small" data-testid="old-presets">Presets data saved by an older version of Alpha needs a look: ' +
        [oldLeft.unreadableList ? 'the old preset list is not readable' : '', oldLeft.notPresets ? oldLeft.notPresets + (oldLeft.notPresets === 1 ? ' entry is not a preset' : ' entries are not presets') : '',
          oldLeft.backup ? 'there is an older backup (alpha.presets-unreadable)' : '',
          oldLeft.unsure ? oldLeft.unsure + ' preset' + (oldLeft.unsure === 1 ? '' : 's') + ' saved by an older version ' + (oldLeft.unsure === 1 ? 'is' : 'are') + ' not in your list now as ' + (oldLeft.unsure === 1 ? 'it was' : 'they were') + ': deleted or changed since, or that version did not copy ' + (oldLeft.unsure === 1 ? 'it' : 'them') + '. Restore adds ' + (oldLeft.unsure === 1 ? 'it as a new preset' : 'them as new presets') : ''].filter(Boolean).join('; ') +
        '. It is kept unchanged. <button type="button" class="btn small" data-act="old-dl">Download old data</button>' +
        (oldLeft.unsure ? ' <button type="button" class="btn small" data-act="old-restore">Restore ' + (oldLeft.unsure === 1 ? 'it' : 'all ' + oldLeft.unsure) + '</button>' : '') +
        (oldLeft.waiting && oldLeft.waiting.length ? '<ul class="old-waiting">' + oldLeft.waiting.map(function (w) {
          return '<li>' + esc(w.name) + ' <button type="button" class="btn small" data-act="old-restore-one" data-k="' + esc(w.k) + '" aria-label="Restore ' + esc(w.name) + '">Restore</button></li>';
        }).join('') + '</ul>' : '') +
        // Not while old presets still wait to be copied: removing would lose them.
        (notMigrated ? ' (Remove is offered once the waiting presets are copied.)' : ' <button type="button" class="btn small" data-act="old-rm">Remove old data</button>') + '</div>' : '') +
      listHtml(ds) +
      '<div class="pe-top"><button type="button" class="btn" data-act="new">New preset</button> ' +
      '<label class="btn file-btn">Load .json file<input type="file" id="pe-file" accept=".json,application/json"></label></div>' +
      '<p id="pe-status" class="small" tabindex="-1">' + esc(status) + '</p>' +
      (editing ? editorHtml(ds) : '') +
      '<div class="dialog-actions"><button type="button" class="btn" data-act="close">Close</button></div>';
    var newFile = body().querySelector('#pe-file');
    if (keepFile && newFile) newFile.replaceWith(keepFile);
    if (editing) showErrors();
    var f = focusSel && dlg.querySelector(focusSel);
    if (f) f.focus();
    // In the name box the caret goes to the end, so typing adds to the name.
    if (f && f.id === 'pe-name' && f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length);
    announce(status);
  }

  // A selector for the focused control, so a redraw can put focus back.
  function focusKey(el) {
    if (!el || !dlg.contains(el) || el === dlg) return null;
    // CSS.escape handles any character a stored key may hold (quotes, line breaks).
    var a = function (n) { return el.getAttribute(n); }, q = function (v) { return '"' + CSS.escape(String(v)) + '"'; };
    if (el.id) return '#' + el.id;
    var row = el.closest('.preset-row');
    if (row && a('data-act')) return '.preset-row[data-id=' + q(row.getAttribute('data-id')) + '] [data-act=' + q(a('data-act')) + ']';
    if (a('data-act') && a('data-key')) return '[data-act=' + q(a('data-act')) + '][data-key=' + q(a('data-key')) + ']';
    if (a('data-act') && a('data-i')) return '[data-act=' + q(a('data-act')) + '][data-i=' + q(a('data-i')) + ']';
    if (a('data-i') && a('data-f')) return '[data-i=' + q(a('data-i')) + '][data-f=' + q(a('data-f')) + ']';
    if (a('data-act')) return '[data-act=' + q(a('data-act')) + ']';
    return null;
  }
  // Redraw (after a change in another window) keeping focus and the caret.
  function redrawKeepingFocus() {
    var el = document.activeElement, sel = focusKey(el), caret = null;
    try { if (el && typeof el.selectionStart === 'number') caret = [el.selectionStart, el.selectionEnd]; } catch (e) { caret = null; }
    render();
    var back = null;
    try { back = sel && dlg.querySelector(sel); } catch (e) { back = null; }
    if (!back) back = dlg.querySelector('#pe-status');
    if (back) {
      back.focus();
      if (caret) try { back.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text field */ }
    }
  }

  // Names are compared as they will be stored (spacing tidied, any case).
  function nameTaken(name, exceptId) {
    var n = P.sameKey(name);
    return all(Alpha.state.ds).some(function (p) { return p.id !== exceptId && P.sameKey(p.name) === n; });
  }
  // Colours offered but not used by any group do not count.
  function inUse(d) {
    var used = Object.create(null);
    d.groups.forEach(function (g) { g.baskets.forEach(function (b) { used[b] = 1; }); });
    return { name: d.name, colours: d.colours.filter(function (c) { return used[c.id]; }), groups: d.groups };
  }
  // Problems are listed once something was changed or Save was tried, so a
  // new blank preset does not open with a list of errors.
  function showErrors() {
    var errs = P.check(inUse(editing.draft)), el = dlg.querySelector('#pe-errors');
    if (nameTaken(editing.draft.name, editing.origId)) errs.unshift('Another preset already has this name, or one that looks the same on screen.');
    var html = editing.tried || dirty() ? errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') : '';
    if (el.innerHTML !== html) el.innerHTML = html; // unchanged text is not announced again
    return errs;
  }

  /* ---------- actions ---------- */
  function startEdit(p, origId) {
    var d = JSON.parse(JSON.stringify(p));
    standardColours(d);
    d.groups.forEach(function (g) { g.own = false; });
    // base: the stored text when editing began, to notice a save from another window.
    editing = { origId: origId, draft: d, start: JSON.stringify(strip(d)), base: origId ? store.raw(KEY + origId) : null };
    status = '';
    render('#pe-name');
  }

  function standardColours(d) {
    var std = function (name) { var n = P.clean(name).toLowerCase(); return P.COLOUR_CHOICES.filter(function (c) { return c.name.toLowerCase() === n; })[0]; };
    var map = Object.create(null), taken = Object.create(null);
    d.colours.forEach(function (c) { var s = std(c.name); if (s && !taken[s.id]) { taken[s.id] = 1; map[c.id] = s.id; } });
    if (!Object.keys(map).length) return;
    d.colours = d.colours.map(function (c) { var s = map[c.id] && std(c.name); return s ? { id: s.id, name: s.name, hex: s.hex } : c; })
      .filter(function (c, i, all) { return all.findIndex(function (x) { return x.id === c.id; }) === i; });
    d.groups.forEach(function (g) { g.baskets = g.baskets.map(function (b) { return map[b] || b; }); });
  }

  function blankPreset() {
    var c = P.COLOUR_CHOICES;
    return { name: '', colours: c.slice(0, 3).map(function (x) { return { id: x.id, name: x.name, hex: x.hex }; }),
      groups: [0, 1, 2].map(function (i) { return { label: '', baskets: [c[i].id] }; }) };
  }

  function ensureColour(id) {
    var d = editing.draft;
    if (!id || d.colours.some(function (c) { return c.id === id; })) return;
    var c = P.COLOUR_CHOICES.filter(function (x) { return x.id === id; })[0];
    if (c) d.colours.push({ id: c.id, name: c.name, hex: c.hex });
  }

  function save(andUse) {
    editing.tried = true;
    var errs0 = showErrors();
    if (errs0.length) {
      // Said every time Save is pressed, not only when the list of problems changes.
      announce('Not saved: ' + errs0.length + ' thing' + (errs0.length > 1 ? 's' : '') + ' to fix. ' + errs0[0], true);
      dlg.querySelector('#pe-errors').scrollIntoView({ block: 'nearest' });
      return;
    }
    var t = P.tidy(editing.draft);
    if (editing.origId) {
      // Deleted in another window while being edited? Ask before bringing it back.
      var now = memoryOnly ? editing.base : store.raw(KEY + editing.origId);
      if (now == null && !memoryOnly) {
        if (!window.confirm('This preset was deleted in another window. Save it again?')) return;
      } else if (now !== editing.base) {
        // Saved in another window since editing began: never overwrite it unasked.
        if (!window.confirm('This preset was changed in another window after you started editing. Save your version over those changes?')) {
          status = 'Not saved. Your changes are still in the editor; the other window\'s version is in the list above.';
          var st0 = dlg.querySelector('#pe-status'); st0.textContent = status; announce(status, true); st0.focus();
          return;
        }
      }
      t.id = editing.origId;
    } else t.id = uniqueId(t.name);
    // Checked again just before writing: while a question above was open,
    // another window may have saved a preset with a name that looks the same.
    // Then this one is renamed, as for two saves at the same moment.
    loadMine();
    var preClash = '';
    if (nameTaken(t.name, editing.origId)) {
      var wasN = t.name, k0 = P.sameKey(wasN), other = all(Alpha.state.ds).filter(function (q) { return q.id !== editing.origId && P.sameKey(q.name) === k0; })[0];
      t.name = uniqueName(wasN);
      preClash = ' Another window saved a preset named "' + (other ? other.name : wasN) + '"' + (other && other.name !== wasN ? ', which looks the same as "' + wasN + '",' : '') + ' just now, so yours is now "' + t.name + '".';
    }
    if (!saveOne(t)) {
      status = 'Not saved: this browser would not store the preset (its storage may be full). Your changes are still in the editor; "Download draft" keeps them as a file.';
      var st = dlg.querySelector('#pe-status'); st.textContent = status; announce(status, true); st.focus();
      return;
    }
    mySaves[t.id] = 1;
    justSaved[t.id] = { raw: store.raw(KEY + t.id), at: Date.now(), preset: JSON.parse(JSON.stringify(t)) };
    var renamed = renameClashes(), clash = preClash + (renamed.length ? ' ' + renamed.join(' ') : '');
    if (renamed.length) { var now2 = find(Alpha.state.ds, t.id); if (now2) t.name = now2.name; }
    editing = null;
    status = memoryOnly ? 'Saved "' + t.name + '" for this visit only: this browser is not saving presets, so download it to keep it.' : 'Saved "' + t.name + '".' + clash;
    if (andUse) Alpha.settings.useScheme(t.id); else Alpha.settings.notify();
    render('#pe-status');
  }

  function download(p) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([P.toFile(p)], { type: 'application/json' }));
    a.download = 'basket-preset-' + P.slug(p.name) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function loadFile(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    input.value = ''; // the same file can be chosen again
    if (f.size > P.MAX_FILE_BYTES) { status = f.name + ' could not be loaded: it is too large to be a preset (over ' + (P.MAX_FILE_BYTES / 1024) + ' KB).'; render('#pe-status'); return; }
    var r = new FileReader();
    r.onload = function () {
      var res = P.fromFile(String(r.result));
      if (res.errors.length) { status = f.name + ' could not be loaded: ' + res.errors.join(' '); render('#pe-status'); return; }
      var p = res.preset;
      p.name = uniqueName(p.name);
      p.id = uniqueId(p.name);
      if (!saveOne(p)) { status = f.name + ' was read but not saved: this browser would not store it (its storage may be full).'; render('#pe-status'); return; }
      // Another window loading the same file at the same moment: this one is renamed (as for Save).
      mySaves[p.id] = 1;
      var renamedL = renameClashes();
      if (renamedL.length) { var nowP = find(Alpha.state.ds, p.id); if (nowP) p.name = nowP.name; }
      Alpha.settings.notify();
      status = 'Loaded "' + p.name + '" from ' + f.name + '.' + (res.warnings.length ? ' Note: ' + res.warnings.join(', ') + '.' : '') + (renamedL.length ? ' ' + renamedL.join(' ') : '');
      render('#pe-status');
    };
    r.onerror = function () { status = 'Could not read ' + f.name + '.'; render('#pe-status'); };
    r.readAsText(f);
  }

  function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act'), row = b.closest('.preset-row'), ds = Alpha.state.ds;
    var p = row ? find(ds, row.getAttribute('data-id')) : null;
    if (row && !p) {
      // The row was drawn before another window deleted the preset.
      status = 'That preset is no longer saved in this browser (it was deleted in another window).';
      render('#pe-status');
      return;
    }
    if (act === 'use') {
      Alpha.settings.useScheme(p.id);
      status = 'Now using "' + p.name + '".' + (Alpha.settings.savedOk() ? '' : ' This choice could not be saved in this browser (its storage may be full), so it lasts until the page is closed.');
      render('#pe-status');
    }
    else if (act === 'edit') { if (okToDiscard()) startEdit(p, p.id); }
    else if (act === 'copy') { if (!okToDiscard()) return; var c = JSON.parse(JSON.stringify(p)); c.name = cut(uniqueName('Copy of ' + p.name), P.MAX_NAME); startEdit(c, null); }
    else if (act === 'download') download(p);
    else if (act === 'old-dl') downloadOld();
    else if (act === 'old-restore' || act === 'old-restore-one') {
      var got = restoreOld(act === 'old-restore-one' ? b.getAttribute('data-k') : null); loadMine(); Alpha.settings.notify();
      status = got.length ? 'Restored ' + got.length + ' preset' + (got.length === 1 ? '' : 's') + ' from the older version: ' +
          got.slice(0, 10).map(function (n) { return '"' + n + '"'; }).join(', ') + (got.length > 10 ? ' and ' + (got.length - 10) + ' more' : '') + '.'
        : already ? 'Already in your list (restored or moved in another window); nothing was added.'
        : act === 'old-restore-one' && !gone ? 'Nothing could be restored (this browser\'s storage may be full).'
        : act === 'old-restore-one' ? 'That entry is no longer in the old list (another window changed it); nothing was restored. The list below is up to date.'
        : 'Nothing could be restored (this browser\'s storage may be full).';
      render('#pe-status');
    }
    else if (act === 'old-rm') {
      if (notMigrated) return; // presets still waiting to be copied would be lost
      var lost = oldLeft ? [oldLeft.unsure ? oldLeft.unsure + ' preset' + (oldLeft.unsure === 1 ? '' : 's') + ' not in your list now' : '', oldLeft.notPresets ? oldLeft.notPresets + (oldLeft.notPresets === 1 ? ' entry that is not a preset' : ' entries that are not presets') : '', oldLeft.backup ? 'the older backup' : '', oldLeft.unreadableList ? 'the unreadable old list' : ''].filter(Boolean).join(', ') : '';
      if (!window.confirm('Remove the old presets data? This removes ' + (lost || 'it') + '. Presets in your list stay. This cannot be undone (download it first to keep a copy).')) return;
      store.remove('presets'); store.remove('presets-unreadable'); store.remove('presets-waiting');
      loadMine();
      status = 'Removed the old presets data.';
      render('#pe-status');
    }
    else if (act === 'broken-dl' || act === 'broken-rm') {
      var key = b.getAttribute('data-key'), raw = store.raw(key);
      if (act === 'broken-dl') {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([raw == null ? '' : raw], { type: 'application/json' }));
        a.download = 'unreadable-' + key.replace(/[^A-Za-z0-9_.-]/g, '_') + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        return;
      }
      if (!window.confirm('Remove the unreadable entry alpha.' + key + '? This cannot be undone (download it first to keep a copy).')) return;
      store.remove(key);
      loadMine();
      status = 'Removed alpha.' + key + '.';
      render('#pe-status');
    }
    else if (act === 'delete') {
      var inUse = (Alpha.settings.scheme(ds) || {}).id === p.id;
      var editingIt = !!editing && editing.origId === p.id && dirty(), asked = memoryOnly ? null : store.raw(KEY + p.id);
      if (!window.confirm('Delete the preset "' + p.name + '"?' + (inUse ? ' It is the preset in use.' : '') +
        (editingIt ? ' Your unsaved changes to it in the editor are lost too.' : '') +
        ' This cannot be undone (download it first to keep a copy).')) return;
      // Changed in another window while the question was open: what was asked
      // about is not what would go. Checked a moment later, once changes made
      // by other windows while the question blocked this one have arrived.
      setTimeout(function () {
        if (!memoryOnly && store.raw(KEY + p.id) !== asked) {
          loadMine();
          status = '"' + p.name + '" was not deleted: another window changed it while you were deciding. The list is up to date; delete it again if you still want to.';
          render('#pe-status'); announce(status, true);
          return;
        }
        if (!removeOne(p.id)) { status = '"' + p.name + '" could not be deleted from this browser\'s storage.'; render('#pe-status'); return; }
        if (editing && editing.origId === p.id) editing = null;
        status = 'Deleted "' + p.name + '".';
        var fallback = builtIn(ds)[0] || mine[0];
        if (inUse && fallback) { Alpha.settings.useScheme(fallback.id); status += ' Now using "' + fallback.name + '".'; }
        else Alpha.settings.notify();
        render('#pe-status');
      }, 150);
    }
    else if (act === 'new') { if (okToDiscard()) startEdit(blankPreset(), null); }
    else if (act === 'add-group') {
      var d = editing.draft, used = {};
      d.groups.forEach(function (g) { used[g.baskets.join('+')] = 1; });
      // Start the new group on a basket combination not used yet, where possible.
      // Only colours that do not look like another colour in the preset.
      var cols = colourChoices(d).filter(function (c) {
        return !d.colours.some(function (x) { return x.id !== c.id && P.looksAlike(x.hex, c.hex); });
      }).map(function (c) { return c.id; }), pick = [cols[0]];
      outer: for (var i = 0; i < cols.length; i++) {
        if (!used[cols[i]]) { pick = [cols[i]]; break; }
        for (var j = 0; j < cols.length; j++) if (!used[cols[i] + '+' + cols[j]]) { pick = [cols[i], cols[j]]; break outer; }
      }
      pick.forEach(ensureColour);
      d.groups.push({ label: '', baskets: pick });
      render('#pl-' + (d.groups.length - 1));
    }
    else if (act === 'remove-group') {
      editing.draft.groups.splice(Number(b.getAttribute('data-i')), 1);
      render('[data-act="add-group"]');
    }
    else if (act === 'dl-draft') { var dft = P.tidy(editing.draft); dft.id = editing.origId || 'user-draft'; if (!dft.name) dft.name = 'Draft'; download(dft); }
    else if (act === 'save') save(false);
    else if (act === 'save-use') save(true);
    else if (act === 'cancel') { if (!okToDiscard()) return; editing = null; status = ''; render('[data-act="new"]'); }
    else if (act === 'close') { if (okToDiscard()) { editing = null; dlg.close(); } }
  }

  function tooLong(max) { announce('That is the most a ' + (max === P.MAX_NAME ? 'name' : 'label') + ' can have (' + max + ' characters).'); }
  // Typing or pasting past the limit: only what fits is put in, cut between
  // characters as seen on screen, where the caret is.
  function onBeforeInput(e) {
    var t = e.target, max = Number(t.getAttribute && t.getAttribute('data-max'));
    if (!max || e.isComposing || !/^insert/.test(e.inputType || '')) return;
    var text = e.data != null ? e.data : e.dataTransfer ? e.dataTransfer.getData('text/plain') : null;
    if (text == null) return;
    var s = t.selectionStart, en = t.selectionEnd, room = max - (t.value.length - (en - s));
    if (text.length <= room) return;
    e.preventDefault();
    var piece = room > 0 ? cut(text.replace(/[\r\n]+/g, ' '), room) : '';
    if (piece) { t.setRangeText(piece, s, en, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); }
    tooLong(max);
  }
  function onInput(e) {
    var t = e.target;
    if (t.id === 'pe-file') { loadFile(t); return; }
    if (!editing) return;
    // Too long: cut between characters as seen on screen (the browser's maxlength
    // could leave half an emoji or a Hindi letter without its vowel). Not while
    // a word is still being composed with an input method.
    var max = Number(t.getAttribute('data-max'));
    if (max && t.value.length > max && !e.isComposing) {
      // (typing and pasting are stopped before this, in onBeforeInput; this is
      // for input methods and drops) back to the text before, caret kept
      var pos = t.selectionStart, prev = t.getAttribute('data-prev'), over = t.value.length - max;
      if (prev != null && prev.length <= max) { t.value = prev; t.setSelectionRange(Math.max(0, pos - over), Math.max(0, pos - over)); }
      else t.value = cut(t.value, max);
      tooLong(max);
    }
    if (max) t.setAttribute('data-prev', t.value);
    if (t.id === 'pe-name') { editing.draft.name = t.value; showErrors(); return; }
    var i = Number(t.getAttribute('data-i')), f = t.getAttribute('data-f');
    if (isNaN(i) || !f) return;
    var g = editing.draft.groups[i];
    if (f === 'label') {
      var own = dlg.querySelector('#po-' + i);
      if (t.value === OWN) { g.own = true; own.hidden = false; g.label = own.value; if (e.type === 'change' && Date.now() - lastArrowAt > 400) own.focus(); }
      else { g.own = false; own.hidden = true; g.label = t.value; }
    } else if (f === 'own') g.label = t.value;
    else if (f === 'b0' || f === 'b1') {
      ensureColour(t.value);
      if (f === 'b0') g.baskets[0] = t.value; else if (t.value) g.baskets[1] = t.value; else g.baskets.length = 1;
      var sw = dlg.querySelector('#sw-' + i + '-' + f.slice(1));
      if (sw) sw.style.background = hexOf(colourChoices(editing.draft), t.value);
    }
    showErrors();
  }

  function open() {
    dlg = document.getElementById('presets');
    status = '';
    render();
    dlg.showModal();
    var first = dlg.querySelector('.preset-row.in-use button, [data-act="new"]');
    if (first) first.focus();
  }

  function init() {
    if (!loaded) { loaded = true; loadMine(); }
    dlg = document.getElementById('presets');
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('change', onInput);
    dlg.addEventListener('input', function (e) { if (e.target.tagName === 'INPUT' && e.target.type === 'text') onInput(e); });
    dlg.addEventListener('beforeinput', onBeforeInput);
    dlg.addEventListener('compositionend', function (e) { if (e.target.tagName === 'INPUT' && e.target.type === 'text') onInput(e); });
    // Esc with unsaved changes asks first. It is handled on the key press,
    // because Chromium stops honouring a prevented "cancel" after the first
    // one; if the dialog is closed anyway, it reopens with the draft.
    var escAsked = false, keepOpen = false;
    dlg.addEventListener('keydown', function (e) {
      // Arrow keys on a closed drop-down change it as they go; remember that, so
      // passing "Type your own…" does not pull focus into the text box.
      if (e.target.tagName === 'SELECT' && /^(Arrow|Home|End|Page)/.test(e.key)) lastArrowAt = Date.now();
      if (e.key !== 'Escape' || !dirty()) return;
      e.preventDefault(); e.stopPropagation();
      escAsked = true; setTimeout(function () { escAsked = false; }, 0);
      if (window.confirm('Discard the changes to this preset?')) { editing = null; dlg.close(); }
    }, true);
    dlg.addEventListener('cancel', function (e) {
      if (!dirty()) { editing = null; return; }
      if (!escAsked && window.confirm('Discard the changes to this preset?')) { editing = null; return; }
      e.preventDefault();
      if (!e.cancelable) keepOpen = true;
    });
    dlg.addEventListener('close', function () {
      if (keepOpen && editing) {
        keepOpen = false;
        dlg.showModal();
        status = 'Your unsaved changes are still here.';
        redrawKeepingFocus();
        return;
      }
      keepOpen = false;
      editing = null;
      Alpha.settings.open();
    });
    // Closing or reloading the tab with an unsaved draft asks first.
    window.addEventListener('beforeunload', function (e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
    // Another window saved or deleted a preset: reload the list.
    window.addEventListener('storage', function (e) {
      // The old list too: an older version open in another tab can write it again.
      if (e.key != null && e.key.indexOf('alpha.' + KEY) !== 0 && e.key !== 'alpha.presets') return;
      loadMine();
      var renamed = renameClashes();
      Alpha.settings.notify();
      if (!dlg.open) return;
      if (renamed.length) { status = renamed.join(' '); redrawKeepingFocus(); return; }
      // Another window saved its own edit to a preset this window saved a
      // moment ago (both clicked Save at once): its version replaced ours. Ours
      // is put back in the editor, so it is not lost unseen.
      var jid = e.key && e.key.indexOf('alpha.' + KEY) === 0 ? e.key.slice(('alpha.' + KEY).length) : null, js = jid && justSaved[jid];
      // (what is stored now decides it, not the event: the window whose edit is
      // stored has nothing to be told; and only for saves within 1.5 s)
      var nowRaw = jid ? store.raw(KEY + jid) : null;
      if (js && Date.now() - js.at < 1500 && nowRaw != null && nowRaw !== js.raw && !editing) {
        delete justSaved[jid];
        startEdit(js.preset, jid);
        editing.base = js.raw; // so Save asks before replacing the other window's version
        status = 'Another window saved its own changes to "' + js.preset.name + '" at the same moment, over yours. Your version is back in the editor: save it to keep it (you will be asked before replacing the other version), or Cancel to keep the other.';
        render('#pe-status'); announce(status, true);
        return;
      }
      // The list is redrawn; an open draft is kept as it is (it lives in memory).
      if (editing && editing.origId && e.key === 'alpha.' + KEY + editing.origId) {
        status = e.newValue == null ? 'The preset you are editing was deleted in another window. Saving will ask before bringing it back.'
          : 'The preset you are editing was changed in another window. Saving will ask before replacing that version.';
      } else if (Date.now() - ownStatusAt > 2000) status = 'Presets were changed in another window; the list is up to date.'; // (a message from this window's own action, just shown, stays)
      redrawKeepingFocus();
    });
  }

  Alpha.presetsUI = { init: init, open: open, all: all, find: find, warning: function (id) { return warns[id] || null; }, alike: function (id) { return alike[id] != null ? alike[id] : null; } };
})(window.Alpha);
