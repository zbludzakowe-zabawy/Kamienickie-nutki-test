// Szyfrowanie katalogu dla chórzystów PIN-em (AES-GCM, klucz z PBKDF2).
// Bez PIN-u nie da się odczytać listy pieśni ani adresów nut.
window.KnCrypto = (() => {
  'use strict';
  const ITER = 150000;
  const enc = new TextEncoder();
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function key(pin, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encrypt(obj, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pin, salt), enc.encode(JSON.stringify(obj))));
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return { kn: 'catalog', v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: btoa(bin) };
  }

  // Zwraca obiekt albo null, gdy PIN jest zły.
  async function decrypt(env, pin) {
    if (!env || env.kn !== 'catalog') throw new Error('To nie jest plik śpiewnika Kamienickich Nutek.');
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await key(pin, unb64(env.salt)), unb64(env.data));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) {
      return null;
    }
  }

  return { encrypt, decrypt };
})();
