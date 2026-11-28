// Zgłoszenia od chórzystów: chórzysta wysyła je (bez logowania) do Formularza Google dyrygenta,
// odpowiedzi trafiają do arkusza na Dysku dyrygenta, a tu czytamy ten arkusz jako CSV.
window.Reports = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = window.App;
  const esc = A.esc;
  const REASONS = ['nie te nuty', 'trzeba obrócić', 'nieczytelne', 'brakuje strony', 'złe miejsce w spisie', 'inne'];
  let busy = false;
  let showDone = false;
  let lastFetch = 0;

  const R = () => {
    const d = A.data;
    if (!d.reports || typeof d.reports !== 'object') d.reports = {};
    const r = d.reports;
    r.form = r.form || {};
    r.list = r.list || [];
    r.done = r.done || {};
    return r;
  };

  // ---------- ustawienia ----------
  // link „wstępnie wypełniony”: …/forms/d/e/<ID>/viewform?usp=pp_url&entry.123=x
  function parseForm(link) {
    const m = String(link).match(/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/e\/([\w-]+)\//);
    const e = String(link).match(/[?&](entry\.\d+)=/);
    if (!m || !e) return null;
    return { url: `https://docs.google.com/forms/d/e/${m[1]}/formResponse`, entry: e[1] };
  }
  const parseSheet = (link) => {
    const m = String(link).match(/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)/) || String(link).match(/^([\w-]{25,})$/);
    return m ? m[1] : null;
  };
  // co trafia do katalogu chórzystów
  function target() {
    const f = R().form;
    return f.url && f.entry ? { url: f.url, entry: f.entry } : null;
  }

  async function saveSettings() {
    const r = R();
    const fl = $('rep-form').value.trim();
    const sl = $('rep-sheet').value.trim();
    const form = fl ? parseForm(fl) : null;
    const sheet = sl ? parseSheet(sl) : null;
    if (fl && !form) return A.toast('To nie wygląda na link do wstępnie wypełnionego formularza (powinien zawierać „/forms/d/e/…” i „entry.…”).', true);
    if (sl && !sheet) return A.toast('To nie wygląda na link do Arkusza Google (powinien zawierać „/spreadsheets/d/…”).', true);
    const changedTarget = JSON.stringify(target()) !== JSON.stringify(form);
    r.form = { ...(form || {}), sheetId: sheet || null, formLink: fl, sheetLink: sl };
    A.changed();
    render();
    if (!changedTarget) return A.toast('Zapisano.');
    try {
      const ok = window.Publish && (await Publish.saveCatalog());
      A.toast(ok ? (form ? 'Zapisano. Chórzyści mogą już zgłaszać problemy (po odświeżeniu aplikacji).' : 'Zapisano. Zgłaszanie jest wyłączone.')
        : 'Zapisano. Chórzyści zobaczą przycisk „Zgłoś problem” po najbliższej publikacji list.');
    } catch (e) {
      A.handleError(e);
    }
  }

  // zgłoszenie testowe – sprawdza, czy formularz przyjmuje odpowiedzi
  async function sendTest() {
    const t = target();
    if (!t) return A.toast('Najpierw wklej link do formularza i zapisz.', true);
    try {
      await send(t, { v: 1, test: true, at: new Date().toISOString(), title: 'Zgłoszenie testowe', reasons: ['inne'], note: 'Test z aplikacji dyrygenta', name: 'Dyrygent' });
      A.toast('Wysłano zgłoszenie testowe. Za chwilę kliknij „↻ Sprawdź zgłoszenia”.');
    } catch (e) {
      A.toast('Nie udało się wysłać: ' + e.message, true);
    }
  }

  // wysyłka do Formularza Google (bez logowania; odpowiedź jest „nieprzezroczysta”, więc sprawdzamy tylko błąd sieci)
  async function send(t, payload) {
    const body = new URLSearchParams({ [t.entry]: JSON.stringify(payload) });
    await fetch(t.url, { method: 'POST', mode: 'no-cors', body });
  }

  // ---------- pobieranie ----------
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function fetchReports(quiet) {
    const r = R();
    if (!r.form.sheetId) { if (!quiet) A.toast('Wklej link do arkusza z odpowiedziami (ustawienia poniżej).', true); return; }
    if (busy) return;
    if (!(await A.ensureConnected())) return;
    busy = true;
    render();
    try {
      const rows = parseCsv(await Drive.exportCsv(r.form.sheetId));
      const list = [];
      rows.slice(1).forEach((cells, n) => {
        for (const c of cells.slice(1)) {
          let p = null;
          try { p = JSON.parse(c); } catch (e) { /* nie nasze pole */ }
          if (p && typeof p === 'object' && p.v) { list.push({ ...p, key: `${n}:${p.at || cells[0]}`, stamp: cells[0] }); break; }
        }
      });
      r.list = list;
      r.fetchedAt = new Date().toISOString();
      lastFetch = Date.now();
      A.changed();
      if (!quiet) A.toast(`Zgłoszenia: ${openCount()} do przejrzenia.`);
    } catch (e) {
      if (!quiet || e instanceof Drive.AuthError) A.handleError(e);
    } finally {
      busy = false;
      render();
    }
  }
  // przy wejściu w zakładkę – nie częściej niż co 2 minuty
  function autoFetch() {
    render();
    if (R().form.sheetId && window.Drive && Drive.isConnected() && Date.now() - lastFetch > 120000) fetchReports(true);
  }

  // ---------- grupowanie ----------
  // kopia u chórzystów → oryginał na Dysku
  function origMap() {
    const out = {};
    const copies = (A.data.publish && A.data.publish.copies) || {};
    for (const [orig, c] of Object.entries(copies)) if (c && c.id) out[c.id] = orig;
    return out;
  }
  function sourceOf(p) {
    if (p.test) return { text: 'zgłoszenie testowe' };
    if (p.kind === 'p') {
      const pr = (A.data.programs || []).find((x) => x.id === p.book);
      return { text: `uroczystość „${pr ? pr.name : p.bookName || '?'}”${p.part ? ', ' + p.part : ''}`, prog: !!pr };
    }
    if (p.kind === 'c') return { text: 'katalog nut' };
    if (p.book === 'others') return { text: '„Pozostałe nuty”' };
    const b = A.data.songbooks.find((x) => x.id === p.book);
    let i = p.i;
    if (b && (!b.items[i] || b.items[i].title !== p.title)) i = b.items.findIndex((it) => it.title === p.title);
    return { text: `śpiewnik „${b ? b.name : p.bookName || '?'}”${p.no ? ' nr ' + p.no : ''}`, book: b && i >= 0 ? b.id : null, i };
  }
  function groups() {
    const r = R();
    const om = origMap();
    const g = {};
    for (const p of r.list) {
      const done = !!r.done[p.key];
      if (done && !showDone) continue;
      const files = (p.files || []).map((c) => om[c] || null);
      const known = files.filter(Boolean);
      const k = known.length ? 'f:' + [...new Set(known)].sort().join('|') : 't:' + (p.title || '?');
      const x = g[k] = g[k] || { k, title: p.title, files: [...new Set(known)], lost: files.length - known.length, items: [], last: '' };
      x.items.push({ ...p, done, src: sourceOf(p) });
      if ((p.at || '') > x.last) x.last = p.at || '';
    }
    return Object.values(g).sort((a, b) => b.last.localeCompare(a.last));
  }
  const openCount = () => { const r = R(); return r.list.filter((p) => !r.done[p.key]).length; };

  // ---------- wyświetlanie ----------
  function fileChip(id, i, all) {
    const n = A.data.nodes[id];
    if (!n) return '<span class="chip gone">plik zniknął z Dysku</span>';
    const m = A.data.meta[id];
    return `<span class="rep-file"><a class="chip" href="${Preview.driveUrl(id)}" target="_blank" rel="noopener" ${Preview.attrs(Array.isArray(all) ? all : [id], Array.isArray(all) ? i : 0)} title="${esc(Catalog.pathOf(A.data.nodes, id))} · kliknij: podgląd nut">
      <span class="badge ${n.kind}">${n.kind === 'pdf' ? 'PDF' : 'IMG'}</span><span class="chip-name">${esc((m && m.title) || n.name)}</span>${m && m.rot ? `<span class="rot-tag">obrócony o ${m.rot}°</span>` : ''}</a>
      <button class="act" data-r="edit" data-id="${esc(id)}" title="Edytuj: nazwa, obrót, „to nie nuty”, „nieistotne”" aria-label="Edytuj plik">✎</button></span>`;
  }
  const when = (iso) => (iso ? new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

  function render() {
    const r = R();
    const n = openCount();
    const badge = $('rep-badge');
    if (badge) { badge.hidden = !n; badge.textContent = n; }
    if (!$('rep-card')) return;
    if (document.activeElement !== $('rep-form')) $('rep-form').value = r.form.formLink || '';
    if (document.activeElement !== $('rep-sheet')) $('rep-sheet').value = r.form.sheetLink || '';
    const ready = !!(target() && r.form.sheetId);
    $('rep-setup').open = !ready && !$('rep-setup').dataset.touched ? true : $('rep-setup').open;
    $('rep-state').innerHTML = ready ? '<span class="ok-text">✓ zgłaszanie włączone</span>' : '<span class="warn-text">nie skonfigurowane – instrukcja poniżej</span>';
    $('rep-fetch').disabled = busy || !r.form.sheetId;
    $('rep-fetch').textContent = busy ? 'Sprawdzanie…' : '↻ Sprawdź zgłoszenia';
    $('rep-test').disabled = !target();
    $('rep-showdone').checked = showDone;
    const gs = r.form.sheetId ? groups() : [];
    $('rep-info').textContent = r.fetchedAt ? `Sprawdzono: ${new Date(r.fetchedAt).toLocaleString('pl-PL')} · do przejrzenia: ${n}` : '';
    $('rep-list').innerHTML = !r.form.sheetId ? ''
      : gs.length ? gs.map((g) => {
        const reasons = {};
        g.items.forEach((p) => (p.reasons || []).forEach((x) => { reasons[x] = (reasons[x] || 0) + 1; }));
        const allDone = g.items.every((p) => p.done);
        const src = g.items.find((p) => p.src.book) || g.items[0];
        return `<div class="rep${allDone ? ' done' : ''}" data-k="${esc(g.k)}">
          <div class="rep-head"><b>${esc(g.title || 'Bez tytułu')}</b>
            ${Object.entries(reasons).map(([x, c]) => `<span class="rep-reason">${esc(x)}${c > 1 ? ` ×${c}` : ''}</span>`).join('')}
            ${g.items.length > 1 ? `<span class="muted small">${g.items.length} zgłoszenia</span>` : ''}</div>
          <ul class="rep-items">${g.items.map((p) => `<li>${p.done ? '✓ ' : ''}<span class="muted small">${esc(when(p.at))} · ${esc(p.name || 'anonimowo')} · ${esc(p.src.text)}${p.page && p.files && p.files.length > 1 ? ` · strona ${p.page}` : ''}</span>
            ${p.note ? `<span class="rep-note">„${esc(p.note)}”</span>` : ''}</li>`).join('')}</ul>
          <div class="rep-files">${g.files.map(fileChip).join('')}${g.lost ? `<span class="muted small">${g.files.length ? 'część plików' : 'pliki'} już zmienione od zgłoszenia</span>` : ''}</div>
          <div class="rep-acts">
            ${src.src.book ? `<button class="btn small" data-r="show" data-book="${esc(src.src.book)}" data-i="${src.src.i}">Pokaż w spisie (zmień nuty)</button>` : ''}
            ${g.items.some((p) => p.src.prog) ? '<button class="btn small" data-r="prog">Otwórz uroczystości</button>' : ''}
            ${allDone ? '<button class="btn small" data-r="undo">↺ Przywróć</button>' : '<button class="btn small primary" data-r="done">✓ Załatwione</button>'}
          </div></div>`;
      }).join('')
      : `<p class="muted">${r.fetchedAt ? (showDone ? 'Brak zgłoszeń.' : 'Brak nowych zgłoszeń. 🎉') : 'Kliknij „↻ Sprawdź zgłoszenia”.'}</p>`;
  }

  // ---------- zdarzenia ----------
  if ($('rep-card')) {
    $('rep-save').addEventListener('click', saveSettings);
    $('rep-test').addEventListener('click', sendTest);
    $('rep-fetch').addEventListener('click', () => fetchReports(false));
    $('rep-setup').addEventListener('toggle', (e) => { e.target.dataset.touched = '1'; });
    $('rep-showdone').addEventListener('change', (e) => { showDone = e.target.checked; render(); });
    $('rep-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      const el = b.closest('.rep');
      if (b.dataset.r === 'edit') return A.openEdit(b.dataset.id);
      if (b.dataset.r === 'show') {
        A.showTab('songs');
        if (!Songs.reveal(b.dataset.book, Number(b.dataset.i))) A.toast('Nie znalazłem tej pozycji w spisie.', true);
        return;
      }
      if (b.dataset.r === 'prog') return A.showTab('events');
      const g = groups().find((x) => x.k === el.dataset.k);
      if (!g) return;
      const r = R();
      if (b.dataset.r === 'done') g.items.forEach((p) => { r.done[p.key] = new Date().toISOString(); });
      if (b.dataset.r === 'undo') g.items.forEach((p) => { delete r.done[p.key]; });
      A.changed();
      render();
    });
  }

  return { render, autoFetch, target, send, REASONS };
})();
