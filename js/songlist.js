// Wczytywanie spisu pieśni z pliku: .odt, .docx, .txt lub Dokument Google (jako tekst).
window.SongList = (() => {
  'use strict';
  const NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  const NS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';

  // Akapity z .odt – z tabulatorami i spacjami tak jak w dokumencie.
  // Wiersz tabeli = jedna linijka: komórki połączone tabulatorem (np. „35<tab>Asperges me”).
  // raw = true: wiersz tabeli zachowuje puste komórki (np. pusta kolumna „część mszy” = ta sama część co wyżej)
  function odtLines(xml, raw) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const lines = [];
    const textOf = (el) => {
      let s = '';
      for (const ch of el.childNodes) {
        if (ch.nodeType === 3) s += ch.nodeValue;
        else if (ch.nodeType === 1) {
          if (ch.namespaceURI === NS_TEXT && ch.localName === 'tab') s += '\t';
          else if (ch.namespaceURI === NS_TEXT && ch.localName === 's') s += ' '.repeat(Number(ch.getAttributeNS(NS_TEXT, 'c')) || 1);
          else if (ch.namespaceURI === NS_TEXT && ch.localName === 'line-break') s += '\n';
          else if (ch.namespaceURI === NS_TEXT && (ch.localName === 'note' || ch.localName === 'annotation')) continue;
          else s += textOf(ch);
        }
      }
      return s;
    };
    // cały tekst komórki (może mieć kilka akapitów) w jednej linii
    const cellText = (cell) => {
      const parts = [];
      const w = (el) => {
        for (const ch of el.children) {
          if (ch.namespaceURI === NS_TEXT && (ch.localName === 'p' || ch.localName === 'h')) parts.push(textOf(ch).replace(/\s+/g, ' ').trim());
          else w(ch);
        }
      };
      w(cell);
      return parts.filter(Boolean).join(' ');
    };
    const walk = (el) => {
      for (const ch of el.children) {
        if (ch.namespaceURI === NS_TABLE && ch.localName === 'table-row') {
          const all = [...ch.children].filter((c) => c.namespaceURI === NS_TABLE && c.localName === 'table-cell').map(cellText);
          const cells = raw ? all : all.filter(Boolean);
          if (cells.some(Boolean)) lines.push(cells.join('\t'));
        } else if (ch.namespaceURI === NS_TEXT && (ch.localName === 'p' || ch.localName === 'h')) lines.push(...textOf(ch).split('\n'));
        else walk(ch);
      }
    };
    walk(doc.documentElement);
    return lines;
  }

  // .docx: akapity; wiersz tabeli (w:tr) = jedna linijka z komórkami połączonymi tabulatorem
  function docxLines(xml, raw) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const lines = [];
    const paraText = (p) => {
      let s = '';
      const w = (el) => {
        for (const ch of el.children) {
          if (ch.namespaceURI !== NS_W) continue;
          if (ch.localName === 't') s += ch.textContent;
          else if (ch.localName === 'tab') s += '\t';
          else if (ch.localName === 'br') s += '\n';
          else if (ch.localName !== 'p') w(ch);
        }
      };
      w(p);
      return s;
    };
    const cellText = (tc) => [...tc.getElementsByTagNameNS(NS_W, 'p')].map((p) => paraText(p).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    const walk = (el) => {
      for (const ch of el.children) {
        if (ch.namespaceURI !== NS_W) continue;
        if (ch.localName === 'tr') {
          const all = [...ch.children].filter((c) => c.namespaceURI === NS_W && c.localName === 'tc').map(cellText);
          const cells = raw ? all : all.filter(Boolean);
          if (cells.some(Boolean)) lines.push(cells.join('\t'));
        } else if (ch.localName === 'p') lines.push(...paraText(ch).split('\n'));
        else walk(ch);
      }
    };
    walk(doc.documentElement);
    return lines;
  }

  // „12<tab>Tytuł”, „12. Tytuł”, „12) Tytuł” albo „Tytuł ....... 12”
  function parseLine(raw) {
    const line = raw.replace(/ /g, ' ').trim();
    if (!line) return null;
    let m = line.match(/^(\d{1,4}[a-zA-Z]?)(?:[.)\]:]|\s*[-–—]\s|\t|\s)\s*(.+)$/);
    if (m && /\p{L}/u.test(m[2])) return { no: m[1], title: m[2].replace(/\s+/g, ' ').trim() };
    m = line.match(/^(.*\p{L}.*?)(?:\s*\t\s*|\s*[.…·_]{2,}\s*|\s{2,})(\d{1,4}[a-zA-Z]?)$/u);
    if (m) return { no: m[2], title: m[1].replace(/\s+/g, ' ').trim() };
    if (/\p{L}/u.test(line)) return { no: '', title: line.replace(/\s+/g, ' ') };
    return null;
  }

  // Czy dwa tytuły to ta sama pieśń pod inną nazwą, np. „Aniele Boży (Do Anioła Stróża)” i „Do Anioła Stróża (Aniele Boży)”?
  // Porównujemy zbiory słów (bez nawiasów i kolejności) – wspólnych co najmniej 60%.
  function sameSong(a, b) {
    const set = (t) => new Set(Catalog.norm(t).split(' ').filter((w) => w.length > 1));
    const A = set(a);
    const B = set(b);
    if (!A.size || !B.size) return false;
    let common = 0;
    A.forEach((w) => { if (B.has(w)) common++; });
    return common / Math.max(A.size, B.size) >= 0.6;
  }

  // Pozycje spisu. Powtórzenia (np. druga strona/tabela alfabetycznie) są pomijane.
  // Gdy pod tym samym numerem jest drugi tytuł tej samej pieśni – zapisujemy go jako tytuł alternatywny (alt).
  // Różne pieśni z tym samym numerem (np. kilka na jednej stronie) zostają osobnymi pozycjami.
  function parse(lines) {
    const items = [];
    let dup = 0;
    let aliases = 0;
    const parsed = lines.map(parseLine).filter(Boolean);
    const numbered = parsed.filter((p) => p.no).length;
    // gdy większość linii ma numery, linie bez numeru to nagłówki (np. „Spis treści”) – pomijamy je
    const useNumbers = numbered >= parsed.length * 0.6;
    const byNo = {};
    const seenTitle = new Set();
    for (const p of parsed) {
      if (useNumbers && !p.no) continue;
      const tkey = Catalog.norm(p.title);
      if (!useNumbers) {
        if (seenTitle.has(tkey)) { dup++; continue; }
        seenTitle.add(tkey);
        items.push({ no: '', title: p.title });
        continue;
      }
      const nkey = p.no.toLowerCase();
      const same = (byNo[nkey] || []).find((it) => [it.title, ...(it.alt || [])].some((t) => Catalog.norm(t) === tkey));
      if (same) { dup++; continue; }
      const alias = (byNo[nkey] || []).find((it) => sameSong(it.title, p.title));
      if (alias) { (alias.alt = alias.alt || []).push(p.title); aliases++; continue; }
      const it = { no: p.no, title: p.title };
      (byNo[nkey] = byNo[nkey] || []).push(it);
      items.push(it);
    }
    // kolejność według numerów (gdy plik zaczyna się od spisu alfabetycznego)
    if (useNumbers && items.every((it) => /^\d+/.test(it.no))) {
      items.forEach((it, i) => { it._i = i; });
      items.sort((a, b) => parseInt(a.no, 10) - parseInt(b.no, 10) || a.no.localeCompare(b.no) || a._i - b._i);
      items.forEach((it) => { delete it._i; });
    }
    return { items, duplicates: dup, aliases };
  }

  // Linijki dokumentu (wiersz tabeli = komórki połączone tabulatorem; raw – z pustymi komórkami)
  async function linesOf(name, content, raw) {
    const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1];
    if (typeof content === 'string') return content.split(/\r?\n/);
    if (/^odt$/i.test(ext)) {
      const xml = await Zip.readEntry(content, 'content.xml');
      if (!xml) throw new Error('W pliku .odt nie ma treści.');
      return odtLines(xml, raw);
    }
    if (/^docx$/i.test(ext)) {
      const xml = await Zip.readEntry(content, 'word/document.xml');
      if (!xml) throw new Error('W pliku .docx nie ma treści.');
      return docxLines(xml, raw);
    }
    if (/^(txt|csv|md)$/i.test(ext) || !ext) return new TextDecoder('utf-8').decode(content).split(/\r?\n/);
    throw new Error('Obsługiwane formaty: .odt, .docx, .txt i Dokumenty Google.');
  }

  // name – nazwa pliku (rozszerzenie decyduje o formacie); content – ArrayBuffer albo tekst
  async function fromFile(name, content) {
    const lines = await linesOf(name, content, false);
    const res = parse(lines);
    if (!res.items.length) throw new Error('Nie znalazłem w pliku żadnych pozycji spisu.');
    return res;
  }

  const SUPPORTED = /\.(odt|docx|txt)$/i;
  const GDOC = 'application/vnd.google-apps.document';

  return { fromFile, linesOf, parse, parseLine, sameSong, SUPPORTED, GDOC };
})();
