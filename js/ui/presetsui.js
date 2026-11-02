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
  var dlg = null, editing = null, status = '';

  function builtInIds() {
    var ids = Object.create(null);
    (((Alpha.state && Alpha.state.ds) || window.ALPHA_DATASETS && (window.ALPHA_DATASETS.real || window.ALPHA_DATASETS.sample) || {}).basketSchemes || [])
      .forEach(function (p) { ids[p.id] = 1; });
    return ids;
  }

  function builtInNames() {
    var ds = (Alpha.state && Alpha.state.ds) || (window.ALPHA_DATASETS && (window.ALPHA_DATASETS.real || window.ALPHA_DATASETS.sample)) || {};
    return (ds.basketSchemes || []).map(function (p) { return P.sameKey(p.name); });
  }

  function loadMine() {
    var ok = [], bad = [], names = Object.create(null), builtins = builtInIds();
    builtInNames().forEach(function (n) { names[n] = 1; });
    if (memoryOnly) return; // storage is blocked: keep what is in memory
    migrateOldList();
    store.keys(KEY).forEach(function (k) {
      var id = k.slice(KEY.length), raw = store.raw(k), p = null, why = null;
      try { p = JSON.parse(raw); } catch (e) { p = null; }
      if (!p || typeof p !== 'object' || Array.isArray(p)) why = 'it is not readable preset data';
      else if (!ID_RE.test(id) || p.id !== id) why = 'its id does not match its storage key';
      else if (builtins[id]) why = 'it has the id of a built-in preset';
      else if (P.check(p).length) why = P.check(p)[0];
      else if (names[P.sameKey(p.name)]) why = 'another preset (built in or yours) already has the name "' + P.clean(p.name) + '"';
      if (!why) { names[P.sameKey(p.name)] = 1; ok.push(p); } else bad.push({ key: k, why: why });
    });
    mine = ok; broken = bad;
  }
  function isBroken(key) { return broken.some(function (b) { return b.key === key; }); }

  /* Version-14 to 16 kept all presets in one list under "alpha.presets".
     Each entry is MOVED: copied to its own entry, then taken out of the old
     list. So an entry is moved once at most, and a preset deleted later has
     nothing to come back from. An entry that does not fit (full storage)
     stays in the old list and is tried again on the next load; nothing else
     is retried. An entry already stored with exactly the same contents
     counts as moved (a move whose second step did not happen). Missing, bad,
     repeated or taken ids get a new id.
     Versions 17-21 ("alpha.presets-migrated") and 22-23
     ("alpha.presets-migrated-2") copied entries and left the old list as it
     was; which entries each one copied differs. With either flag set,
     nothing is copied unasked: an exact copy counts as moved, and every
     other entry (deleted or changed since, or never copied) is kept and
     shown with "Restore them". Entries that are not presets, an old list
     that cannot be read, and the version-16 backup are shown too. */
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
    // Versions 17-21 wrote "presets-migrated", versions 22-23 "presets-migrated-2"
    // after copying the list (and left it in place). Either means an older
    // version copied it already: nothing is copied again unasked.
    var ranBefore = store.raw('presets-migrated') != null || store.raw('presets-migrated-2') != null, notPresets = 0, unsure = 0;
    if (o.list) {
      var used = builtInIds(), seenIds = Object.create(null), have = Object.create(null), keep = [], moved = false;
      store.keys(KEY).forEach(function (k) { var q = null; try { q = JSON.parse(store.raw(k)); } catch (e) { q = null; } if (presetLike(q)) have[contentKey(q)] = 1; });
      o.list.forEach(function (p) {
        if (!presetLike(p)) { notPresets++; keep.push(p); return; }
        var firstOfId = typeof p.id === 'string' && ID_RE.test(p.id) && !seenIds[p.id];
        var goodId = firstOfId && !used[p.id];
        if (typeof p.id === 'string') seenIds[p.id] = 1;
        if (have[contentKey(p)]) { moved = true; return; } // an exact copy is stored: already moved
        if (ranBefore) { unsure++; keep.push(p); return; } // deleted or changed since, or never copied: ask, never bring back unasked
        var stored = goodId && store.raw(KEY + p.id) != null;
        var id = goodId && !stored ? p.id : freeId(p.name, used);
        if (store.set(KEY + id, Object.assign({}, p, { id: id }))) { used[id] = 1; have[contentKey(p)] = 1; moved = true; }
        else { notMigrated++; keep.push(p); }
      });
      if (moved) writeOld(keep);
    }
    if ((o.raw != null && !o.list) || notPresets || unsure || backup != null) {
      oldLeft = { unreadableList: o.raw != null && !o.list, notPresets: notPresets, unsure: unsure, backup: backup != null };
    }
  }
  // "Restore them": the entries an older version may have copied, which are
  // not stored now, are moved as new presets (with new ids).
  function restoreOld() {
    var o = oldList(); if (!o.list) return 0;
    var used = builtInIds(), keep = [], n = 0, have = Object.create(null);
    store.keys(KEY).forEach(function (k) { var q = null; try { q = JSON.parse(store.raw(k)); } catch (e) { q = null; } if (presetLike(q)) have[contentKey(q)] = 1; });
    o.list.forEach(function (p) {
      if (!presetLike(p)) { keep.push(p); return; }
      if (have[contentKey(p)]) return; // stored already
      have[contentKey(p)] = 1;
      var id = freeId(p.name, used);
      if (store.set(KEY + id, Object.assign({}, p, { id: id }))) { used[id] = 1; n++; } else keep.push(p);
    });
    writeOld(keep);
    return n;
  }
  function downloadOld() {
    var a = document.createElement('a'), out = { 'alpha.presets': store.raw('presets'), 'alpha.presets-unreadable': store.raw('presets-unreadable') };
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' }));
    a.download = 'old-basket-presets.json';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // Returns false when the browser would not store it (for example, full).
  function saveOne(p) {
    if (memoryOnly) { mine = mine.filter(function (x) { return x.id !== p.id; }).concat([p]); return true; }
    var ok = store.set(KEY + p.id, p);
    loadMine();
    return ok;
  }
  function removeOne(id) {
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
  function cut(s, n) { s = s.slice(0, n); return /[\uD800-\uDBFF]$/.test(s) ? s.slice(0, -1) : s; }
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
      ' maxlength="' + P.MAX_LABEL + '" value="' + esc(own ? g.label : '') + '"' + (own ? '' : ' hidden') + ' placeholder="Label">';
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
      '<label>Name <input type="text" id="pe-name" maxlength="' + P.MAX_NAME + '" value="' + esc(d.name) + '" placeholder="e.g. Our 9 baskets"></label>' +
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
      '<button type="button" class="btn" data-act="cancel">Cancel</button></div></fieldset>';
  }

  // The page is drawn into #pe-body; #pe-live stays, so screen readers hear status changes.
  function body() {
    var b = dlg.querySelector('#pe-body');
    if (!b) { dlg.innerHTML = '<div id="pe-body"></div><p id="pe-live" class="sr" role="status" aria-live="polite"></p>'; b = dlg.querySelector('#pe-body'); }
    return b;
  }
  function announce(text) { var l = dlg.querySelector('#pe-live'); if (l && l.textContent !== text) l.textContent = text; }
  function render(focusSel) {
    var ds = Alpha.state.ds;
    body().innerHTML = '<h2 id="presets-title">Basket presets</h2>' +
      '<p class="small">A preset sets the groups a script can belong to and the baskets for each group (at least ' + P.MIN_GROUPS + ' groups). ' +
      'Built-in presets come with the data; yours are kept in this browser' + (memoryOnly ? ' <strong class="note-bad">(this browser is not saving them: download them to keep them)</strong>' : '') + '.</p>' +
      (broken.length ? '<div class="note-bad small">' + broken.length + ' saved preset(s) could not be read; they are left unchanged in this browser\'s storage:<ul class="broken-list">' +
        broken.map(function (b) {
          return '<li>' + esc('alpha.' + b.key) + ': ' + esc(b.why) + '. <button type="button" class="btn small" data-act="broken-dl" data-key="' + esc(b.key) + '">Download as is</button> ' +
            '<button type="button" class="btn small" data-act="broken-rm" data-key="' + esc(b.key) + '">Remove</button></li>';
        }).join('') + '</ul></div>' : '') +
      (notMigrated ? '<p class="note-bad small">' + notMigrated + ' preset(s) saved by an older version of Alpha could not be copied to the new storage because this browser\'s storage is full. ' +
        'They are kept as they were and will be copied once space is freed.</p>' : '') +
      (oldLeft ? '<div class="note-bad small" data-testid="old-presets">Presets data saved by an older version of Alpha could not all be read: ' +
        [oldLeft.unreadableList ? 'the old preset list is not readable' : '', oldLeft.notPresets ? oldLeft.notPresets + (oldLeft.notPresets === 1 ? ' entry is not a preset' : ' entries are not presets') : '',
          oldLeft.backup ? 'there is an older backup (alpha.presets-unreadable)' : '',
          oldLeft.unsure ? oldLeft.unsure + ' preset' + (oldLeft.unsure === 1 ? '' : 's') + ' saved by an older version ' + (oldLeft.unsure === 1 ? 'is' : 'are') + ' not in your list now as ' + (oldLeft.unsure === 1 ? 'it was' : 'they were') + ': deleted or changed since, or that version did not copy ' + (oldLeft.unsure === 1 ? 'it' : 'them') + '. Restore adds ' + (oldLeft.unsure === 1 ? 'it' : 'them') + ' as new presets' : ''].filter(Boolean).join('; ') +
        '. It is kept unchanged. <button type="button" class="btn small" data-act="old-dl">Download old data</button>' +
        (oldLeft.unsure ? ' <button type="button" class="btn small" data-act="old-restore">Restore them</button>' : '') +
        // Not while old presets still wait to be copied: removing would lose them.
        (notMigrated ? ' (Remove is offered once the waiting presets are copied.)' : ' <button type="button" class="btn small" data-act="old-rm">Remove old data</button>') + '</div>' : '') +
      listHtml(ds) +
      '<div class="pe-top"><button type="button" class="btn" data-act="new">New preset</button> ' +
      '<label class="btn file-btn">Load .json file<input type="file" id="pe-file" accept=".json,application/json"></label></div>' +
      '<p id="pe-status" class="small" tabindex="-1">' + esc(status) + '</p>' +
      (editing ? editorHtml(ds) : '') +
      '<div class="dialog-actions"><button type="button" class="btn" data-act="close">Close</button></div>';
    if (editing) showErrors();
    var f = focusSel && dlg.querySelector(focusSel);
    if (f) f.focus();
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
    if (nameTaken(editing.draft.name, editing.origId)) errs.unshift('Another preset already has this name.');
    var html = editing.tried || dirty() ? errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') : '';
    if (el.innerHTML !== html) el.innerHTML = html; // unchanged text is not announced again
    return errs;
  }

  /* ---------- actions ---------- */
  function startEdit(p, origId) {
    var d = JSON.parse(JSON.stringify(p));
    d.groups.forEach(function (g) { g.own = false; });
    // base: the stored text when editing began, to notice a save from another window.
    editing = { origId: origId, draft: d, start: JSON.stringify(strip(d)), base: origId ? store.raw(KEY + origId) : null };
    status = '';
    render('#pe-name');
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
    if (showErrors().length) { dlg.querySelector('#pe-errors').scrollIntoView({ block: 'nearest' }); return; }
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
          var st0 = dlg.querySelector('#pe-status'); st0.textContent = status; announce(status); st0.focus();
          return;
        }
      }
      t.id = editing.origId;
    } else t.id = uniqueId(t.name);
    if (!saveOne(t)) {
      status = 'Not saved: this browser would not store the preset (its storage may be full). Download it to keep it.';
      var st = dlg.querySelector('#pe-status'); st.textContent = status; announce(status); st.focus();
      return;
    }
    editing = null;
    status = memoryOnly ? 'Saved "' + t.name + '" for this visit only: this browser is not saving presets, so download it to keep it.' : 'Saved "' + t.name + '".';
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
      Alpha.settings.notify();
      status = 'Loaded "' + p.name + '" from ' + f.name + '.' + (res.warnings.length ? ' Note: ' + res.warnings.join(', ') + '.' : '');
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
    else if (act === 'old-restore') {
      var got = restoreOld(); loadMine(); Alpha.settings.notify();
      status = got ? 'Restored ' + got + ' preset' + (got === 1 ? '' : 's') + ' from the older version.' : 'Nothing could be restored (this browser\'s storage may be full).';
      render('#pe-status');
    }
    else if (act === 'old-rm') {
      if (notMigrated) return; // presets still waiting to be copied would be lost
      var lost = oldLeft ? [oldLeft.unsure ? oldLeft.unsure + ' preset' + (oldLeft.unsure === 1 ? '' : 's') + ' not in your list now' : '', oldLeft.notPresets ? oldLeft.notPresets + (oldLeft.notPresets === 1 ? ' entry that is not a preset' : ' entries that are not presets') : '', oldLeft.backup ? 'the older backup' : '', oldLeft.unreadableList ? 'the unreadable old list' : ''].filter(Boolean).join(', ') : '';
      if (!window.confirm('Remove the old presets data? This removes ' + (lost || 'it') + '. Presets in your list stay. This cannot be undone (download it first to keep a copy).')) return;
      store.remove('presets'); store.remove('presets-unreadable');
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
      if (!window.confirm('Delete the preset "' + p.name + '"?' + (inUse ? ' It is the preset in use.' : '') +
        ' This cannot be undone (download it first to keep a copy).')) return;
      if (!removeOne(p.id)) { status = '"' + p.name + '" could not be deleted from this browser\'s storage.'; render('#pe-status'); return; }
      if (editing && editing.origId === p.id) editing = null;
      status = 'Deleted "' + p.name + '".';
      var fallback = builtIn(ds)[0] || mine[0];
      if (inUse && fallback) { Alpha.settings.useScheme(fallback.id); status += ' Now using "' + fallback.name + '".'; }
      else Alpha.settings.notify();
      render('#pe-status');
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
    else if (act === 'save') save(false);
    else if (act === 'save-use') save(true);
    else if (act === 'cancel') { if (!okToDiscard()) return; editing = null; status = ''; render('[data-act="new"]'); }
    else if (act === 'close') { if (okToDiscard()) { editing = null; dlg.close(); } }
  }

  function onInput(e) {
    var t = e.target;
    if (t.id === 'pe-file') { loadFile(t); return; }
    if (!editing) return;
    if (t.id === 'pe-name') { editing.draft.name = t.value; showErrors(); return; }
    var i = Number(t.getAttribute('data-i')), f = t.getAttribute('data-f');
    if (isNaN(i) || !f) return;
    var g = editing.draft.groups[i];
    if (f === 'label') {
      var own = dlg.querySelector('#po-' + i);
      if (t.value === OWN) { g.own = true; own.hidden = false; g.label = own.value; if (e.type === 'change') own.focus(); }
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
    // Esc with unsaved changes asks first. It is handled on the key press,
    // because Chromium stops honouring a prevented "cancel" after the first
    // one; if the dialog is closed anyway, it reopens with the draft.
    var escAsked = false, keepOpen = false;
    dlg.addEventListener('keydown', function (e) {
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
      if (e.key != null && e.key.indexOf('alpha.' + KEY) !== 0) return;
      loadMine();
      Alpha.settings.notify();
      if (!dlg.open) return;
      // The list is redrawn; an open draft is kept as it is (it lives in memory).
      if (editing && editing.origId && e.key === 'alpha.' + KEY + editing.origId) {
        status = e.newValue == null ? 'The preset you are editing was deleted in another window. Saving will ask before bringing it back.'
          : 'The preset you are editing was changed in another window. Saving will ask before replacing that version.';
      } else status = 'Presets were changed in another window; the list is up to date.';
      redrawKeepingFocus();
    });
  }

  Alpha.presetsUI = { init: init, open: open, all: all, find: find };
})(window.Alpha);
