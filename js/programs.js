// Administrator: programy uroczystości – pieśni ułożone według części mszy, z krótkimi uwagami.
window.Programs = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = window.App;
  const esc = A.esc;
  const PARTS = ['Wejście', 'Kyrie', 'Gloria', 'Psalm', 'Alleluja lub Chwała', 'Ofiarowanie', 'Sanctus', 'Agnus Dei', 'Komunia', 'Uwielbienie', 'Wyjście'];
  const OPEN_KEY = 'kn-program';
  let openId = null;
  try { openId = localStorage.getItem(OPEN_KEY); } catch (e) { /* brak */ }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const list = () => {
    if (!Array.isArray(A.data.programs)) A.data.programs = [];
    return A.data.programs;
  };
  const prog = () => list().find((p) => p.id === openId) || null;
  const setOpen = (id) => {
    openId = id;
    try { if (id) localStorage.setItem(OPEN_KEY, id); else localStorage.removeItem(OPEN_KEY); } catch (e) { /* trudno */ }
  };
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const isPast = (p) => !!p.date && p.date < today();
  const fmtDate = (s) => {
    if (!s) return 'bez daty';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  };
  const usable = (it) => (it.state === 'ok' || it.state === 'auto') && it.files.length > 0;

  // Pozycja spisu, z której pochodzi pieśń programu (albo null)
  function srcItem(item) {
    if (!item.src) return null;
    const b = A.data.songbooks.find((x) => x.id === item.src.book);
    if (!b) return null;
    const byIdx = item.src.i != null ? b.items[item.src.i] : null;
    const it = (byIdx && byIdx.no === item.src.no ? byIdx : null) ||
      (item.src.no ? b.items.find((x) => x.no === item.src.no) : null) ||
      b.items.find((x) => x.title === item.title);
    return it ? { b, it } : null;
  }

  // Pliki pozycji: gdy pieśń pochodzi ze spisu, bierzemy aktualne dopasowanie z tego spisu.
  function resolve(item) {
    const r = srcItem(item);
    if (r && usable(r.it)) return r.it.files.filter((f) => A.data.nodes[f]);
    return (item.files || []).filter((f) => A.data.nodes[f]);
  }

  // Dopisek do tytułu: identyfikator śpiewnika + numer, np. „[N 34]”.
  // Pieśń dodana jako plik: szukamy pozycji spisu z dokładnie tymi samymi nutami.
  function tag(item) {
    let r = srcItem(item);
    if (!r && item.files && item.files.length) {
      const key = [...item.files].sort().join('|');
      for (const b of A.data.songbooks) {
        const it = b.items.find((x) => usable(x) && [...x.files].sort().join('|') === key);
        if (it) { r = { b, it }; break; }
      }
    }
    if (!r || !r.b.code) return '';
    return `[${r.b.code}${r.it.no ? ' ' + r.it.no : ''}]`;
  }
  const fullTitle = (item) => { const t = tag(item); return t ? `${item.title} ${t}` : item.title; };

  // Dla publikacji: programy z aktualnymi plikami (id oryginałów)
  function forPublish() {
    return list().map((p) => ({
      id: p.id,
      name: p.name,
      date: p.date || '',
      parts: p.parts.map((pt) => ({ name: pt.name, items: pt.items.map((it) => ({ title: fullTitle(it), note: it.note || '', files: resolve(it) })) })),
    }));
  }

  // ---------- lista programów ----------
  function create() {
    const p = { id: 'pr' + uid(), name: 'Nowa uroczystość', date: '', createdAt: new Date().toISOString(),
      parts: PARTS.map((name) => ({ id: uid(), name, items: [] })) };
    list().push(p);
    setOpen(p.id);
    A.changed();
    render();
    setTimeout(() => { $('ev-name').focus(); $('ev-name').select(); }, 30);
  }
  function copy(id) {
    const src = list().find((p) => p.id === id);
    if (!src) return;
    const p = JSON.parse(JSON.stringify(src));
    p.id = 'pr' + uid();
    p.name = src.name + ' (kopia)';
    p.date = '';
    p.createdAt = new Date().toISOString();
    p.parts.forEach((pt) => { pt.id = uid(); });
    list().push(p);
    setOpen(p.id);
    A.changed();
    render();
    A.toast('Utworzono kopię – ustaw nazwę i datę.');
  }
  function remove(id) {
    const p = list().find((x) => x.id === id);
    if (!p || !confirm(`Usunąć program „${p.name}”?\n\nPo aktualizacji zniknie też chórzystom. Nuty na Dysku zostają nietknięte.`)) return;
    A.data.programs = list().filter((x) => x.id !== id);
    A.markDeleted(id);
    if (openId === id) setOpen(null);
    A.changed();
    render();
  }

  function card(p) {
    const items = p.parts.flatMap((pt) => pt.items);
    const withNotes = items.filter((it) => resolve(it).length).length;
    return `<div class="ev-row" data-id="${esc(p.id)}">
      <div class="ev-row-main"><strong>${esc(p.name)}</strong><span class="muted small">${esc(fmtDate(p.date))} · ${items.length} ${A.plural(items.length, 'pieśń', 'pieśni', 'pieśni')}${items.length ? `, z nutami: ${withNotes}` : ''}${p.restoredAt ? ` · przywrócony z historii ${new Date(p.restoredAt).toLocaleDateString('pl-PL')}` : ''}</span></div>
      <div class="ev-tools"><button class="btn small primary" data-a="open">Otwórz</button><button class="btn small" data-a="copy">Kopiuj</button><button class="btn small" data-a="del">Usuń</button></div></div>`;
  }

  function renderList() {
    const all = list();
    const next = all.filter((p) => !isPast(p)).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    const past = all.filter(isPast).sort((a, b) => b.date.localeCompare(a.date));
    $('ev-list').innerHTML = (next.length ? `<h3 class="sub">Nadchodzące</h3>${next.map(card).join('')}` : '') +
      (past.length ? `<h3 class="sub">Archiwum <span class="muted small">(chórzyści nadal je widzą, dopóki ich nie usuniesz)</span></h3>${past.map(card).join('')}` : '') +
      (all.length ? '' : '<p class="muted">Nie ma jeszcze żadnego programu. Kliknij „+ Nowy program” albo „📄 Wczytaj z pliku…”.</p>');
  }

  // ---------- wczytanie programów z pliku (np. „Triduum” – kilka dni w jednym dokumencie) ----------
  // Pieśń łączymy z pozycją spisu (pewne dopasowanie tytułu), a gdy jej tam nie ma – z plikiem na Dysku.
  function songMatcher() {
    const books = [];
    for (const b of A.data.songbooks) {
      b.items.forEach((it, i) => {
        if (!usable(it)) return;
        for (const t of [it.title, ...(it.alt || [])]) {
          const s = Matcher.split(t);
          books.push({ b, it, i, key: [...it.files].sort().join('|'), all: [...s.main, ...s.extra] });
        }
      });
    }
    const files = Matcher.candidates(A.data.nodes, A.data.meta, A.idx);
    const sure = (list) => {
      const [best, second] = list;
      return best && best.score >= Matcher.SURE && !(second && second.key !== best.key && best.score - second.score < 0.05) ? best : null;
    };
    return (title) => {
      const t = Matcher.split(title);
      const scored = books.map((c) => ({ ...c, score: Matcher.score(t, c) })).filter((c) => c.score >= Matcher.MAYBE)
        .sort((a, b) => b.score - a.score);
      const hit = sure(scored);
      if (hit) return { files: [...hit.it.files], src: { book: hit.b.id, bookName: hit.b.name, no: hit.it.no, i: hit.i } };
      const f = sure(Matcher.rank(title, files, 3).map((x) => ({ ...x, key: x.files.join('|') })));
      if (f) return { files: A.orderFiles(f.files) };
      return { files: [] };
    };
  }

  async function importFile(file) {
    let res;
    try {
      const lines = await SongList.linesOf(file.name, await file.arrayBuffer(), true);
      res = ProgImport.parse(lines);
    } catch (e) {
      return A.toast('Nie udało się odczytać pliku: ' + e.message, true);
    }
    if (!res.days.length) return A.toast('Nie znalazłem w pliku żadnej uroczystości z pieśniami.', true);
    const find = songMatcher();
    let total = 0;
    let fromBook = 0;
    let fromFile = 0;
    const made = res.days.map((d) => ({
      id: 'pr' + uid(),
      name: res.group ? `${d.name} – ${res.group}` : d.name,
      date: '',
      createdAt: new Date().toISOString(),
      source: { kind: 'file', name: file.name },
      parts: d.parts.map((pt) => ({
        id: uid(),
        name: pt.name,
        items: pt.items.map((x) => {
          const m = find(x.title);
          total++;
          if (m.src) fromBook++;
          else if (m.files.length) fromFile++;
          return { title: x.title, note: x.note || '', files: m.files, ...(m.src ? { src: m.src } : {}) };
        }),
      })),
    }));
    list().push(...made);
    setOpen(null);
    A.changed();
    render();
    const none = total - fromBook - fromFile;
    A.toast(`Wczytano ${made.length} ${A.plural(made.length, 'uroczystość', 'uroczystości', 'uroczystości')}${res.group ? ` („${res.group}”)` : ''}: ` +
      `${total} ${A.plural(total, 'pieśń', 'pieśni', 'pieśni')} – ze spisów ${fromBook}, z plików ${fromFile}, bez nut ${none}. ` +
      'Ustaw daty i sprawdź dopasowania (♪ Dołącz nuty / Zmień nuty).');
  }

  // ---------- edycja programu ----------
  function chip(id, i, all) {
    const n = A.data.nodes[id];
    if (!n) return '<span class="chip gone">plik zniknął z Dysku</span>';
    const m = A.data.meta[id];
    return `<a class="chip" href="${Preview.driveUrl(id)}" target="_blank" rel="noopener" ${Preview.attrs(Array.isArray(all) ? all : [id], Array.isArray(all) ? i : 0)} title="Podgląd nut">
      <span class="badge ${n.kind}">${n.kind === 'pdf' ? 'PDF' : 'IMG'}</span><span class="chip-name">${esc((m && m.title) || n.name)}</span></a>`;
  }

  function renderEditor(p) {
    if (document.activeElement !== $('ev-name')) $('ev-name').value = p.name;
    $('ev-date').value = p.date || '';
    $('ev-state').textContent = isPast(p) ? 'Archiwum – uroczystość już się odbyła' : '';
    $('ev-parts').innerHTML = p.parts.map((pt, pi) => `<div class="ev-part" data-p="${pi}">
      <div class="ev-part-head">
        <input class="ev-pname" value="${esc(pt.name)}" aria-label="Nazwa części">
        <div class="ev-tools">
          <button class="icon-btn" data-a="pup" title="Przesuń część wyżej"${pi === 0 ? ' disabled' : ''}>↑</button>
          <button class="icon-btn" data-a="pdown" title="Przesuń część niżej"${pi === p.parts.length - 1 ? ' disabled' : ''}>↓</button>
          <button class="icon-btn" data-a="pdel" title="Usuń część">✕</button>
        </div>
      </div>
      ${pt.items.map((it, ii) => {
        const files = resolve(it);
        return `<div class="ev-item" data-i="${ii}">
          <div class="ev-item-main">
            <div class="ev-item-title"><strong>${esc(it.title)}</strong>${tag(it) ? ` <span class="ev-tag" title="Identyfikator śpiewnika i numer – chórzyści zobaczą go przy tytule">${esc(tag(it))}</span>` : ''}${it.src ? `<span class="muted small">${esc(it.src.bookName || '')}${it.src.no ? ' · nr ' + esc(it.src.no) : ''}</span>` : ''}</div>
            <div class="chips">${files.length ? files.map(chip).join('') : '<span class="muted small">bez nut</span>'}
              ${files.length > 1 ? '<button class="btn small" data-a="order" title="Ustaw pliki od pierwszej do ostatniej strony">⇅ Kolejność stron</button>' : ''}
              <button class="btn small${files.length ? '' : ' primary'}" data-a="attach" title="${files.length ? 'Wybierz inne nuty dla tej pieśni' : 'Dołącz nuty do tej pieśni'}">${files.length ? 'Zmień nuty' : '♪ Dołącz nuty'}</button></div>
            <input class="ev-note" value="${esc(it.note || '')}" placeholder="uwaga, np. zwrotki 1–3, solo: Ania" maxlength="120" aria-label="Uwaga do pieśni">
          </div>
          <div class="ev-tools">
            <button class="icon-btn" data-a="iup" title="Wyżej"${ii === 0 ? ' disabled' : ''}>↑</button>
            <button class="icon-btn" data-a="idown" title="Niżej"${ii === pt.items.length - 1 ? ' disabled' : ''}>↓</button>
            <button class="icon-btn" data-a="idel" title="Usuń pieśń z programu">✕</button>
          </div>
        </div>`;
      }).join('')}
      <button class="btn small ev-add" data-a="add">+ Dodaj pieśń</button>
    </div>`).join('');
  }

  function render() {
    const p = prog();
    $('ev-list-card').hidden = !!p;
    $('ev-editor').hidden = !p;
    if (p) renderEditor(p);
    else renderList();
  }

  // ---------- wybór pieśni ----------
  let pickPart = -1;
  let pickItem = -1; // ≥ 0: dołączamy/zmieniamy nuty istniejącej pieśni zamiast dodawać nową
  function openPicker(pi, ii = -1) {
    pickPart = pi;
    pickItem = ii;
    const p = prog();
    const it = ii >= 0 && p.parts[pi].items[ii];
    $('sp-title').textContent = it ? `Nuty do: ${it.title}` : `Dodaj pieśń: ${p.parts[pi].name}`;
    $('sp-q').value = it ? it.title : '';
    if (window.Works && Object.keys(A.data.nodes).length) Works.sync(); // katalog aktualny (połączone utwory)
    $('song-picker').showModal();
    renderPicker();
    setTimeout(() => $('sp-q').focus(), 30);
  }

  function renderPicker() {
    const q = $('sp-q').value.trim();
    const words = Catalog.norm(q).split(' ').filter(Boolean);
    const match = (hay) => words.every((w) => hay.includes(w));
    let html = '';
    if (!words.length) {
      html = '<li class="muted">Wpisz tytuł, numer ze spisu albo nazwę pliku.</li>';
    } else {
      const songs = [];
      for (const b of A.data.songbooks) {
        b.items.forEach((it, i) => {
          if (!usable(it)) return;
          // tytuł (też alternatywne) albo identyfikator + numer („N 34”); nazwa spisu nie – inaczej pokazuje wszystkie jego pieśni
          if (match(Catalog.norm(`${b.code || ''} ${it.no} ${it.title} ${(it.alt || []).join(' ')}`))) songs.push({ b, it, i });
        });
      }
      // utwory z katalogu (np. połączone tam pliki) – bez tych, które są już na liście jako pozycja spisu z tymi samymi plikami
      const key = (f) => [...f].sort().join('|');
      const songKeys = new Set(songs.map(({ it }) => key(it.files)));
      const works = window.Works ? Works.find(words).filter(({ w }) => !songKeys.has(key(w.files))) : [];
      const inWork = new Set();
      works.forEach(({ w }) => w.files.forEach((id) => inWork.add(id)));
      const files = Object.values(A.data.nodes).filter((n) => !n.folder && !inWork.has(n.id)).filter((n) => {
        const m = A.data.meta[n.id];
        return match(Catalog.norm(`${A.stripExt(n.name)} ${(m && m.title) || ''}`)); // tylko nazwa – bez folderu i rozszerzenia
      });
      html += songs.slice(0, 60).map(({ b, it, i }) => `<li><button type="button" class="pick-item" data-kind="song" data-b="${esc(b.id)}" data-i="${i}">
        <span class="badge doc">SPIS</span><span><b>${esc(it.title)}</b><br><span class="muted small">${esc(b.name)}${b.code ? ' [' + esc(b.code) + ']' : ''}${it.no ? ' · nr ' + esc(it.no) : ''} · ${it.files.length} ${A.plural(it.files.length, 'plik', 'pliki', 'plików')}</span></span><span class="chev">${pickItem >= 0 ? 'Wybierz' : 'Dodaj'}</span></button></li>`).join('');
      html += works.slice(0, 60).map(({ w, ign }) => {
        const n = A.data.nodes[w.files[0]];
        const where = n ? Catalog.pathOf(A.data.nodes, n.id) : '';
        return `<li><button type="button" class="pick-item" data-kind="work" data-w="${esc(w.id)}">
          <span class="badge doc">KAT</span><span><b>${esc(w.title)}</b><br><span class="muted small">Katalog · ${w.files.length} ${A.plural(w.files.length, 'plik', 'pliki', 'plików')}${where ? ' · ' + esc(where) : ''}${w.music ? ' · ' + esc(w.music) : ''}${ign ? ' · nieistotne' : ''}</span></span><span class="chev">${pickItem >= 0 ? 'Wybierz' : 'Dodaj'}</span></button></li>`;
      }).join('');
      html += files.slice(0, 60).map((n) => {
        const m = A.data.meta[n.id];
        return `<li><button type="button" class="pick-item" data-kind="file" data-id="${esc(n.id)}">
          <span class="badge ${n.kind}">${n.kind === 'pdf' ? 'PDF' : 'IMG'}</span><span><b>${esc((m && m.title) || n.name)}</b><br><span class="muted small">${esc(Catalog.pathOf(A.data.nodes, n.id))}${m && m.title ? ' / ' + esc(n.name) : ''}</span></span><span class="chev">${pickItem >= 0 ? 'Wybierz' : 'Dodaj'}</span></button></li>`;
      }).join('');
      if (!songs.length && !works.length && !files.length) html += `<li class="muted">Nic nie znaleziono w spisach ani w plikach.${pickItem >= 0 ? ' Spróbuj krótszej nazwy, np. jednego słowa z tytułu.' : ''}</li>`;
      if (pickItem < 0) html += `<li><button type="button" class="pick-item" data-kind="text"><span class="badge doc">TXT</span><span>Dodaj „<b>${esc(q)}</b>” bez nut<br><span class="muted small">np. psalm śpiewany przez kantora – nuty możesz dodać później</span></span><span class="chev">Dodaj</span></button></li>`;
    }
    $('sp-list').innerHTML = html;
  }

  const workOf = (btn) => { const c = A.data.catalog; return c && c.works && c.works[btn.dataset.w]; };

  function addFromPicker(btn) {
    const p = prog();
    const pt = p && p.parts[pickPart];
    if (!pt) return;
    const cur = pickItem >= 0 && pt.items[pickItem];
    if (cur) { // dołączenie nut do istniejącej pieśni – tytuł i uwaga zostają
      if (btn.dataset.kind === 'song') {
        const b = A.data.songbooks.find((x) => x.id === btn.dataset.b);
        const it = b && b.items[Number(btn.dataset.i)];
        if (!it) return;
        cur.files = [...it.files];
        cur.src = { book: b.id, bookName: b.name, no: it.no, i: Number(btn.dataset.i) };
      } else if (btn.dataset.kind === 'file') {
        cur.files = [btn.dataset.id];
        delete cur.src;
      } else if (btn.dataset.kind === 'work') {
        const w = workOf(btn);
        if (!w) return;
        cur.files = [...w.files];
        delete cur.src;
      } else return;
      $('song-picker').close();
      A.changed();
      render();
      A.toast(`Dołączono nuty do „${cur.title}”.`);
      return;
    }
    let item;
    if (btn.dataset.kind === 'song') {
      const b = A.data.songbooks.find((x) => x.id === btn.dataset.b);
      const it = b && b.items[Number(btn.dataset.i)];
      if (!it) return;
      item = { title: it.title, files: [...it.files], note: '', src: { book: b.id, bookName: b.name, no: it.no, i: Number(btn.dataset.i) } };
    } else if (btn.dataset.kind === 'file') {
      const n = A.data.nodes[btn.dataset.id];
      const m = A.data.meta[n.id];
      item = { title: (m && m.title) || A.stripExt(n.name), files: [n.id], note: '' };
    } else if (btn.dataset.kind === 'work') {
      const w = workOf(btn);
      if (!w) return;
      item = { title: w.title, files: [...w.files], note: '' };
    } else {
      item = { title: $('sp-q').value.trim(), files: [], note: '' };
    }
    pt.items.push(item);
    $('song-picker').close();
    A.changed();
    render();
  }

  // ---------- zdarzenia ----------
  $('ev-new').addEventListener('click', create);
  $('ev-import').addEventListener('click', () => $('ev-file').click());
  $('ev-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) importFile(f);
  });
  $('ev-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    const row = e.target.closest('.ev-row');
    if (!b || !row) return;
    if (b.dataset.a === 'open') { setOpen(row.dataset.id); render(); window.scrollTo(0, 0); }
    if (b.dataset.a === 'copy') copy(row.dataset.id);
    if (b.dataset.a === 'del') remove(row.dataset.id);
  });
  $('ev-back').addEventListener('click', () => { setOpen(null); render(); });
  $('ev-copy').addEventListener('click', () => copy(openId));
  $('ev-delete').addEventListener('click', () => remove(openId));
  $('ev-name').addEventListener('change', (e) => { const p = prog(); if (p) { p.name = e.target.value.trim() || 'Uroczystość'; A.changed(); } });
  $('ev-date').addEventListener('change', (e) => { const p = prog(); if (p) { p.date = e.target.value; A.changed(); render(); } });
  $('ev-addpart').addEventListener('click', () => {
    const p = prog();
    const name = $('ev-newpart').value.trim();
    if (!p) return;
    if (!name) { $('ev-newpart').focus(); return A.toast('Wpisz nazwę nowej części.'); }
    p.parts.push({ id: uid(), name, items: [] });
    $('ev-newpart').value = '';
    A.changed();
    render();
  });
  $('ev-newpart').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('ev-addpart').click(); });

  $('ev-parts').addEventListener('change', (e) => {
    const p = prog();
    const partEl = e.target.closest('.ev-part');
    if (!p || !partEl) return;
    const pt = p.parts[Number(partEl.dataset.p)];
    if (e.target.classList.contains('ev-pname')) { pt.name = e.target.value.trim() || pt.name; A.changed(); }
    if (e.target.classList.contains('ev-note')) {
      const it = pt.items[Number(e.target.closest('.ev-item').dataset.i)];
      it.note = e.target.value.trim();
      A.changed();
    }
  });
  $('ev-parts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    const partEl = e.target.closest('.ev-part');
    const p = prog();
    if (!b || !partEl || !p) return;
    const pi = Number(partEl.dataset.p);
    const parts = p.parts;
    const itemEl = e.target.closest('.ev-item');
    const ii = itemEl ? Number(itemEl.dataset.i) : -1;
    const items = parts[pi].items;
    const swap = (arr, a, c) => { [arr[a], arr[c]] = [arr[c], arr[a]]; };
    switch (b.dataset.a) {
      case 'add': return openPicker(pi);
      case 'attach': return openPicker(pi, ii);
      case 'order': return A.openOrder(resolve(items[ii]), items[ii].title);
      case 'pup': if (pi > 0) swap(parts, pi, pi - 1); break;
      case 'pdown': if (pi < parts.length - 1) swap(parts, pi, pi + 1); break;
      case 'pdel':
        if (parts[pi].items.length && !confirm(`Usunąć część „${parts[pi].name}” razem z jej pieśniami?`)) return;
        parts.splice(pi, 1);
        break;
      case 'iup': if (ii > 0) swap(items, ii, ii - 1); break;
      case 'idown': if (ii < items.length - 1) swap(items, ii, ii + 1); break;
      case 'idel': items.splice(ii, 1); break;
      default: return;
    }
    A.changed();
    render();
  });

  let qt = null;
  $('sp-q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(renderPicker, 120); });
  $('sp-list').addEventListener('click', (e) => { const b = e.target.closest('.pick-item'); if (b) addFromPicker(b); });
  $('sp-cancel').addEventListener('click', () => $('song-picker').close());

  return { render, forPublish, isPast, fmtDate, tag };
})();
