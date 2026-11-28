// Porządkowanie Dysku: szukanie duplikatów nut + śpiewnik „Pozostałe nuty” (nuty nieprzypisane do żadnego spisu).
// Wyniki i decyzje są w data.dups (zapis w urządzeniu i na Dysku) – do pracy można wracać przez wiele dni.
window.Dups = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = window.App;
  const esc = A.esc;
  const VIEW_KEY = 'kn-dups-view';
  let view = 'open'; // open | done | all
  let query = '';
  try { view = localStorage.getItem(VIEW_KEY) || 'open'; } catch (e) { /* brak */ }

  const TYPE = {
    same: ['IDENTYCZNE PLIKI', 'Te same pliki (identyczna treść) w kilku miejscach na Dysku.'],
    name: ['TA SAMA NAZWA', 'Pliki o tej samej nazwie (Twojej albo nazwie pliku) w różnych folderach.'],
    book: ['RÓŻNE PLIKI W ŚPIEWNIKACH', 'Ta sama pieśń w różnych spisach ma przypisane różne pliki.'],
  };
  const JUNK = new Set(['pdf', 'jpg', 'jpeg', 'png', 'img', 'image', 'dsc', 'skan', 'scan', 'kopia', 'copy', 'str', 'strona', 'page', 'nuty', 'wersja', 'final']);

  const D = () => {
    if (!A.data.dups || typeof A.data.dups !== 'object') A.data.dups = { groups: {} };
    const d = A.data.dups;
    d.groups = d.groups || {};
    if (!d.cleanup) { // lista „do sprzątnięcia” – przeniesienie decyzji z wcześniejszej wersji
      d.cleanup = {};
      for (const [gid, g] of Object.entries(d.groups)) {
        if (g.status !== 'resolved' || g.type === 'book') continue;
        g.files.filter((id) => !(g.keep || []).includes(id)).forEach((id) => addCleanup(d, id, gid, g));
      }
    }
    return d;
  };

  // ---------- lista „Do sprzątnięcia na Dysku” ----------
  // data.dups.cleanup[fileId] = { gid, title, name, own, path, parent, keep:[{id,name,path}], decidedAt, done, doneBy, doneAt }
  // Zapisujemy nazwę i folder w chwili decyzji – po usunięciu pliku z Dysku nadal wiadomo, co to było.
  function addCleanup(d, id, gid, g, manual) {
    const n = A.data.nodes[id];
    if (!n) return;
    const m = A.data.meta[id];
    d.cleanup[id] = {
      gid,
      manual: !!manual, // „🗑 Do wyrzucenia” – oznaczony ręcznie, niezależnie od decyzji w grupie
      title: g.title,
      name: n.name,
      own: (m && m.title) || '',
      path: Catalog.pathOf(A.data.nodes, id),
      parent: n.parent,
      keep: (manual ? [] : g.keep || []).map((k) => ({ id: k, name: A.data.nodes[k] ? A.data.nodes[k].name : k, path: A.data.nodes[k] ? Catalog.pathOf(A.data.nodes, k) : '' })),
      decidedAt: new Date().toISOString(),
      done: false,
    };
  }
  // „zrobione”: odhaczone ręcznie albo pliku nie ma już na Dysku (po skanowaniu)
  const isDone = (c, id) => c.done || !A.data.nodes[id];

  // Po skanowaniu: pliki, których już nie ma, odhaczamy automatycznie.
  function syncCleanup() {
    const d = D();
    let n = 0;
    for (const [id, c] of Object.entries(d.cleanup)) {
      if (!c.done && !A.data.nodes[id]) { c.done = true; c.doneBy = 'auto'; c.doneAt = A.data.scannedAt || new Date().toISOString(); n++; }
    }
    return n;
  }
  // pliki oznaczone „to nie nuty” i „nieistotne” (także w nieistotnym folderze) pomijamy w duplikatach i „Pozostałych nutach”
  const files = () => Object.values(A.data.nodes).filter((n) => !n.folder && !Catalog.flagOf(A.data.nodes, A.data.meta, n.id));
  const titleOf = (id) => {
    const n = A.data.nodes[id];
    const m = A.data.meta[id];
    return (m && m.title) || (n ? A.stripExt(n.name) : id);
  };
  // „Barka 2 (kopia).jpg” → „barka” – klucz nazwy bez numerów stron i dopisków
  const nameKey = (id) => Catalog.norm(titleOf(id)).split(' ').filter((t) => t && !JUNK.has(t) && !/^\d+$/.test(t)).join(' ');
  // Tytuł do wyświetlenia bez numeru strony na końcu („Barka 2” → „Barka”)
  const baseTitle = (id) => titleOf(id).replace(/[\s_\-–.(]*\(?(str\.?|strona|s\.)?\s*\d+\)?\s*$/i, '').trim() || titleOf(id);

  // Pliki „do usunięcia”, które jeszcze są na Dysku i nie zostały odhaczone
  function toRemove() {
    const out = new Set();
    for (const [id, c] of Object.entries(D().cleanup)) if (!isDone(c, id)) out.add(id);
    return out;
  }

  // Gdzie plik jest używany (śpiewniki i programy) – pokazujemy przy duplikatach
  function usage() {
    const map = {};
    const add = (id, txt) => { (map[id] = map[id] || []).push(txt); };
    for (const b of A.data.songbooks) b.items.forEach((it) => { if (it.state === 'ok' || it.state === 'auto') it.files.forEach((id) => add(id, `${b.name}${it.no ? ' nr ' + it.no : ''}`)); });
    for (const p of A.data.programs || []) p.parts.forEach((pt) => pt.items.forEach((it) => (it.files || []).forEach((id) => add(id, `program „${p.name}”`))));
    return map;
  }

  // ---------- szukanie ----------
  function detect(quiet) {
    const all = files();
    const found = {};
    // 1. identyczna treść (md5 z Dysku)
    const byMd5 = {};
    all.forEach((n) => { if (n.md5) (byMd5[n.md5] = byMd5[n.md5] || []).push(n.id); });
    for (const [md5, ids] of Object.entries(byMd5)) if (ids.length > 1) found['m:' + md5] = { type: 'same', title: baseTitle(ids[0]), files: ids };
    // 2. ta sama nazwa w różnych folderach (pliki w jednym folderze różniące się numerem to zwykle strony jednej pieśni)
    const byName = {};
    all.forEach((n) => { const k = nameKey(n.id); if (k.length >= 3) (byName[k] = byName[k] || []).push(n.id); });
    const md5Sets = new Set(Object.values(found).map((g) => [...g.files].sort().join()));
    for (const [k, ids] of Object.entries(byName)) {
      if (ids.length < 2) continue;
      const parents = new Set(ids.map((id) => A.data.nodes[id].parent));
      if (parents.size < 2) continue;
      if (md5Sets.has([...ids].sort().join())) continue;
      found['n:' + k] = { type: 'name', title: baseTitle(ids[0]), files: ids };
    }
    // 3. ta sama pieśń w różnych spisach przypisana do różnych plików
    const bySong = {};
    A.data.songbooks.forEach((b) => b.items.forEach((it, i) => {
      if (!(it.state === 'ok' || it.state === 'auto') || !it.files.length) return;
      const k = Catalog.norm(it.title);
      (bySong[k] = bySong[k] || []).push({ book: b.id, i, sig: [...it.files].sort().join() });
    }));
    for (const [k, list] of Object.entries(bySong)) {
      if (list.length < 2 || new Set(list.map((x) => x.sig)).size < 2) continue;
      const b0 = A.data.songbooks.find((b) => b.id === list[0].book);
      found['b:' + k] = { type: 'book', title: b0.items[list[0].i].title, files: [...new Set(list.flatMap((x) => x.sig.split(',')))], entries: list.map(({ book, i }) => ({ book, i })) };
    }
    // połącz z wcześniejszymi decyzjami
    const old = D().groups;
    const groups = {};
    let reopened = 0;
    for (const [gid, g] of Object.entries(found)) {
      const prev = old[gid];
      if (prev && prev.status !== 'open') {
        const newFiles = g.files.filter((id) => !prev.files.includes(id));
        if (!newFiles.length) { groups[gid] = { ...g, status: prev.status, keep: prev.keep || [], decidedAt: prev.decidedAt }; continue; }
        reopened++;
        groups[gid] = { ...g, status: 'open', keep: [], note: 'Pojawiły się nowe pliki – sprawdź ponownie.' };
        continue;
      }
      groups[gid] = { ...g, status: 'open', keep: [] };
    }
    // rozstrzygnięte grupy zostają w historii, nawet gdy przestały być duplikatem (np. po usunięciu plików albo ujednoliceniu)
    for (const [gid, prev] of Object.entries(old)) {
      if (groups[gid] || prev.status === 'open') continue;
      groups[gid] = { ...prev, gone: true };
    }
    const autoDone = syncCleanup();
    D().groups = groups;
    D().at = new Date().toISOString();
    D().hasMd5 = all.some((n) => n.md5);
    A.changed();
    const open = Object.values(groups).filter((g) => g.status === 'open').length;
    if (quiet) return render();
    if (autoDone) A.toast(`Odhaczono ${autoDone} ${A.plural(autoDone, 'plik usunięty', 'pliki usunięte', 'plików usuniętych')} z Dysku.`);
    A.toast(`Znaleziono ${Object.keys(groups).length} ${A.plural(Object.keys(groups).length, 'grupę', 'grupy', 'grup')} możliwych duplikatów, do przejrzenia: ${open}` +
      (reopened ? ` (w tym ${reopened} ponownie – doszły nowe pliki)` : '') + '.');
    try { localStorage.setItem('kn-dups-hidden', '0'); } catch (e) { /* trudno */ }
    render();
  }

  // ---------- decyzje ----------
  // przepnij śpiewniki i programy z usuwanych plików na zachowany (gdy zachowujemy dokładnie jeden)
  function repoint(fromIds, toId) {
    const from = new Set(fromIds);
    const fix = (arr) => [...new Set(arr.map((id) => (from.has(id) ? toId : id)))];
    let n = 0;
    for (const b of A.data.songbooks) b.items.forEach((it) => { if (it.files.some((id) => from.has(id))) { it.files = fix(it.files); n++; } });
    for (const p of A.data.programs || []) p.parts.forEach((pt) => pt.items.forEach((it) => { if ((it.files || []).some((id) => from.has(id))) { it.files = fix(it.files); n++; } }));
    return n;
  }

  function decide(gid, action, el) {
    const g = D().groups[gid];
    if (!g) return;
    const checked = [...el.querySelectorAll('.dup-file input:checked')].map((c) => c.dataset.id);
    if (action === 'keepSel') {
      if (!checked.length) return A.toast('Zaznacz plik (albo pliki), które mają zostać.');
      g.status = 'resolved';
      g.keep = checked;
      const others = g.files.filter((id) => !checked.includes(id));
      const moved = checked.length === 1 ? repoint(others, checked[0]) : 0;
      const r = toCleanup(gid, g, others);
      A.toast(`Zapisano. Na listę „Do sprzątnięcia” trafiło: ${r.added} ${A.plural(r.added, 'plik', 'pliki', 'plików')}.` +
        (moved ? ` Przepięto ${moved} ${A.plural(moved, 'pozycję', 'pozycje', 'pozycji')} w śpiewnikach i programach na zachowany plik.` : '') + r.warn, !!r.warn);
    } else if (action === 'keepAll') {
      g.status = 'kept';
      g.keep = [...g.files];
      A.toast('Zapisano: zostają wszystkie pliki.');
    } else if (action === 'notDup') {
      g.status = 'kept';
      g.keep = [...g.files];
      A.toast('Zapisano: to nie są duplikaty.');
    } else if (action === 'reopen') {
      g.status = 'open';
      g.keep = [];
      for (const [id, c] of Object.entries(D().cleanup)) if (c.gid === gid && !c.done && !c.manual) delete D().cleanup[id]; // ręczne „do wyrzucenia” zostają
    } else if (action === 'name') {
      const v = el.querySelector('.dup-name').value.trim().replace(/\s+/g, ' ');
      if (!checked.length) return A.toast('Zaznacz pliki, którym chcesz nadać nazwę.');
      if (!v) return A.toast('Wpisz nazwę.');
      checked.forEach((id) => { A.data.meta[id] = { ...(A.data.meta[id] || {}), title: v }; });
      A.toast(`Nadano nazwę „${v}” ${checked.length} ${A.plural(checked.length, 'plikowi', 'plikom', 'plikom')}.`);
    }
    g.decidedAt = new Date().toISOString();
    A.changed();
    render();
    A.renderTree();
  }

  // Pliki zbędne po decyzji → lista sprzątania; nadal używane gdzie indziej (inna pieśń, program) – pomijamy z ostrzeżeniem.
  function toCleanup(gid, g, ids) {
    const use = usage();
    let added = 0;
    const used = [];
    for (const id of ids) {
      if (!A.data.nodes[id]) continue;
      if (use[id]) { used.push(`${titleOf(id)} (${use[id].join(', ')})`); continue; }
      addCleanup(D(), id, gid, g);
      added++;
    }
    const warn = used.length ? ` Nie dodano – nadal używane: ${used.join('; ')}.` : '';
    return { added, warn };
  }

  function useEverywhere(gid, k) {
    const g = D().groups[gid];
    const src = g && g.entries[k];
    const b = src && A.data.songbooks.find((x) => x.id === src.book);
    if (!b) return;
    const filesSel = [...b.items[src.i].files];
    for (const e of g.entries) {
      const bb = A.data.songbooks.find((x) => x.id === e.book);
      const it = bb && bb.items[e.i];
      if (it) { it.files = [...filesSel]; it.state = 'ok'; }
    }
    g.status = 'resolved';
    g.keep = filesSel;
    g.decidedAt = new Date().toISOString();
    // pozostałe wersje są teraz zbędne – na listę sprzątania (chyba że są używane gdzie indziej)
    const r = toCleanup(gid, g, g.files.filter((id) => !filesSel.includes(id)));
    A.changed();
    render();
    A.renderTree();
    A.toast(`Ujednolicono: wszystkie śpiewniki mają teraz te same nuty dla tej pieśni.${r.added ? ` Na listę „Do sprzątnięcia” trafiło: ${r.added} ${A.plural(r.added, 'plik', 'pliki', 'plików')}.` : ''}` + r.warn, !!r.warn);
  }

  // ---------- wyświetlanie ----------
  const fmtSize = (b) => (!b ? '' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const folderUrl = (pid) => (!pid || pid === 'root' ? 'https://drive.google.com/drive/my-drive' : `https://drive.google.com/drive/folders/${encodeURIComponent(pid)}`);

  function fileRow(id, g, use, remove) {
    const n = A.data.nodes[id];
    if (!n) {
      const c = D().cleanup[id];
      return `<div class="dup-file gone muted small">✓ ${c ? `${esc(c.own || c.name)} (${esc(c.path)})` : 'plik'} – usunięty z Dysku</div>`;
    }
    const m = A.data.meta[id];
    const kept = (g.keep || []).includes(id);
    const c = D().cleanup[id];
    // oznaczenie „do usunięcia” (z decyzji albo ręczne „🗑 Do wyrzucenia”) widać zawsze, także w grupie do przejrzenia
    const tag = c ? (c.done ? '<span class="dup-tag keep">✓ zrobione</span>'
      : `<span class="dup-tag del">${c.manual ? 'do wyrzucenia' : 'do usunięcia'}</span> <button class="linklike small" data-a="unmark" data-id="${esc(id)}" title="Usuń z listy „Do sprzątnięcia”">↺ nie wyrzucaj</button>`)
      : g.status === 'resolved' ? (kept ? '<span class="dup-tag keep">zostaje</span>' : '<span class="dup-tag">nadal używany</span>') : '';
    return `<label class="dup-file${remove.has(id) ? ' del' : ''}"><input type="checkbox" data-id="${esc(id)}"${g.status === 'resolved' && kept ? ' checked' : ''}>
      <span class="badge ${n.kind}">${n.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
      <span class="dup-main"><span><b>${esc((m && m.title) || n.name)}</b>${m && m.title ? ` <span class="muted small">${esc(n.name)}</span>` : ''} ${tag}${m && m.rot ? ` <span class="rot-tag">obrócony o ${m.rot}°</span>` : ''}</span>
        <span class="muted small"><a href="${folderUrl(n.parent)}" target="_blank" rel="noopener" title="${n.viaShortcut ? 'Folder ze skrótem do tego pliku (prawdziwy plik leży poza wybranymi folderami)' : 'Otwórz folder na Dysku'}">📁 ${esc(Catalog.pathOf(A.data.nodes, id) || 'Mój dysk')}${n.viaShortcut ? ' (przez skrót)' : ''}</a>${n.viaShortcut && n.real ? ` <span class="muted small">· oryginał: ${esc(n.real)}</span>` : ''}
        · ${fmtSize(n.size)}${n.modified ? ' · ' + new Date(n.modified).toLocaleDateString('pl-PL') : ''}${use[id] ? ' · używany: ' + esc(use[id].join(', ')) : ' · nieużywany'}</span></span>
      <button class="act" data-a="edit" data-id="${esc(id)}" title="Edytuj: nazwa, obrót, „to nie nuty”, „nieistotne”" aria-label="Edytuj plik">✎</button>
      ${Preview.noteBtn(id)}${Preview.driveLink(id)}</label>`;
  }

  // „Nadaj nazwę zaznaczonym (n)” – nazwa trafia tylko do zaznaczonych plików (jednego albo kilku)
  const nameBtn = (n) => `<button class="btn small" data-a="name" title="Nazwa trafi tylko do zaznaczonych plików"${n ? '' : ' disabled'}>Nadaj nazwę zaznaczonym${n ? ` (${n})` : ''}</button>`;

  const trashBtn = (n) => `<button class="btn small" data-a="trash" title="Zaznaczone pliki trafią na listę „Do sprzątnięcia na Dysku” – niezależnie od innych decyzji w grupie"${n ? '' : ' disabled'}>🗑 Do wyrzucenia${n ? ` (${n})` : ''}</button>`;

  // „🗑 Do wyrzucenia” – zaznaczone pliki na listę sprzątania; plik używany w śpiewniku/programie – tylko po potwierdzeniu
  function trash(gid, el) {
    const g = D().groups[gid];
    const ids = [...el.querySelectorAll('.dup-file input:checked')].map((c) => c.dataset.id).filter((id) => A.data.nodes[id]);
    if (!g || !ids.length) return A.toast('Zaznacz plik (albo pliki) do wyrzucenia.');
    const use = usage();
    const used = ids.filter((id) => use[id]);
    if (used.length && !confirm(`Te pliki są nadal używane:\n${used.map((id) => `• ${titleOf(id)} – ${use[id].join(', ')}`).join('\n')}\n\n` +
      'Oznaczyć je mimo to do wyrzucenia? Pamiętaj, żeby w tych śpiewnikach/programach wybrać inne nuty, zanim usuniesz plik z Dysku.')) return;
    ids.forEach((id) => addCleanup(D(), id, gid, g, true));
    A.changed();
    render();
    A.renderTree();
    A.toast(`Na listę „Do sprzątnięcia” trafiło: ${ids.length} ${A.plural(ids.length, 'plik', 'pliki', 'plików')}.`);
  }

  function group(gid, g, use, remove) {
    const [label, help] = TYPE[g.type];
    const status = g.status === 'open' ? '<span class="state check">do przejrzenia</span>'
      : g.status === 'kept' ? '<span class="state have">zostawione</span>' : '<span class="state have">rozstrzygnięte</span>';
    let body;
    let acts;
    if (g.type === 'book' && g.status !== 'open') {
      body = `<p class="muted small">Ujednolicono – we wszystkich śpiewnikach te same nuty. Pozostałe wersje: na liście sprzątania.</p>` +
        g.files.map((id) => fileRow(id, g, use, remove)).join('');
      acts = g.gone ? '' : '<button class="btn small" data-a="reopen">↺ Otwórz ponownie</button>';
    } else if (g.type === 'book') {
      body = g.entries.map((e, k) => {
        const b = A.data.songbooks.find((x) => x.id === e.book);
        const it = b && b.items[e.i];
        if (!it) return '';
        return `<div class="dup-entry"><span><b>${esc(b.name)}</b>${it.no ? ' · nr ' + esc(it.no) : ''}</span>
          <div class="dup-entry-files">${it.files.map((id) => fileRow(id, { ...g, status: 'open' }, use, remove)).join('')}</div>
          <button class="btn small" data-a="useAll" data-k="${k}" title="Użyj tych nut we wszystkich śpiewnikach">Użyj tych wszędzie</button></div>`;
      }).join('');
      acts = g.status === 'open' ? '<button class="btn small" data-a="keepAll">Zostaw różne wersje</button>' : '<button class="btn small" data-a="reopen">↺ Otwórz ponownie</button>';
    } else {
      body = g.files.map((id) => fileRow(id, g, use, remove)).join('');
      acts = (g.status === 'open'
        ? `<button class="btn small primary" data-a="keepSel" title="Zaznaczone zostają, pozostałe oznaczę „do usunięcia”">Zostaw tylko zaznaczone</button>
           <button class="btn small" data-a="keepAll" title="To duplikaty, ale wszystkie mają zostać">Zostaw wszystkie</button>
           <button class="btn small" data-a="notDup">To różne utwory</button>`
        : '<button class="btn small" data-a="reopen">↺ Otwórz ponownie</button>') +
        `<span class="dup-namebox"><input class="dup-name" maxlength="200" placeholder="Nazwa dla zaznaczonych plików" value="${esc(g.title)}" aria-label="Nazwa dla zaznaczonych plików">${nameBtn(g.status === 'resolved' ? (g.keep || []).filter((id) => A.data.nodes[id]).length : 0)}</span>` +
        '<button class="btn small" data-a="order" title="Zaznacz strony jednej pieśni i ustaw ich kolejność">⇅ Kolejność stron zaznaczonych</button>';
    }
    acts += trashBtn(0);
    return `<div class="dup ${g.status}" data-g="${esc(gid)}">
      <div class="dup-head"><b>${esc(g.title)}</b><span class="badge doc" title="${esc(help)}">${label}</span>${status}${g.gone ? '<span class="muted small">· załatwione – nie jest już duplikatem</span>' : ''}${g.decidedAt && g.status !== 'open' ? `<span class="muted small">· decyzja ${new Date(g.decidedAt).toLocaleDateString('pl-PL')}</span>` : ''}</div>
      ${g.note && g.status === 'open' ? `<p class="small warn-text">${esc(g.note)}</p>` : ''}
      <div class="dup-files">${body}</div>
      <div class="dup-acts">${acts}</div></div>`;
  }

  function render() {
    const d = D();
    const has = !!d.at;
    $('btn-dups').disabled = !A.data.scannedAt;
    let hidden = false;
    try { hidden = localStorage.getItem('kn-dups-hidden') === '1'; } catch (e) { /* brak */ }
    $('dups-card').hidden = !has || hidden;
    if (!has || hidden) return;
    const use = usage();
    const remove = toRemove();
    const all = Object.entries(d.groups);
    const nOpen = all.filter(([, g]) => g.status === 'open').length;
    document.querySelectorAll('#dups-filters [data-v]').forEach((b) => {
      b.classList.toggle('active', b.dataset.v === view);
      const n = b.dataset.v === 'open' ? nOpen : b.dataset.v === 'done' ? all.length - nOpen : all.length;
      b.querySelector('b').textContent = n;
    });
    $('dups-info').textContent = `Ostatnie szukanie: ${new Date(d.at).toLocaleString('pl-PL')}.` +
      (d.hasMd5 ? '' : ' Identyczne pliki wykryję po ponownym „Skanuj Dysk” (aplikacja pobierze wtedy „odciski” plików).');
    renderCleanup();
    const words = Catalog.norm(query).split(' ').filter(Boolean);
    const list = all.filter(([, g]) => (view === 'all' || (view === 'open' ? g.status === 'open' : g.status !== 'open')))
      .filter(([, g]) => !words.length || words.every((w) => Catalog.norm(g.title + ' ' + g.files.map(titleOf).join(' ')).includes(w)))
      .sort((a, b) => a[1].title.localeCompare(b[1].title, 'pl', { numeric: true, sensitivity: 'base' }));
    const order = { same: 0, book: 1, name: 2 };
    list.sort((a, b) => order[a[1].type] - order[b[1].type]);
    $('dups-list').innerHTML = list.length ? list.map(([gid, g]) => group(gid, g, use, remove)).join('')
      : `<p class="muted empty">${view === 'open' ? 'Nic do przejrzenia. 🎉' : 'Brak pozycji w tym widoku.'}</p>`;
  }

  // ---------- wyświetlanie listy sprzątania ----------
  const fileUrl = (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
  // wpisy pogrupowane według folderów (do sprzątania folder po folderze)
  function cleanupByFolder(includeDone) {
    const byF = {};
    for (const [id, c] of Object.entries(D().cleanup)) {
      const done = isDone(c, id);
      if (done && !includeDone) continue;
      const k = c.path || 'Mój dysk';
      (byF[k] = byF[k] || { path: k, parent: c.parent, items: [] }).items.push({ id, c, done });
    }
    const list = Object.values(byF).sort((a, b) => a.path.localeCompare(b.path, 'pl', { numeric: true }));
    list.forEach((f) => f.items.sort((a, b) => a.c.name.localeCompare(b.c.name, 'pl', { numeric: true })));
    return list;
  }
  const reason = (c) => (c.manual ? `oznaczony ręcznie do wyrzucenia (grupa „${c.title}”)`
    : `duplikat „${c.title}” – zostaje: ${c.keep.map((k) => `${k.path ? k.path + ' / ' : ''}${k.name}`).join(', ') || '—'}`);

  function renderCleanup() {
    const all = Object.entries(D().cleanup);
    const nDone = all.filter(([id, c]) => isDone(c, id)).length;
    const nTodo = all.length - nDone;
    $('cleanup').hidden = !all.length;
    $('cleanup-count').textContent = `do zrobienia: ${nTodo} · zrobione: ${nDone}`;
    $('cleanup-html').disabled = !nTodo;
    $('cleanup-csv').disabled = !all.length;
    const showDone = $('cleanup-showdone').checked;
    const folders = cleanupByFolder(showDone);
    $('cleanup-list').innerHTML = folders.length ? folders.map((f) => `<div class="cl-folder">
        <a class="cl-folder-name" href="${folderUrl(f.parent)}" target="_blank" rel="noopener" title="Otwórz folder na Dysku">📁 ${esc(f.path)}</a>
        ${f.items.map(({ id, c, done }) => `<div class="cl-item${done ? ' done' : ''}" data-id="${esc(id)}">
          <span class="cl-main"><a href="${fileUrl(id)}" target="_blank" rel="noopener" title="Otwórz na Dysku Google"${done && !A.data.nodes[id] ? ' class="gone"' : ''}>${Preview.DRIVE_ICO} ${esc(c.name)}</a>${c.own && c.own !== A.stripExt(c.name) ? ` <span class="muted small">(${esc(c.own)})</span>` : ''}
            <span class="muted small">${esc(reason(c))}${c.keep[0] ? ` · <a href="${fileUrl(c.keep[0].id)}" target="_blank" rel="noopener" ${Preview.attrs([c.keep[0].id], 0, c.keep[0].name)}><span class="nv-note-ico" aria-hidden="true">♪</span> zobacz zachowany</a>` : ''}</span></span>
          ${done
    ? `<span class="dup-tag keep">${!A.data.nodes[id] ? '✓ usunięty z Dysku' : '✓ zrobione'}</span>${A.data.nodes[id] ? '<button class="btn small" data-c="undo" title="Cofnij odhaczenie">↺</button>' : ''}`
    : '<button class="btn small" data-c="done" title="Odhacz ręcznie (np. plik przeniesiony albo już usunięty)">✓ Zrobione</button>'}
        </div>`).join('')}</div>`).join('')
      : `<p class="muted small">${nTodo ? '' : 'Wszystko posprzątane. 🎉'}</p>`;
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const today = () => new Date().toISOString().slice(0, 10);

  // Strona HTML do sprzątania: foldery z linkami, w każdym pliki do usunięcia (z polem do odhaczania na kartce/ekranie)
  function exportHtml() {
    const folders = cleanupByFolder(false);
    const n = folders.reduce((s, f) => s + f.items.length, 0);
    const h = (s) => esc(s);
    const body = folders.map((f) => `<section><h2><a href="${folderUrl(f.parent)}" target="_blank">📁 ${h(f.path)}</a> <small>(${f.items.length})</small></h2><ul>${
      f.items.map(({ id, c }) => `<li><label><input type="checkbox"> <a href="${fileUrl(id)}" target="_blank">${h(c.name)}</a></label>${c.own && c.own !== A.stripExt(c.name) ? ` <em>(${h(c.own)})</em>` : ''}
        <div class="r">${h(reason(c))}${c.keep[0] ? ` · <a href="${fileUrl(c.keep[0].id)}" target="_blank">zachowany plik ↗</a>` : ''} · decyzja ${new Date(c.decidedAt).toLocaleDateString('pl-PL')}</div></li>`).join('')}</ul></section>`).join('');
    const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Do sprzątnięcia na Dysku – ${today()}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#222}h1{font-size:1.4rem}h2{font-size:1.05rem;margin:22px 0 6px}
a{color:#8c2f39}ul{list-style:none;padding:0;margin:0}li{padding:6px 8px;border-bottom:1px solid #eee}li:has(input:checked){opacity:.45;text-decoration:line-through}
.r{color:#666;font-size:.85rem;margin-left:26px}small{color:#888;font-weight:400}p{color:#555}</style></head><body>
<h1>Kamienickie Nutki – do sprzątnięcia na Dysku</h1>
<p>${n} ${A.plural(n, 'plik', 'pliki', 'plików')} w ${folders.length} ${A.plural(folders.length, 'folderze', 'folderach', 'folderach')} · lista z dnia ${new Date().toLocaleDateString('pl-PL')}.
Otwórz folder (📁), usuń wskazane pliki i odhacz je tutaj. Potem w aplikacji kliknij „Skanuj Dysk” – usunięte pliki odhaczą się same.</p>
${body || '<p>Nic do sprzątania.</p>'}</body></html>`;
    download(`do-sprzatniecia-${today()}.html`, html, 'text/html;charset=utf-8');
    A.toast(`Pobrano listę: ${n} ${A.plural(n, 'plik', 'pliki', 'plików')}.`);
  }

  function exportCsv() {
    const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const lines = ['Folder;Plik;Twoja nazwa;Link do pliku;Link do folderu;Powód;Zostaje plik;Link do zachowanego;Data decyzji;Stan'];
    for (const f of cleanupByFolder(true)) {
      for (const { id, c, done } of f.items) {
        lines.push([q(f.path), q(c.name), q(c.own), q(fileUrl(id)), q(folderUrl(c.parent)), q(`duplikat „${c.title}”`),
          q(c.keep.map((k) => `${k.path ? k.path + ' / ' : ''}${k.name}`).join(', ')), q(c.keep[0] ? fileUrl(c.keep[0].id) : ''),
          q(new Date(c.decidedAt).toLocaleDateString('pl-PL')), q(done ? (A.data.nodes[id] ? 'zrobione' : 'usunięty z Dysku') : 'do zrobienia')].join(';'));
      }
    }
    download(`do-sprzatniecia-${today()}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ---------- śpiewnik „Pozostałe nuty” ----------
  // Nuty nieprzypisane do żadnego spisu (bez plików „do usunięcia”); strony jednej pieśni w tym samym folderze = jedna pozycja.
  function othersItems() {
    const assigned = new Set();
    for (const b of A.data.songbooks) for (const it of b.items) if (it.state === 'ok' || it.state === 'auto') it.files.forEach((id) => assigned.add(id));
    const remove = toRemove();
    const groups = {};
    for (const n of files()) {
      if (assigned.has(n.id) || remove.has(n.id)) continue;
      const k = n.parent + '|' + (nameKey(n.id) || n.id);
      (groups[k] = groups[k] || []).push(n.id);
    }
    return Object.values(groups)
      .map((ids) => {
        ids.splice(0, ids.length, ...A.orderFiles(ids)); // kolejność stron (⇅), inaczej według nazw
        return { no: '', title: ids.length > 1 ? baseTitle(ids[0]) : titleOf(ids[0]), state: 'ok', files: ids };
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'pl', { numeric: true, sensitivity: 'base' }));
  }

  // ---------- zdarzenia ----------
  $('btn-dups').addEventListener('click', () => {
    if (!A.data.scannedAt) return A.toast('Najpierw przeskanuj Dysk.');
    detect();
    $('dups-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('dups-again').addEventListener('click', () => detect());
  $('cleanup-showdone').addEventListener('change', renderCleanup);
  $('cleanup-html').addEventListener('click', exportHtml);
  $('cleanup-csv').addEventListener('click', exportCsv);
  $('cleanup-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    const row = e.target.closest('.cl-item');
    if (!b || !row) return;
    const c = D().cleanup[row.dataset.id];
    if (!c) return;
    if (b.dataset.c === 'done') { c.done = true; c.doneBy = 'manual'; c.doneAt = new Date().toISOString(); }
    else { c.done = false; delete c.doneBy; delete c.doneAt; }
    A.changed();
    render();
    A.renderTree();
  });
  $('dups-hide').addEventListener('click', () => { try { localStorage.setItem('kn-dups-hidden', '1'); } catch (e) { /* trudno */ } render(); });
  $('dups-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    view = b.dataset.v;
    try { localStorage.setItem(VIEW_KEY, view); } catch (err) { /* trudno */ }
    render();
  });
  let qt = null;
  $('dups-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { query = e.target.value; render(); }, 150); });
  $('dups-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    const el = e.target.closest('.dup');
    if (!b || !el) return;
    e.preventDefault();
    if (b.dataset.a === 'edit') return A.openEdit(b.dataset.id);
    if (b.dataset.a === 'trash') return trash(el.dataset.g, el);
    if (b.dataset.a === 'unmark') {
      delete D().cleanup[b.dataset.id];
      A.changed();
      render();
      A.renderTree();
      return A.toast('Plik nie będzie wyrzucony – usunięto go z listy „Do sprzątnięcia”.');
    }
    if (b.dataset.a === 'useAll') return useEverywhere(el.dataset.g, Number(b.dataset.k));
    if (b.dataset.a === 'order') {
      const ids = [...el.querySelectorAll('.dup-file input:checked')].map((c) => c.dataset.id);
      if (ids.length < 2) return A.toast('Zaznacz co najmniej 2 pliki – strony jednej pieśni.');
      return A.openOrder(ids, D().groups[el.dataset.g] && D().groups[el.dataset.g].title);
    }
    decide(el.dataset.g, b.dataset.a, el);
  });
  // licznik zaznaczonych na przycisku „Nadaj nazwę zaznaczonym”
  $('dups-list').addEventListener('change', (e) => {
    if (!e.target.matches('.dup-file input')) return;
    const el = e.target.closest('.dup');
    const n = el ? el.querySelectorAll('.dup-file input:checked').length : 0;
    const b = el && el.querySelector('[data-a="name"]');
    if (b) b.outerHTML = nameBtn(n);
    const t = el && el.querySelector('[data-a="trash"]');
    if (t) t.outerHTML = trashBtn(n);
  });
  $('dups-list').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('dup-name')) { e.preventDefault(); decide(e.target.closest('.dup').dataset.g, 'name', e.target.closest('.dup')); }
  });

  return { render, detect, othersItems, toRemove, titleOf, baseTitle, nameKey };
})();
