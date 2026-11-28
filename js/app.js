// Kamienickie Nutki – etap 1: połączenie z Dyskiem, wybór folderów, skanowanie, własne nazwy.
(() => {
  'use strict';
  const cfg = window.KN_CONFIG;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, one, few, many) => {
    const t = n % 10;
    const h = n % 100;
    return n === 1 ? one : t >= 2 && t <= 4 && (h < 12 || h > 14) ? few : many;
  };
  const fmtDate = (iso) => {
    try {
      return new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  };
  const stripExt = (name) => String(name).replace(/\.[a-z0-9]{2,5}$/i, '');

  // ---------- stan ----------
  const emptyData = () => ({ app: 'KamienickieNutki', v: 1, roots: [], nodes: {}, meta: {}, songbooks: [], scannedAt: null, updatedAt: 0 });
  // Identyfikator śpiewnika (do 3 znaków, np. Z – żółty, N – niebieski); nowe spisy dostają A01, A02…
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^0-9A-ZĄĆĘŁŃÓŚŹŻ]/g, '').slice(0, 3);
  function nextCode(books) {
    const used = new Set(books.map((b) => b.code));
    for (let l = 65; l <= 90; l++) {
      for (let n = 1; n <= 99; n++) {
        const c = String.fromCharCode(l) + String(n).padStart(2, '0');
        if (!used.has(c)) return c;
      }
    }
    return '';
  }
  const ensureCodes = (d) => { d.songbooks.forEach((b) => { if (!b.code) b.code = nextCode(d.songbooks); }); return d; };
  const normalize = (d) => {
    const e = emptyData();
    if (!d || typeof d !== 'object') return e;
    return ensureCodes({
      ...e,
      ...d,
      roots: Array.isArray(d.roots) ? d.roots : [],
      nodes: d.nodes && typeof d.nodes === 'object' ? d.nodes : {},
      meta: d.meta && typeof d.meta === 'object' ? d.meta : {},
      songbooks: Array.isArray(d.songbooks) ? d.songbooks : [],
      programs: Array.isArray(d.programs) ? d.programs : [],
      dups: d.dups && typeof d.dups === 'object' ? d.dups : { groups: {} },
    });
  };

  let data = emptyData();
  let sync = { fileId: null, dirty: false, syncedAt: null, baseAt: null, remoteMod: null };
  let idx = Catalog.buildIndex({});
  let user = null;
  const ui = { expanded: new Set(), expandedLoaded: false, query: '', filter: 'all', editing: null, scanning: false };
  let syncTimer = null;
  let syncing = false;
  let syncError = false;

  const EXP_KEY = 'kn-expanded';
  function loadExpanded() {
    try {
      const v = JSON.parse(localStorage.getItem(EXP_KEY) || 'null');
      if (Array.isArray(v)) { ui.expanded = new Set(v); ui.expandedLoaded = true; }
    } catch (e) { /* brak */ }
  }
  function saveExpanded() {
    try { localStorage.setItem(EXP_KEY, JSON.stringify([...ui.expanded])); } catch (e) { /* trudno */ }
  }

  // „nowe” = dodane podczas ostatniego skanowania lub odświeżania folderu
  const isNewNode = (n) => !!n.added && n.added === (data.newAt || data.scannedAt);

  const rebuild = () => {
    idx = Catalog.buildIndex(data.nodes);
    // na nowym urządzeniu foldery główne są od razu rozwinięte
    if (!ui.expandedLoaded && idx.roots.length) {
      idx.roots.forEach((r) => ui.expanded.add(r.id));
      ui.expandedLoaded = true;
      saveExpanded();
    }
  };

  function persist() {
    Store.set('data', data);
    Store.set('sync', sync);
  }

  function changed() {
    data.updatedAt = Date.now();
    sync.dirty = true;
    persist();
    scheduleSync();
    renderSync();
  }

  // ---------- zapis na Dysku ----------
  function scheduleSync(delay = 1500) {
    clearTimeout(syncTimer);
    if (Drive.isConnected()) syncTimer = setTimeout(pushNow, delay);
  }

  // Ochrona przed nadpisaniem: sync.baseAt = updatedAt wersji z Dysku, którą to urządzenie ostatnio wczytało albo zapisało,
  // sync.remoteMod = modifiedTime tego pliku. Jeśli plik na Dysku zmienił się w międzyczasie (inne urządzenie, druga karta),
  // nie nadpisujemy go, tylko łączymy (DataMerge) – wcześniej wygrywał cały plik z nowszą datą i znikały np. nowe spisy.
  const backupName = () => cfg.dataFileName.replace(/\.json$/i, '') + '-kopia-z-urzadzenia-' +
    new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-') + '.json';

  async function mergeRemote(remote) {
    const local = data;
    const r = DataMerge.merge(local, remote, sync.baseAt);
    if (r.conflicts || r.dropped) { // ta sama rzecz zmieniona tu i tam – wygrał Dysk, wersję z urządzenia zachowujemy w kopii
      try { await Drive.createJson(backupName(), JSON.stringify(local), await Drive.ensureAppFolder()); } catch (e) { console.warn('Nie udało się zapisać kopii', e); }
    }
    const d = normalize(r.data);
    const seen = new Set(); // identyfikatory spisów muszą być unikalne
    d.songbooks.forEach((b) => { if (seen.has(b.code)) b.code = ''; else seen.add(b.code); });
    ensureCodes(d);
    d.updatedAt = Date.now();
    data = d;
    sync.baseAt = remote.updatedAt || 0;
    sync.dirty = true;
    persist();
    rebuild();
    renderAll();
    toast('Na Dysku były zmiany z innego urządzenia – połączyłem je ze zmianami z tego urządzenia' +
      (r.conflicts ? '. Gdzie to samo zmieniono w obu miejscach, została wersja z Dysku (wersja z tego urządzenia jest w kopii w folderze aplikacji).' : '.'));
  }

  // przed zapisem: czy ktoś nie zmienił pliku na Dysku od naszego ostatniego odczytu/zapisu
  async function guardRemote() {
    let m;
    try { m = await Drive.meta(sync.fileId, 'modifiedTime,trashed'); } catch (e) { if (e.status === 404) return; throw e; }
    if (m.trashed) return;
    if (sync.remoteMod && m.modifiedTime === sync.remoteMod) return;
    const remote = normalize(await Drive.readJson(sync.fileId));
    const ru = remote.updatedAt || 0;
    if (ru !== sync.baseAt && ru !== data.updatedAt && ru) await mergeRemote(remote);
    else sync.baseAt = ru === data.updatedAt ? ru : sync.baseAt;
    sync.remoteMod = m.modifiedTime;
  }

  async function pushNow() {
    if (syncing) return scheduleSync();
    if (!sync.dirty || !Drive.isConnected()) return;
    syncing = true;
    syncError = false;
    renderSync();
    try {
      if (sync.fileId) await guardRemote();
      const snapshot = data.updatedAt;
      const text = JSON.stringify(data);
      let saved = null;
      if (sync.fileId) {
        try {
          saved = await Drive.updateJson(sync.fileId, text);
        } catch (e) {
          if (e.status !== 404) throw e;
        }
      }
      if (!saved) {
        saved = await Drive.createJson(cfg.dataFileName, text, await Drive.ensureAppFolder());
        sync.fileId = saved.id;
      }
      sync.baseAt = snapshot;
      sync.remoteMod = saved.modifiedTime || null;
      if (data.updatedAt === snapshot) sync.dirty = false;
      sync.syncedAt = Date.now();
      Store.set('sync', sync);
    } catch (e) {
      syncError = true;
      if (!(e instanceof Drive.AuthError)) console.warn(e);
    } finally {
      syncing = false;
      renderSync();
      if (sync.dirty && !syncError) scheduleSync();
    }
  }

  async function onConnected() {
    try {
      const a = await Drive.about();
      user = a.user || null;
      const email = user && user.emailAddress;
      if (email) Drive.rememberEmail(email);
      // dane w urządzeniu należą do innego konta → nie mieszamy, wczytamy dane tego konta z Dysku
      if (email && data.owner && data.owner !== email) {
        data = emptyData();
        sync = { fileId: null, dirty: false, syncedAt: null, baseAt: null, remoteMod: null };
        rebuild();
        renderAll();
      }
      if (email && !data.owner) { data.owner = email; persist(); }
      renderAccount();
      const f = await Drive.findDataFile();
      if (f) {
        const remote = normalize(await Drive.readJson(f.id));
        sync.fileId = f.id;
        // plik z danymi zawsze w folderze aplikacji (starsze wersje zapisywały go w „Mój dysk”)
        Drive.ensureAppFolder()
          .then((fid) => ((f.parents || []).includes(fid) ? null : Drive.moveInto(f.id, fid, f.parents)))
          .catch((e) => console.warn('Nie udało się przenieść pliku z danymi', e));
        const ru = remote.updatedAt || 0;
        const lu = data.updatedAt || 0;
        if (ru === lu) {
          sync.baseAt = ru; // ta sama wersja
        } else if (!sync.dirty || !lu) {
          // w urządzeniu nie ma niezapisanych zmian → obowiązuje Dysk (także gdy jest „starszy”, np. przywrócona wersja)
          data = remote;
          sync.dirty = false;
          sync.baseAt = ru;
          rebuild();
          renderAll();
          toast('Wczytano Twoje dane z Dysku.');
        } else if (sync.baseAt === ru || !ru) {
          // zmiany tylko w tym urządzeniu – Dysk się od tamtej pory nie zmienił
        } else {
          await mergeRemote(remote); // zmiany i tu, i na Dysku (albo starsze urządzenie bez śladu wersji)
        }
        sync.remoteMod = f.modifiedTime || null;
      } else {
        sync.fileId = null;
        if (data.updatedAt) sync.dirty = true;
      }
      persist();
      renderSync();
      scheduleSync(300);
    } catch (e) {
      handleError(e);
    }
  }

  async function ensureConnected() {
    if (Drive.isConnected()) return true;
    try {
      await Drive.connect();
      return true;
    } catch (e) {
      toast(e.message, true);
      return false;
    }
  }

  function handleError(e) {
    if (e instanceof Drive.AuthError) toast('Połączenie z Dyskiem wygasło – kliknij „Połącz z Dyskiem”.', true);
    else toast(e && e.message ? e.message : String(e), true);
    console.warn(e);
  }

  // ---------- komunikaty ----------
  let toastTimer = null;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3500);
  }

  // ---------- konto i zapis ----------
  function renderAccount() {
    const c = Drive.isConnected();
    $('btn-connect').hidden = c;
    $('account').hidden = !c;
    $('who').textContent = (user && (user.emailAddress || user.displayName)) || 'Połączono';
  }

  function renderSync() {
    const el = $('sync');
    let text = '';
    let cls = '';
    if (data.updatedAt) {
      if (syncing) { text = 'Zapisywanie…'; cls = 'busy'; }
      else if (!sync.dirty) { text = 'Zapisano na Dysku'; cls = 'ok'; }
      else if (!Drive.isConnected()) { text = 'Zapisano w urządzeniu'; cls = 'warn'; }
      else if (syncError) { text = 'Błąd zapisu – ponowię'; cls = 'warn'; }
      else { text = 'Czeka na zapis…'; cls = 'busy'; }
    }
    el.textContent = text;
    el.className = 'sync ' + cls;
    el.hidden = !text;
    el.title = cls === 'warn' && !Drive.isConnected() ? 'Zmiany są w tym urządzeniu. Połącz z Dyskiem, żeby je tam zapisać.' : '';
  }

  // ---------- foldery ----------
  function renderFolders() {
    const list = $('root-list');
    list.innerHTML = data.roots.length
      ? data.roots.map((r) => `<li><span class="fico" aria-hidden="true"></span><span class="root-name">${esc(r.name)}</span>
          <button class="icon-btn" data-refresh="${esc(r.id)}" title="Odśwież tylko ten folder" aria-label="Odśwież folder ${esc(r.name)}"${ui.scanning || !data.scannedAt ? ' disabled' : ''}>↻</button>
          <button class="icon-btn" data-rm="${esc(r.id)}" title="Usuń z listy" aria-label="Usuń folder ${esc(r.name)} z listy"${ui.scanning ? ' disabled' : ''}>✕</button></li>`).join('')
      : '<li class="muted">Nie wybrano jeszcze żadnego folderu.</li>';
    $('btn-scan').disabled = ui.scanning || !data.roots.length;
    $('btn-add-folder').disabled = ui.scanning;
    if (!ui.scanning) {
      const total = Object.values(data.nodes).filter((n) => !n.folder).length;
      const fresh = data.scannedAt ? Object.values(data.nodes).filter((n) => !n.folder && isNewNode(n)).length : 0;
      $('scan-info').textContent = data.scannedAt
        ? `Ostatnie skanowanie: ${fmtDate(data.scannedAt)} · ${total} ${plural(total, 'plik', 'pliki', 'plików')} z nutami` +
          (fresh ? ` · ${fresh} ${plural(fresh, 'nowy', 'nowe', 'nowych')}` : '')
        : data.roots.length ? 'Kliknij „Skanuj Dysk”, żeby wyszukać nuty.' : '';
    }
    $('welcome').hidden = data.roots.length > 0;
  }

  // Po skanowaniu: pliki, których już nie ma na Dysku (np. usunięty duplikat), znikają z pieśni,
  // jeśli pieśń ma jeszcze inne pliki. Gdy zniknęły wszystkie – zostawiamy, żeby było widać „plik zniknął z Dysku”
  // (np. po usunięciu folderu z listy nie kasujemy po cichu zatwierdzonych dopasowań).
  function dropGone() {
    const keep = (files) => {
      if (!files || !files.length) return null;
      const ok = files.filter((id) => data.nodes[id]);
      return ok.length && ok.length < files.length ? ok : null;
    };
    let n = 0;
    for (const b of data.songbooks) b.items.forEach((it) => { const f = keep(it.files); if (f) { it.files = f; n++; } });
    for (const p of data.programs || []) p.parts.forEach((pt) => pt.items.forEach((it) => { const f = keep(it.files); if (f) { it.files = f; n++; } }));
    return n;
  }

  // ---------- „to nie nuty” i „nieistotne” ----------
  // Duszek „nieistotne”: same kontury = nieoznaczone, biały wypełniony (klasa on) = oznaczone
  const GHOST = (on) => `<svg class="ico-ghost${on ? ' on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-ghost"/></svg>`;
  const NONOTE = '<svg class="ico-nonote" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-nonote"/></svg>';
  function flagTag(fl) {
    if (fl === 'notes') return `<span class="flag-tag">${NONOTE} to nie nuty</span>`;
    if (fl === 'ignore') return `<span class="flag-tag">${GHOST(true)} nieistotne</span>`;
    if (fl === 'ignoreDir') return `<span class="flag-tag" title="Cały folder jest oznaczony jako nieistotny">${GHOST(true)} w nieistotnym folderze</span>`;
    return '';
  }
  // ustaw/usuń pole w meta (puste meta znika)
  function setMeta(id, key, val) {
    const m = { ...(data.meta[id] || {}) };
    if (val) m[key] = val;
    else delete m[key];
    if (Object.keys(m).length) data.meta[id] = m;
    else delete data.meta[id];
  }
  // gdzie plik jest w śpiewnikach (zatwierdzony lub automatyczny) i programach
  function usedIn(id) {
    const out = [];
    for (const b of data.songbooks) b.items.forEach((it) => { if ((it.state === 'ok' || it.state === 'auto') && it.files.includes(id)) out.push(`śpiewnik „${b.name}”${it.no ? ' nr ' + it.no : ''}`); });
    for (const p of data.programs || []) if (p.parts.some((pt) => pt.items.some((it) => (it.files || []).includes(id)))) out.push(`program „${p.name}”`);
    return out;
  }
  // po zmianie oznaczeń: automatyczne dopasowania i duplikaty od nowa
  function afterFlags() {
    if (window.Songs) Songs.rematchAll(true);
    if (window.Dups && data.dups && data.dups.at) Dups.detect(true);
    changed();
    renderAll();
  }
  // duszek przy folderze albo pliku w drzewie
  function toggleIgnore(id) {
    const n = data.nodes[id];
    if (!n) return;
    const on = !(data.meta[id] && data.meta[id].ignore);
    setMeta(id, 'ignore', on);
    if (on) setMeta(id, 'notNotes', false);
    afterFlags();
    if (n.folder) {
      toast(on ? `Folder „${n.name}” oznaczony jako nieistotny – jego nuty są pomijane przy dopasowaniu, w duplikatach i „Pozostałych nutach”.`
        : `Folder „${n.name}” znów jest brany pod uwagę.`);
    } else toast(on ? 'Oznaczono jako nieistotne.' : 'Usunięto oznaczenie „nieistotne”.');
  }
  // przycisk duszka w drzewie: inDir = leży w folderze oznaczonym jako nieistotny (wtedy tylko podgląd)
  const ghostBtn = (id, on, inDir, folder) => inDir
    ? `<span class="act ghost on dim" title="W folderze oznaczonym jako nieistotny – zmień to przy folderze">${GHOST(true)}</span>`
    : `<button class="act ghost${on ? ' on' : ''}" data-ghost="${esc(id)}" aria-pressed="${on}" aria-label="${folder ? 'Nieistotny folder' : 'Nieistotny plik'}" title="${on
      ? (folder ? 'Folder oznaczony jako nieistotny – kliknij, żeby cofnąć' : 'Oznaczony jako nieistotny – kliknij, żeby cofnąć')
      : (folder ? 'Oznacz folder jako nieistotny (nuty niepotrzebne chórzystom)' : 'Oznacz jako nieistotne (nuty niepotrzebne chórzystom)')}">${GHOST(on)}</button>`;

  let edId = null;
  let edInCat = false;
  // „Edytuj w Katalogu” wyszarzone, gdy pliku nie ma w Katalogu albo właśnie zaznaczono „to nie nuty” (taki plik z Katalogu znika)
  function paintEdCat() {
    const notes = $('ed-notes').checked;
    $('ed-cat').disabled = !edInCat || notes;
    $('ed-cat').title = notes ? 'Plik oznaczony „to nie nuty” nie jest w Katalogu'
      : edInCat ? 'Tytuł, autorzy, cechy, obrót i pozostałe strony tego utworu'
        : 'Tego pliku nie ma w Katalogu (np. „to nie nuty” albo na liście do sprzątnięcia)';
  }
  function openEdit(id) {
    const n = data.nodes[id];
    if (!n) return;
    edId = id;
    const m = data.meta[id] || {};
    $('ed-title').textContent = n.name;
    $('ed-path').textContent = '📁 ' + (Catalog.pathOf(data.nodes, id) || 'Mój dysk') + (n.viaShortcut ? ` (skrót; oryginał: ${n.real || 'poza wybranymi folderami'})` : '');
    $('ed-name').value = m.title || '';
    $('ed-name').placeholder = stripExt(n.name);
    $('ed-open').href = Preview.driveUrl(id);
    $('ed-view').onclick = () => Preview.open([id]);
    // „Edytuj w Katalogu” – nie wtedy, gdy okno otwarto z samego katalogu albo pliku w katalogu nie ma (np. „to nie nuty”)
    // plik „to nie nuty” po odznaczeniu i zapisie wróci do Katalogu – wtedy też można przejść
    edInCat = !$('work-dlg').open && !!((window.Works && Works.workOfFile(id)) || m.notNotes);
    $('ed-cat').hidden = $('work-dlg').open;
    const used = usedIn(id);
    $('ed-notes').checked = !!m.notNotes;
    $('ed-notes').disabled = !m.notNotes && used.length > 0;
    $('ed-notes-why').hidden = !$('ed-notes').disabled;
    $('ed-notes-why').textContent = used.length ? `Plik jest używany: ${used.join(', ')} – najpierw go stamtąd usuń.` : '';
    const dirIgn = Catalog.flagOf(data.nodes, { ...data.meta, [id]: {} }, id) === 'ignoreDir';
    $('ed-ignore').checked = !!m.ignore || dirIgn;
    $('ed-ignore').disabled = dirIgn;
    $('ed-ignore-why').hidden = !dirIgn;
    $('ed-ignore-why').textContent = dirIgn ? 'Cały folder jest oznaczony jako nieistotny (duszek przy folderze w „Nutach na Dysku”).' : '';
    paintEdCat();
    $('edit-dlg').showModal();
    $('ed-name').focus();
  }
  // „to nie nuty” i „nieistotne” wykluczają się
  $('ed-notes').addEventListener('change', (e) => { if (e.target.checked && !$('ed-ignore').disabled) $('ed-ignore').checked = false; paintEdCat(); });
  $('ed-ignore').addEventListener('change', (e) => { if (e.target.checked) $('ed-notes').checked = false; paintEdCat(); });
  // zapisuje zmiany z okna i przechodzi do pozycji tego pliku w Katalogu
  $('ed-cat').addEventListener('click', () => {
    const id = edId;
    $('ed-form').requestSubmit(); // zapis jak „Zapisz” (okno zamyka się samo)
    if ($('edit-dlg').open) $('edit-dlg').close();
    showTab('catalog');
    if (window.Works && !Works.openFile(id)) toast('Tego pliku nie ma w Katalogu (np. „to nie nuty”).', true);
  });
  $('ed-cancel').addEventListener('click', () => $('edit-dlg').close());
  $('ed-form').addEventListener('submit', () => {
    const id = edId;
    const m = data.meta[id] || {};
    const title = $('ed-name').value.trim().replace(/\s+/g, ' ');
    const notes = $('ed-notes').checked;
    const ign = $('ed-ignore').checked && !$('ed-ignore').disabled;
    const flagsChanged = !!m.notNotes !== notes || !!m.ignore !== ign;
    if ((m.title || '') === title && !flagsChanged) return;
    setMeta(id, 'title', title);
    setMeta(id, 'notNotes', notes);
    setMeta(id, 'ignore', ign);
    if (flagsChanged) afterFlags();
    else { changed(); renderTree(); if (window.Dups) Dups.render(); if (window.Songs) Songs.render(); }
    toast(flagsChanged ? (notes ? 'Oznaczono: to nie nuty.' : ign ? 'Oznaczono jako nieistotne.' : 'Usunięto oznaczenie – plik znów jest brany pod uwagę.') : 'Zapisano nazwę.');
  });

  // Skrót do pliku/folderu, którego oryginał leży poza wybranymi folderami – pokazujemy, gdzie jest naprawdę.
  function shortcutTag(n) {
    if (!n.viaShortcut || n.parent === null) return '';
    const where = n.real ? `oryginał: ${n.real}` : 'oryginał poza wybranymi folderami (zeskanuj ponownie, żeby zobaczyć gdzie)';
    return `<span class="sc-tag" title="Tu jest tylko skrót. ${esc(where)}">↪ skrót · ${esc(where)}</span>`;
  }

  async function doScan() {
    if (!data.roots.length) return toast('Najpierw dodaj folder z nutami.');
    if (!(await ensureConnected())) return;
    ui.scanning = true;
    renderFolders();
    $('scan-info').textContent = 'Skanowanie…';
    try {
      const res = await Catalog.scan(data.roots, data.nodes, (p) => {
        $('scan-info').textContent = `Skanowanie… ${p.folders} ${plural(p.folders, 'folder', 'foldery', 'folderów')}, ${p.files} ${plural(p.files, 'plik', 'pliki', 'plików')} z nutami${p.shortcuts ? ' · sprawdzanie skrótów…' : ''}`;
      });
      data.nodes = res.nodes;
      data.scannedAt = res.scannedAt;
      data.newAt = res.scannedAt;
      rebuild();
      dropGone();
      if (window.Songs) Songs.rematchAll(true);
      if (window.Dups && data.dups && data.dups.at) Dups.detect(true); // duplikaty aktualne po skanowaniu
      changed();
      toast(`Gotowe: ${res.files} ${plural(res.files, 'plik', 'pliki', 'plików')} z nutami.`);
    } catch (e) {
      handleError(e);
    } finally {
      ui.scanning = false;
      renderAll();
    }
  }

  // Odświeża jeden folder (np. po dodaniu nut na Dysku) bez skanowania wszystkiego.
  async function refreshFolder(id) {
    if (ui.scanning) return;
    const r = data.roots.find((x) => x.id === id);
    const node = data.nodes[id] || (r && { id, name: r.name, folder: true, parent: null });
    if (!node || !node.folder) return;
    if (!(await ensureConnected())) return;
    ui.scanning = true;
    ui.refreshing = id;
    renderFolders();
    renderTree();
    $('scan-info').textContent = `Odświeżanie „${node.name}”…`;
    try {
      const res = await Catalog.rescanFolder(data.nodes, node, (p) => {
        $('scan-info').textContent = `Odświeżanie „${node.name}”… ${p.files} ${plural(p.files, 'plik', 'pliki', 'plików')} z nutami`;
      });
      data.nodes = res.nodes;
      if (!data.nodes[id] && r) data.nodes[id] = { id, name: r.name, folder: true, parent: null };
      data.newAt = res.at;
      rebuild();
      dropGone();
      if (window.Songs) Songs.rematchAll(true);
      changed();
      toast(`Odświeżono „${node.name}”: ${res.files} ${plural(res.files, 'plik', 'pliki', 'plików')} z nutami` +
        `, nowe: ${res.added}` + (res.removed ? `, usunięte z Dysku: ${res.removed}` : '') + '.');
    } catch (e) {
      handleError(e);
    } finally {
      ui.scanning = false;
      ui.refreshing = null;
      renderAll();
    }
  }

  function removeRoot(id) {
    const r = data.roots.find((x) => x.id === id);
    if (!r) return;
    if (!confirm(`Usunąć folder „${r.name}” z listy?\n\nPliki na Dysku zostaną nietknięte, a nadane nazwy aplikacja zapamięta.`)) return;
    data.roots = data.roots.filter((x) => x.id !== id);
    data.nodes = Catalog.keepUnder(data.nodes, data.roots.map((x) => x.id));
    rebuild();
    changed();
    renderAll();
  }

  // ---------- wybór folderu ----------
  let pickStack = [];
  let pickMode = 'folder'; // 'folder' – folder z nutami, 'doc' – plik ze spisem pieśni
  let pickDoc = null;
  async function openPicker(mode = 'folder', onDoc = null) {
    if (!(await ensureConnected())) return;
    pickMode = mode === 'doc' ? 'doc' : 'folder';
    pickDoc = onDoc;
    pickStack = [{ id: 'top', name: 'Dysk Google' }];
    $('picker-title').textContent = pickMode === 'doc' ? 'Wybierz plik ze spisem pieśni' : 'Wybierz folder z nutami';
    $('btn-pick').hidden = pickMode === 'doc';
    $('picker').showModal();
    loadPicker();
  }

  async function loadPicker() {
    const cur = pickStack[pickStack.length - 1];
    $('crumbs').innerHTML = pickStack.map((p, i) => (i < pickStack.length - 1
      ? `<button type="button" class="crumb" data-depth="${i}">${esc(p.name)}</button><span class="sep">›</span>`
      : `<span class="crumb current">${esc(p.name)}</span>`)).join('');
    const list = $('picker-list');
    list.innerHTML = '<li class="muted">Wczytywanie…</li>';
    $('btn-pick').disabled = cur.id === 'top' || cur.id === 'shared';
    let items;
    try {
      if (cur.id === 'top') {
        const drives = await Drive.listSharedDrives();
        items = [{ id: 'root', name: 'Mój dysk' }, { id: 'shared', name: 'Udostępnione dla mnie' }, ...drives.map((d) => ({ id: d.id, name: d.name }))];
      } else if (pickMode === 'doc') {
        const r = await Drive.listFoldersAndDocs(cur.id);
        items = [...r.folders, ...r.docs.map((d) => ({ ...d, doc: true }))];
      } else {
        items = await Drive.listFolders(cur.id);
      }
    } catch (e) {
      handleError(e);
      list.innerHTML = '';
      return;
    }
    if (pickStack[pickStack.length - 1] !== cur) return; // użytkownik przeszedł gdzie indziej
    list.innerHTML = items.length
      ? items.map((f) => (f.doc
        ? `<li><button type="button" class="pick-item pick-doc" data-id="${esc(f.id)}" data-name="${esc(f.name)}" data-mime="${esc(f.mimeType)}"><span class="badge doc">DOC</span><span>${esc(f.name)}</span><span class="chev">Wybierz</span></button></li>`
        : `<li><button type="button" class="pick-item" data-id="${esc(f.id)}" data-name="${esc(f.name)}"><span class="fico" aria-hidden="true"></span><span>${esc(f.name)}</span><span class="chev">›</span></button></li>`)).join('')
      : `<li class="muted">${pickMode === 'doc' ? 'Brak podfolderów i plików spisu (.odt, .docx, .txt, Dokument Google).' : 'Brak podfolderów.'}</li>`;
  }

  function pickCurrent() {
    const cur = pickStack[pickStack.length - 1];
    if (cur.id === 'top' || cur.id === 'shared') return;
    $('picker').close();
    if (data.roots.some((r) => r.id === cur.id)) return toast('Ten folder już jest na liście.');
    data.roots.push({ id: cur.id, name: cur.name });
    ui.expanded.add(cur.id);
    saveExpanded();
    changed();
    renderFolders();
    doScan();
  }

  // ---------- drzewo nut ----------
  // pliki przypisane do któregoś śpiewnika (zatwierdzone albo pewne automatycznie); programy uroczystości się nie liczą
  function assignedIds() {
    const ids = new Set();
    for (const b of data.songbooks) for (const it of b.items) if (it.state === 'ok' || it.state === 'auto') it.files.forEach((id) => ids.add(id));
    return ids;
  }

  let lastMatch = null;
  // Zapisuje widoczną (przefiltrowaną) listę plików jako CSV – otwiera się w Excelu / LibreOffice.
  function exportList() {
    const rows = [];
    const walk = (n) => {
      for (const ch of idx.children[n.id] || []) {
        if (ch.folder) walk(ch);
        else if (!lastMatch || lastMatch(ch)) rows.push(ch);
      }
    };
    idx.roots.forEach(walk);
    if (!rows.length) return toast('Lista jest pusta.');
    const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const lines = ['Lp.;Nazwa w aplikacji;Nazwa pliku;Folder;Rodzaj'];
    rows.forEach((n, i) => {
      const m = data.meta[n.id];
      lines.push([i + 1, q((m && m.title) || stripExt(n.name)), q(n.name), q(Catalog.pathOf(data.nodes, n.id)), n.kind === 'pdf' ? 'PDF' : 'obraz'].join(';'));
    });
    const label = { all: 'wszystkie', unnamed: 'bez-wlasnej-nazwy', named: 'z-wlasna-nazwa', new: 'nowe', unassigned: 'nieprzypisane-do-spiewnika', remove: 'duplikaty-do-usuniecia' }[ui.filter] || 'lista';
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nuty-${label}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`Zapisano listę: ${rows.length} ${plural(rows.length, 'plik', 'pliki', 'plików')}.`);
  }

  function renderTree() {
    const hasFiles = Object.keys(data.nodes).length > 0;
    $('files-card').hidden = !hasFiles;
    if (!hasFiles) return;

    const words = Catalog.norm(ui.query).split(' ').filter(Boolean);
    const f = ui.filter;
    const filtering = words.length > 0 || f !== 'all';
    const isNew = isNewNode;
    const assigned = f === 'unassigned' ? assignedIds() : null;
    const removeSet = f === 'remove' && window.Dups ? Dups.toRemove() : null;
    const match = (n) => {
      const m = data.meta[n.id];
      const title = m && m.title;
      const fl = Catalog.flagOf(data.nodes, data.meta, n.id);
      if (f === 'flagged') return !!fl;
      if (assigned && (assigned.has(n.id) || fl)) return false;
      if (removeSet && !removeSet.has(n.id)) return false;
      if (f === 'named' && !title) return false;
      if (f === 'unnamed' && title) return false;
      if (f === 'new' && !isNew(n)) return false;
      if (words.length) {
        const hay = Catalog.norm(stripExt(n.name) + ' ' + (title || '')); // bez rozszerzenia („jpg” nie znajduje wszystkich zdjęć)
        return words.every((w) => hay.includes(w));
      }
      return true;
    };

    lastMatch = filtering ? match : null;
    $('unassigned-hint').hidden = f !== 'unassigned';
    const visible = {};
    const walk = (n) => {
      if (!n.folder) return match(n) ? 1 : 0;
      let c = 0;
      for (const ch of idx.children[n.id] || []) c += walk(ch);
      visible[n.id] = c;
      return c;
    };
    let shown = 0;
    idx.roots.forEach((r) => { shown += walk(r); });

    const toRemoveSet = window.Dups ? Dups.toRemove() : null;
    const sib = siblingsMap();
    const fileRow = (n, d) => {
      const m = data.meta[n.id];
      const title = m && m.title;
      const badge = `<span class="badge ${n.kind}">${n.kind === 'pdf' ? 'PDF' : 'IMG'}</span>`;
      if (ui.editing === n.id) {
        return `<div class="row file editing" data-id="${esc(n.id)}" style="--d:${d}">${badge}
          <div class="names"><input class="name-input" type="text" value="${esc(title || '')}" placeholder="${esc(stripExt(n.name))}" maxlength="200" aria-label="Własna nazwa dla ${esc(n.name)}" enterkeyhint="done">
          <span class="orig">${esc(n.name)}</span></div>
          <button class="act" data-act="save" title="Zapisz" aria-label="Zapisz nazwę">✓</button></div>`;
      }
      const fl = Catalog.flagOf(data.nodes, data.meta, n.id);
      return `<div class="row file${fl ? ' flagged' : ''}" data-id="${esc(n.id)}" style="--d:${d}">${badge}
        <div class="names" data-act="edit"><span class="title${title ? '' : ' plain'}">${esc(title || n.name)}</span>${title ? `<span class="orig">${esc(n.name)}</span>` : ''}${isNew(n) ? '<span class="new">nowy</span>' : ''}${m && m.rot ? `<span class="rot-tag">obrócony o ${m.rot}°</span>` : ''}${toRemoveSet && toRemoveSet.has(n.id) ? '<span class="dup-tag del">duplikat – do usunięcia</span>' : ''}${m && m.page ? `<span class="page-tag">str. ${m.page}</span>` : ''}${fl === 'notes' ? flagTag(fl) : ''}${shortcutTag(n)}</div>
        ${(sib[n.id] || []).length > 1 ? `<button class="act" data-act="order" title="Kolejność stron tej pieśni (${sib[n.id].length} pliki w tym folderze)" aria-label="Kolejność stron">⇅</button>` : ''}
        ${fl === 'notes' ? '<span class="act ghost-gap"></span>' : ghostBtn(n.id, fl === 'ignore', fl === 'ignoreDir', false)}
        <button class="act" data-act="edit" title="Edytuj: nazwa, obrót, „to nie nuty”, „nieistotne”" aria-label="Edytuj plik">✎</button>
        ${(sib[n.id] || []).length > 1 ? Preview.noteBtn(sib[n.id], sib[n.id].indexOf(n.id), title || '') : Preview.noteBtn(n.id)}</div>`;
    };

    const node = (n, d) => {
      if (!n.folder) return filtering && !match(n) ? '' : fileRow(n, d);
      if (filtering && !visible[n.id]) return '';
      const open = filtering || ui.expanded.has(n.id);
      const cnt = filtering ? visible[n.id] : idx.counts[n.id] || 0;
      const ign = !!(data.meta[n.id] && data.meta[n.id].ignore);
      const inIgn = !ign && Catalog.flagOf(data.nodes, data.meta, n.id) === 'ignoreDir';
      let s = `<div class="row folder${open ? ' open' : ''}${ign || inIgn ? ' flagged' : ''}" data-id="${esc(n.id)}" style="--d:${d}" role="button" tabindex="0" aria-expanded="${open}">
        <span class="tw" aria-hidden="true"></span><span class="fico" aria-hidden="true"></span><span class="fname">${esc(n.name)}</span>${shortcutTag(n)}<span class="cnt">${cnt}</span>
        ${n.parent !== null ? ghostBtn(n.id, ign, inIgn, true) : ''}
        <button class="act refresh${ui.refreshing === n.id ? ' spin' : ''}" data-refresh="${esc(n.id)}" title="Odśwież tylko ten folder" aria-label="Odśwież folder ${esc(n.name)}"${ui.scanning ? ' disabled' : ''}>↻</button></div>`;
      if (open) s += (idx.children[n.id] || []).map((ch) => node(ch, d + 1)).join('');
      return s;
    };

    $('tree').innerHTML = shown || !filtering
      ? idx.roots.map((r) => node(r, 0)).join('')
      : '<p class="muted empty">Nic nie pasuje do wyszukiwania.</p>';

    const total = Object.values(data.nodes).filter((n) => !n.folder).length;
    const named = Object.values(data.nodes).filter((n) => !n.folder && data.meta[n.id] && data.meta[n.id].title).length;
    $('files-summary').textContent = filtering
      ? `${shown} z ${total}`
      : `${total} ${plural(total, 'plik', 'pliki', 'plików')} · ${named} z własną nazwą`;
    $('tree').classList.toggle('filtering', filtering);

    if (ui.editing) {
      const inp = $('tree').querySelector('.name-input');
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  // ---------- kolejność stron (meta[id].page – jedno miejsce, jak własne nazwy) ----------
  const ORDER_JUNK = new Set(['pdf', 'jpg', 'jpeg', 'png', 'img', 'image', 'dsc', 'skan', 'scan', 'kopia', 'copy', 'str', 'strona', 'page', 'nuty', 'wersja', 'final']);
  // „Barka 2.jpg” / „Barka str. 1” → „barka” (Twoja nazwa ma pierwszeństwo)
  function songKey(id) {
    const n = data.nodes[id];
    const m = data.meta[id];
    const t = (m && m.title) || (n ? stripExt(n.name) : id);
    return Catalog.norm(t).split(' ').filter((w) => w && !ORDER_JUNK.has(w) && !/^\d+$/.test(w)).join(' ');
  }
  // Pliki tej samej pieśni w jednym folderze (strony) – do przycisku ⇅ w drzewie
  function siblingsMap() {
    const g = {};
    for (const n of Object.values(data.nodes)) {
      if (n.folder) continue;
      const k = songKey(n.id);
      if (k.length < 2) continue;
      (g[n.parent + '|' + k] = g[n.parent + '|' + k] || []).push(n.id);
    }
    const out = {};
    for (const ids of Object.values(g)) if (ids.length > 1) { const o = orderFiles(ids); o.forEach((id) => { out[id] = o; }); }
    return out;
  }
  // Ustawia pliki w kolejności stron: najpierw zapisana kolejność, potem folder i nazwa pliku („… 1”, „… 2”)
  function orderFiles(ids) {
    const key = (id) => {
      const n = data.nodes[id];
      return (n ? Catalog.pathOf(data.nodes, id) + '/' + n.name : id);
    };
    const page = (id) => (data.meta[id] && data.meta[id].page) || 1e6;
    return [...ids].sort((a, b) => page(a) - page(b) || key(a).localeCompare(key(b), 'pl', { numeric: true, sensitivity: 'base' }));
  }
  // Po zmianie kolejności: przestaw pliki we wszystkich śpiewnikach i programach, w których występują razem
  function applyOrder(ids) {
    const set = new Set(ids);
    let n = 0;
    const fix = (it) => {
      if (!it.files || it.files.filter((id) => set.has(id)).length < 2) return;
      const next = orderFiles(it.files);
      if (next.join() !== it.files.join()) { it.files = next; n++; }
    };
    for (const b of data.songbooks) b.items.forEach(fix);
    for (const p of data.programs || []) p.parts.forEach((pt) => pt.items.forEach(fix));
    return n;
  }

  let orderIds = [];
  let orderDone = null;
  function paintOrder() {
    $('order-list').innerHTML = orderIds.map((id, i) => {
      const n = data.nodes[id];
      const m = data.meta[id];
      if (!n) return '';
      return `<li class="order-item" data-i="${i}"><span class="order-no">${i + 1}.</span>
        <span class="badge ${n.kind}">${n.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
        <span class="order-names"><b>${esc((m && m.title) || n.name)}</b><span class="muted small">${esc(Catalog.pathOf(data.nodes, id))} / ${esc(n.name)}</span></span>
        ${Preview.noteBtn(id)}
        <button class="icon-btn" data-o="up" title="Wyżej"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="icon-btn" data-o="down" title="Niżej"${i === orderIds.length - 1 ? ' disabled' : ''}>↓</button></li>`;
    }).join('');
  }
  // Okno „Kolejność stron” – wspólne dla drzewa, spisów, programów i duplikatów. onDone(ids) – opcjonalnie po zapisie.
  function openOrder(ids, title, onDone) {
    orderIds = orderFiles(ids.filter((id) => data.nodes[id]));
    if (orderIds.length < 2) return toast('Do ustalenia kolejności potrzebne są co najmniej 2 pliki.');
    orderDone = onDone || null;
    const first = orderIds[0];
    $('order-title').textContent = title || (data.meta[first] && data.meta[first].title) || stripExt(data.nodes[first].name);
    paintOrder();
    $('order-dlg').showModal();
  }
  $('order-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-o]');
    const li = e.target.closest('.order-item');
    if (!b || !li) return;
    const i = Number(li.dataset.i);
    const j = b.dataset.o === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= orderIds.length) return;
    [orderIds[i], orderIds[j]] = [orderIds[j], orderIds[i]];
    paintOrder();
  });
  $('order-cancel').addEventListener('click', () => $('order-dlg').close());
  $('order-save').addEventListener('click', () => {
    orderIds.forEach((id, i) => { data.meta[id] = { ...(data.meta[id] || {}), page: i + 1 }; });
    const moved = applyOrder(orderIds);
    $('order-dlg').close();
    changed();
    renderAll();
    if (orderDone) orderDone(orderIds);
    toast(`Zapisano kolejność stron (${orderIds.length} ${plural(orderIds.length, 'plik', 'pliki', 'plików')}).` +
      (moved ? ` Przestawiono ją w ${moved} ${plural(moved, 'miejscu', 'miejscach', 'miejscach')} (śpiewniki/programy).` : ''));
  });

  // ---------- obrót pliku (tylko w aplikacji: kopie dla chórzystów i PDF-y) ----------
  let rotId = null;
  let rotVal = 0;
  let rotUrl = null;
  const rotNorm = (v) => ((v % 360) + 360) % 360;
  function paintRot() {
    $('rot-img').style.transform = `rotate(${rotVal}deg)`;
    $('rot-val').textContent = rotVal ? `Obrót: ${rotVal}° w prawo` : 'Bez obrotu';
  }
  async function openRotate(id) {
    const n = data.nodes[id];
    if (!n) return;
    rotId = id;
    rotVal = (data.meta[id] && data.meta[id].rot) || 0;
    const m = data.meta[id];
    $('rot-title').textContent = (m && m.title) || n.name;
    $('rot-open').href = Preview.driveUrl(id);
    $('rot-img').hidden = true;
    $('rot-msg').hidden = false;
    $('rot-msg').textContent = 'Wczytywanie podglądu…';
    paintRot();
    $('rot-dlg').showModal();
    if (rotUrl) { URL.revokeObjectURL(rotUrl); rotUrl = null; }
    if (n.kind === 'pdf') {
      $('rot-msg').textContent = 'Podgląd PDF niedostępny – otwórz plik na Dysku, żeby sprawdzić, jak jest ułożony. Obrót dotyczy wszystkich stron.';
      return;
    }
    if (!(await ensureConnected())) { $('rot-msg').textContent = 'Połącz z Dyskiem, żeby zobaczyć podgląd.'; return; }
    try {
      const buf = await Drive.download(id);
      if (rotId !== id) return;
      rotUrl = URL.createObjectURL(new Blob([buf]));
      $('rot-img').onload = () => { $('rot-img').hidden = false; $('rot-msg').hidden = true; };
      $('rot-img').onerror = () => { $('rot-msg').textContent = 'Tego formatu przeglądarka nie pokaże (np. HEIC) – otwórz plik na Dysku.'; };
      $('rot-img').src = rotUrl;
    } catch (e) {
      $('rot-msg').textContent = 'Nie udało się wczytać podglądu.';
      handleError(e);
    }
  }
  $('rot-dlg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    rotVal = rotNorm(rotVal + Number(b.dataset.r));
    paintRot();
  });
  $('rot-cancel').addEventListener('click', () => $('rot-dlg').close());
  $('rot-save').addEventListener('click', () => {
    const m = data.meta[rotId] || {};
    if ((m.rot || 0) !== rotVal) {
      if (rotVal) data.meta[rotId] = { ...m, rot: rotVal };
      else {
        delete m.rot;
        if (Object.keys(m).length) data.meta[rotId] = m;
        else delete data.meta[rotId];
      }
      changed();
      renderTree();
      if (window.Dups) Dups.render(); // obrót widać też przy duplikatach
      toast(rotVal ? `Zapisano obrót o ${rotVal}°. Chórzyści zobaczą go po aktualizacji.` : 'Usunięto obrót.');
    }
    $('rot-dlg').close();
  });

  let committing = false;
  function commitEdit(id, value) {
    if (committing) return;
    committing = true;
    const v = String(value || '').trim().replace(/\s+/g, ' ');
    const m = data.meta[id] || {};
    if ((m.title || '') !== v) {
      if (v) data.meta[id] = { ...m, title: v };
      else {
        delete m.title;
        if (Object.keys(m).length) data.meta[id] = m;
        else delete data.meta[id];
      }
      changed();
    }
    ui.editing = null;
    renderTree();
    committing = false;
  }

  function startEdit(id) {
    if (ui.editing && ui.editing !== id) {
      const inp = $('tree').querySelector('.name-input');
      if (inp) commitEdit(ui.editing, inp.value);
    }
    ui.editing = id;
    renderTree();
  }

  function renderAll() {
    renderAccount();
    renderSync();
    renderFolders();
    renderTree();
    if (window.Songs) Songs.render();
    if (window.Dups) Dups.render();
    if (window.Programs) Programs.render();
    if (window.Publish) Publish.render();
    if (window.Works) Works.render();
  }

  // ---------- zakładki ----------
  const TAB_KEY = 'kn-tab';
  function showTab(name) {
    document.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* trudno */ }
    if (name === 'choir' && window.Publish) Publish.render();
    if (name === 'choir' && window.Reports) Reports.autoFetch();
    if (name === 'events' && window.Programs) Programs.render();
    if (name === 'catalog' && window.Works) Works.render();
  }
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  try { const t = localStorage.getItem(TAB_KEY); showTab(['catalog', 'songs', 'events', 'choir'].includes(t) ? t : 'files'); } catch (e) { showTab('files'); }

  // usunięty spis/program zapamiętujemy, żeby drugie urządzenie (inna przeglądarka) go nie przywróciło przy łączeniu danych
  function markDeleted(id) {
    if (!data.deleted || typeof data.deleted !== 'object') data.deleted = {};
    data.deleted[id] = new Date().toISOString();
  }

  // ---------- odzyskiwanie z historii pliku na Dysku ----------
  // Przegląda starsze wersje pliku z danymi (od najnowszej) i zbiera spisy/programy, których teraz nie ma –
  // każdy w najnowszej wersji, w jakiej występował.
  let histFound = [];
  async function openHistory() {
    if (!(await ensureConnected())) return;
    const dlg = $('hist-dlg');
    const st = $('hs-status');
    const list = $('hs-list');
    histFound = [];
    list.innerHTML = '';
    $('hs-ok').disabled = true;
    st.textContent = 'Sprawdzam historię pliku…';
    dlg.showModal();
    try {
      if (sync.dirty) await pushNow();
      if (!sync.fileId) { st.textContent = 'Na Dysku nie ma jeszcze pliku z danymi.'; return; }
      const revs = (await Drive.revisions(sync.fileId)).sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
      const seen = new Set();
      for (let i = 0; i < revs.length && dlg.open; i++) {
        st.textContent = `Przeglądam wersje z Dysku… ${i + 1} z ${revs.length}`;
        let old;
        try { old = await Drive.readRevision(sync.fileId, revs[i].id); } catch (e) { if (e instanceof Drive.AuthError) throw e; continue; }
        const m = DataMerge.missing(data, old || {});
        m.songbooks.forEach((b) => { if (!seen.has(b.id)) { seen.add(b.id); histFound.push({ kind: 'book', obj: b, at: revs[i].modifiedTime }); } });
        m.programs.forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); histFound.push({ kind: 'prog', obj: p, at: revs[i].modifiedTime }); } });
        paintHistory();
      }
      if (!dlg.open) return;
      st.textContent = histFound.length
        ? `Przejrzano ${revs.length} ${plural(revs.length, 'wersję', 'wersje', 'wersji')} pliku. Zaznacz, co przywrócić:`
        : `Przejrzano ${revs.length} ${plural(revs.length, 'wersję', 'wersje', 'wersji')} pliku – nie znalazłem spisów ani programów, których teraz brakuje.`;
    } catch (e) {
      st.textContent = 'Nie udało się odczytać historii pliku.';
      handleError(e);
    }
  }
  // Do porównania: nazwa bez wielkości liter, polskich znaków i znaków przestankowych („Śpiewnik 2 - niebieski” = „Śpiewnik 2 Niebieski”)
  const nameKey = (x) => Catalog.norm(x || '').replace(/[^a-z0-9]+/g, '');
  const hasNotes = (it) => (it.state === 'ok' || it.state === 'auto') && (it.files || []).length > 0;
  function paintHistory() {
    const on = new Set([...$('hs-list').querySelectorAll('input:checked')].map((x) => x.value)); // domyślnie nic nie zaznaczone
    const del = data.deleted || {};
    $('hs-list').innerHTML = histFound.map((h, i) => {
      const o = h.obj;
      const isBook = h.kind === 'book';
      const songs = isBook ? (o.items || []) : (o.parts || []).flatMap((p) => p.items || []);
      const what = isBook
        ? `spis pieśni${o.code ? ' ' + esc(o.code) : ''} · ${songs.length} ${plural(songs.length, 'pozycja', 'pozycje', 'pozycji')}, z nutami ${songs.filter(hasNotes).length}`
        : `program uroczystości${o.date ? ' · ' + esc(o.date) : ''} · ${songs.length} ${plural(songs.length, 'pieśń', 'pieśni', 'pieśni')}`;
      const now = (isBook ? data.songbooks : data.programs).filter((x) => nameKey(x.name) === nameKey(o.name));
      const notes = [];
      if (del[o.id]) notes.push(`<span class="warn-text">Usunięty w aplikacji ${esc(fmtDate(del[o.id]))} – raczej celowo.</span>`);
      if (now.length) {
        const x = now[0];
        const xs = isBook ? (x.items || []) : (x.parts || []).flatMap((p) => p.items || []);
        notes.push(`<span class="warn-text">⚠ Masz już ${isBook ? 'spis' : 'program'} o tej nazwie: „${esc(x.name)}”${isBook ? ` (${xs.length} poz., z nutami ${xs.filter(hasNotes).length})` : ''} – po przywróceniu będą dwa.</span>`);
      }
      return `<li><label><input type="checkbox" value="${i}"${on.has(String(i)) ? ' checked' : ''}>
        <span><b>${esc(o.name || '(bez nazwy)')}</b><span class="muted small">${what} · ${isBook && o.importedAt ? `wczytany ${esc(fmtDate(o.importedAt))} · ` : ''}ostatnio w wersji z ${esc(fmtDate(h.at))}</span>
        ${notes.map((n) => `<span class="small">${n}</span>`).join('')}</span></label></li>`;
    }).join('');
    $('hs-ok').disabled = !histFound.length;
  }
  function restoreHistory() {
    const pick = [...$('hs-list').querySelectorAll('input:checked')].map((x) => histFound[+x.value]).filter(Boolean);
    if (!pick.length) return toast('Zaznacz, co przywrócić.');
    let books = 0;
    let progs = 0;
    const at = new Date().toISOString();
    for (const h of pick) {
      const list = h.kind === 'book' ? data.songbooks : data.programs;
      if (list.some((x) => x.id === h.obj.id)) continue;
      const o = { ...h.obj, restoredAt: at }; // znacznik: widać w spisach, że przywrócony; łączenie danych go nie wyrzuci
      if (h.kind === 'book') {
        if (!o.code || data.songbooks.some((x) => x.code === o.code)) o.code = nextCode(data.songbooks);
        books++;
      } else progs++;
      list.push(o);
      if (data.deleted) delete data.deleted[o.id];
    }
    $('hist-dlg').close();
    changed();
    renderAll();
    const parts = [];
    if (books) parts.push(`${books} ${plural(books, 'spis', 'spisy', 'spisów')}`);
    if (progs) parts.push(`${progs} ${plural(progs, 'program', 'programy', 'programów')}`);
    toast(parts.length ? `Przywrócono: ${parts.join(' i ')}. Mają dopisek „przywrócony z historii” – jeśli to pomyłka, usuń je przyciskiem „Usuń spis” / „Usuń”.` : 'Nic nie przywrócono (już są).');
  }
  $('btn-history').addEventListener('click', openHistory);
  $('hs-cancel').addEventListener('click', () => $('hist-dlg').close());
  $('hs-ok').addEventListener('click', restoreHistory);

  // ---------- wersja testowa (KN_CONFIG.env) ----------
  // Pasek „WERSJA TESTOWA” i kopiowanie danych z produkcji. Plik produkcji tylko CZYTAMY –
  // zapis idzie zawsze do własnego pliku testowego (cfg.dataFileName), w folderze testowym.
  async function copyFromProd() {
    if (!(await ensureConnected())) return;
    try {
      const f = await Drive.findDataFile(cfg.prodDataFileName);
      if (!f) return toast(`Nie znaleziono na Dysku pliku „${cfg.prodDataFileName}” głównej aplikacji.`, true);
      const when = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('pl-PL') : '?';
      if (!confirm(`Zastąpić dane wersji testowej kopią danych z głównej aplikacji (zapisanych ${when})?\n\n` +
        'Obecne dane testowe zostaną nadpisane. Główna aplikacja i jej plik zostają bez zmian.\n' +
        'Publikacja dla chórzystów zaczyna się w teście od nowa (osobny folder i katalog), PIN zostaje.')) return;
      const d = normalize(await Drive.readJson(f.id));
      // z publikacji zostaje tylko to, co nie wskazuje na pliki produkcji (folder, katalog, kopie, PDF-y)
      const p = d.publish || {};
      d.publish = { pin: p.pin, hold: p.hold || {}, ...(p.others ? { others: { enabled: p.others.enabled } } : {}) };
      // zgłoszenia z testu nie mogą trafiać do prawdziwego formularza
      if (d.reports) d.reports = { ...d.reports, form: {} };
      d.owner = (user && user.emailAddress) || d.owner;
      d.updatedAt = Date.now();
      data = d;
      sync.dirty = true;
      persist();
      rebuild();
      renderAll();
      scheduleSync(300);
      toast('Skopiowano dane z głównej aplikacji do wersji testowej.');
    } catch (e) {
      handleError(e);
    }
  }
  if (cfg.env) {
    $('test-bar').hidden = false;
    if (cfg.prodUrl) $('test-prod').href = cfg.prodUrl;
    $('test-copy').addEventListener('click', copyFromProd);
  }

  // wspólne funkcje dla pozostałych modułów (spisy pieśni)
  window.App = {
    get data() { return data; },
    get idx() { return idx; },
    changed, toast, handleError, ensureConnected, markDeleted, openPicker, renderTree, esc, plural, stripExt, cleanCode, nextCode,
    orderFiles, openOrder, songKey, openRotate, openEdit, showTab, afterFlags, setMeta, flagTag, renderAll, GHOST,
  };

  // ---------- zdarzenia ----------
  $('btn-connect').addEventListener('click', () => { ensureConnected(); });
  $('btn-disconnect').addEventListener('click', () => {
    Drive.disconnect();
    user = null;
    renderAll();
    toast('Rozłączono z Dyskiem. Dane zostają w tym urządzeniu.');
  });
  $('btn-add-folder').addEventListener('click', () => openPicker('folder'));
  $('btn-scan').addEventListener('click', doScan);
  $('btn-welcome-start').addEventListener('click', () => openPicker('folder'));
  $('root-list').addEventListener('click', (e) => {
    const rf = e.target.closest('[data-refresh]');
    if (rf) return refreshFolder(rf.dataset.refresh);
    const b = e.target.closest('[data-rm]');
    if (b) removeRoot(b.dataset.rm);
  });

  $('picker-list').addEventListener('click', (e) => {
    const b = e.target.closest('.pick-item');
    if (!b) return;
    if (b.classList.contains('pick-doc')) {
      $('picker').close();
      if (pickDoc) pickDoc({ id: b.dataset.id, name: b.dataset.name, mimeType: b.dataset.mime });
      return;
    }
    pickStack.push({ id: b.dataset.id, name: b.dataset.name });
    loadPicker();
  });
  $('crumbs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-depth]');
    if (!b) return;
    pickStack = pickStack.slice(0, Number(b.dataset.depth) + 1);
    loadPicker();
  });
  $('btn-pick').addEventListener('click', pickCurrent);
  $('btn-pick-cancel').addEventListener('click', () => $('picker').close());

  let qTimer = null;
  $('q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { ui.query = e.target.value; renderTree(); }, 150);
  });
  $('filter').addEventListener('change', (e) => { ui.filter = e.target.value; renderTree(); });
  $('btn-expand').addEventListener('click', () => {
    Object.values(data.nodes).forEach((n) => { if (n.folder) ui.expanded.add(n.id); });
    saveExpanded();
    renderTree();
  });
  $('btn-export').addEventListener('click', exportList);
  $('btn-collapse').addEventListener('click', () => {
    ui.expanded.clear();
    saveExpanded();
    renderTree();
  });

  const tree = $('tree');
  const toggleFolder = (row) => {
    if (tree.classList.contains('filtering')) return;
    const id = row.dataset.id;
    if (ui.expanded.has(id)) ui.expanded.delete(id);
    else ui.expanded.add(id);
    saveExpanded();
    renderTree();
  };
  tree.addEventListener('click', (e) => {
    const gh = e.target.closest('[data-ghost]');
    if (gh) return toggleIgnore(gh.dataset.ghost);
    const rf = e.target.closest('[data-refresh]');
    if (rf) return refreshFolder(rf.dataset.refresh);
    const row = e.target.closest('.row');
    if (!row) return;
    if (row.classList.contains('folder')) return toggleFolder(row);
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'edit') openEdit(row.dataset.id);
    else if (act.dataset.act === 'order') {
      const ids = siblingsMap()[row.dataset.id] || [row.dataset.id];
      const n = data.nodes[row.dataset.id];
      const m = data.meta[row.dataset.id];
      openOrder(ids, ((m && m.title) || stripExt(n.name)).replace(/[\s_\-.(]*(str\.?|strona)?\s*\d+\)?\s*$/i, '').trim() || undefined);
    }
    else if (act.dataset.act === 'save') {
      const inp = row.querySelector('.name-input');
      commitEdit(row.dataset.id, inp ? inp.value : '');
    }
  });
  // „Zapisz” musi zadziałać zanim pole straci fokus
  tree.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-act="save"]')) e.preventDefault();
  });
  tree.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('name-input')) {
      const id = e.target.closest('.row').dataset.id;
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(id, e.target.value); }
      else if (e.key === 'Escape') { ui.editing = null; renderTree(); }
      return;
    }
    const row = e.target.closest('.row.folder');
    if (e.target.closest('[data-refresh]')) return;
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleFolder(row); }
  });
  tree.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('name-input') || committing) return;
    const row = e.target.closest('.row');
    if (row && ui.editing === row.dataset.id) commitEdit(row.dataset.id, e.target.value);
  });

  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });

  // ---------- tryb administratora: blokada, wylogowanie, widok chórzysty ----------
  const ADMIN_KEY = 'kn-admin';
  const isLocked = () => document.documentElement.classList.contains('admin-locked');

  async function loadLocal() {
    data = normalize(await Store.get('data'));
    const s = await Store.get('sync');
    if (s && typeof s === 'object') sync = { ...sync, ...s };
    loadExpanded();
    rebuild();
    renderAll();
  }

  // Po zalogowaniu: zapamiętujemy urządzenie jako administratorskie i otwieramy zakładki.
  async function unlock() {
    try {
      const a = await Drive.about();
      const email = a.user && a.user.emailAddress;
      if (!email) throw new Error('Nie udało się odczytać konta Google.');
      try { localStorage.setItem(ADMIN_KEY, email); } catch (e) { /* trudno */ }
      document.documentElement.classList.remove('admin-locked');
      await loadLocal();
      onConnected();
    } catch (e) {
      handleError(e);
    }
  }

  async function logout() {
    if (sync.dirty && Drive.isConnected()) await pushNow(); // najpierw spróbuj zapisać zmiany na Dysku
    const msg = 'Wylogować z trybu administratora na tym urządzeniu?\n\n' +
      'Dane w tym urządzeniu zostaną usunięte. Na Twoim Dysku Google wszystko zostaje i wróci po ponownym zalogowaniu.' +
      (sync.dirty ? '\n\nUWAGA: część zmian nie jest zapisana na Dysku i zostanie utracona. Żeby je zachować, kliknij Anuluj i połącz się z Dyskiem.' : '');
    if (!confirm(msg)) return;
    Drive.disconnect();
    await NoteView.clearAdmin(); // nuty z Dysku otwierane w podglądzie
    await Store.set('data', null);
    await Store.set('sync', null);
    ['kn-admin', 'kn-email', 'kn-expanded', 'kn-tab', 'kn-songbook'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* trudno */ } });
    location.reload();
  }

  function toGuest() {
    const id = cfg.publicCatalogId || (data.publish && data.publish.catalogId);
    if (!id) return toast('Najpierw opublikuj śpiewniki w zakładce „Dla chórzystów”.', true);
    Guest.enter(id);
  }

  $('btn-unlock').addEventListener('click', () => { ensureConnected(); });
  $('btn-lock-guest').addEventListener('click', toGuest);
  $('btn-to-guest').addEventListener('click', toGuest);
  $('btn-logout').addEventListener('click', logout);

  // ---------- start ----------
  (async () => {
    if (document.documentElement.dataset.mode === 'guest') return; // chórzysta nie loguje się do Google
    Drive.onChange((connected) => {
      if (connected && isLocked()) return unlock();
      renderAccount();
      renderSync();
      if (connected) onConnected();
    });
    if (!isLocked()) await loadLocal();
    await Drive.init();
    if (Drive.isConnected()) {
      if (isLocked()) unlock();
      else onConnected();
    }
  })();
})();
