// Podgląd nut u administratora (window.Preview) – to samo okienko co u chórzysty (js/noteview.js),
// ale oryginały z Dysku pobierane przez połączenie administratora (Drive.download), więc działa po połączeniu z Dyskiem
// (albo dla nut już raz otwartych – są w pamięci urządzenia, czyszczonej przy „Wyloguj”).
// Ikonki (decyzja użytkownika 2026-11-26): ♪ = podgląd w aplikacji (jak u chórzysty), znaczek Dysku ze strzałką = otwórz na Dysku Google.
// Każdy element z data-nv="id1,id2" (+ data-nv-i = od którego pliku, data-nv-t = tytuł) otwiera podgląd zwykłym kliknięciem;
// linki do Dysku z data-nv (np. „chipy” plików) nadal otwierają Dysk z Ctrl/środkowym przyciskiem.
window.Preview = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const driveUrl = (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
  const DRIVE_ICO = '<svg class="ico-drive" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-drive"/></svg>';

  // przycisk ♪ (ids = jeden plik albo wszystkie strony pieśni)
  const noteBtn = (ids, i = 0, title = '') => {
    ids = [].concat(ids).filter(Boolean);
    if (!ids.length) return '';
    return `<button type="button" class="act nv-note" data-nv="${esc(ids.join(','))}" data-nv-i="${i}" data-nv-t="${esc(title)}" title="Podgląd nut" aria-label="Podgląd nut"><span class="nv-note-ico" aria-hidden="true">♪</span></button>`;
  };
  // znaczek „otwórz na Dysku Google”
  const driveLink = (id, label) => `<a class="act drv" href="${driveUrl(id)}" target="_blank" rel="noopener" title="Otwórz na Dysku Google" aria-label="Otwórz na Dysku Google">${DRIVE_ICO}${label ? `<span>${esc(label)}</span>` : ''}</a>`;
  // atrybuty dla elementu, który ma otwierać podgląd (np. chip pliku)
  const attrs = (ids, i = 0, title = '') => `data-nv="${esc([].concat(ids).filter(Boolean).join(','))}" data-nv-i="${i}" data-nv-t="${esc(title)}"`;

  let cur = null; // { ids, f, title }
  let attached = false;
  function ensure() {
    if (attached) return;
    attached = true;
    NoteView.attach($('a-page'), {
      onSwipe: (d) => go(d),
      load: async (id) => new Blob([await Drive.download(id)]),
    });
  }
  function open(ids, i, title) {
    ids = [].concat(ids).filter(Boolean);
    if (!ids.length) return;
    ensure();
    cur = { ids, f: Math.min(Math.max(0, i || 0), ids.length - 1), title: title || '' };
    const dlg = $('a-viewer');
    if (!dlg.open) dlg.showModal();
    showFile();
  }
  function nameOf(id) {
    const d = window.App && App.data;
    const n = d && d.nodes[id];
    const m = d && d.meta[id];
    return (m && m.title) || (n && n.name) || '';
  }
  // Co pokazać (decyzja użytkownika 2026-11-26: podgląd = to, co widzi chórzysta; oryginał „jak leży” – znaczkiem Dysku):
  // aktualna kopia dla chórzystów → ta kopia (kluczem API, bez połączenia z Dyskiem), „Tak widzą chórzyści”;
  // kopia nieaktualna albo brak → oryginał z obrotem ustawionym w aplikacji (wymaga połączenia).
  function sourceOf(id) {
    const d = App.data;
    const n = d.nodes[id];
    const rot = (d.meta[id] && d.meta[id].rot) || 0;
    const c = d.publish && d.publish.copies && d.publish.copies[id];
    if (c && c.id && (!n || c.modified === n.modified) && (c.rot || 0) === rot) {
      return { state: 'pub', label: 'Tak widzą chórzyści', spec: { id: c.id, load: NoteView.publicLoad } };
    }
    return {
      state: c ? 'stale' : 'none',
      label: c ? 'Chórzyści zobaczą to po „Aktualizuj”' : 'Nie opublikowane u chórzystów',
      spec: { id, ver: (n && n.modified) || '', rot },
    };
  }
  function showFile() {
    const id = cur.ids[cur.f];
    $('a-vname').textContent = cur.title || nameOf(id);
    $('a-vsub').textContent = cur.title && cur.title !== nameOf(id) ? nameOf(id) : '';
    $('a-vnav').hidden = cur.ids.length < 2;
    $('a-vpos').textContent = `${cur.f + 1} / ${cur.ids.length}`;
    $('a-prev').disabled = cur.f === 0;
    $('a-next').disabled = cur.f === cur.ids.length - 1;
    $('a-open').href = driveUrl(id);
    const src = sourceOf(id);
    $('a-state').textContent = src.label;
    $('a-state').className = 'a-state ' + src.state;
    const { spec } = src;
    NoteView.show(spec.id, { openUrl: driveUrl(id), ver: spec.ver, load: spec.load, rot: spec.rot }).then((ok) => {
      if (ok && cur) NoteView.prefetch(cur.ids.filter((x) => x !== id).slice(0, 3).map((x) => sourceOf(x).spec));
    });
    NoteView.focus();
  }
  function go(d) {
    if (!cur) return;
    const f = cur.f + d;
    if (f < 0 || f >= cur.ids.length) return;
    cur.f = f;
    showFile();
  }
  function close() {
    if (!cur) return;
    cur = null;
    if ($('a-viewer').open) $('a-viewer').close();
    // bez blokowania przewijania strony (body.g-viewing): okno jest modalne na cały ekran, a blokada zostawała po otwarciu
    // podglądu z innego okienka (✎, pozycja Katalogu) – potem lista nie przewijała się kółkiem myszy (zgłoszenie 2026-11-27)
    document.body.classList.remove('g-viewing');
    NoteView.reset();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }

  if (document.documentElement.dataset.mode !== 'guest') {
    document.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-nv]');
      if (!el || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
      e.preventDefault();
      e.stopPropagation();
      open(el.dataset.nv.split(','), +el.dataset.nvI || 0, el.dataset.nvT || '');
    }, true);
    $('a-close').addEventListener('click', close);
    $('a-viewer').addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
    $('a-viewer').addEventListener('close', () => { if (cur) close(); });
    $('a-prev').addEventListener('click', () => go(-1));
    $('a-next').addEventListener('click', () => go(1));
    document.addEventListener('keydown', (e) => {
      if (!cur || e.altKey || e.metaKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (!e.ctrlKey && (e.key === '+' || e.key === '=')) NoteView.zoomBy(1.4);
      else if (!e.ctrlKey && e.key === '-') NoteView.zoomBy(1 / 1.4);
    });
  }

  return { open, close, noteBtn, driveLink, attrs, driveUrl, DRIVE_ICO };
})();
