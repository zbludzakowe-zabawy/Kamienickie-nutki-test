// Katalog nut (zakładka „Katalog”, tylko administrator): wszystkie nuty z Dysku jako utwory (jeden albo kilka plików – strony),
// z tytułem, autorem tekstu, muzyką i cechami wielokrotnego wyboru (kolęda, wielkopostne…), które administrator sam definiuje.
// data.catalog = { tags:[{id, name}], works:{id:{id, title, ownTitle?, lyrics, music, tags:[tagId], files:[fileId], at}} }
// Katalog sam się uzupełnia (sync): pieśni ze spisów (ok/auto) → utwór z tymi plikami i tytułem ze spisu;
// pozostałe pliki → utwory jak w „Pozostałych nutach” (strony z jednego folderu o tej samej nazwie razem).
// Pomijamy „to nie nuty” i pliki z listy „do sprzątnięcia”; „nieistotne” są w katalogu, ale domyślnie ukryte.
window.Works = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = window.App;
  const esc = A.esc;
  const DEFAULT_TAGS = ['kolęda', 'wielkopostne', 'wielkanocne', 'eucharystyczne', 'ostinato', 'adwentowe', 'uwielbienie', 'alleluja'];
  const PAGE = 300; // tyle pozycji rysujemy naraz (reszta po „Pokaż więcej”)
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const cmp = (a, b) => a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' });

  const ui = { q: '', filter: 'all', showIgn: false, tags: new Set(), sel: new Set(), limit: PAGE, editId: null, editTags: new Set(), editFiles: [], detached: [], merged: new Map(), renaming: null };
  try {
    const s = JSON.parse(localStorage.getItem('kn-cat-ui') || 'null');
    if (s) { ui.filter = s.filter || 'all'; ui.showIgn = !!s.showIgn; ui.tags = new Set(s.tags || []); }
  } catch (e) { /* brak */ }
  const saveUi = () => { try { localStorage.setItem('kn-cat-ui', JSON.stringify({ filter: ui.filter, showIgn: ui.showIgn, tags: [...ui.tags] })); } catch (e) { /* trudno */ } };

  // ---------- dane ----------
  function C() {
    const d = A.data;
    if (!d.catalog || typeof d.catalog !== 'object') d.catalog = {};
    const c = d.catalog;
    if (!Array.isArray(c.tags)) c.tags = DEFAULT_TAGS.map((name, i) => ({ id: 't' + (i + 1), name }));
    if (!c.works || typeof c.works !== 'object') c.works = {};
    return c;
  }
  const tagName = (id) => { const t = C().tags.find((x) => x.id === id); return t ? t.name : ''; };
  const flag = (id) => Catalog.flagOf(A.data.nodes, A.data.meta, id);
  const isIgnFile = (id) => { const f = flag(id); return f === 'ignore' || f === 'ignoreDir'; };
  const isIgnored = (w) => w.files.length > 0 && w.files.every(isIgnFile);
  const hasUserData = (w) => !!(w.lyrics || w.music || (w.tags && w.tags.length) || w.ownTitle || w.manual);
  const titleOf = (id) => (window.Dups ? Dups.titleOf(id) : id);
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  // pozycje spisów z nutami (ok/auto): plik → [{b, it, i}]
  function bookRefs() {
    const map = {};
    for (const b of A.data.songbooks) {
      b.items.forEach((it, i) => {
        if (it.state !== 'ok' && it.state !== 'auto') return;
        (it.files || []).forEach((id) => { (map[id] = map[id] || []).push({ b, it, i }); });
      });
    }
    return map;
  }
  function refsOf(w, map) {
    const seen = new Set();
    const out = [];
    for (const id of w.files) for (const r of map[id] || []) { const k = r.b.id + '|' + r.i; if (!seen.has(k)) { seen.add(k); out.push(r); } }
    return out;
  }

  // Uzupełnia katalog o nowe pliki, usuwa zniknięte; zwraca true, jeśli coś się zmieniło.
  function sync() {
    const c = C();
    const before = JSON.stringify(c.works);
    const nodes = A.data.nodes;
    const remove = window.Dups ? Dups.toRemove() : new Set();
    const ok = (id) => { const n = nodes[id]; return n && !n.folder && flag(id) !== 'notes' && !remove.has(id); };
    const owner = {};
    for (const w of Object.values(c.works)) {
      w.files = (w.files || []).filter((id) => ok(id) && !owner[id]);
      w.files.forEach((id) => { owner[id] = w.id; });
      w.tags = (w.tags || []).filter((t) => c.tags.some((x) => x.id === t));
      if (!w.files.length && !hasUserData(w)) { delete c.works[w.id]; }
    }
    const add = (title, files) => {
      const w = { id: uid('w'), title, lyrics: '', music: '', tags: [], files: A.orderFiles(files), at: new Date().toISOString() };
      c.works[w.id] = w;
      files.forEach((id) => { owner[id] = w.id; });
      return w;
    };
    // pieśni ze spisów
    for (const b of A.data.songbooks) {
      for (const it of b.items) {
        if (it.state !== 'ok' && it.state !== 'auto') continue;
        const f = (it.files || []).filter(ok);
        if (!f.length) continue;
        const free = f.filter((id) => !owner[id]);
        if (!free.length) continue;
        const ws = [...new Set(f.filter((id) => owner[id]).map((id) => owner[id]))];
        if (!ws.length) add(it.title, free);
        else if (ws.length === 1) { const w = c.works[ws[0]]; w.files = A.orderFiles([...w.files, ...free]); free.forEach((id) => { owner[id] = w.id; }); }
        else add(it.title, free);
      }
    }
    // pozostałe pliki – strony jednej pieśni z tego samego folderu razem
    const groups = {};
    for (const n of Object.values(nodes)) {
      if (n.folder || owner[n.id] || !ok(n.id)) continue;
      const k = n.parent + '|' + ((window.Dups && Dups.nameKey(n.id)) || n.id);
      (groups[k] = groups[k] || []).push(n.id);
    }
    for (const ids of Object.values(groups)) add(ids.length > 1 && window.Dups ? Dups.baseTitle(ids[0]) : titleOf(ids[0]), ids);
    // tytuł taki jak w spisie (dopóki administrator nie nadał w katalogu własnego)
    const map = bookRefs();
    for (const w of Object.values(c.works)) {
      if (w.ownTitle || !w.files.length) continue;
      const refs = refsOf(w, map);
      if (refs.some((x) => x.it.title === w.title)) continue; // np. po dołączeniu innej pieśni zostaje tytuł edytowanej pozycji
      const r = refs.find((x) => sameSet(x.it.files.filter(ok), w.files)) || refs[0];
      if (r && r.it.title && r.it.title !== w.title) w.title = r.it.title;
    }
    const diff = JSON.stringify(c.works) !== before;
    if (diff) A.data.updatedAt = Date.now();
    return diff;
  }
  function syncSave() {
    if (!Object.keys(A.data.nodes).length) return;
    if (sync()) A.changed();
  }

  // ---------- lista ----------
  const visible = () => !document.querySelector('[data-panel="catalog"]').hidden;
  function haystack(w, refs) {
    const parts = [w.title, w.lyrics, w.music, ...w.tags.map(tagName)];
    w.files.forEach((id) => { const n = A.data.nodes[id]; parts.push(titleOf(id), n ? A.stripExt(n.name) : ''); }); // nazwy plików bez rozszerzeń
    refs.forEach((r) => { parts.push(r.it.title, ...(r.it.alt || []), `${r.b.code} ${r.it.no}`); });
    return Catalog.norm(parts.join(' '));
  }
  function listed() {
    const c = C();
    const map = bookRefs();
    const words = Catalog.norm(ui.q).split(' ').filter(Boolean);
    const all = Object.values(c.works).map((w) => ({ w, refs: refsOf(w, map), ign: isIgnored(w) }));
    const counts = { ign: 0, tags: {} };
    const out = [];
    for (const x of all) {
      if (x.ign) counts.ign++;
      if (x.ign && !ui.showIgn) continue;
      const w = x.w;
      if (ui.filter === 'notags' && w.tags.length) continue;
      if (ui.filter === 'nolyrics' && w.lyrics) continue;
      if (ui.filter === 'nomusic' && w.music) continue;
      if (ui.filter === 'nobook' && x.refs.length) continue;
      if (ui.filter === 'nofiles' && w.files.length) continue;
      if (words.length) { const h = haystack(w, x.refs); if (!words.every((t) => h.includes(t))) continue; }
      w.tags.forEach((t) => { counts.tags[t] = (counts.tags[t] || 0) + 1; }); // liczniki cech przed filtrem cech
      if ([...ui.tags].some((t) => !w.tags.includes(t))) continue;
      out.push(x);
    }
    out.sort((a, b) => cmp(a.w.title, b.w.title));
    return { all, out, counts };
  }

  function tagPills(w) {
    return w.tags.map((t) => `<span class="wtag">${esc(tagName(t))}</span>`).join('');
  }
  function row(x) {
    const w = x.w;
    const people = [w.lyrics && `sł. ${esc(w.lyrics)}`, w.music && `muz. ${esc(w.music)}`].filter(Boolean).join(' · ');
    const refs = x.refs.map((r) => `<span class="wref" title="${esc(r.b.name)}${r.it.no ? ' nr ' + esc(r.it.no) : ''}">${esc(r.b.code || r.b.name)}${r.it.no ? ' ' + esc(r.it.no) : ''}</span>`).join('');
    const nf = w.files.length;
    return `<div class="work${x.ign ? ' ign' : ''}${ui.sel.has(w.id) ? ' on' : ''}" data-id="${esc(w.id)}">
      <input type="checkbox" class="wsel" aria-label="Zaznacz" ${ui.sel.has(w.id) ? 'checked' : ''}>
      <div class="work-main">
        <button type="button" class="work-title linklike" data-w="edit">${esc(w.title || '(bez tytułu)')}</button>
        ${people ? `<span class="work-people small">${people}</span>` : ''}
        <span class="work-meta">${tagPills(w)}${refs}
          <span class="muted small">${nf ? `${nf} ${A.plural(nf, 'plik', 'pliki', 'plików')}` : '<span class="warn-text">bez plików</span>'}</span>
          ${x.ign ? `<span class="flag-tag">${A.GHOST(true)} nieistotne</span>` : ''}</span>
      </div>
      ${nf ? Preview.noteBtn(w.files, 0, w.title) : ''}
      <button type="button" class="act" data-w="edit" title="Edytuj pozycję" aria-label="Edytuj pozycję">✎</button>
    </div>`;
  }

  function tagOptions(ph) {
    return `<option value="">${ph}</option>` + C().tags.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  }

  let last = [];
  function render() {
    if (!visible()) return;
    const has = Object.keys(A.data.nodes).length > 0;
    $('cat-empty').hidden = has;
    $('cat-body').hidden = !has;
    if (!has) { $('cat-sum').textContent = ''; return; }
    if (sync()) A.changed();
    const c = C();
    const { all, out, counts } = listed();
    last = out;
    ui.sel.forEach((id) => { if (!c.works[id]) ui.sel.delete(id); });
    $('cat-sum').textContent = `${all.length} ${A.plural(all.length, 'utwór', 'utwory', 'utworów')}` + (out.length !== all.length ? ` · widocznych ${out.length}` : '');
    $('cat-filter').value = ui.filter;
    $('cat-showign').checked = ui.showIgn;
    $('cat-ign-n').textContent = counts.ign ? `(${counts.ign})` : '';
    $('cat-tagfilter').innerHTML = c.tags.map((t) =>
      `<button class="fchip${ui.tags.has(t.id) ? ' active' : ''}" data-t="${esc(t.id)}" aria-pressed="${ui.tags.has(t.id)}">${esc(t.name)} <b>${counts.tags[t.id] || 0}</b></button>`).join('') +
      (ui.tags.size ? '<button class="fchip" data-t="">✕ wyczyść</button>' : '');
    const n = out.filter((x) => ui.sel.has(x.w.id)).length;
    $('cat-sel').textContent = n ? `zaznaczone: ${n}` : 'zaznacz';
    $('cat-all').checked = out.length > 0 && out.every((x) => ui.sel.has(x.w.id));
    $('cat-all').indeterminate = n > 0 && !$('cat-all').checked;
    $('cat-bulk-acts').querySelectorAll('select, button').forEach((b) => { b.disabled = !n && b.id !== 'cat-export'; });
    $('cat-merge').disabled = n < 2;
    $('cat-addtag').innerHTML = tagOptions('+ Dodaj cechę…');
    $('cat-rmtag').innerHTML = tagOptions('− Usuń cechę…');
    $('cat-list').innerHTML = out.length ? out.slice(0, ui.limit).map(row).join('') : '<p class="muted empty">Nic nie pasuje do wyszukiwania.</p>';
    $('cat-more').innerHTML = out.length > ui.limit ? `Pokazano ${ui.limit} z ${out.length}. <button type="button" class="linklike" id="cat-morebtn">Pokaż więcej</button>` : '';
  }

  // ---------- działania na zaznaczonych ----------
  // tylko zaznaczone i widoczne (po zmianie filtra ukryte zaznaczenia nie biorą udziału)
  const selected = () => last.filter((x) => ui.sel.has(x.w.id)).map((x) => x.w);
  function bulkTag(tag, on) {
    const ws = selected();
    let n = 0;
    ws.forEach((w) => {
      const has = w.tags.includes(tag);
      if (on && !has) { w.tags.push(tag); n++; }
      if (!on && has) { w.tags = w.tags.filter((t) => t !== tag); n++; }
    });
    A.changed();
    render();
    A.toast(on ? `Cecha „${tagName(tag)}” dodana do ${n} ${A.plural(n, 'pozycji', 'pozycji', 'pozycji')}.` : `Cecha „${tagName(tag)}” usunięta z ${n} ${A.plural(n, 'pozycji', 'pozycji', 'pozycji')}.`);
  }
  function merge() {
    const ws = selected();
    if (ws.length < 2) return;
    const map = bookRefs();
    ws.sort((a, b) => (refsOf(b, map).length ? 1 : 0) - (refsOf(a, map).length ? 1 : 0) || cmp(a.title, b.title));
    const first = ws[0];
    if (!confirm(`Połączyć ${ws.length} pozycje w jeden utwór „${first.title}”?\n\n${ws.map((w) => '• ' + w.title).join('\n')}\n\nPliki, cechy i autorzy zostaną połączone.`)) return;
    const files = A.orderFiles([...new Set(ws.flatMap((w) => w.files))]);
    first.files = files;
    first.tags = [...new Set(ws.flatMap((w) => w.tags))];
    first.lyrics = ws.map((w) => w.lyrics).find(Boolean) || '';
    first.music = ws.map((w) => w.music).find(Boolean) || '';
    first.manual = true;
    ws.slice(1).forEach((w) => { delete C().works[w.id]; });
    ui.sel = new Set([first.id]);
    A.changed();
    render();
    A.toast(`Połączono w „${first.title}” (${files.length} ${A.plural(files.length, 'plik', 'pliki', 'plików')}). Kolejność stron: ⇅ w oknie pozycji.`);
  }
  // „nieistotne” zapisujemy przy plikach (meta.ignore) – to samo oznaczenie co w „Nutach na Dysku”
  function setIgnored(ws, on) {
    let n = 0;
    let dir = 0;
    ws.forEach((w) => w.files.forEach((id) => {
      const m = A.data.meta[id] || {};
      if (on && !m.ignore && flag(id) !== 'ignoreDir') { A.setMeta(id, 'ignore', true); A.setMeta(id, 'notNotes', false); n++; }
      if (!on && m.ignore) { A.setMeta(id, 'ignore', false); n++; }
      if (!on && flag(id) === 'ignoreDir') dir++;
    }));
    if (n) A.afterFlags();
    return { n, dir };
  }

  function exportCsv() {
    if (!last.length) return A.toast('Lista jest pusta.');
    const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const lines = ['Lp.;Tytuł;Autor tekstu;Muzyka;Cechy;W spisach;Pliki;Foldery;Nieistotne'];
    last.forEach((x, i) => {
      const w = x.w;
      lines.push([i + 1, q(w.title), q(w.lyrics), q(w.music), q(w.tags.map(tagName).join(', ')),
        q(x.refs.map((r) => `${r.b.code || r.b.name} ${r.it.no || ''}`.trim()).join(', ')),
        q(w.files.map((id) => (A.data.nodes[id] || {}).name || id).join(', ')),
        q([...new Set(w.files.map((id) => Catalog.pathOf(A.data.nodes, id)))].join(', ')), x.ign ? 'tak' : ''].join(';'));
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `katalog-nut-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    A.toast(`Zapisano listę: ${last.length} ${A.plural(last.length, 'pozycja', 'pozycje', 'pozycji')}.`);
  }

  // ---------- okno pozycji ----------
  function paintEditTags() {
    $('wk-tags').innerHTML = C().tags.map((t) =>
      `<button type="button" class="fchip${ui.editTags.has(t.id) ? ' active' : ''}" data-t="${esc(t.id)}" aria-pressed="${ui.editTags.has(t.id)}">${esc(t.name)}</button>`).join('');
  }
  function paintEditFiles() {
    const ids = ui.editFiles;
    $('wk-fcount').textContent = ids.length ? `(${ids.length})` : '';
    $('wk-order').hidden = ids.length < 2;
    $('wk-files').innerHTML = ids.length ? ids.map((id) => {
      const n = A.data.nodes[id];
      const fl = flag(id);
      const m = A.data.meta[id];
      const rot = (m && m.rot) || 0;
      const from = [...ui.merged.values()].find((x) => x.files.includes(id));
      const name = ui.renaming === id
        ? `<input class="name-input wk-rename" type="text" value="${esc((m && m.title) || '')}" placeholder="${esc(A.stripExt(n ? n.name : id))}" maxlength="200" aria-label="Nazwa pliku w aplikacji" enterkeyhint="done">`
        : `<b>${esc(titleOf(id))}</b><button type="button" class="wk-ren" data-f="rename" title="Zmień nazwę w aplikacji (plik na Dysku zostaje bez zmian)" aria-label="Zmień nazwę w aplikacji">✎</button>`;
      return `<li data-id="${esc(id)}"><span class="badge ${n ? n.kind : ''}">${n && n.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
        <span class="order-names"><span class="wk-name">${name}</span><span class="muted small">${esc(Catalog.pathOf(A.data.nodes, id))} / ${esc(n ? n.name : id)}</span>${fl ? A.flagTag(fl) : ''}${rot ? `<span class="rot-tag">obrócony o ${rot}°</span>` : ''}${from ? `<span class="dup-tag">dołączony z „${esc(from.title)}”</span>` : ''}</span>
        ${Preview.noteBtn(id)}${n ? Preview.driveLink(id) : ''}
        <button type="button" class="act" data-f="rot" title="Obróć nuty${rot ? ` (teraz o ${rot}°)` : ''}" aria-label="Obróć nuty">⟳</button>
        ${ids.length > 1 ? '<button type="button" class="btn small" data-f="detach" title="To osobny utwór – wydziel jako nową pozycję">Osobno</button>' : ''}</li>`;
    }).join('') : '<li class="muted small">Pliki zniknęły z Dysku albo zostały oznaczone. Połącz tę pozycję z inną (zaznacz obie → ⧉ Połącz) albo ją usuń.</li>';
    const w = C().works[ui.editId];
    const dirAll = ids.length && ids.every((id) => flag(id) === 'ignoreDir');
    $('wk-ign').checked = ids.length > 0 && ids.every(isIgnFile);
    $('wk-ign').disabled = !ids.length || dirAll;
    $('wk-del').hidden = ids.length > 0;
    $('wk-ign-why').hidden = !dirAll;
    $('wk-ign-why').textContent = dirAll ? 'Cały folder jest oznaczony jako nieistotny (duszek przy folderze w „Nutach na Dysku”).' : '';
    if (!ids.length && w) $('wk-ign').checked = false;
  }
  function openWork(id) {
    const w = C().works[id];
    if (!w) return;
    ui.editId = id;
    ui.editTags = new Set(w.tags);
    ui.editFiles = [...w.files];
    ui.detached = [];
    ui.merged = new Map();
    ui.renaming = null;
    const refs = refsOf(w, bookRefs());
    $('wk-head').textContent = 'Pozycja w katalogu';
    $('wk-title').value = w.title;
    $('wk-lyrics').value = w.lyrics || '';
    $('wk-music').value = w.music || '';
    $('wk-books').innerHTML = refs.length ? 'W spisach: ' + refs.map((r) =>
      `<button type="button" class="linklike" data-ref="${esc(r.b.id)}|${r.i}">${esc(r.b.name)}${r.it.no ? ' nr ' + esc(r.it.no) : ''}</button>`).join(', ')
      + (w.ownTitle ? ' <span class="muted">· tytuł w katalogu inny niż w spisie</span>' : '') : 'Spoza spisów pieśni (z „Pozostałych nut”).';
    const people = new Set();
    Object.values(C().works).forEach((x) => { if (x.lyrics) people.add(x.lyrics); if (x.music) people.add(x.music); });
    $('wk-people').innerHTML = [...people].sort(cmp).map((p) => `<option value="${esc(p)}">`).join('');
    paintEditTags();
    paintEditFiles();
    $('wk-newtag').value = '';
    $('work-dlg').showModal();
  }
  function newTag(name) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (!name) return null;
    const c = C();
    const hit = c.tags.find((t) => Catalog.norm(t.name) === Catalog.norm(name));
    if (hit) return hit;
    const t = { id: uid('t'), name };
    c.tags.push(t);
    return t;
  }

  // Gdzie jeszcze jest tytuł tej pieśni: pozycje spisów i programów uroczystości z tymi plikami
  function titlePlaces(w) {
    const set = new Set(w.files);
    const items = [];
    const map = bookRefs();
    refsOf(w, map).forEach((r) => items.push({ kind: 'book', label: `spis „${r.b.name}”${r.it.no ? ' nr ' + r.it.no : ''}`, it: r.it, b: r.b, i: r.i }));
    for (const p of A.data.programs || []) {
      p.parts.forEach((pt) => pt.items.forEach((it) => {
        const bySrc = it.src && items.some((x) => x.kind === 'book' && x.b.id === it.src.book && x.i === it.src.i);
        if (bySrc || (it.files || []).some((id) => set.has(id))) items.push({ kind: 'prog', label: `program „${p.name}” (${pt.name})`, it });
      }));
    }
    return items;
  }

  function saveWork() {
    const c = C();
    const w = c.works[ui.editId];
    if (!w) return;
    const title = $('wk-title').value.trim().replace(/\s+/g, ' ');
    if (!title) return A.toast('Tytuł nie może być pusty.');
    let msg = 'Zapisano.';
    if (title !== w.title) {
      const places = titlePlaces(w).filter((x) => x.it.title !== title);
      const noBooks = !places.some((x) => x.kind === 'book');
      const own = w.files.filter((id) => titleOf(id) !== title);
      if (places.length) {
        const list = places.slice(0, 12).map((x) => '• ' + x.label).join('\n') + (places.length > 12 ? `\n… i ${places.length - 12} więcej` : '');
        if (confirm(`Zmienić nazwę „${title}” także w całym zbiorze?\n\n${list}\n\nOK – zmień wszędzie.\nAnuluj – tylko w katalogu (w spisach zostanie dotychczasowa nazwa).`)) {
          places.forEach((x) => { x.it.title = title; if (x.kind === 'book' && x.it.state === 'auto') x.it.state = 'ok'; });
          w.ownTitle = false;
          msg = `Zmieniono nazwę w katalogu i w ${places.length} ${A.plural(places.length, 'miejscu', 'miejscach', 'miejscach')}.`;
        } else { w.ownTitle = true; msg = 'Zmieniono nazwę tylko w katalogu.'; }
      } else if (noBooks && own.length && !refsOf(w, bookRefs()).length) {
        // utwór spoza spisów – nazwa plików w aplikacji (ta sama co w „Nutach na Dysku” i „Pozostałych nutach”)
        if (confirm(`Nadać nazwę „${title}” także ${own.length === 1 ? 'plikowi' : `${own.length} plikom`} (nazwa w aplikacji, widoczna w „Nutach na Dysku” i „Pozostałych nutach”)?\n\nOK – tak.\nAnuluj – tylko w katalogu.`)) {
          own.forEach((id) => A.setMeta(id, 'title', title));
          w.ownTitle = false;
          msg = 'Zmieniono nazwę w katalogu i przy plikach.';
        } else { w.ownTitle = true; msg = 'Zmieniono nazwę tylko w katalogu.'; }
      } else w.ownTitle = refsOf(w, bookRefs()).some((r) => r.it.title !== title);
      w.title = title;
    }
    // „+ Dodaj plik”: dołączone pliki; plik z innej pozycji = połączenie z nią (pliki, cechy, autorzy) – jak ⧉ Połącz
    const merged = [...ui.merged.values()].filter((x) => c.works[x.id] && x.id !== w.id);
    const added = ui.editFiles.filter((id) => !w.files.includes(id));
    if (added.length) {
      merged.forEach((x) => {
        x.tags.forEach((t) => ui.editTags.add(t));
        if (!$('wk-lyrics').value.trim() && x.lyrics) $('wk-lyrics').value = x.lyrics;
        if (!$('wk-music').value.trim() && x.music) $('wk-music').value = x.music;
        delete c.works[x.id];
      });
      w.files = A.orderFiles([...new Set([...w.files, ...added])]);
      w.manual = true;
      msg += ` Dołączono ${added.length} ${A.plural(added.length, 'plik', 'pliki', 'plików')}${merged.length ? ` (połączono z: ${merged.map((x) => '„' + x.title + '”').join(', ')})` : ''}.`;
    }
    w.lyrics = $('wk-lyrics').value.trim().replace(/\s+/g, ' ');
    w.music = $('wk-music').value.trim().replace(/\s+/g, ' ');
    w.tags = c.tags.map((t) => t.id).filter((t) => ui.editTags.has(t));
    // pliki wydzielone jako osobne utwory
    ui.detached.forEach((id) => {
      w.files = w.files.filter((x) => x !== id);
      const nw = { id: uid('w'), title: titleOf(id), lyrics: '', music: '', tags: [], files: [id], manual: true, ownTitle: true, at: new Date().toISOString() };
      c.works[nw.id] = nw;
    });
    if (ui.detached.length) msg += ` Wydzielono ${ui.detached.length} ${A.plural(ui.detached.length, 'plik', 'pliki', 'plików')} jako osobne pozycje.`;
    if (ui.detached.length) w.manual = true;
    const ign = $('wk-ign').checked;
    const wasIgn = w.files.length > 0 && w.files.every(isIgnFile);
    $('work-dlg').close();
    if (!$('wk-ign').disabled && ign !== wasIgn && w.files.length) {
      setIgnored([w], ign);
      msg += ign ? ' Oznaczono jako nieistotne.' : ' Usunięto oznaczenie „nieistotne”.';
    } else {
      A.changed();
      A.renderAll();
    }
    A.toast(msg);
  }

  // ---------- okno cech ----------
  function paintTags() {
    const c = C();
    const cnt = {};
    Object.values(c.works).forEach((w) => w.tags.forEach((t) => { cnt[t] = (cnt[t] || 0) + 1; }));
    $('tg-list').innerHTML = c.tags.map((t, i) => `<li data-id="${esc(t.id)}">
      <input class="tg-name" value="${esc(t.name)}" maxlength="40" aria-label="Nazwa cechy">
      <span class="muted small tg-n">${cnt[t.id] || 0}</span>
      <button type="button" class="icon-btn" data-g="up" title="Wyżej"${i === 0 ? ' disabled' : ''}>↑</button>
      <button type="button" class="icon-btn" data-g="down" title="Niżej"${i === c.tags.length - 1 ? ' disabled' : ''}>↓</button>
      <button type="button" class="icon-btn" data-g="del" title="Usuń cechę">✕</button></li>`).join('') || '<li class="muted small">Brak cech – dodaj pierwszą.</li>';
  }

  // ---------- zdarzenia ----------
  let qt = null;
  $('cat-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { ui.q = e.target.value; ui.limit = PAGE; render(); }, 150); });
  $('cat-filter').addEventListener('change', (e) => { ui.filter = e.target.value; ui.limit = PAGE; saveUi(); render(); });
  $('cat-showign').addEventListener('change', (e) => { ui.showIgn = e.target.checked; saveUi(); render(); });
  $('cat-tagfilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const t = b.dataset.t;
    if (!t) ui.tags.clear();
    else if (ui.tags.has(t)) ui.tags.delete(t);
    else ui.tags.add(t);
    ui.limit = PAGE;
    saveUi();
    render();
  });
  $('cat-all').addEventListener('change', (e) => {
    if (e.target.checked) last.forEach((x) => ui.sel.add(x.w.id));
    else last.forEach((x) => ui.sel.delete(x.w.id));
    render();
  });
  $('cat-list').addEventListener('change', (e) => {
    if (!e.target.matches('.wsel')) return;
    const id = e.target.closest('.work').dataset.id;
    if (e.target.checked) ui.sel.add(id); else ui.sel.delete(id);
    e.target.closest('.work').classList.toggle('on', e.target.checked);
    render();
  });
  $('cat-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-w="edit"]');
    if (b) openWork(b.closest('.work').dataset.id);
  });
  $('cat-more').addEventListener('click', (e) => { if (e.target.id === 'cat-morebtn') { ui.limit += PAGE; render(); } });
  $('cat-addtag').addEventListener('change', (e) => { if (e.target.value) bulkTag(e.target.value, true); });
  $('cat-rmtag').addEventListener('change', (e) => { if (e.target.value) bulkTag(e.target.value, false); });
  $('cat-merge').addEventListener('click', merge);
  $('cat-ign').addEventListener('click', () => {
    const r = setIgnored(selected(), true);
    if (!r.n) return A.toast('Zaznaczone pozycje już są nieistotne.');
    ui.sel.clear();
    render();
    A.toast(`Oznaczono jako nieistotne: ${r.n} ${A.plural(r.n, 'plik', 'pliki', 'plików')}. Ukryte w katalogu – „pokaż nieistotne”, żeby je zobaczyć.`);
  });
  $('cat-unign').addEventListener('click', () => {
    const r = setIgnored(selected(), false);
    render();
    A.toast((r.n ? `Przywrócono ${r.n} ${A.plural(r.n, 'plik', 'pliki', 'plików')}.` : 'Nic do przywrócenia.') +
      (r.dir ? ` ${r.dir} ${A.plural(r.dir, 'plik leży', 'pliki leżą', 'plików leży')} w folderze oznaczonym jako nieistotny – zmień to przy folderze w „Nutach na Dysku”.` : ''));
  });
  $('cat-export').addEventListener('click', exportCsv);

  $('wk-tags').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const t = b.dataset.t;
    if (ui.editTags.has(t)) ui.editTags.delete(t); else ui.editTags.add(t);
    paintEditTags();
  });
  const addEditTag = () => {
    const t = newTag($('wk-newtag').value);
    if (!t) return;
    ui.editTags.add(t.id);
    $('wk-newtag').value = '';
    A.changed();
    paintEditTags();
  };
  $('wk-newtag-add').addEventListener('click', addEditTag);
  $('wk-newtag').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addEditTag(); } });
  $('wk-files').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    const li = e.target.closest('li[data-id]');
    if (!b || !li) return;
    const id = li.dataset.id;
    if (b.dataset.f === 'rot') return A.openRotate(id);
    if (b.dataset.f === 'rename') {
      ui.renaming = id;
      paintEditFiles();
      const inp = $('wk-files').querySelector('.wk-rename');
      if (inp) { inp.focus(); inp.select(); }
      return;
    }
    if (b.dataset.f === 'detach') {
      ui.detached.push(id);
      ui.editFiles = ui.editFiles.filter((x) => x !== id);
      paintEditFiles();
      A.toast('Po zapisaniu ten plik będzie osobną pozycją.');
    }
  });
  $('edit-dlg').addEventListener('close', () => { if ($('work-dlg').open) paintEditFiles(); });
  $('rot-dlg').addEventListener('close', () => { if ($('work-dlg').open) paintEditFiles(); });
  // zmiana nazwy pliku w aplikacji (meta.title) – od razu, jak w „Nutach na Dysku”
  function commitRename(save) {
    const id = ui.renaming;
    const inp = $('wk-files').querySelector('.wk-rename');
    if (!id || !inp) return;
    ui.renaming = null;
    if (save) {
      const v = inp.value.trim().replace(/\s+/g, ' ');
      const old = (A.data.meta[id] && A.data.meta[id].title) || '';
      if (v !== old) {
        A.setMeta(id, 'title', v);
        A.changed();
        A.toast(v ? 'Zapisano nazwę pliku.' : 'Usunięto własną nazwę pliku.');
      }
    }
    paintEditFiles();
  }
  $('wk-files').addEventListener('keydown', (e) => {
    if (!e.target.matches('.wk-rename')) return;
    if (e.key === 'Enter') { e.preventDefault(); commitRename(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commitRename(false); }
  });
  $('wk-files').addEventListener('focusout', (e) => { if (e.target.matches('.wk-rename')) commitRename(true); });
  // „+ Dodaj plik” – to samo okno co „Wybierz plik…” w spisach
  const workOf = (id) => Object.values(C().works).find((x) => x.files.includes(id));
  $('wk-add').addEventListener('click', () => {
    const cur = C().works[ui.editId];
    if (!cur || !window.Songs) return;
    Songs.chooseFiles($('wk-title').value || cur.title, {
      exclude: ui.editFiles,
      note: (id) => {
        const x = workOf(id);
        return x && x.id !== cur.id ? `<span class="small warn-text">w katalogu: „${esc(x.title)}” – zostanie połączona</span>` : '';
      },
      onSave: (ids) => {
        ids.forEach((id) => {
          const x = workOf(id);
          if (x && x.id !== cur.id) {
            ui.merged.set(x.id, x);
            x.files.forEach((f) => { if (!ui.editFiles.includes(f)) ui.editFiles.push(f); });
          } else if (!ui.editFiles.includes(id)) ui.editFiles.push(id);
        });
        ui.detached = ui.detached.filter((id) => !ui.editFiles.includes(id));
        paintEditFiles();
        if (ids.length) A.toast('Dołączone pliki zostaną zapisane po kliknięciu „Zapisz”.');
      },
    });
  });
  $('wk-order').addEventListener('click', () => {
    const w = C().works[ui.editId];
    A.openOrder(ui.editFiles, $('wk-title').value || (w && w.title), (ids) => {
      const ww = C().works[ui.editId];
      if (ww) ww.files = A.orderFiles(ww.files);
      ui.editFiles = A.orderFiles(ui.editFiles);
      paintEditFiles();
    });
  });
  $('wk-books').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ref]');
    if (!b) return;
    const [book, i] = b.dataset.ref.split('|');
    $('work-dlg').close();
    A.showTab('songs');
    if (window.Songs) Songs.reveal(book, Number(i));
  });
  $('wk-del').addEventListener('click', () => {
    const w = C().works[ui.editId];
    if (!w || w.files.length || !confirm(`Usunąć pozycję „${w.title}” z katalogu?`)) return;
    delete C().works[w.id];
    $('work-dlg').close();
    A.changed();
    render();
    A.toast('Usunięto pozycję z katalogu.');
  });
  $('wk-cancel').addEventListener('click', () => $('work-dlg').close());
  $('wk-form').addEventListener('submit', (e) => { e.preventDefault(); saveWork(); });
  $('wk-form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('#wk-title, #wk-lyrics, #wk-music')) { e.preventDefault(); saveWork(); }
  });

  $('cat-tags-btn').addEventListener('click', () => { paintTags(); $('tg-new').value = ''; $('tags-dlg').showModal(); });
  $('tg-close').addEventListener('click', () => { $('tags-dlg').close(); });
  $('tags-dlg').addEventListener('close', () => render());
  const addTag = () => {
    const name = $('tg-new').value.trim();
    if (!name) return;
    const exists = C().tags.some((t) => Catalog.norm(t.name) === Catalog.norm(name));
    newTag(name);
    $('tg-new').value = '';
    A.changed();
    paintTags();
    if (exists) A.toast(`Cecha „${name}” już jest.`);
  };
  $('tg-add').addEventListener('click', addTag);
  $('tg-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
  $('tg-list').addEventListener('change', (e) => {
    if (!e.target.matches('.tg-name')) return;
    const t = C().tags.find((x) => x.id === e.target.closest('li').dataset.id);
    const name = e.target.value.trim().replace(/\s+/g, ' ');
    if (!t) return;
    if (!name) { e.target.value = t.name; return; }
    if (C().tags.some((x) => x !== t && Catalog.norm(x.name) === Catalog.norm(name))) { e.target.value = t.name; return A.toast(`Cecha „${name}” już jest.`); }
    t.name = name;
    A.changed();
  });
  $('tg-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    const li = e.target.closest('li[data-id]');
    if (!b || !li) return;
    const c = C();
    const i = c.tags.findIndex((x) => x.id === li.dataset.id);
    if (i < 0) return;
    if (b.dataset.g === 'del') {
      const t = c.tags[i];
      const n = Object.values(c.works).filter((w) => w.tags.includes(t.id)).length;
      if (n && !confirm(`Usunąć cechę „${t.name}”? Zostanie zdjęta z ${n} ${A.plural(n, 'pozycji', 'pozycji', 'pozycji')}.`)) return;
      c.tags.splice(i, 1);
      Object.values(c.works).forEach((w) => { w.tags = w.tags.filter((x) => x !== t.id); });
      ui.tags.delete(t.id);
    } else {
      const j = b.dataset.g === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= c.tags.length) return;
      [c.tags[i], c.tags[j]] = [c.tags[j], c.tags[i]];
    }
    A.changed();
    paintTags();
  });

  // Utwory z katalogu pasujące do słów (okno „Dodaj pieśń” w uroczystościach) – nieistotne na końcu.
  function find(words) {
    const map = bookRefs();
    return Object.values(C().works).filter((w) => w.files.length)
      .map((w) => ({ w, ign: isIgnored(w), hay: haystack(w, refsOf(w, map)) }))
      .filter((x) => words.every((q) => x.hay.includes(q)))
      .sort((a, b) => (a.ign - b.ign) || a.w.title.localeCompare(b.w.title, 'pl'))
      .map(({ w, ign }) => ({ w, ign }));
  }

  // „Edytuj w Katalogu” z okna pliku: pozycja, w której jest ten plik
  function workOfFile(id) {
    if (!A.data.catalog) return null;
    sync();
    const w = Object.values(C().works).find((x) => x.files.includes(id));
    return w ? w.id : null;
  }
  function openFile(id) {
    const wid = workOfFile(id);
    if (!wid) return false;
    openWork(wid);
    return true;
  }
  return { render, sync: syncSave, open: openWork, find, workOfFile, openFile };
})();
