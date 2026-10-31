/* Basket presets page (opened from Settings). Lists the built-in presets
   (from the data file) and the user's own (kept in this browser), and edits
   them: each group gets a label picked from a list or typed, and one or two
   basket colours. Presets can be saved as .json files and loaded again. */
(function (Alpha) {
  'use strict';
  var ui = Alpha.ui, esc = ui.esc, store = ui.store, P = Alpha.presets;
  var OWN = '__own__', NONE = '';

  var mine = loadMine(), memoryOnly = false;
  var dlg = null, editing = null, status = '';

  function loadMine() {
    var v = store.get('presets', []);
    return Array.isArray(v) ? v.filter(function (p) { return p && !P.check(p).length; }) : [];
  }
  function persist() { memoryOnly = !store.set('presets', mine); }

  function builtIn(ds) { return (ds && ds.basketSchemes) || []; }
  function all(ds) { return builtIn(ds).concat(mine); }
  function isMine(id) { return mine.some(function (p) { return p.id === id; }); }
  function find(ds, id) { return all(ds).filter(function (p) { return p.id === id; })[0] || null; }

  // Labels offered in the drop-downs: the data file's list, then labels
  // already used in any preset.
  function labelChoices(ds) {
    var seen = {}, out = [];
    function add(l) { l = String(l || '').trim(); if (l && !seen[l.toLowerCase()]) { seen[l.toLowerCase()] = 1; out.push(l); } }
    ((ds && ds.groupLabels) || []).forEach(add);
    all(ds).forEach(function (p) { p.groups.forEach(function (g) { add(g.label); }); });
    return out;
  }
  function colourChoices(draft) {
    var seen = {}, out = [];
    (draft.colours || []).concat(P.COLOUR_CHOICES).forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; out.push(c); } });
    return out;
  }

  function uniqueId(name) {
    var base = 'user-' + P.slug(name), id = base, n = 2;
    while (find(Alpha.state.ds, id)) id = base + '-' + n++;
    return id;
  }
  function uniqueName(name) {
    var taken = {}, out = name, n = 2;
    all(Alpha.state.ds).forEach(function (p) { taken[p.name.toLowerCase()] = 1; });
    while (taken[out.toLowerCase()]) out = name + ' (' + n++ + ')';
    return out;
  }

  /* ---------- drawing ---------- */
  function swatches(p, g) {
    var byId = {};
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
      return '<option' + (!own && c === g.label ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('') + '<option value="' + OWN + '"' + (own ? ' selected' : '') + '>Type your own…</option>';
    return '<select id="pl-' + i + '" data-i="' + i + '" data-f="label" aria-label="Group ' + (i + 1) + ' label">' + opts + '</select>' +
      '<input type="text" id="po-' + i + '" data-i="' + i + '" data-f="own" class="own-label" aria-label="Group ' + (i + 1) + ' label, typed"' +
      ' value="' + esc(own ? g.label : '') + '"' + (own ? '' : ' hidden') + ' placeholder="Label">';
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
      '<label>Name <input type="text" id="pe-name" value="' + esc(d.name) + '" placeholder="e.g. Our 9 baskets"></label>' +
      '<table class="pe-table"><thead><tr><th>#</th><th>Group label</th><th>Basket 1</th><th>Basket 2</th><th><span class="sr">Remove</span></th></tr></thead><tbody>' +
      d.groups.map(function (g, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + labelCell(i, g, choices) + '</td><td>' + basketCell(i, 0, g.baskets[0], colours) + '</td>' +
          '<td>' + basketCell(i, 1, g.baskets[1] || '', colours) + '</td>' +
          '<td><button type="button" class="btn small" data-act="remove-group" data-i="' + i + '" aria-label="Remove group ' + (i + 1) + '"' +
          (d.groups.length <= P.MIN_GROUPS ? ' disabled' : '') + '>Remove</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<button type="button" class="btn small" data-act="add-group">Add a group</button>' +
      '<ul id="pe-errors" class="pe-errors" role="alert"></ul>' +
      '<div class="pe-buttons"><button type="button" class="btn" data-act="save">Save</button> ' +
      '<button type="button" class="btn" data-act="save-use">Save and use</button> ' +
      '<button type="button" class="btn" data-act="cancel">Cancel</button></div></fieldset>';
  }

  function render(focusSel) {
    var ds = Alpha.state.ds;
    dlg.innerHTML = '<h2 id="presets-title">Basket presets</h2>' +
      '<p class="small">A preset sets the groups a script can belong to and the baskets for each group (at least ' + P.MIN_GROUPS + ' groups). ' +
      'Built-in presets come with the data; yours are kept in this browser' + (memoryOnly ? ' <strong class="note-bad">(this browser is not saving them: download them to keep them)</strong>' : '') + '.</p>' +
      listHtml(ds) +
      '<div class="pe-top"><button type="button" class="btn" data-act="new">New preset</button> ' +
      '<label class="btn file-btn">Load .json file<input type="file" id="pe-file" accept=".json,application/json"></label></div>' +
      '<p id="pe-status" class="small" role="status">' + esc(status) + '</p>' +
      (editing ? editorHtml(ds) : '') +
      '<form method="dialog" class="dialog-actions"><button class="btn">Close</button></form>';
    if (editing) showErrors();
    var f = focusSel && dlg.querySelector(focusSel);
    if (f) f.focus();
  }

  function showErrors() {
    var errs = P.check(editing.draft), el = dlg.querySelector('#pe-errors');
    el.innerHTML = errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
    return errs;
  }

  /* ---------- actions ---------- */
  function startEdit(p, origId) {
    var d = JSON.parse(JSON.stringify(p));
    d.groups.forEach(function (g) { g.own = false; });
    editing = { origId: origId, draft: d };
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
    if (showErrors().length) { dlg.querySelector('#pe-errors').scrollIntoView({ block: 'nearest' }); return; }
    var t = P.tidy(editing.draft);
    if (editing.origId) {
      t.id = editing.origId;
      mine = mine.map(function (p) { return p.id === t.id ? t : p; });
    } else {
      t.name = uniqueName(t.name);
      t.id = uniqueId(t.name);
      mine.push(t);
    }
    persist();
    editing = null;
    status = 'Saved "' + t.name + '".';
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
    var r = new FileReader();
    r.onload = function () {
      var res = P.fromFile(String(r.result));
      if (res.errors.length) { status = f.name + ' could not be loaded: ' + res.errors.join(' '); render('#pe-status'); return; }
      var p = res.preset;
      p.name = uniqueName(p.name);
      p.id = uniqueId(p.name);
      mine.push(p);
      persist();
      Alpha.settings.notify();
      status = 'Loaded "' + p.name + '" from ' + f.name + '.';
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
    if (act === 'use') { Alpha.settings.useScheme(p.id); status = 'Now using "' + p.name + '".'; render('#pe-status'); }
    else if (act === 'edit') startEdit(p, p.id);
    else if (act === 'copy') { var c = JSON.parse(JSON.stringify(p)); c.name = 'Copy of ' + p.name; startEdit(c, null); }
    else if (act === 'download') download(p);
    else if (act === 'delete') {
      if (!window.confirm('Delete the preset "' + p.name + '"? This cannot be undone (download it first to keep a copy).')) return;
      mine = mine.filter(function (x) { return x.id !== p.id; });
      persist();
      if (editing && editing.origId === p.id) editing = null;
      Alpha.settings.notify();
      status = 'Deleted "' + p.name + '".';
      render('#pe-status');
    }
    else if (act === 'new') startEdit(blankPreset(), null);
    else if (act === 'add-group') {
      var d = editing.draft, used = {};
      d.groups.forEach(function (g) { used[g.baskets.join('+')] = 1; });
      // Start the new group on a basket combination not used yet, where possible.
      var cols = colourChoices(d).map(function (c) { return c.id; }), pick = [cols[0]];
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
    else if (act === 'cancel') { editing = null; status = ''; render('[data-act="new"]'); }
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
    dlg = document.getElementById('presets');
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('change', onInput);
    dlg.addEventListener('input', function (e) { if (e.target.tagName === 'INPUT' && e.target.type === 'text') onInput(e); });
    dlg.addEventListener('close', function () { editing = null; Alpha.settings.open(); });
  }

  Alpha.presetsUI = { init: init, open: open, all: all, find: find };
})(window.Alpha);
