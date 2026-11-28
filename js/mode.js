// Wybór trybu przed narysowaniem strony: chórzysta (link od dyrygenta) albo administrator.
(() => {
  'use strict';
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* trudno */ } };
  const fromLink = new URLSearchParams(location.search).get('chor');
  if (fromLink) {
    put('kn-guest-id', fromLink);
    put('kn-mode', 'guest');
    history.replaceState(null, '', location.pathname + location.hash);
  }
  const cfg = window.KN_CONFIG || {};
  const mode = get('kn-mode') || (fromLink || cfg.publicCatalogId ? 'guest' : 'admin');
  document.documentElement.dataset.mode = mode;
  // tryb administratora otwiera się dopiero po zalogowaniu kontem Google na tym urządzeniu
  if (mode === 'admin' && !get('kn-admin')) document.documentElement.classList.add('admin-locked');
})();
