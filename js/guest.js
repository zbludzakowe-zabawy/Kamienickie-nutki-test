// Tryb chórzysty: bez logowania, PIN → start (Śpiewniki / Uroczystości / Katalog nut) → lista pieśni → nuty na cały ekran.
window.Guest = (() => {
  'use strict';
  const cfg = window.KN_CONFIG;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const K = { mode: 'kn-mode', id: 'kn-guest-id', pin: 'kn-guest-pin', env: 'kn-guest-env', only: 'kn-guest-only', name: 'kn-guest-name' };
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* trudno */ } };

  let catalog = null;
  let catalogId = null;
  let pinMsg = '';
  let onlyWithNotes = get(K.only) === '1';
  let query = '';

  // tryb wybiera js/mode.js (zanim strona się narysuje)
  const mode = document.documentElement.dataset.mode;
  catalogId = get(K.id) || cfg.publicCatalogId || null;

  function enter(id) {
    if (id) put(K.id, id);
    put(K.mode, 'guest');
    location.hash = '#/';
    location.reload();
  }
  function leave() {
    put(K.mode, 'admin');
    history.replaceState(null, '', location.pathname);
    location.reload();
  }

  // ---------- dane ----------
  async function load() {
    const view = $('g-view');
    if (!catalogId) {
      view.innerHTML = `<section class="card g-card"><h2>Śpiewniki chóru</h2>
        <p>Otwórz link do śpiewników, który dostałeś od dyrygenta. Wystarczy go raz stuknąć – aplikacja zapamięta śpiewniki.</p></section>`;
      return;
    }
    view.innerHTML = '<p class="muted g-loading">Wczytywanie śpiewników…</p>';
    let env = null;
    try {
      const text = await Drive.publicText(catalogId);
      env = JSON.parse(text);
      put(K.env, JSON.stringify({ id: catalogId, env }));
    } catch (e) {
      try {
        const c = JSON.parse(get(K.env) || 'null');
        if (c && c.id === catalogId) env = c.env;
      } catch (e2) { /* brak */ }
      if (!env) {
        view.innerHTML = `<section class="card g-card"><h2>Nie udało się wczytać śpiewników</h2><p>${esc(navigator.onLine ? e.message : 'Brak internetu. Połącz się i spróbuj ponownie.')}</p>
          <button class="btn primary" id="g-retry">Spróbuj ponownie</button></section>`;
        $('g-retry').onclick = load;
        return;
      }
    }
    window.__knEnv = env;
    const pin = get(K.pin);
    if (pin) {
      catalog = await KnCrypto.decrypt(env, pin);
      if (catalog) return route();
      pinMsg = 'PIN się zmienił – wpisz nowy PIN od dyrygenta.';
      put(K.pin, null);
    }
    showPin();
  }

  function showPin() {
    $('g-view').innerHTML = `<section class="card g-card g-pin">
      <img src="icons/icon-192.png?v=2" alt="" width="72" height="72">
      <h2>Śpiewniki chóru</h2>
      <p class="muted">Wpisz PIN, który podał dyrygent.</p>
      <form id="g-pin-form" autocomplete="off">
        <input id="g-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" aria-label="PIN" placeholder="PIN" autofocus>
        <button class="btn primary" type="submit">Wejdź</button>
      </form>
      <p class="g-err" id="g-pin-err">${esc(pinMsg)}</p></section>`;
    $('g-pin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = $('g-pin').value.trim();
      if (!v) return;
      $('g-pin-err').textContent = 'Sprawdzanie…';
      const c = await KnCrypto.decrypt(window.__knEnv, v);
      if (!c) {
        $('g-pin-err').textContent = 'Zły PIN. Spróbuj jeszcze raz.';
        $('g-pin').select();
        return;
      }
      catalog = c;
      put(K.pin, v);
      pinMsg = '';
      route();
    });
    setTimeout(() => { const i = $('g-pin'); if (i) i.focus(); }, 50);
  }

  // ---------- widoki ----------
  const hasNotes = (it) => it.files && it.files.length > 0;
  const book = (id) => catalog && catalog.songbooks.find((b) => b.id === id);
  const programs = () => (catalog && catalog.programs) || [];
  const program = (id) => programs().find((p) => p.id === id);
  // program jako płaska lista pieśni (do przechodzenia ⏮ ⏭ w kolejności uroczystości)
  const flat = (pr) => ({
    id: pr.id,
    name: pr.name,
    kind: 'p',
    base: `#/p/${encodeURIComponent(pr.id)}`,
    items: pr.parts.flatMap((pt) => pt.items.map((it) => ({ ...it, part: pt.name }))),
  });
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const isPast = (pr) => !!pr.date && pr.date < today();
  const staleNote = (x) => (x.pdf && x.stale
    ? `<p class="small g-stale">⚠ PDF może być nieaktualny${x.pdfAt ? ` (stan na ${new Date(x.pdfAt).toLocaleDateString('pl-PL')})` : ''} – dyrygent wprowadza zmiany. Lista poniżej jest aktualna.</p>` : '');
  const fmtDate = (s) => {
    if (!s) return '';
    const [y, mo, d] = s.split('-').map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  // katalog nut (utwory) jako pseudo-śpiewnik do podglądu nut
  const works = () => (catalog && catalog.works && catalog.works.items) || [];
  const worksTags = () => (catalog && catalog.works && catalog.works.tags) || [];
  const worksBook = () => ({
    id: 'katalog', name: 'Katalog nut', kind: 'c', base: '#/katalog',
    items: works().map((w) => ({ no: '', title: w.title, files: w.files })),
  });
  const upcoming = () => programs().filter((p) => !isPast(p)).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const archived = () => programs().filter(isPast).sort((a, b) => b.date.localeCompare(a.date));

  function route() {
    if (!catalog) return;
    const h = location.hash;
    const mp = h.match(/^#\/p\/([^/]+)(?:\/(\d+))?/);
    const pr = mp && program(decodeURIComponent(mp[1]));
    if (pr) {
      const fb = flat(pr);
      renderProgram(pr, fb);
      if (mp[2] != null && fb.items[Number(mp[2])]) openViewer(fb, Number(mp[2]));
      else closeViewer();
      return;
    }
    const mk = h.match(/^#\/katalog(?:\/(\d+))?/);
    if (mk && catalog.works) {
      const wb = worksBook();
      renderWorks();
      if (mk[1] != null && wb.items[Number(mk[1])]) { wb.order = workRows().map((x) => x.i); openViewer(wb, Number(mk[1])); }
      else closeViewer();
      return;
    }
    const m = h.match(/^#\/s\/([^/]+)(?:\/(\d+))?/);
    const b = m && book(decodeURIComponent(m[1]));
    if (b) {
      renderBook(b);
      if (m[2] != null && b.items[Number(m[2])]) openViewer(b, Number(m[2]));
      else closeViewer();
      return;
    }
    closeViewer();
    if (/^#\/spiewniki/.test(h)) return renderBooks();
    if (/^#\/uroczystosci/.test(h)) return renderPrograms();
    return renderHome();
  }

  const backBar = (href, label) => `<div class="g-bar"><a class="btn small" href="${href}">‹ ${label}</a></div>`;
  const setView = (key, html) => {
    const v = $('g-view');
    v.dataset.book = key;
    v.innerHTML = html;
    window.scrollTo(0, 0);
  };

  // ikonka uroczystości: sztandar i świece (wybór użytkownika 2026-11-22)
  const PROG_ICO = `<span class="g-prog-ico g-cat-ico" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 6v36"/>
    <path class="c" d="M17 9h14v16l-7 4-7-4z"/><path d="M24 13v9M20.5 16.5h7" stroke-width="2"/>
    <rect class="c" x="5" y="24" width="6" height="18" rx="1"/><rect class="c" x="37" y="24" width="6" height="18" rx="1"/>
    <path class="f" d="M8 14c2 3 2.5 5.5 0 8-2.5-2.5-2-5 0-8zM40 14c2 3 2.5 5.5 0 8-2.5-2.5-2-5 0-8z"/><path d="M3 42h42"/></svg></span>`;
  // ikonka katalogu: lupa i nuta (wybór użytkownika 2026-11-22)
  const CAT_ICO = `<span class="g-prog-ico g-cat-ico" aria-hidden="true"><svg viewBox="0 0 48 48"><circle class="c" cx="20" cy="20" r="13"/>
    <path d="M29.5 29.5 42 42" stroke-width="4"/><ellipse class="f" cx="17" cy="25" rx="3.6" ry="2.8" transform="rotate(-20 17 25)"/>
    <path d="M20.3 24V12.5l5 2.5" stroke-width="2.2"/></svg></span>`;

  // ekran startowy: wybór Śpiewniki / Uroczystości / Katalog
  function renderHome() {
    document.title = 'Kamienickie Nutki';
    const list = catalog.songbooks;
    const next = upcoming();
    const past = archived();
    const tile = (href, ico, title, sub, extra = '') => `<a class="g-book g-home${extra}" href="${href}">${ico}
      <span class="g-book-text"><strong>${title}</strong><span class="muted">${sub}</span></span><span class="chev">›</span></a>`;
    const pl = (n, a, b, c) => (n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
    const progSub = next.length
      ? `Najbliższa: ${esc(next[0].name)}${next[0].date ? ' · ' + esc(fmtDate(next[0].date)) : ''}`
      : past.length ? `Archiwum: ${past.length}` : 'Brak uroczystości';
    setView('', `<h2 class="g-h">Co chcesz otworzyć?</h2>
      <div class="g-books g-homes">
        ${tile('#/spiewniki', '<span class="g-book-ico" aria-hidden="true"></span>', 'Śpiewniki', `${list.length} ${pl(list.length, 'śpiewnik', 'śpiewniki', 'śpiewników')}`)}
        ${tile('#/uroczystosci', PROG_ICO, 'Uroczystości', progSub + (next.length > 1 ? ` · nadchodzące: ${next.length}` : ''))}
        ${catalog.works ? tile('#/katalog', CAT_ICO, 'Katalog nut',
          `${works().length} ${pl(works().length, 'utwór', 'utwory', 'utworów')} · wyszukiwanie i cechy`) : ''}
      </div>
      <p class="muted small g-updated">Aktualizacja: ${new Date(catalog.at).toLocaleDateString('pl-PL')}</p>`);
  }

  function renderBooks() {
    document.title = 'Śpiewniki – Kamienickie Nutki';
    const list = catalog.songbooks;
    setView('', `${backBar('#/', 'Start')}<h2 class="g-h">Śpiewniki</h2>
      ${list.length ? `<div class="g-books">${list.map((b) => {
        const have = b.items.filter(hasNotes).length;
        return `<a class="g-book" href="#/s/${encodeURIComponent(b.id)}"><span class="g-book-ico" aria-hidden="true"></span>
          <span class="g-book-text"><strong>${esc(b.name)}${b.code ? ` <span class="muted">[${esc(b.code)}]</span>` : ''}</strong><span class="muted">${b.items.length} pieśni · nuty: ${have}${b.stale ? ' · PDF może być nieaktualny' : ''}</span></span><span class="chev">›</span></a>`;
      }).join('')}</div>` : '<p class="muted">Dyrygent nie udostępnił jeszcze żadnego śpiewnika.</p>'}`);
  }

  let archOpen = false;
  function renderPrograms() {
    document.title = 'Uroczystości – Kamienickie Nutki';
    const next = upcoming();
    const past = archived();
    const progCard = (p, first) => {
      const songs = p.parts.flatMap((pt) => pt.items);
      return `<a class="g-book g-prog${first ? ' next' : ''}" href="#/p/${encodeURIComponent(p.id)}">${PROG_ICO}
        <span class="g-book-text">${first ? '<span class="g-next">Najbliższa uroczystość</span>' : ''}<strong>${esc(p.name)}</strong>
        <span class="muted">${p.date ? esc(fmtDate(p.date)) + ' · ' : ''}${songs.length} pieśni</span></span><span class="chev">›</span></a>`;
    };
    setView('', `${backBar('#/', 'Start')}<h2 class="g-h">Uroczystości</h2>
      ${next.length ? `<div class="g-books">${next.map((p, i) => progCard(p, i === 0)).join('')}</div>` : '<p class="muted">Nie ma zaplanowanych uroczystości.</p>'}
      ${past.length ? `<details class="g-arch" id="g-arch"${archOpen ? ' open' : ''}><summary><h2 class="g-h g-h2">Archiwum <span class="muted">(${past.length})</span></h2></summary>
        <div class="g-books">${past.map((p) => progCard(p, false)).join('')}</div></details>` : ''}`);
    // Archiwum zwinięte na start (decyzja użytkownika 2026-11-28: chórzysta widzi najpierw tylko przyszłe uroczystości);
    // rozwinięcie pamiętane do zamknięcia aplikacji – po powrocie z programu z archiwum lista zostaje otwarta
    const d = $('g-arch');
    if (d) d.addEventListener('toggle', () => { archOpen = d.open; });
  }

  // ---------- katalog nut: wyszukiwanie i filtr cech ----------
  const W_PAGE = 200;
  const wui = { q: '', tags: new Set(), limit: W_PAGE };
  const nrm = (s) => (window.Catalog ? Catalog.norm(s) : String(s).toLowerCase());
  let hayCache = null;
  function workRows() {
    const ws = works();
    if (!hayCache || hayCache.src !== ws) {
      const tn = {};
      worksTags().forEach((t) => { tn[t.id] = t.name; });
      hayCache = { src: ws, h: ws.map((w) => nrm([w.title, ...(w.alt || []), w.lyrics, w.music, ...w.tags.map((t) => tn[t] || ''), ...(w.refs || [])].join(' '))) };
    }
    const words = nrm(wui.q).split(' ').filter(Boolean);
    return ws.map((w, i) => ({ w, i })).filter(({ w, i }) => [...wui.tags].every((t) => w.tags.includes(t))
      && words.every((x) => hayCache.h[i].includes(x)));
  }
  function renderWorks() {
    document.title = 'Katalog nut – Kamienickie Nutki';
    const keep = $('g-wlist') && $('g-view').dataset.book === 'katalog';
    const y = window.scrollY;
    if (!keep) {
      $('g-view').dataset.book = 'katalog';
      $('g-view').innerHTML = `${backBar('#/', 'Start')}<h2 class="g-h">Katalog nut</h2>
        <p class="muted small">${works().length} utworów · szukaj po tytule, autorze, cesze albo numerze ze śpiewnika (np. „Z 12”)</p>
        <div class="g-tools"><input type="search" id="g-wq" placeholder="Szukaj w katalogu…" value="${esc(wui.q)}" autocomplete="off" aria-label="Szukaj w katalogu"></div>
        <div class="g-tags" id="g-wtags"></div>
        <p class="muted small g-wsum" id="g-wsum"></p>
        <div class="g-list" id="g-wlist"></div>
        <p class="g-more" id="g-wmore"></p>`;
      let t = null;
      $('g-wq').addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(() => { wui.q = e.target.value; wui.limit = W_PAGE; paintWorks(); }, 150);
      });
      $('g-wtags').addEventListener('click', (e) => {
        const b = e.target.closest('[data-t]');
        if (!b) return;
        const id = b.dataset.t;
        if (!id) wui.tags.clear();
        else if (wui.tags.has(id)) wui.tags.delete(id);
        else wui.tags.add(id);
        wui.limit = W_PAGE;
        paintWorks();
      });
      $('g-wmore').addEventListener('click', (e) => {
        if (!e.target.closest('button')) return;
        wui.limit += W_PAGE;
        paintWorks();
      });
    }
    paintWorks();
    window.scrollTo(0, keep ? y : 0);
  }
  function paintWorks() {
    const rows = workRows();
    const tn = {};
    worksTags().forEach((t) => { tn[t.id] = t.name; });
    // liczniki cech w wynikach wyszukiwania tekstowego (przed filtrem cech nie ma sensu – pokazujemy, ile zostanie po dodaniu cechy)
    const cnt = {};
    rows.forEach(({ w }) => w.tags.forEach((t) => { cnt[t] = (cnt[t] || 0) + 1; }));
    $('g-wtags').innerHTML = worksTags().map((t) => `<button type="button" class="fchip${wui.tags.has(t.id) ? ' active' : ''}" data-t="${esc(t.id)}" aria-pressed="${wui.tags.has(t.id)}">${esc(t.name)} <b>${cnt[t.id] || 0}</b></button>`).join('')
      + (wui.tags.size ? '<button type="button" class="fchip" data-t="">✕ wyczyść</button>' : '');
    $('g-wsum').textContent = rows.length === works().length ? '' : `Znaleziono: ${rows.length}`;
    $('g-wlist').innerHTML = rows.slice(0, wui.limit).map(({ w, i }) => {
      const people = [w.lyrics && `sł. ${esc(w.lyrics)}`, w.music && `muz. ${esc(w.music)}`].filter(Boolean).join(' · ');
      const meta = w.tags.map((t) => `<span class="wtag">${esc(tn[t] || '')}</span>`).join('') + (w.refs || []).map((r) => `<span class="wref">${esc(r)}</span>`).join('');
      return `<a class="g-song" href="#/katalog/${i}"><span class="g-title">${esc(w.title)}${altOf(w)}
        ${people ? `<span class="g-alt">${people}</span>` : ''}${meta ? `<span class="g-wmeta">${meta}</span>` : ''}</span><span class="g-note" aria-label="nuty">♪</span></a>`;
    }).join('') || '<p class="muted empty">Nic nie pasuje.</p>';
    $('g-wmore').innerHTML = rows.length > wui.limit ? `Pokazano ${wui.limit} z ${rows.length}. <button type="button" class="linklike">Pokaż więcej</button>` : '';
  }

  function renderProgram(pr, fb) {
    document.title = pr.name + ' – Kamienickie Nutki';
    const mb = pr.pdfSize ? ` (${(pr.pdfSize / 1048576).toFixed(1)} MB)` : '';
    let k = 0;
    const keep = $('g-view').dataset.book === pr.id;
    const y = window.scrollY;
    $('g-view').dataset.book = pr.id;
    $('g-view').innerHTML = `${backBar('#/uroczystosci', 'Uroczystości')}
      <h2 class="g-h">${esc(pr.name)}</h2>
      <p class="muted small">${pr.date ? esc(fmtDate(pr.date)) : 'Program uroczystości'}${isPast(pr) ? ' · archiwum' : ''}</p>
      ${pr.pdf ? `<a class="btn primary g-pdf" href="https://drive.google.com/uc?export=download&id=${encodeURIComponent(pr.pdf)}" target="_blank" rel="noopener">⬇ Pobierz PDF z programem${mb}</a>${staleNote(pr)}` : ''}
      <div class="g-list g-program">${pr.parts.filter((pt) => pt.items.length).map((pt) => `<div class="g-part">${esc(pt.name)}</div>${pt.items.map((it) => {
        const i = k++;
        const note = it.note ? `<span class="g-pnote">${esc(it.note)}</span>` : '';
        return hasNotes(it)
          ? `<a class="g-song" href="${fb.base}/${i}"><span class="g-title">${esc(it.title)}${note}</span><span class="g-note" aria-label="nuty">♪</span></a>`
          : `<div class="g-song off"><span class="g-title">${esc(it.title)}${note}</span><span class="g-none">bez nut</span></div>`;
      }).join('')}`).join('') || '<p class="muted empty">Program jest jeszcze pusty.</p>'}</div>`;
    if (keep) window.scrollTo(0, y);
    else window.scrollTo(0, 0);
  }

  const altOf = (it) => (it.alt && it.alt.length ? `<span class="g-alt">też: ${esc(it.alt.join('; '))}</span>` : '');

  function renderBook(b) {
    document.title = b.name + ' – Kamienickie Nutki';
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const norm = (s) => (window.Catalog ? Catalog.norm(s) : String(s).toLowerCase());
    const nwords = words.map(norm);
    const rows = b.items.map((it, i) => ({ it, i })).filter(({ it }) => {
      if (onlyWithNotes && !hasNotes(it)) return false;
      if (!nwords.length) return true;
      const hay = norm(it.no + ' ' + it.title + ' ' + (it.alt || []).join(' '));
      return nwords.every((w) => hay.includes(w));
    });
    const have = b.items.filter(hasNotes).length;
    const mb = b.pdfSize ? ` (${(b.pdfSize / 1048576).toFixed(1)} MB)` : '';
    const keepScroll = $('g-list') && $('g-view').dataset.book === b.id;
    const y = window.scrollY;
    $('g-view').dataset.book = b.id;
    $('g-view').innerHTML = `${backBar('#/spiewniki', 'Śpiewniki')}
      <h2 class="g-h">${esc(b.name)}</h2>
      <p class="muted small">${b.items.length} pieśni · z nutami: ${have}${b.auto && b.at ? ` · lista z dnia ${new Date(b.at).toLocaleDateString('pl-PL')}` : ''}</p>
      ${b.auto ? '<p class="muted small">Nuty, których nie ma w pozostałych śpiewnikach, ułożone alfabetycznie.</p>' : ''}
      ${b.pdf ? `<a class="btn primary g-pdf" href="https://drive.google.com/uc?export=download&id=${encodeURIComponent(b.pdf)}" target="_blank" rel="noopener">⬇ Pobierz PDF ze śpiewnikiem${mb}${b.auto && b.pdfAt ? ` – stan na ${new Date(b.pdfAt).toLocaleDateString('pl-PL')}` : ''}</a>${staleNote(b)}` : ''}
      <div class="g-tools">
        <input type="search" id="g-q" placeholder="Szukaj (tytuł lub numer)…" value="${esc(query)}" autocomplete="off" aria-label="Szukaj pieśni">
        <label class="g-only"><input type="checkbox" id="g-only"${onlyWithNotes ? ' checked' : ''}> tylko z nutami</label>
      </div>
      <div class="g-list" id="g-list">${rows.map(({ it, i }) => (hasNotes(it)
        ? `<a class="g-song" href="#/s/${encodeURIComponent(b.id)}/${i}"><span class="g-no">${esc(it.no)}</span><span class="g-title">${esc(it.title)}${altOf(it)}</span><span class="g-note" aria-label="nuty">♪</span></a>`
        : `<div class="g-song off"><span class="g-no">${esc(it.no)}</span><span class="g-title">${esc(it.title)}${altOf(it)}</span><span class="g-none">brak nut</span></div>`)).join('')
        || '<p class="muted empty">Nic nie pasuje.</p>'}</div>`;
    let t = null;
    $('g-q').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        query = e.target.value;
        renderBook(b);
        const q = $('g-q');
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      }, 150);
    });
    $('g-only').addEventListener('change', (e) => { onlyWithNotes = e.target.checked; put(K.only, onlyWithNotes ? '1' : '0'); renderBook(b); });
    if (keepScroll) window.scrollTo(0, y);
  }

  // ---------- nuty na cały ekran ----------
  let viewer = null; // { b, i, f }
  function openViewer(b, i) {
    const it = b.items[i];
    if (!hasNotes(it)) return;
    const key = `${b.id}:${i}`;
    const same = viewer && viewer.key === key;
    viewer = { b, i, key, f: same ? viewer.f : 0, shown: same ? viewer.shown : null, failed: same && viewer.failed };
    $('g-viewer').hidden = false;
    document.body.classList.add('g-viewing');
    $('g-vno').textContent = it.part ? it.part + ' ·' : it.no ? it.no + '.' : '';
    $('g-vname').textContent = it.note ? `${it.title} – ${it.note}` : it.title;
    const base = b.base || `#/s/${encodeURIComponent(b.id)}`;
    showFile();
    $('g-report').hidden = !(catalog && catalog.report);
    // poprzednia/następna pieśń z nutami
    const prev = findSong(b, i, -1);
    const next = findSong(b, i, 1);
    $('g-sprev').hidden = prev < 0;
    $('g-snext').hidden = next < 0;
    $('g-sprev').onclick = () => { location.replace(`${base}/${prev}`); };
    $('g-snext').onclick = () => { location.replace(`${base}/${next}`); };
  }
  function findSong(b, i, dir) {
    if (b.order) { // katalog: kolejność jak na liście po wyszukiwaniu/filtrze
      const k = b.order.indexOf(i);
      if (k < 0) return -1;
      const j = b.order[k + dir];
      return j == null ? -1 : j;
    }
    for (let k = i + dir; k >= 0 && k < b.items.length; k += dir) if (hasNotes(b.items[k])) return k;
    return -1;
  }
  // Nuty pokazuje własny podgląd (js/noteview.js), nie ramka Dysku Google – otwarcie nie trafia do „Ostatnich”
  // na Dysku osoby zalogowanej w przeglądarce. Znaczek Dysku w pasku (#g-open) jest na razie ukryty (decyzja użytkownika 2026-11-27 – może wrócimy).
  function showFile() {
    const it = viewer.b.items[viewer.i];
    const id = it.files[viewer.f];
    const multi = it.files.length > 1;
    $('g-vnav').hidden = !multi;
    $('g-vpos').textContent = `${viewer.f + 1} / ${it.files.length}`;
    $('g-prev').disabled = viewer.f === 0;
    $('g-next').disabled = viewer.f === it.files.length - 1;
    const openUrl = `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
    $('g-open').href = openUrl;
    if (viewer.shown === id && !viewer.failed) return;
    viewer.shown = id;
    viewer.failed = false;
    const v = viewer;
    NoteView.show(id).then((ok) => {
      if (viewer !== v) return;
      viewer.failed = !ok;
      // w tle: pozostałe strony tej pieśni i pierwsza strona następnej
      const next = findSong(v.b, v.i, 1);
      NoteView.prefetch([...it.files.filter((f) => f !== id), next >= 0 ? v.b.items[next].files[0] : null]);
    });
    NoteView.focus();
  }
  // strzałki / przesunięcie palcem: najpierw strony tej pieśni, potem następna / poprzednia pieśń
  function step(dir) {
    if (!viewer) return;
    const n = viewer.b.items[viewer.i].files.length;
    if (viewer.f + dir >= 0 && viewer.f + dir < n) { viewer.f += dir; showFile(); return; }
    const btn = $(dir > 0 ? 'g-snext' : 'g-sprev');
    if (!btn.hidden) btn.click();
  }
  function closeViewer() {
    if ($('g-viewer').hidden) return;
    $('g-viewer').hidden = true;
    document.body.classList.remove('g-viewing');
    NoteView.reset();
    viewer = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }

  // ---------- zgłoszenie problemu (Formularz Google dyrygenta, bez logowania) ----------
  const REASONS = ['nie te nuty', 'trzeba obrócić', 'nieczytelne', 'brakuje strony', 'złe miejsce w spisie', 'inne'];
  let reportFor = null;
  function openReport() {
    if (!viewer || !catalog || !catalog.report) return;
    const b = viewer.b;
    const it = b.items[viewer.i];
    reportFor = { b, i: viewer.i, it, page: viewer.f + 1 };
    $('gr-song').textContent = (it.no ? it.no + '. ' : '') + it.title;
    $('gr-src').textContent = b.kind === 'p' ? `Uroczystość „${b.name}”${it.part ? ' · ' + it.part : ''}` : b.kind === 'c' ? 'Katalog nut' : `Śpiewnik „${b.name}”`;
    $('gr-reasons').innerHTML = REASONS.map((r) => `<label><input type="checkbox" value="${esc(r)}">${esc(r)}</label>`).join('');
    $('gr-note').value = '';
    $('gr-name').value = get(K.name) || '';
    $('gr-msg').textContent = '';
    $('gr-msg').className = 'small';
    $('gr-send').disabled = false;
    $('g-report-dlg').showModal();
  }
  async function sendReport(e) {
    e.preventDefault();
    const x = reportFor;
    if (!x) return;
    const reasons = [...$('gr-reasons').querySelectorAll('input:checked')].map((c) => c.value);
    const note = $('gr-note').value.trim();
    if (!reasons.length && !note) { $('gr-msg').textContent = 'Zaznacz, co jest nie tak, albo dopisz komentarz.'; $('gr-msg').className = 'small warn-text'; return; }
    const name = $('gr-name').value.trim();
    put(K.name, name || null);
    const payload = {
      v: 1, at: new Date().toISOString(), kind: x.b.kind === 'p' || x.b.kind === 'c' ? x.b.kind : 's', book: x.b.id, bookName: x.b.name,
      i: x.i, no: x.it.no || '', part: x.it.part || '', title: x.it.title, files: x.it.files, page: x.page, reasons, note, name,
    };
    $('gr-send').disabled = true;
    $('gr-msg').textContent = 'Wysyłanie…';
    $('gr-msg').className = 'small';
    try {
      await fetch(catalog.report.url, { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ [catalog.report.entry]: JSON.stringify(payload) }) });
      $('gr-msg').textContent = '✓ Dziękujemy! Dyrygent zobaczy zgłoszenie.';
      $('gr-msg').className = 'small ok-text';
      setTimeout(() => $('g-report-dlg').close(), 1400);
    } catch (err) {
      $('gr-send').disabled = false;
      $('gr-msg').textContent = navigator.onLine ? 'Nie udało się wysłać – spróbuj za chwilę.' : 'Brak internetu – wyślij, gdy połączysz się z siecią.';
      $('gr-msg').className = 'small warn-text';
    }
  }

  // ---------- zdarzenia ----------
  if (mode === 'guest') {
    $('g-report').addEventListener('click', openReport);
    $('gr-form').addEventListener('submit', sendReport);
    $('gr-cancel').addEventListener('click', () => $('g-report-dlg').close());
    $('g-close').addEventListener('click', () => {
      if (history.length > 1 && /\/\d+$/.test(location.hash)) history.back();
      else location.hash = location.hash.replace(/\/\d+$/, '') || '#/';
    });
    $('g-prev').addEventListener('click', () => { if (viewer && viewer.f > 0) { viewer.f--; showFile(); } });
    $('g-next').addEventListener('click', () => {
      if (viewer && viewer.f < viewer.b.items[viewer.i].files.length - 1) { viewer.f++; showFile(); }
    });
    $('g-full').hidden = !document.fullscreenEnabled;
    $('g-full').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      else $('g-viewer').requestFullscreen().catch(() => undefined);
    });
    $('g-admin').addEventListener('click', leave);
    window.addEventListener('hashchange', route);
    NoteView.attach($('g-page'), { onSwipe: step });
    window.addEventListener('online', () => { if (viewer && viewer.failed) showFile(); }); // nuty, które nie doszły bez internetu
    document.addEventListener('keydown', (e) => {
      if (!viewer || $('g-viewer').hidden || e.altKey || e.metaKey || document.querySelector('dialog[open]')) return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'Escape' && !document.fullscreenElement) $('g-close').click();
      else if (!e.ctrlKey && (e.key === '+' || e.key === '=')) NoteView.zoomBy(1.4);
      else if (!e.ctrlKey && e.key === '-') NoteView.zoomBy(1 / 1.4);
    });
    $('guest').hidden = false;
    load();
  }

  return { enter, leave, mode };
})();
