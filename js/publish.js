// Administrator: publikacja dla chórzystów (kopie nut, PDF śpiewników, katalog zaszyfrowany PIN-em).
window.Publish = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = window.App;
  const esc = A.esc;
  let busy = false;
  let problems = [];

  const P = () => {
    const d = A.data;
    if (!d.publish || typeof d.publish !== 'object') d.publish = {};
    const p = d.publish;
    if (p.pin == null) p.pin = '2018';
    p.copies = p.copies || {};
    p.pdfs = p.pdfs || {};
    p.hold = p.hold || {}; // {id: true} – pole „przygotuj” przy PDF odznaczone: przy „Przygotuj PDF-y” ten PDF zostaje, jaki jest
    return p;
  };
  const usable = (it) => (it.state === 'ok' || it.state === 'auto') && it.files.length > 0;
  const extOf = (name) => (String(name).match(/\.[a-z0-9]{2,5}$/i) || [''])[0];
  const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp' };
  const mimeOf = (name) => MIME[extOf(name).slice(1).toLowerCase()] || 'application/octet-stream';

  function neededIds() {
    const ids = new Set();
    for (const b of allBooks()) for (const it of b.items) if (usable(it)) it.files.forEach((f) => { if (A.data.nodes[f]) ids.add(f); });
    const o = P().others;
    if (o && o.enabled !== false && o.snapshot) o.snapshot.forEach((it) => it.files.forEach((f) => { if (A.data.nodes[f]) ids.add(f); }));
    if (W().enabled !== false) worksNow().forEach((w) => w.files.forEach((f) => ids.add(f)));
    return ids;
  }

  // ---------- katalog nut dla chórzystów ----------
  // Utwory z zakładki „Katalog” (bez „nieistotnych” i „to nie nuty”) – chórzysta tylko wyszukuje, filtruje i ogląda nuty.
  const WORKS_KEY = '__works';
  const W = () => {
    const p = P();
    if (!p.works || typeof p.works !== 'object') p.works = { enabled: true };
    return p.works;
  };
  const cmpPl = (a, b) => a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' });
  function worksNow() {
    if (window.Works) Works.sync();
    const c = A.data.catalog;
    if (!c || !c.works) return [];
    const nodes = A.data.nodes;
    const fl = (id) => Catalog.flagOf(nodes, A.data.meta, id);
    const ign = (id) => { const f = fl(id); return f === 'ignore' || f === 'ignoreDir'; };
    const refs = {};
    for (const b of A.data.songbooks) {
      b.items.forEach((it) => {
        if (it.state !== 'ok' && it.state !== 'auto') return;
        (it.files || []).forEach((id) => { (refs[id] = refs[id] || []).push({ b, it }); });
      });
    }
    const tagName = {};
    (c.tags || []).forEach((t) => { tagName[t.id] = t.name; });
    const out = [];
    for (const w of Object.values(c.works)) {
      const files = (w.files || []).filter((id) => nodes[id] && !nodes[id].folder && fl(id) !== 'notes');
      if (!files.length || files.every(ign)) continue;
      const seen = new Set();
      const rs = [];
      const alt = new Set();
      files.forEach((id) => (refs[id] || []).forEach(({ b, it }) => {
        const k = (b.code || b.name) + (it.no ? ' ' + it.no : '');
        if (!seen.has(k)) { seen.add(k); rs.push(k); }
        [it.title, ...(it.alt || [])].forEach((t) => { if (t && t !== w.title) alt.add(t); });
      }));
      out.push({
        title: w.title || '(bez tytułu)',
        ...(alt.size ? { alt: [...alt] } : {}),
        lyrics: w.lyrics || '',
        music: w.music || '',
        tags: (w.tags || []).filter((t) => tagName[t]),
        refs: rs,
        files,
      });
    }
    out.sort((a, b) => cmpPl(a.title, b.title));
    return out;
  }
  const worksTags = (items) => {
    const used = new Set(items.flatMap((w) => w.tags));
    return ((A.data.catalog && A.data.catalog.tags) || []).filter((t) => used.has(t.id)).map((t) => ({ id: t.id, name: t.name }));
  };
  const worksSig = (items) => (W().enabled === false ? Promise.resolve('off') : hash(JSON.stringify([worksTags(items),
    items.map((w) => [w.title, w.alt || [], w.lyrics, w.music, w.tags, w.refs, w.files.map((f) => [f, A.data.nodes[f] && A.data.nodes[f].modified, rotOf(f)])])])));
  function worksCatalog() {
    if (W().enabled === false) return null;
    const p = P();
    const items = worksNow();
    return {
      tags: worksTags(items),
      items: items.map((w) => ({ ...w, files: w.files.map((f) => p.copies[f] && p.copies[f].id).filter(Boolean) })).filter((w) => w.files.length),
    };
  }
  function worksRow() {
    const off = W().enabled === false;
    const n = off ? 0 : worksNow().length;
    const st = status.works;
    const label = !st ? '' : off ? (st.state === 'ok' ? '<span class="muted small">ukryty</span>' : '<span class="pub-state changed">● do ukrycia – kliknij „Aktualizuj listy”</span>')
      : STATE_LABEL[st.state];
    return `<li class="pub-others">
      <span class="pub-cell"><strong><span class="badge doc">KATALOG</span> Katalog nut</strong>
        <span class="muted small">Wszystkie nuty z zakładki „Katalog” (bez nieistotnych)${off ? '' : ` – teraz ${n} ${A.plural(n, 'utwór', 'utwory', 'utworów')}`}.
          Chórzysta wyszukuje, filtruje po cechach i ogląda nuty. Aktualizujesz razem z listami.</span>
        <label class="check small"><input type="checkbox" data-w="enabled"${off ? '' : ' checked'}${busy ? ' disabled' : ''}> widoczny dla chórzystów</label></span>
      <span class="pub-cell"><span class="lbl">Lista w aplikacji</span>${label}</span>
      <span class="pub-cell"><span class="lbl">PDF</span><span class="muted small">— bez PDF</span></span>
    </li>`;
  }

  // ---------- śpiewnik „Pozostałe nuty” ----------
  // U administratora zawsze aktualny (Dups.othersItems). Chórzyści widzą „migawkę” zrobioną przyciskiem
  // „Aktualizuj Pozostałe nuty”; PDF tylko na wyraźne żądanie („Utwórz PDF”).
  const OTHERS_ID = 'others';
  const OTHERS_NAME = 'Pozostałe nuty';
  const othersNow = () => (window.Dups ? Dups.othersItems() : []);
  const othersSig = (items) => JSON.stringify(items.map((it) => [it.title, it.files]));
  const O = () => {
    const p = P();
    if (!p.others) p.others = { enabled: true };
    return p.others;
  };

  // Programy uroczystości jako „śpiewniki” do PDF: nagłówki części + pieśni (z uwagą w nawiasie).
  const programs = () => (window.Programs ? Programs.forPublish() : []);
  const programBooks = () => programs().map((pr) => ({
    id: pr.id,
    name: pr.name,
    subtitle: pr.date ? Programs.fmtDate(pr.date) : 'Program uroczystości',
    items: pr.parts.filter((pt) => pt.items.length).flatMap((pt) => [{ section: true, title: pt.name },
      ...pt.items.map((it) => ({ no: '', title: it.note ? `${it.title} (${it.note})` : it.title, state: 'ok', files: it.files }))]),
  }));
  const allBooks = () => [...A.data.songbooks, ...programBooks()];
  const held = (id) => !!P().hold[id];
  // czy chórzyści dostają nieaktualny PDF (lista zmieniona, PDF jeszcze nie przebudowany)
  const staleOf = (id) => !!(status.books[id] && status.books[id].pdf === 'stale');

  async function hash(text) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const rotOf = (id) => (A.data.meta[id] && A.data.meta[id].rot) || 0;
  // „podpis” śpiewnika – PDF budujemy od nowa tylko, gdy coś się w nim zmieniło
  // Wersja wyglądu PDF – podbij, gdy zmienia się sposób składania PDF (np. linki w spisie treści),
  // wtedy wszystkie śpiewniki pokażą „są zmiany” i PDF-y zbudują się od nowa.
  const PDF_FORMAT = 2;
  const sig = (b) => hash(JSON.stringify([PDF_FORMAT, b.name, b.subtitle || '', b.items.map((it) => (it.section ? ['§', it.title] : usable(it)
    ? [it.no, it.title, it.files.map((f) => [f, A.data.nodes[f] && A.data.nodes[f].modified, rotOf(f)]), ...(it.alt ? [it.alt] : [])]
    : [it.no, it.title]))]));

  function othersCatalog() {
    const p = P();
    const o = O();
    if (o.enabled === false || !o.snapshot || !o.snapshot.length) return [];
    return [{
      id: OTHERS_ID,
      name: OTHERS_NAME,
      auto: true,
      at: o.at,
      pdf: o.pdf ? o.pdf.id : null,
      pdfSize: o.pdf ? o.pdf.size : 0,
      pdfAt: o.pdf ? o.pdf.at : null,
      items: o.snapshot.map((it) => ({ no: '', title: it.title, files: it.files.map((f) => p.copies[f] && p.copies[f].id).filter(Boolean) })),
    }];
  }

  function othersRow() {
    const o = O();
    const now = othersNow();
    const fresh = o.snapshot && othersSig(o.snapshot) === othersSig(now);
    const off = o.enabled === false;
    const state = !o.snapshot ? '<span class="pub-state new">● jeszcze nie udostępniona</span>'
      : fresh ? '<span class="pub-state ok">✓ aktualna</span>' : '<span class="pub-state changed">● lista się zmieniła</span>';
    const d = (iso) => new Date(iso).toLocaleDateString('pl-PL');
    return `<li class="pub-others">
      <span class="pub-cell"><strong><span class="badge doc">AUTO</span> ${OTHERS_NAME}</strong>
        <span class="muted small">Nuty nieprzypisane do żadnego spisu, alfabetycznie – teraz ${now.length} ${A.plural(now.length, 'utwór', 'utwory', 'utworów')}.
          Aktualizujesz osobno, przyciskami obok.</span>
        <label class="check small"><input type="checkbox" data-o="enabled"${off ? '' : ' checked'}> widoczny dla chórzystów</label></span>
      <span class="pub-cell"><span class="lbl">Lista w aplikacji</span>${off ? '<span class="muted small">ukryty</span>' : state}
        ${o.snapshot && !off ? `<span class="muted small">u chórzystów: ${o.snapshot.length} (stan na ${d(o.at)})</span>` : ''}
        <span><button class="btn small" data-o="update"${busy || off ? ' disabled' : ''}>Aktualizuj listę</button></span></span>
      <span class="pub-cell"><span class="lbl">PDF</span>${o.pdf ? `<span class="muted small">${o.pdf.pages} str., stan na ${d(o.pdf.at)}</span>` : '<span class="muted small">brak PDF</span>'}
        <span><button class="btn small" data-o="pdf"${busy || off || (!o.snapshot && !now.length) ? ' disabled' : ''}>${o.pdf ? 'Utwórz PDF od nowa' : 'Utwórz PDF'}</button></span></span>
    </li>`;
  }

  function catalog() {
    const p = P();
    const works = worksCatalog();
    return {
      v: 1,
      at: new Date().toISOString(),
      songbooks: A.data.songbooks.map((b) => {
        const pdf = p.pdfs[b.id];
        return {
          id: b.id,
          name: b.name,
          code: b.code || '',
          pdf: pdf ? pdf.id : null,
          pdfSize: pdf ? pdf.size : 0,
          pdfAt: pdf ? pdf.at : null,
          stale: !!pdf && staleOf(b.id),
          items: b.items.map((it) => ({
            no: it.no,
            title: it.title,
            ...(it.alt && it.alt.length ? { alt: it.alt } : {}),
            files: usable(it) ? it.files.map((f) => p.copies[f] && p.copies[f].id).filter(Boolean) : [],
          })),
        };
      }).concat(othersCatalog()),
      ...(works ? { works } : {}),
      // formularz zgłoszeń od chórzystów (adres wysyłki i pole) – tylko gdy ustawiony
      ...(window.Reports && Reports.target() ? { report: Reports.target() } : {}),
      programs: programs().map((pr) => {
        const pdf = p.pdfs[pr.id];
        return {
          id: pr.id,
          name: pr.name,
          date: pr.date,
          pdf: pdf ? pdf.id : null,
          pdfSize: pdf ? pdf.size : 0,
          pdfAt: pdf ? pdf.at : null,
          stale: !!pdf && staleOf(pr.id),
          parts: pr.parts.map((pt) => ({
            name: pt.name,
            items: pt.items.map((it) => ({ title: it.title, note: it.note, files: it.files.map((f) => p.copies[f] && p.copies[f].id).filter(Boolean) })),
          })),
        };
      }),
    };
  }

  async function writeCatalog(folder) {
    const p = P();
    const text = JSON.stringify(await KnCrypto.encrypt(catalog(), p.pin));
    if (p.catalogId) {
      try {
        await Drive.updateJson(p.catalogId, text);
        return;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
    const f = await Drive.createJson('spiewniki-dla-chorzystow.json', text, folder);
    p.catalogId = f.id;
  }

  // ---------- co się zmieniło od ostatniej publikacji ----------
  // Lista (szybko) i PDF (wolno) mają osobne stany.
  // Lista: 'new' – jeszcze nie opublikowana, 'changed' – są zmiany, 'ok' – chórzyści mają aktualną wersję (p.sigs).
  // PDF: 'none' – śpiewnik bez nut, 'missing' – nie ma PDF, 'stale' – PDF starszy niż śpiewnik, 'ok' – aktualny (p.pdfs[id].sig).
  let status = { books: {}, removed: [], any: false, pdfTodo: 0, pdfOff: 0 };
  async function computeStatus() {
    const p = P();
    const books = allBooks();
    const st = { books: {}, removed: [], any: false, pdfTodo: 0, pdfOff: 0 };
    for (const b of books) {
      const s = await sig(b);
      const prev = (p.sigs && p.sigs[b.id]) || (p.pdfs[b.id] && p.pdfs[b.id].sig);
      const v = !prev ? 'new' : prev !== s ? 'changed' : 'ok';
      const cur = p.pdfs[b.id];
      const pdf = !b.items.some(usable) ? 'none' : !cur ? 'missing' : cur.sig !== s ? 'stale' : 'ok';
      const h = held(b.id);
      st.books[b.id] = { state: v, sig: s, name: b.name, pdf, held: h };
      if (v !== 'ok') st.any = true;
      if (pdf === 'missing' || pdf === 'stale') { st.pdfOff++; if (!h) st.pdfTodo++; }
    }
    const ws = await worksSig(W().enabled === false ? [] : worksNow());
    const wprev = p.sigs && p.sigs[WORKS_KEY];
    st.works = { sig: ws, state: !wprev ? (ws === 'off' ? 'ok' : 'new') : wprev !== ws ? 'changed' : 'ok' };
    if (st.works.state !== 'ok') st.any = true;
    const ids = new Set(books.map((b) => b.id));
    st.removed = (p.published || []).filter((id) => !ids.has(id));
    if (st.removed.length || !p.catalogId) st.any = true;
    return st;
  }
  let statusRun = 0;
  function refreshStatus() {
    const run = ++statusRun;
    computeStatus().then((st) => {
      if (run !== statusRun) return;
      status = st;
      paint();
    }).catch(() => undefined);
  }

  function markPublished() {
    const p = P();
    p.at = new Date().toISOString();
    p.sigs = {};
    for (const [id, x] of Object.entries(status.books)) p.sigs[id] = x.sig;
    if (status.works) p.sigs[WORKS_KEY] = status.works.sig;
    p.published = Object.keys(status.books);
    delete p.dataAt;
    A.changed();
  }

  function step(text, frac) {
    $('pub-status').textContent = text;
    if (frac != null) $('pub-bar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  }

  async function publish(opts = {}) {
    if (busy) return;
    if (!allBooks().length && !opts.others && W().enabled === false) return A.toast('Najpierw wczytaj spis pieśni albo utwórz program uroczystości.', true);
    if (!(await A.ensureConnected())) return;
    busy = true;
    problems = [];
    render();
    const p = P();
    try {
      status = await computeStatus();
      const updated = Object.values(status.books).filter((x) => x.state !== 'ok').map((x) => x.name);
      if (status.works && status.works.state !== 'ok') updated.push('Katalog nut');
      const same = Object.values(status.books).filter((x) => x.state === 'ok').map((x) => x.name);
      const pdfDone = [];
      step('Przygotowanie folderu dla chórzystów…', 0.02);
      const folder = await Drive.ensurePublicFolder();
      if (p.folderId !== folder || !p.folderPublic) {
        await Drive.makePublic(folder);
        p.folderId = folder;
        p.folderPublic = true;
      }

      // 1. kopie nut (tylko nowe i zmienione)
      const need = neededIds();
      const todo = [...need].filter((id) => !p.copies[id] || p.copies[id].modified !== A.data.nodes[id].modified || (p.copies[id].rot || 0) !== rotOf(id));
      let i = 0;
      for (const id of todo) {
        step(`Kopiowanie nut dla chórzystów… ${++i} z ${todo.length}`, 0.05 + 0.35 * (i / todo.length));
        const n = A.data.nodes[id];
        const own = A.data.meta[id] && A.data.meta[id].title;
        const name = own ? own + extOf(n.name) : n.name;
        let copy;
        const rot = rotOf(id);
        let rotDone = 0;
        if (rot) { // obrócony plik: pobieramy, obracamy i wgrywamy jako kopię
          try {
            const r = await PdfBuild.rotate(new Uint8Array(await Drive.download(id)), rot);
            copy = await Drive.uploadFile(A.stripExt(name) + r.ext, r.mime, new Blob([r.bytes], { type: r.mime }), folder);
            rotDone = rot;
          } catch (e) {
            if (e instanceof Drive.AuthError) throw e;
            problems.push(`${own || n.name}: nie udało się obrócić (np. format HEIC) – chórzyści zobaczą oryginał`);
          }
        }
        if (!copy) {
          try {
            copy = await Drive.copyFile(id, name, folder);
          } catch (e) {
            if (e instanceof Drive.AuthError) throw e;
            copy = await Drive.uploadFile(name, mimeOf(n.name), await Drive.download(id), folder); // gdy kopiowanie niedozwolone
          }
        }
        const old = p.copies[id];
        p.copies[id] = { id: copy.id, modified: n.modified || null, rot: rotDone || (rot ? rot : 0) };
        if (old) await Drive.deleteFile(old.id).catch(() => undefined);
        if (i % 10 === 0) A.changed();
      }
      for (const [id, c] of Object.entries(p.copies)) {
        if (need.has(id)) continue;
        await Drive.deleteFile(c.id).catch(() => undefined);
        delete p.copies[id];
      }
      A.changed();

      // 2. PDF-y śpiewników – tylko przyciskiem „Przygotuj PDF-y” (zaznaczone i nieaktualne)
      const books = allBooks();
      for (const b of books) { // PDF śpiewnika, w którym nie ma już nut – usuwamy (to szybkie)
        if (p.pdfs[b.id] && !b.items.some(usable)) { await Drive.deleteFile(p.pdfs[b.id].id).catch(() => undefined); delete p.pdfs[b.id]; }
      }
      if (opts.pdfs) {
        const cache = new Map();
        const getBytes = async (fid) => {
          if (!cache.has(fid)) {
            let u8 = new Uint8Array(await Drive.download(fid));
            if (rotOf(fid)) u8 = await PdfBuild.rotate(u8, rotOf(fid)).then((r) => r.bytes).catch(() => u8);
            cache.set(fid, u8);
          }
          return cache.get(fid);
        };
        for (let bi = 0; bi < books.length; bi++) {
          const b = books[bi];
          const cur = p.pdfs[b.id];
          if (held(b.id) || !b.items.some(usable)) continue; // odznaczony – PDF zostaje taki, jaki jest
          const s = await sig(b);
          if (cur && cur.sig === s) continue;
          const base = 0.4 + 0.5 * (bi / books.length);
          step(`PDF „${b.name}”: pobieranie nut…`, base);
          const res = await PdfBuild.build(b, getBytes, (d, t) => step(`PDF „${b.name}”: ${d} z ${t} pieśni`, base + (0.5 / books.length) * (d / t)));
          step(`PDF „${b.name}”: wysyłanie na Dysk…`);
          const up = await Drive.uploadFile(`${b.name}.pdf`, 'application/pdf', new Blob([res.bytes], { type: 'application/pdf' }), folder, cur && cur.id);
          p.pdfs[b.id] = { id: up.id, sig: s, size: res.bytes.length, pages: res.pages, at: new Date().toISOString() };
          problems.push(...res.problems.map((x) => `${b.name}: ${x}`));
          pdfDone.push(b.name);
          A.changed();
        }
      }
      for (const id of Object.keys(p.pdfs)) {
        if (books.find((b) => b.id === id)) continue;
        await Drive.deleteFile(p.pdfs[id].id).catch(() => undefined);
        delete p.pdfs[id];
      }

      // 2b. PDF „Pozostałych nut” – tylko na żądanie
      if (opts.othersPdf && O().snapshot && O().snapshot.length) {
        step('PDF „Pozostałe nuty”: pobieranie nut…', 0.85);
        const bytesOf = async (fid) => {
          let u8 = new Uint8Array(await Drive.download(fid));
          if (rotOf(fid)) u8 = await PdfBuild.rotate(u8, rotOf(fid)).then((r) => r.bytes).catch(() => u8);
          return u8;
        };
        const ob = { id: OTHERS_ID, name: OTHERS_NAME, subtitle: `Stan na ${new Date(O().at).toLocaleDateString('pl-PL')}`, items: O().snapshot.map((it) => ({ ...it, no: '', state: 'ok' })) };
        const res = await PdfBuild.build(ob, bytesOf, (d, t) => step(`PDF „Pozostałe nuty”: ${d} z ${t}`, 0.85 + 0.1 * (d / t)));
        const cur = O().pdf;
        const up = await Drive.uploadFile(`${OTHERS_NAME}.pdf`, 'application/pdf', new Blob([res.bytes], { type: 'application/pdf' }), folder, cur && cur.id);
        O().pdf = { id: up.id, size: res.bytes.length, pages: res.pages, at: O().at };
        problems.push(...res.problems.map((x) => `${OTHERS_NAME}: ${x}`));
        A.changed();
      }

      // 3. katalog dla chórzystów
      step('Zapisywanie spisów dla chórzystów…', 0.96);
      await writeCatalog(folder);
      markPublished();
      status = await computeStatus();
      const summary = (opts.others ? `Zaktualizowano „${OTHERS_NAME}”${opts.othersPdf ? ' (z PDF)' : ''}. ` : '') +
        (opts.pdfs ? (pdfDone.length ? `Nowe PDF-y: ${pdfDone.join(', ')}. ` : 'Żaden PDF nie wymagał przygotowania. ') : '') +
        (updated.length ? `Listy pieśni zaktualizowane: ${updated.join(', ')}.` : opts.others || opts.pdfs ? '' : 'Listy pieśni nie wymagały aktualizacji.') +
        (same.length && !opts.pdfs ? ` Bez zmian: ${same.join(', ')}.` : '') +
        (status.removed.length ? ` Usunięto u chórzystów: ${status.removed.length}.` : '') +
        (!opts.pdfs && status.pdfOff ? ` PDF-y do przygotowania: ${status.pdfOff} – chórzyści widzą przy nich „PDF może być nieaktualny”.` : '');
      step(summary, 1);
      A.toast(problems.length
        ? `Gotowe. Do PDF nie udało się dołączyć ${problems.length} ${A.plural(problems.length, 'pozycji', 'pozycji', 'pozycji')} – lista poniżej.`
        : opts.others ? `Zaktualizowano „${OTHERS_NAME}” u chórzystów${opts.othersPdf ? ' razem z PDF' : ''}.`
          : opts.pdfs ? (pdfDone.length ? `Gotowe PDF-y: ${pdfDone.join(', ')}.` : 'Gotowe.')
            : updated.length ? `Zaktualizowano listy pieśni: ${updated.join(', ')}.` : 'Gotowe.', problems.length > 0);
    } catch (e) {
      A.changed();
      A.handleError(e);
      step('Przerwano – kliknij przycisk ponownie, aplikacja dokończy od miejsca przerwania.');
    } finally {
      busy = false;
      render();
    }
  }

  async function savePin() {
    const v = $('pub-pin').value.trim();
    if (!/^\d{4,8}$/.test(v)) return A.toast('PIN musi mieć od 4 do 8 cyfr.', true);
    const p = P();
    if (v === p.pin) return A.toast('PIN bez zmian.');
    p.pin = v;
    A.changed();
    if (!p.catalogId) return A.toast(`Zapisano PIN ${v}. Zacznie obowiązywać po publikacji.`);
    if (!(await A.ensureConnected())) return A.toast('Zapisano PIN, ale chórzyści dostaną go dopiero po połączeniu z Dyskiem i publikacji.', true);
    try {
      await writeCatalog(p.folderId);
      A.toast(`Nowy PIN ${v} obowiązuje. Chórzyści zostaną o niego poproszeni.`);
    } catch (e) {
      A.handleError(e);
    }
  }

  const link = () => `${location.origin}${location.pathname}?chor=${encodeURIComponent(P().catalogId)}`;

  function render() {
    paint();
    if (!busy) refreshStatus();
  }

  const STATE_LABEL = {
    ok: '<span class="pub-state ok">✓ aktualna</span>',
    changed: '<span class="pub-state changed">● są zmiany – do aktualizacji</span>',
    new: '<span class="pub-state new">● nowa – jeszcze nie opublikowana</span>',
  };
  const day = (iso) => new Date(iso).toLocaleDateString('pl-PL');

  function pdfCell(b, st) {
    const pdf = P().pdfs[b.id];
    const info = pdf ? `${pdf.pages} str., ${(pdf.size / 1048576).toFixed(1)} MB, z ${day(pdf.at)}` : '';
    if (!st) return info ? `<span class="muted small">${info}</span>` : '';
    if (st.pdf === 'none') return '<span class="muted small">— brak nut, PDF niepotrzebny</span>';
    if (st.pdf === 'ok') return `<span class="pub-state ok">✓ aktualny</span><span class="muted small">${info}</span>`;
    const label = st.pdf === 'missing' ? '<span class="pub-state new">● brak PDF</span>'
      : `<span class="pub-state changed">● nieaktualny</span><span class="muted small">${info} – chórzyści widzą „PDF może być nieaktualny”</span>`;
    return `${label}<label class="check small" title="Zaznaczone PDF-y przygotujesz przyciskiem „Przygotuj PDF-y”.">
      <input type="checkbox" data-hold${st.held ? '' : ' checked'}${busy ? ' disabled' : ''}> przygotuj ten PDF</label>`;
  }

  function paint() {
    const p = P();
    if (document.activeElement !== $('pub-pin')) $('pub-pin').value = p.pin;
    const all = allBooks();
    const head = '<li class="pub-head"><span>Śpiewnik / program</span><span>Lista w aplikacji</span><span>PDF</span></li>';
    $('pub-books').innerHTML = all.length
      ? head + all.map((b) => {
        const songs = b.items.filter((it) => !it.section);
        const have = songs.filter(usable).length;
        const kind = b.subtitle ? '<span class="badge doc">PROGRAM</span> ' : '';
        const st = status.books[b.id];
        const isBook = !b.subtitle;
        return `<li data-id="${esc(b.id)}">
          <span class="pub-cell"><strong>${kind}${esc(b.name)}${isBook && b.code ? ` <span class="muted" title="Identyfikator – zmienisz go w „Spisach pieśni”">[${esc(b.code)}]</span>` : ''}</strong>
            <span class="muted small">${b.subtitle ? esc(b.subtitle) + ' · ' : ''}${have} z ${songs.length} ${A.plural(songs.length, 'pozycji', 'pozycji', 'pozycji')} z nutami</span></span>
          <span class="pub-cell"><span class="lbl">Lista w aplikacji</span>${st ? STATE_LABEL[st.state] : ''}</span>
          <span class="pub-cell"><span class="lbl">PDF</span>${pdfCell(b, st)}</span></li>`;
      }).join('')
      : '<li class="muted pub-empty">Brak spisów i programów – wczytaj spis w zakładce „Spisy pieśni” albo utwórz program w „Uroczystościach”.</li>';
    $('pub-books').insertAdjacentHTML('beforeend', worksRow() + othersRow());
    const known = Object.keys(status.books).length === all.length;
    const listTodo = Object.values(status.books).filter((x) => x.state !== 'ok').length + status.removed.length + (status.works && status.works.state !== 'ok' ? 1 : 0);
    const upToDate = !!p.catalogId && !status.any && known;
    $('pub-go').disabled = busy || (!all.length && !(status.works && status.works.state !== 'ok')) || upToDate;
    $('pub-go').textContent = !p.catalogId ? 'Opublikuj listy dla chórzystów' : upToDate ? '✓ Listy aktualne' : `Aktualizuj listy (${listTodo})`;
    $('pub-force').hidden = !upToDate || busy;
    $('pub-list-sum').innerHTML = !known ? '' : !p.catalogId ? '<span class="warn-text">Jeszcze nic nie opublikowano.</span>'
      : listTodo ? `<span class="warn-text">Do aktualizacji: ${listTodo}</span>` : '<span class="ok-text">✓ Chórzyści mają aktualne listy</span>';
    $('pub-pdf-go').disabled = busy || !known || !status.pdfTodo;
    $('pub-pdf-go').textContent = !known ? 'Przygotuj PDF-y' : status.pdfOff ? `Przygotuj zaznaczone PDF-y (${status.pdfTodo})` : '✓ PDF-y aktualne';
    $('pub-pdf-sum').innerHTML = !known ? '' : status.pdfOff
      ? `<span class="warn-text">Nieaktualne lub brakujące: ${status.pdfOff}</span>${status.pdfOff > status.pdfTodo ? ` <span class="muted small">(zaznaczone: ${status.pdfTodo})</span>` : ''}`
      : '<span class="ok-text">✓ Wszystkie PDF-y aktualne</span>';
    $('pub-pin-save').disabled = busy;
    $('pub-progress').hidden = !busy && !$('pub-status').textContent;
    $('pub-bar').parentElement.hidden = !busy;
    $('pub-problems').hidden = !problems.length;
    $('pub-problems').innerHTML = problems.length
      ? `<p><b>Problemy przy aktualizacji</b> (plik uszkodzony lub w nieobsługiwanym formacie, np. HEIC/TIFF):</p><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : '';
    $('pub-link-card').hidden = !p.catalogId;
    $('pub-preview').hidden = !p.catalogId;
    if (p.catalogId) {
      $('pub-link').value = link();
      $('pub-info').textContent = `Ostatnia publikacja: ${new Date(p.at).toLocaleString('pl-PL')}.`;
    }
  }

  $('pub-go').addEventListener('click', () => publish());
  $('pub-books').addEventListener('click', (e) => {
    const b = e.target.closest('[data-o]');
    if (!b || busy) return;
    const o = O();
    if (b.dataset.o === 'update') {
      o.snapshot = othersNow();
      o.at = new Date().toISOString();
      A.changed();
      publish({ others: true });
    } else if (b.dataset.o === 'pdf') {
      if (!o.snapshot) { o.snapshot = othersNow(); o.at = new Date().toISOString(); }
      A.changed();
      publish({ others: true, othersPdf: true });
    }
  });
  $('pub-books').addEventListener('change', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li && e.target.matches('[data-hold]')) {
      if (e.target.checked) delete P().hold[li.dataset.id];
      else P().hold[li.dataset.id] = true;
      A.changed();
      return render();
    }
    if (e.target.matches('[data-w="enabled"]')) {
      W().enabled = e.target.checked;
      A.changed();
      return render(); // zmiana trafi do chórzystów po „Aktualizuj listy”
    }
    if (!e.target.matches('[data-o="enabled"]')) return;
    O().enabled = e.target.checked;
    if (e.target.checked && !O().snapshot) { O().snapshot = othersNow(); O().at = new Date().toISOString(); }
    A.changed();
    if (P().catalogId) publish({ others: true }); // zmiana widoczności = od razu aktualizacja u chórzystów
    else paint();
  });
  $('pub-force').addEventListener('click', () => publish());
  $('pub-pdf-go').addEventListener('click', () => publish({ pdfs: true }));
  $('pub-pin-save').addEventListener('click', savePin);
  $('pub-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePin(); });
  $('pub-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('pub-link').value);
      A.toast('Skopiowano link.');
    } catch (e) {
      $('pub-link').select();
      A.toast('Zaznaczono link – skopiuj go (Ctrl+C).');
    }
  });
  $('pub-preview').addEventListener('click', () => Guest.enter(P().catalogId));

  // zapis samego katalogu (np. po ustawieniu formularza zgłoszeń) – chórzyści dostają zmianę od razu
  async function saveCatalog() {
    const p = P();
    if (!p.catalogId) return false;
    if (!(await A.ensureConnected())) return false;
    await writeCatalog(p.folderId);
    return true;
  }

  return { render, saveCatalog };
})();
