// Spisy pieśni: wczytanie spisu, automatyczne dopasowanie, potwierdzanie i ręczny wybór plików.
window.Songs = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = window.App;
  const esc = A.esc;
  const CUR_KEY = 'kn-songbook';
  let current = null;
  let filter = 'all';
  let editing = -1; // indeks pozycji edytowanej ręcznie (tytuł / numer)
  let query = '';

  try { current = localStorage.getItem(CUR_KEY); } catch (e) { /* brak */ }

  const books = () => A.data.songbooks;
  const book = () => books().find((b) => b.id === current) || books()[0] || null;
  const setCurrent = (id) => {
    current = id;
    try { localStorage.setItem(CUR_KEY, id || ''); } catch (e) { /* trudno */ }
  };
  const hasNotes = (it) => it.state === 'ok' || it.state === 'auto';
  const isMissing = (it) => it.state === 'none' || it.state === 'missing';
  const group = (it) => (hasNotes(it) ? 'have' : it.state === 'check' ? 'check' : 'missing');

  // ---------- wczytanie spisu ----------
  function createBook(name, source, parsed) {
    const items = parsed.items.map((p) => ({ no: p.no, title: p.title, ...(p.alt ? { alt: p.alt } : {}), state: 'none', files: [], sugg: [] }));
    Matcher.matchItems(items, A.data.nodes, A.data.meta, A.idx);
    const b = { id: 'sb' + Date.now().toString(36), name, code: A.nextCode(books()), source, importedAt: new Date().toISOString(), items };
    books().push(b);
    setCurrent(b.id);
    A.changed();
    filter = 'all';
    query = '';
    render();
    const have = items.filter(hasNotes).length;
    const check = items.filter((i) => i.state === 'check').length;
    A.toast(`Wczytano ${items.length} ${A.plural(items.length, 'pozycję', 'pozycje', 'pozycji')}` +
      (parsed.duplicates ? ` (pominięto ${parsed.duplicates} powtórzeń)` : '') +
      (parsed.aliases ? `, w tym ${parsed.aliases} z drugim tytułem („też: …”)` : '') +
      `. Nuty: ${have}, do sprawdzenia: ${check}.`);
    if (!Object.keys(A.data.nodes).length) A.toast('Spis wczytany, ale nie ma jeszcze plików – przeskanuj Dysk w zakładce „Nuty na Dysku”.', true);
  }

  // „+ Nowy spis” – pusty spis bez pliku, pozycje dopisywane ręcznie („+ Dodaj pozycję”)
  function newBook() {
    const name = (prompt('Nazwa nowego spisu (np. „Kolędy 2026”):', '') || '').trim().replace(/\s+/g, ' ');
    if (!name) return;
    const b = { id: 'sb' + Date.now().toString(36), name, code: A.nextCode(books()), source: { kind: 'manual' }, importedAt: new Date().toISOString(), items: [] };
    books().push(b);
    setCurrent(b.id);
    A.changed();
    filter = 'all';
    query = '';
    render();
    $('sb-add').hidden = false;
    $('sb-add-no').focus();
    A.toast(`Utworzono spis „${name}”. Dopisz pozycje: numer i tytuł, Enter.`);
  }

  // ---------- ponowne wczytanie spisu (np. poprawiony plik) z zachowaniem Twoich dopasowań ----------
  let reloadId = null; // id spisu, który wczytujemy ponownie (zamiast tworzyć nowy)
  const titlesOf = (it) => [it.title, ...(it.alt || [])].map((t) => Catalog.norm(t));
  function reloadBook(b, source, parsed) {
    const old = b.items;
    const used = new Set();
    const map = {}; // stary indeks → nowy indeks (dla programów uroczystości)
    let kept = 0;
    const items = parsed.items.map((p, ni) => {
      const it = { no: p.no, title: p.title, ...(p.alt ? { alt: p.alt } : {}), state: 'none', files: [], sugg: [] };
      const nt = titlesOf(it);
      // ta sama pieśń: wspólny tytuł (preferowany ten sam numer), a gdy tytuł poprawiony – ten sam numer i podobny tytuł
      let oi = old.findIndex((o, i) => !used.has(i) && o.no === it.no && titlesOf(o).some((t) => nt.includes(t)));
      if (oi < 0) oi = old.findIndex((o, i) => !used.has(i) && titlesOf(o).some((t) => nt.includes(t)));
      if (oi < 0 && it.no) oi = old.findIndex((o, i) => !used.has(i) && o.no === it.no && SongList.sameSong(o.title, it.title));
      if (oi >= 0) {
        const o = old[oi];
        used.add(oi);
        map[oi] = ni;
        Object.assign(it, { state: o.state, files: o.files || [], score: o.score, sugg: o.sugg || [], rejected: o.rejected });
        if (o.state === 'ok' || o.state === 'missing' || o.state === 'auto') kept++;
      }
      return it;
    });
    Matcher.matchItems(items, A.data.nodes, A.data.meta, A.idx); // nowe i niezatwierdzone – od nowa
    // programy uroczystości: przesuń odwołania do pozycji tego spisu
    for (const pr of A.data.programs || []) for (const pt of pr.parts) for (const x of pt.items) {
      if (!x.src || x.src.book !== b.id || x.src.i == null) continue;
      if (map[x.src.i] != null) { x.src.no = items[map[x.src.i]].no; x.src.i = map[x.src.i]; } else delete x.src; // pozycja zniknęła – program zachowuje swoje nuty
    }
    // stare pozycje bez pary: część to dawne osobne tytuły, które teraz są drugim tytułem („też: …”) innej pozycji
    const allNew = new Set(items.flatMap(titlesOf));
    const leftover = old.filter((o, i) => !used.has(i));
    const merged = leftover.filter((o) => titlesOf(o).some((t) => allNew.has(t))).length;
    const removed = leftover.length - merged;
    b.items = items;
    b.source = source;
    b.importedAt = new Date().toISOString();
    A.changed();
    if (window.Dups && A.data.dups && A.data.dups.at) Dups.detect(true);
    filter = 'all';
    query = '';
    render();
    A.toast(`Wczytano ponownie „${b.name}”: ${items.length} ${A.plural(items.length, 'pozycja', 'pozycje', 'pozycji')}` +
      (parsed.aliases ? ` (${parsed.aliases} z drugim tytułem)` : '') +
      `. Zachowane dopasowania: ${kept}, nowe pozycje: ${items.length - used.size}` +
      (merged ? `, połączone jako drugi tytuł: ${merged}` : '') + `, usunięte ze spisu: ${removed}.`);
  }
  // wspólne zakończenie wczytania: nowy spis albo ponowne wczytanie istniejącego
  // id spisu do ponownego wczytania – pobierany od razu po wyborze pliku (zamknięcie okna bez wyboru go kasuje)
  function takeReload() { const r = reloadId; reloadId = null; return r; }
  function finishImport(rid, name, source, parsed) {
    const b = rid && books().find((x) => x.id === rid);
    if (b) reloadBook(b, source, parsed);
    else createBook(name, source, parsed);
  }

  async function importLocal(file) {
    const rid = takeReload();
    try {
      const parsed = await SongList.fromFile(file.name, await file.arrayBuffer());
      finishImport(rid, A.stripExt(file.name), { kind: 'local', name: file.name }, parsed);
    } catch (e) {
      A.handleError(e);
    }
  }

  function importDrive() {
    A.openPicker('doc', loadDriveDoc);
  }
  async function loadDriveDoc(f) {
    const rid = takeReload();
    try {
      A.toast('Wczytywanie spisu…');
      const gdoc = f.mimeType === SongList.GDOC;
      const content = gdoc ? await Drive.exportText(f.id) : await Drive.download(f.id);
      const parsed = await SongList.fromFile(gdoc ? f.name + '.txt' : f.name, content);
      finishImport(rid, A.stripExt(f.name), { kind: 'drive', id: f.id, name: f.name }, parsed);
    } catch (e) {
      A.handleError(e);
    }
  }

  // Ponowne dopasowanie (np. po skanowaniu); pozycji zatwierdzonych ręcznie nie rusza.
  function rematchAll(quiet) {
    for (const b of books()) Matcher.matchItems(b.items, A.data.nodes, A.data.meta, A.idx);
    if (!quiet) A.toast('Dopasowano ponownie. Pozycje zatwierdzone przez Ciebie zostały bez zmian.');
  }

  // Po zatwierdzeniu: plik bez własnej nazwy dostaje tytuł ze spisu.
  function autoName(it) {
    if (it.files.length !== 1) return;
    const id = it.files[0];
    const m = A.data.meta[id] || {};
    if (A.data.nodes[id] && !m.title) A.data.meta[id] = { ...m, title: it.title };
  }

  // Programy uroczystości pamiętają miejsce pozycji w spisie (src.i) – po dodaniu/usunięciu pozycji przesuwamy te odwołania.
  function shiftProgramRefs(bookId, at, delta) {
    for (const pr of A.data.programs || []) {
      for (const pt of pr.parts) {
        for (const x of pt.items) {
          if (!x.src || x.src.book !== bookId || x.src.i == null) continue;
          if (delta < 0 && x.src.i === at) delete x.src; // pozycja usunięta – zostają nuty zapamiętane w programie
          else if (x.src.i >= at) x.src.i += delta;
        }
      }
    }
  }

  function saveEdit(el, it) {
    const no = el.querySelector('.se-no').value.trim();
    const title = el.querySelector('.se-title').value.trim().replace(/\s+/g, ' ');
    if (!title) return A.toast('Tytuł nie może być pusty.', true);
    const changedTitle = title !== it.title;
    it.no = no;
    it.title = title;
    // nowy tytuł → dopasuj nuty od nowa (o ile nie były zatwierdzone ręcznie)
    if (changedTitle && it.state !== 'ok' && it.state !== 'missing') {
      it.state = 'none';
      it.rejected = [];
      Matcher.matchItems([it], A.data.nodes, A.data.meta, A.idx);
    }
    editing = -1;
    A.changed();
    render();
    A.toast('Zapisano zmianę.');
  }

  // Nowa pozycja: miejsce według numeru (gdy numer jest liczbą), inaczej na końcu spisu.
  function addItem() {
    const b = book();
    if (!b) return;
    const no = $('sb-add-no').value.trim();
    const title = $('sb-add-title').value.trim().replace(/\s+/g, ' ');
    if (!title) { $('sb-add-title').focus(); return A.toast('Wpisz tytuł nowej pozycji.'); }
    const it = { no, title, state: 'none', files: [], sugg: [] };
    Matcher.matchItems([it], A.data.nodes, A.data.meta, A.idx);
    let at = b.items.length;
    const n = parseInt(no, 10);
    if (!Number.isNaN(n)) {
      const k = b.items.findIndex((x) => parseInt(x.no, 10) > n);
      if (k >= 0) at = k;
    }
    b.items.splice(at, 0, it);
    shiftProgramRefs(b.id, at, +1);
    $('sb-add-no').value = '';
    $('sb-add-title').value = '';
    $('sb-add-no').focus();
    filter = 'all';
    query = '';
    $('sb-q').value = '';
    A.changed();
    render();
    const row = $('sb-list').querySelector(`.song[data-i="${at}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); }
    A.toast(`Dodano: ${no ? no + '. ' : ''}${title}` + (it.state === 'auto' || it.state === 'check' ? ' – znaleziono propozycję nut.' : '.'));
  }

  function update(it, fn) {
    fn(it);
    A.changed();
    render();
    A.renderTree();
  }

  // ---------- wyświetlanie ----------
  // kliknięcie = podgląd w aplikacji (wszystkie pliki pieśni, od tego); Ctrl/środkowy przycisk = Dysk Google
  function chip(id, i, all) {
    const n = A.data.nodes[id];
    if (!n) return '<span class="chip gone" title="Pliku nie ma w ostatnim skanowaniu">plik zniknął z Dysku</span>';
    const m = A.data.meta[id];
    const label = (m && m.title) || n.name;
    const path = Catalog.pathOf(A.data.nodes, id);
    return `<a class="chip" href="${Preview.driveUrl(id)}" target="_blank" rel="noopener" ${Preview.attrs(Array.isArray(all) ? all : [id], Array.isArray(all) ? i : 0)} title="${esc((n.viaShortcut ? `skrót w: ${path} · oryginał: ${n.real || 'poza wybranymi folderami'}` : path + ' / ' + n.name) + ' · kliknij: podgląd nut')}">
      <span class="badge ${n.kind}">${n.kind === 'pdf' ? 'PDF' : 'IMG'}</span><span class="chip-name">${esc(label)}</span>${m && m.title ? `<span class="chip-orig">${esc(n.name)}</span>` : ''}</a>`;
  }
  const chips = (files) => files.map(chip).join('');
  const pct = (s) => `<span class="pct" title="Podobieństwo nazwy">${Math.round((s || 0) * 100)}%</span>`;

  const STATE = {
    ok: ['have', 'Są nuty'],
    auto: ['have', 'Są nuty · automatycznie'],
    check: ['check', 'Do sprawdzenia'],
    none: ['missing', 'Brak nut'],
    missing: ['missing', 'Brak nut · potwierdzone'],
  };

  // Propozycje do zaznaczenia przy pozycji „do sprawdzenia” / „brak” – można wybrać kilka naraz (np. strona 1 i 2).
  function candsOf(it) {
    const main = it.state === 'check' && it.files.length ? [{ files: it.files, score: it.score, main: true }] : [];
    return [...main, ...(it.sugg || []).slice(0, it.state === 'check' ? 3 : 4)];
  }

  function row(it, i) {
    const [cls, label] = STATE[it.state] || STATE.none;
    let body = '';
    let acts = '';
    const cands = it.state === 'check' || it.state === 'none' ? candsOf(it) : [];
    if (it.state === 'ok' || it.state === 'auto') {
      body = `<div class="chips">${chips(it.files)}${it.files.length > 1 ? '<button class="btn small" data-a="order" title="Ustaw pliki od pierwszej do ostatniej strony">⇅ Kolejność stron</button>' : ''}</div>`;
      acts = (it.state === 'auto' ? '<button class="btn small primary" data-a="confirm">✓ Zgadza się</button><button class="btn small" data-a="reject">✕ To nie to</button>' : '') +
        '<button class="btn small" data-a="choose" title="Zmień albo dodaj kolejne pliki (np. drugą stronę)">Zmień / dodaj pliki…</button>' +
        (it.state === 'ok' ? '<button class="btn small" data-a="reset" title="Wróć do dopasowania automatycznego">↺</button>' : '');
    } else if (cands.length) {
      const sel = cands.filter((c) => c.main).length;
      acts = `<button class="btn small primary" data-a="confirmSel"${sel ? '' : ' disabled'}>✓ Zatwierdź zaznaczone${sel ? ` (${sel})` : ''}</button>` +
        (it.state === 'check' ? '<button class="btn small" data-a="rejectAll" title="Żadna z propozycji nie pasuje">✕ Żadne nie pasuje</button>' : '') +
        '<button class="btn small" data-a="choose">Wybierz inny plik…</button>' +
        (it.state === 'none' ? '<button class="btn small" data-a="missing" title="Potwierdź, że tych nut nie ma">Nie mamy</button>' : '');
    } else {
      acts = '<button class="btn small" data-a="choose">Wybierz plik…</button>' +
        (it.state === 'none' ? '<button class="btn small" data-a="missing" title="Potwierdź, że tych nut nie ma">Nie mamy</button>' : '<button class="btn small" data-a="reset" title="Wróć do dopasowania automatycznego">↺</button>');
    }
    const sugg = cands.length
      ? `<div class="cands"><span class="muted small">${it.state === 'check' ? 'Zaznacz pasujące pliki (można kilka):' : 'Może to? Zaznacz pasujące pliki:'}</span>${cands.map((c, k) =>
        `<label class="cand${c.main ? ' on' : ''}"><input type="checkbox" data-k="${k}"${c.main ? ' checked' : ''} aria-label="Zaznacz">${chips(c.files)}${pct(c.score)}</label>`).join('')}</div>`
      : '';
    return `<div class="song ${cls}" data-i="${i}">
      <span class="no">${esc(it.no || '')}</span>
      <div class="song-main">${editing === i
        ? `<div class="song-edit"><input class="se-no" value="${esc(it.no || '')}" maxlength="6" placeholder="Nr" aria-label="Numer">
            <input class="se-title" value="${esc(it.title)}" maxlength="200" aria-label="Tytuł">
            <button class="btn small primary" data-a="editSave">Zapisz</button><button class="btn small" data-a="editCancel">Anuluj</button></div>`
        : `<div class="song-head"><span class="song-title">${esc(it.title)}${it.alt && it.alt.length ? ` <span class="song-alt">też: ${esc(it.alt.join('; '))}</span>` : ''}</span><span class="state ${cls}">${label}</span>
            <span class="song-edit-btns"><button class="icon-btn" data-a="edit" title="Popraw tytuł lub numer" aria-label="Popraw">✎</button><button class="icon-btn" data-a="del" title="Usuń pozycję ze spisu" aria-label="Usuń pozycję">✕</button></span></div>`}${body}${sugg}</div>
      <div class="song-acts">${acts}</div></div>`;
  }

  function render() {
    const list = books();
    const b = book();
    if (b) setCurrent(b.id);
    $('sb-empty').hidden = !!b;
    $('sb-content').hidden = !b;
    $('sb-select').innerHTML = list.map((x) => `<option value="${esc(x.id)}"${b && x.id === b.id ? ' selected' : ''}>${esc(x.name)}${x.code ? ` [${esc(x.code)}]` : ''} · ${x.items.length} poz.${x.restoredAt ? ' · przywrócony' : ''}</option>`).join('');
    $('sb-select').hidden = list.length < 2;
    if (!b) return;

    if (document.activeElement !== $('sb-name')) $('sb-name').value = b.name;
    if (document.activeElement !== $('sb-code')) $('sb-code').value = b.code || '';
    const autos = b.items.filter((it) => it.state === 'auto').length;
    $('sb-confirm-all').hidden = !autos;
    $('sb-confirm-all').textContent = `✓ Zatwierdź pewne (${autos})`;
    $('sb-source').textContent = (b.source && b.source.kind === 'manual' ? `utworzony ręcznie ${new Date(b.importedAt).toLocaleDateString('pl-PL')}`
      : `${b.source && b.source.name ? 'Plik: ' + b.source.name + ' · ' : ''}wczytano ${new Date(b.importedAt).toLocaleDateString('pl-PL')}`) +
      (b.restoredAt ? ` · przywrócony z historii ${new Date(b.restoredAt).toLocaleDateString('pl-PL')}` : '');

    const n = { all: b.items.length, have: 0, check: 0, missing: 0 };
    b.items.forEach((it) => { n[group(it)]++; });
    document.querySelectorAll('#sb-filters [data-f]').forEach((el) => {
      el.classList.toggle('active', el.dataset.f === filter);
      el.querySelector('b').textContent = n[el.dataset.f];
    });

    const words = Catalog.norm(query).split(' ').filter(Boolean);
    const rows = [];
    b.items.forEach((it, i) => {
      if (filter !== 'all' && group(it) !== filter) return;
      if (words.length) {
        const hay = Catalog.norm(it.no + ' ' + it.title + ' ' + (it.alt || []).join(' '));
        if (!words.every((w) => hay.includes(w))) return;
      }
      rows.push(row(it, i));
    });
    $('sb-list').innerHTML = rows.join('') || '<p class="muted empty">Brak pozycji w tym widoku.</p>';
  }

  // ---------- ręczny wybór plików ----------
  // opts (wybór z innych miejsc, np. „+ Dodaj plik” w Katalogu): {onSave(ids), exclude:[ids], note(id) → dopisek przy pliku}
  let chooser = null; // { it, selected: [], cands, opts }
  function openChooser(it, opts) {
    if (!Object.keys(A.data.nodes).length) return A.toast('Najpierw przeskanuj Dysk w zakładce „Nuty na Dysku”.', true);
    chooser = { it, opts: opts || null, selected: opts ? [] : [...it.files], cands: Matcher.candidates(A.data.nodes, A.data.meta, A.idx, true).filter((c) => !c.folder) };
    $('chooser-title').textContent = `${it.no ? it.no + '. ' : ''}${it.title}`;
    $('chooser-q').value = '';
    $('chooser').showModal();
    renderChooser();
  }

  function renderChooser() {
    const { it, selected, cands, opts } = chooser;
    const q = $('chooser-q').value.trim();
    const ex = new Set((opts && opts.exclude) || []);
    let ids;
    if (!q) {
      ids = Matcher.rank(it.title, cands, 40, 0.15).map((r) => ({ id: r.files[0], score: r.score }));
    } else {
      const words = Catalog.norm(q).split(' ').filter(Boolean);
      ids = Object.values(A.data.nodes).filter((n) => !n.folder).filter((n) => {
        const m = A.data.meta[n.id];
        const hay = Catalog.norm(A.stripExt(n.name) + ' ' + ((m && m.title) || '')); // tylko nazwa – bez folderu i rozszerzenia
        return words.every((w) => hay.includes(w));
      }).slice(0, 150).map((n) => ({ id: n.id }));
    }
    // zaznaczone zawsze na górze
    const shown = [...selected.map((id) => ({ id })), ...ids.filter((x) => !selected.includes(x.id) && !ex.has(x.id))];
    $('chooser-list').innerHTML = shown.length ? shown.map(({ id, score }) => {
      const n = A.data.nodes[id];
      if (!n) return '';
      const m = A.data.meta[id];
      const on = selected.includes(id);
      return `<li><label class="choose-item${on ? ' on' : ''}"><input type="checkbox" data-id="${esc(id)}"${on ? ' checked' : ''}>
        <span class="badge ${n.kind}">${n.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
        <span class="choose-names"><span>${esc((m && m.title) || n.name)}</span><span class="orig">${esc(Catalog.pathOf(A.data.nodes, id))}${m && m.title ? ' / ' + esc(n.name) : ''}</span>${opts && opts.note ? opts.note(id) : ''}</span>
        ${score ? pct(score) : ''}
        ${Preview.noteBtn(id)}</label></li>`;
    }).join('') : `<li class="muted">${q ? 'Nic nie pasuje.' : 'Brak podobnych nazw – wpisz coś w wyszukiwarkę.'}</li>`;
    $('chooser-count').textContent = selected.length ? `Zaznaczono: ${selected.length}` : '';
  }

  // ---------- zdarzenia ----------
  $('sb-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) importLocal(f);
  });
  document.querySelectorAll('[data-import]').forEach((b) => b.addEventListener('click', () => {
    reloadId = null; // zwykłe „Wczytaj spis” = nowy spis
    if (b.dataset.import === 'local') $('sb-file').click();
    else importDrive();
  }));
  $('sb-select').addEventListener('change', (e) => { setCurrent(e.target.value); render(); });
  $('sb-name').addEventListener('change', (e) => {
    const b = book();
    const v = e.target.value.trim();
    if (b && v && v !== b.name) { b.name = v; A.changed(); render(); }
  });
  // identyfikator śpiewnika (do 3 znaków, unikalny); puste pole = automatyczny (A01, A02…)
  $('sb-code').addEventListener('change', (e) => {
    const b = book();
    if (!b) return;
    let v = A.cleanCode(e.target.value);
    const other = v && books().find((x) => x !== b && x.code === v);
    if (other) {
      A.toast(`Identyfikator „${v}” ma już spis „${other.name}”. Wybierz inny.`, true);
      e.target.value = b.code || '';
      return;
    }
    if (!v) { b.code = ''; v = A.nextCode(books()); }
    e.target.value = v;
    if (v === b.code) return;
    b.code = v;
    A.changed();
    A.toast(`Identyfikator spisu „${b.name}”: ${v}.`);
  });
  $('sb-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('sb-confirm-all').addEventListener('click', () => {
    const b = book();
    if (!b) return;
    const autos = b.items.filter((it) => it.state === 'auto');
    autos.forEach((it) => { it.state = 'ok'; autoName(it); });
    A.changed();
    render();
    A.renderTree();
    A.toast(`Zatwierdzono ${autos.length} ${A.plural(autos.length, 'pozycję', 'pozycje', 'pozycji')}.`);
  });
  $('sb-rematch').addEventListener('click', () => { rematchAll(false); A.changed(); render(); });
  // „↻ Wczytaj ponownie…” – okno z wyborem pliku (ten sam z Dysku / inny z Dysku / z komputera)
  $('sb-reload').addEventListener('click', () => {
    const b = book();
    if (!b) return;
    const src = b.source || {};
    $('rl-title').textContent = b.name;
    $('rl-same').hidden = !(src.kind === 'drive' && src.id);
    $('rl-same').textContent = `Z tego samego pliku na Dysku (${src.name || ''})`;
    $('reload-dlg').showModal();
  });
  $('sb-file').addEventListener('cancel', () => { reloadId = null; });
  $('picker').addEventListener('close', () => { setTimeout(() => { reloadId = null; }, 0); });
  $('reload-dlg').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-rl]');
    if (!btn) return;
    const b = book();
    $('reload-dlg').close();
    if (!b || btn.dataset.rl === 'cancel') return;
    reloadId = b.id;
    if (btn.dataset.rl === 'same') {
      if (!(await A.ensureConnected())) { reloadId = null; return; }
      loadDriveDoc({ id: b.source.id, name: b.source.name, mimeType: b.source.name && /\.(odt|docx|txt)$/i.test(b.source.name) ? '' : SongList.GDOC });
    } else if (btn.dataset.rl === 'drive') importDrive();
    else $('sb-file').click();
  });
  $('sb-delete').addEventListener('click', () => {
    const b = book();
    if (!b || !confirm(`Usunąć spis „${b.name}” z aplikacji?\n\nPlik na Dysku i nuty zostaną nietknięte.`)) return;
    A.data.songbooks = books().filter((x) => x.id !== b.id);
    A.markDeleted(b.id);
    setCurrent(null);
    A.changed();
    render();
  });
  $('sb-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (b) { filter = b.dataset.f; render(); }
  });
  let qt = null;
  $('sb-q').addEventListener('input', (e) => {
    clearTimeout(qt);
    qt = setTimeout(() => { query = e.target.value; render(); }, 120);
  });

  $('sb-add-btn').addEventListener('click', addItem);
  $('sb-new').addEventListener('click', newBook);
  // „+ Dodaj pozycję” w pasku spisu – pokazuje pole do wpisania (po dodaniu zostaje otwarte, żeby dopisać kolejne)
  $('sb-add-open').addEventListener('click', () => {
    $('sb-add').hidden = false;
    $('sb-add-no').focus();
  });
  $('sb-add-close').addEventListener('click', () => { $('sb-add').hidden = true; });
  $('sb-add-no').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('sb-add-title').focus(); } });
  $('sb-add-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(); });
  $('sb-list').addEventListener('keydown', (e) => {
    if (!e.target.closest('.song-edit')) return;
    const el = e.target.closest('.song');
    const b = book();
    if (e.key === 'Enter' && b) saveEdit(el, b.items[Number(el.dataset.i)]);
    if (e.key === 'Escape') { editing = -1; render(); }
  });

  $('sb-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-a]');
    const el = e.target.closest('.song');
    const b = book();
    if (!btn || !el || !b) return;
    const it = b.items[Number(el.dataset.i)];
    if (!it) return;
    const idx = Number(el.dataset.i);
    switch (btn.dataset.a) {
      case 'edit':
        editing = idx;
        render();
        setTimeout(() => { const t = $('sb-list').querySelector('.se-title'); if (t) { t.focus(); t.select(); } }, 20);
        return;
      case 'editCancel': editing = -1; return render();
      case 'editSave': return saveEdit(el, it);
      case 'del':
        if (!confirm(`Usunąć pozycję ${it.no ? it.no + '. ' : ''}„${it.title}” ze spisu „${b.name}”?\n\nPlik ze spisem na Dysku zostaje bez zmian.`)) return;
        b.items.splice(idx, 1);
        shiftProgramRefs(b.id, idx, -1);
        editing = -1;
        A.changed();
        render();
        return A.toast('Usunięto pozycję.');
      case 'confirm': return update(it, (x) => { x.state = 'ok'; autoName(x); });
      case 'reject': return update(it, (x) => {
        x.rejected = [...new Set([...(x.rejected || []), x.files.join(',')])];
        x.state = 'none';
        Matcher.matchItems([x], A.data.nodes, A.data.meta, A.idx);
        if (x.state !== 'none') { x.state = 'check'; } // po odrzuceniu kolejna propozycja zawsze do sprawdzenia
      });
      case 'confirmSel': {
        const ks = [...el.querySelectorAll('.cand input:checked')].map((c) => Number(c.dataset.k));
        if (!ks.length) return A.toast('Zaznacz co najmniej jeden plik.');
        const cands = candsOf(it);
        return update(it, (x) => {
          // kolejność stron: zapisana przy plikach (⇅), a bez niej – według nazwy pliku („… 1.jpg”, „… 2.jpg”)
          x.files = A.orderFiles([...new Set(ks.flatMap((k) => (cands[k] ? cands[k].files : [])))]);
          x.state = 'ok';
          autoName(x);
        });
      }
      case 'rejectAll': return update(it, (x) => {
        x.rejected = [...new Set([...(x.rejected || []), ...candsOf(x).map((c) => c.files.join(','))])];
        x.state = 'none';
        Matcher.matchItems([x], A.data.nodes, A.data.meta, A.idx);
        if (x.state !== 'none') x.state = 'check';
      });
      case 'use': return update(it, (x) => {
        const s = x.sugg[Number(btn.dataset.k)];
        if (!s) return;
        x.files = s.files;
        x.state = 'ok';
        autoName(x);
      });
      case 'missing': return update(it, (x) => { x.state = 'missing'; x.files = []; });
      case 'reset': return update(it, (x) => {
        x.state = 'none';
        Matcher.matchItems([x], A.data.nodes, A.data.meta, A.idx);
      });
      case 'choose': return openChooser(it);
      case 'order': return A.openOrder(it.files, `${it.no ? it.no + '. ' : ''}${it.title}`);
      default:
    }
  });

  // zaznaczanie propozycji: licznik na przycisku „Zatwierdź zaznaczone”
  $('sb-list').addEventListener('change', (e) => {
    if (!e.target.matches('.cand input')) return;
    e.target.closest('.cand').classList.toggle('on', e.target.checked);
    const el = e.target.closest('.song');
    const n = el.querySelectorAll('.cand input:checked').length;
    const b = el.querySelector('[data-a="confirmSel"]');
    if (b) { b.disabled = !n; b.textContent = `✓ Zatwierdź zaznaczone${n ? ` (${n})` : ''}`; }
  });

  $('chooser-q').addEventListener('input', () => renderChooser());
  $('chooser-list').addEventListener('change', (e) => {
    const id = e.target.dataset.id;
    if (!id || !chooser) return;
    if (e.target.checked) { if (!chooser.selected.includes(id)) chooser.selected.push(id); }
    else chooser.selected = chooser.selected.filter((x) => x !== id);
    e.target.closest('.choose-item').classList.toggle('on', e.target.checked);
    $('chooser-count').textContent = chooser.selected.length ? `Zaznaczono: ${chooser.selected.length}` : '';
  });
  $('chooser-cancel').addEventListener('click', () => $('chooser').close());
  $('chooser-save').addEventListener('click', () => {
    const { it, selected, opts } = chooser;
    $('chooser').close();
    if (opts) return opts.onSave([...selected]);
    update(it, (x) => {
      x.files = A.orderFiles([...selected]);
      x.state = selected.length ? 'ok' : 'none';
      if (selected.length) autoName(x);
      else Matcher.matchItems([x], A.data.nodes, A.data.meta, A.idx);
    });
  });

  // przejście do pozycji spisu (np. ze zgłoszenia chórzysty)
  function reveal(bookId, i) {
    if (!books().find((b) => b.id === bookId)) return false;
    setCurrent(bookId);
    $('sb-q').value = '';
    render();
    const row = $('sb-list').querySelector(`.song[data-i="${i}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); }
    return true;
  }

  // wybór plików z innego miejsca aplikacji (to samo okno co „Wybierz plik…”)
  const chooseFiles = (title, opts) => openChooser({ title, no: '', files: [] }, opts);
  return { chooseFiles, render, rematchAll, reveal };
})();
