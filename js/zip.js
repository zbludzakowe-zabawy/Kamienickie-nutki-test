// Odczyt jednego pliku z archiwum ZIP (np. content.xml z .odt, word/document.xml z .docx).
window.Zip = (() => {
  'use strict';

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Ta przeglądarka nie umie rozpakować pliku – użyj aktualnego Chrome, Edge, Firefoxa lub Safari.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readEntry(buffer, wanted) {
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    // koniec katalogu centralnego (szukamy od końca)
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('To nie jest prawidłowy plik .odt/.docx.');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const csize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commLen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      if (name === wanted) {
        const lName = view.getUint16(local + 26, true);
        const lExtra = view.getUint16(local + 28, true);
        const start = local + 30 + lName + lExtra;
        const data = u8.subarray(start, start + csize);
        const out = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
        if (!out) throw new Error('Nieobsługiwany sposób kompresji pliku.');
        return new TextDecoder('utf-8').decode(out);
      }
      p += 46 + nameLen + extraLen + commLen;
    }
    return null;
  }

  return { readEntry };
})();
