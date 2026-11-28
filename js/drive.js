// Połączenie z Dyskiem Google: logowanie (Google Identity Services) i wywołania Drive API.
window.Drive = (() => {
  'use strict';
  const cfg = window.KN_CONFIG;
  const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly', // przeglądanie folderów z nutami
    'https://www.googleapis.com/auth/drive.file', // zapis pliku z danymi i gotowych PDF-ów
  ];
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER = 'application/vnd.google-apps.folder';
  const SHORTCUT = 'application/vnd.google-apps.shortcut';
  const TOKEN_KEY = 'kn-token';
  const HINT_KEY = 'kn-email';

  let token = null;
  let expiresAt = 0;
  let client = null;
  let waiter = null;
  const listeners = new Set();

  class AuthError extends Error {
    constructor() { super('Połącz się z Dyskiem Google.'); this.name = 'AuthError'; }
  }

  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.expiresAt > Date.now() + 60000) { token = t.token; expiresAt = t.expiresAt; }
  } catch (e) { /* brak */ }

  const isConnected = () => !!token && Date.now() < expiresAt - 30000;
  const emit = () => listeners.forEach((f) => f(isConnected()));
  const onChange = (f) => listeners.add(f);

  function saveToken() {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt }));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* trudno */ }
  }

  function loadGis() {
    return new Promise((resolve, reject) => {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Nie udało się wczytać logowania Google (brak internetu?).'));
      document.head.appendChild(s);
    });
  }

  function fail(err) {
    if (waiter) { waiter.reject(err); waiter = null; }
  }

  function onToken(r) {
    if (r.error) return fail(new Error(r.error_description || r.error));
    if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES)) {
      return fail(new Error('Zaznacz w oknie Google wszystkie uprawnienia – bez nich aplikacja nie zobaczy nut.'));
    }
    token = r.access_token;
    expiresAt = Date.now() + (Number(r.expires_in) || 3600) * 1000;
    saveToken();
    if (waiter) { waiter.resolve(); waiter = null; }
    emit();
    // przypomnienie o wygaśnięciu połączenia
    setTimeout(emit, Math.max(0, expiresAt - Date.now() - 25000));
  }

  function onError(e) {
    const msg = {
      popup_closed: 'Zamknięto okno logowania.',
      popup_failed_to_open: 'Przeglądarka zablokowała okno logowania – zezwól na wyskakujące okna dla tej strony.',
    }[e && e.type] || 'Nie udało się zalogować do Google.';
    fail(new Error(msg));
  }

  // Wczytujemy logowanie Google od razu, bo okno logowania musi się otworzyć
  // bezpośrednio po kliknięciu (inaczej przeglądarka je zablokuje).
  async function init() {
    try {
      await loadGis();
      let hint = '';
      try { hint = localStorage.getItem(HINT_KEY) || ''; } catch (e) { /* brak */ }
      client = google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: SCOPES.join(' '),
        login_hint: hint || undefined,
        callback: onToken,
        error_callback: onError,
      });
    } catch (e) {
      console.warn(e);
    }
  }

  function connect() {
    return new Promise((resolve, reject) => {
      if (!client) {
        init();
        reject(new Error('Logowanie Google jeszcze się wczytuje – spróbuj za chwilę.'));
        return;
      }
      if (waiter) waiter.reject(new Error('Przerwano poprzednie logowanie.'));
      waiter = { resolve, reject };
      client.requestAccessToken({ prompt: '' });
    });
  }

  function disconnect() {
    token = null;
    expiresAt = 0;
    saveToken();
    emit();
  }

  function rememberEmail(email) {
    try { localStorage.setItem(HINT_KEY, email); } catch (e) { /* trudno */ }
  }

  async function api(url, opts = {}) {
    if (!isConnected()) throw new AuthError();
    const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    if (r.status === 401) {
      disconnect();
      throw new AuthError();
    }
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).error.message; } catch (e) { /* brak */ }
      const err = new Error(`Błąd Dysku Google (${r.status})${msg ? ': ' + msg : ''}`);
      err.status = r.status;
      throw err;
    }
    return r;
  }

  const qs = (p) => new URLSearchParams(p).toString();

  async function listAll(params, fields) {
    const out = [];
    let pageToken = '';
    do {
      const p = { fields: `nextPageToken,files(${fields})`, pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true, ...params };
      if (pageToken) p.pageToken = pageToken;
      const r = await (await api(`${API}/files?${qs(p)}`)).json();
      out.push(...(r.files || []));
      pageToken = r.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  const esc = (id) => String(id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const ITEM = 'id,name,mimeType,size,modifiedTime,md5Checksum,shortcutDetails(targetId,targetMimeType)';

  // wszystkie elementy folderu (do skanowania)
  const listChildren = (folderId) =>
    listAll({ q: `'${esc(folderId)}' in parents and trashed=false`, corpora: 'allDrives' }, ITEM);

  // same podfoldery (do wybierania folderów), łącznie ze skrótami do folderów
  async function listFolders(parentId) {
    let items;
    if (parentId === 'shared') {
      items = await listAll({ q: `sharedWithMe and mimeType='${FOLDER}' and trashed=false` }, ITEM);
    } else {
      items = await listAll({
        q: `'${esc(parentId)}' in parents and trashed=false and (mimeType='${FOLDER}' or mimeType='${SHORTCUT}')`,
        corpora: 'allDrives',
      }, ITEM);
    }
    return items
      .map((f) => (f.mimeType === SHORTCUT
        ? (f.shortcutDetails && f.shortcutDetails.targetMimeType === FOLDER ? { id: f.shortcutDetails.targetId, name: f.name } : null)
        : { id: f.id, name: f.name }))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true, sensitivity: 'base' }));
  }

  // podfoldery i pliki spisów (.odt, .docx, .txt, Dokumenty Google) – do wyboru pliku spisu
  async function listFoldersAndDocs(parentId) {
    const q = parentId === 'shared'
      ? `sharedWithMe and trashed=false`
      : `'${esc(parentId)}' in parents and trashed=false`;
    const items = await listAll(parentId === 'shared' ? { q } : { q, corpora: 'allDrives' }, ITEM);
    const folders = [];
    const docs = [];
    for (const f of items) {
      let mime = f.mimeType;
      let id = f.id;
      if (mime === SHORTCUT && f.shortcutDetails) { mime = f.shortcutDetails.targetMimeType; id = f.shortcutDetails.targetId; }
      if (mime === FOLDER) folders.push({ id, name: f.name });
      else if (mime === 'application/vnd.google-apps.document' || /\.(odt|docx|txt)$/i.test(f.name)) docs.push({ id, name: f.name, mimeType: mime });
    }
    const by = (a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true, sensitivity: 'base' });
    return { folders: folders.sort(by), docs: docs.sort(by) };
  }

  // metadane jednego pliku/folderu (np. prawdziwe położenie celu skrótu)
  const meta = async (id, fields) => (await api(`${API}/files/${encodeURIComponent(id)}?${qs({ fields, supportsAllDrives: true })}`)).json();

  async function download(id) {
    return (await api(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).arrayBuffer();
  }

  async function exportText(id) {
    return (await api(`${API}/files/${encodeURIComponent(id)}/export?mimeType=text/plain`)).text();
  }

  // arkusz Google jako CSV (odpowiedzi z formularza zgłoszeń)
  async function exportCsv(id) {
    return (await api(`${API}/files/${encodeURIComponent(id)}/export?mimeType=text/csv`)).text();
  }

  async function listSharedDrives() {
    try {
      const r = await (await api(`${API}/drives?${qs({ pageSize: 100, fields: 'drives(id,name)' })}`)).json();
      return r.drives || [];
    } catch (e) {
      if (e instanceof AuthError) throw e;
      return [];
    }
  }

  async function about() {
    return (await api(`${API}/about?fields=user(displayName,emailAddress,photoLink)`)).json();
  }

  // name – inny plik (wersja testowa czyta tak plik produkcji, tylko do odczytu)
  async function findDataFile(name) {
    const files = await listAll({
      q: `name='${esc(name || cfg.dataFileName)}' and 'me' in owners and trashed=false`,
      orderBy: 'modifiedTime desc',
      corpora: 'user',
    }, 'id,name,modifiedTime,parents');
    return files[0] || null;
  }

  // Jedyny folder, w którym aplikacja zapisuje (plik z danymi, a później PDF-y i nuty dla gości).
  // Rozpoznajemy go po znaczniku widocznym tylko dla tej aplikacji, więc zmiana nazwy mu nie szkodzi.
  // Foldery aplikacji rozpoznajemy po znaczniku widocznym tylko dla niej (kn=app, kn=public),
  // więc zmiana nazwy czy przeniesienie im nie szkodzi.
  const tagged = {};
  async function ensureTaggedFolder(tag, name, parentId, description) {
    if (cfg.env) tag = cfg.env + '-' + tag; // wersja testowa: własne foldery (kn=test-app, kn=test-public)
    if (tagged[tag]) return tagged[tag];
    const found = await listAll({
      q: `appProperties has { key='kn' and value='${tag}' } and mimeType='${FOLDER}' and trashed=false`,
      corpora: 'user',
    }, 'id,name');
    if (found[0]) return (tagged[tag] = found[0].id);
    const r = await (await api(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER, appProperties: { kn: tag }, description, ...(parentId ? { parents: [parentId] } : {}) }),
    })).json();
    return (tagged[tag] = r.id);
  }

  // Jedyny folder, w którym aplikacja zapisuje (plik z danymi, folder dla chórzystów).
  const ensureAppFolder = () => ensureTaggedFolder('app', cfg.appFolderName || 'Kamienickie Nutki', null,
    'Folder aplikacji Kamienickie Nutki – tu zapisuje ona swoje pliki. Twoich nut aplikacja nie zmienia.');

  // Folder z kopiami nut dla chórzystów – dostępny dla każdego, kto ma link.
  async function ensurePublicFolder() {
    const app = await ensureAppFolder();
    return ensureTaggedFolder('public', 'Dla chórzystów', app,
      'Kopie nut udostępnione chórzystom przez aplikację Kamienickie Nutki. Zawartość zmienia aplikacja przy publikacji.');
  }

  async function makePublic(id) {
    return (await api(`${API}/files/${encodeURIComponent(id)}/permissions?supportsAllDrives=true&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    })).json();
  }

  async function copyFile(id, name, parentId) {
    return (await api(`${API}/files/${encodeURIComponent(id)}/copy?supportsAllDrives=true&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, parents: [parentId] }),
    })).json();
  }

  // Wgrywa plik (np. PDF śpiewnika); z existingId podmienia treść istniejącego pliku.
  async function uploadFile(name, mime, data, parentId, existingId) {
    if (existingId) {
      try {
        return await (await api(`${UPLOAD}/files/${encodeURIComponent(existingId)}?uploadType=media&fields=id,size`, {
          method: 'PATCH', headers: { 'Content-Type': mime }, body: data,
        })).json();
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
    const boundary = 'kn' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, mimeType: mime, parents: [parentId] });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      data,
      `\r\n--${boundary}--`,
    ]);
    return (await api(`${UPLOAD}/files?uploadType=multipart&fields=id,size`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    })).json();
  }

  async function deleteFile(id) {
    try {
      await api(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'DELETE' });
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }

  // Odczyt pliku udostępnionego publicznie – bez logowania, kluczem API (tryb chórzysty).
  async function publicText(id) {
    const r = await fetch(`${API}/files/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(cfg.apiKey)}`, { cache: 'no-store' });
    if (!r.ok) {
      const err = new Error(r.status === 404 ? 'Nie znaleziono śpiewnika – poproś o nowy link.' : `Błąd pobierania (${r.status}).`);
      err.status = r.status;
      throw err;
    }
    return r.text();
  }

  // Przenosi plik utworzony przez aplikację do jej folderu (np. plik z danymi z wcześniejszej wersji).
  async function moveInto(id, folderId, parents) {
    const p = { addParents: folderId, fields: 'id,parents' };
    const old = (parents || []).filter((x) => x !== folderId);
    if (old.length) p.removeParents = old.join(',');
    return (await api(`${API}/files/${encodeURIComponent(id)}?${qs(p)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })).json();
  }

  async function readJson(id) {
    return (await api(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).json();
  }

  // historia wersji pliku z danymi (Dysk trzyma starsze wersje ok. 30 dni / do 100 wersji)
  async function revisions(id) {
    const r = await (await api(`${API}/files/${encodeURIComponent(id)}/revisions?${qs({ fields: 'revisions(id,modifiedTime,size)', pageSize: 1000 })}`)).json();
    return r.revisions || [];
  }
  async function readRevision(id, revId) {
    return (await api(`${API}/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revId)}?alt=media`)).json();
  }

  async function createJson(name, text, parentId) {
    const boundary = 'kn' + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, mimeType: 'application/json', description: 'Dane aplikacji Kamienickie Nutki – nie usuwaj.', ...(parentId ? { parents: [parentId] } : {}) }) +
      `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
    return (await api(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })).json();
  }

  async function updateJson(id, text) {
    return (await api(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: text,
    })).json();
  }

  return {
    FOLDER, SHORTCUT, AuthError,
    init, connect, disconnect, isConnected, onChange, rememberEmail,
    about, meta, listChildren, listFolders, listFoldersAndDocs, listSharedDrives, download, exportText, exportCsv,
    findDataFile, readJson, revisions, readRevision, createJson, updateJson, ensureAppFolder, moveInto,
    ensurePublicFolder, makePublic, copyFile, uploadFile, deleteFile, publicText,
  };
})();
