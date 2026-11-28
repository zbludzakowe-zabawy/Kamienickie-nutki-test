// Wczytywanie programów uroczystości z dokumentu (np. „Triduum”: kilka dni w jednym pliku).
// Układ pliku: wiersz z samą nazwą dnia = nowa uroczystość; wiersz „część mszy | pieśń” – lewa kolumna to część
// (pusta = ta sama część co wyżej); tekst bez pieśni i bez części na końcu/początku (np. „Triduum 2026”) = nazwa całego zestawu.
// Czysty parser – bez DOM, żeby dało się go testować w Node.
window.ProgImport = (() => {
  'use strict';

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // komórka bez treści: pusta, sama kropka, „0”, kreski, wielokropek
  const junk = (c) => /^[\s.…·_\-–—0]*$/.test(c || '');

  // Skróty części mszy z lewej kolumny → nazwy jak w programach (null = nieznana etykieta)
  function knownPart(label) {
    const raw = String(label).replace(/[:.\s]+$/, '').trim();
    const k = norm(raw);
    if (/^(we\d*|wejscie)$/.test(k)) return 'Wejście';
    if (k === 'kyrie') return 'Kyrie';
    if (k === 'gloria' || /^chwala na wysokosci/.test(k)) return 'Gloria';
    if (k === 'psalm') return 'Psalm';
    const ps = k.match(/^ps\s?0*(\d+)$/);
    if (ps) return 'Psalm ' + ps[1];
    if (/^(chwala|alleluja|aklamacja|chwala tobie)$/.test(k)) return 'Alleluja lub Chwała';
    if (/^(of|ofiarowanie)$/.test(k)) return 'Ofiarowanie';
    if (/^(sanctus|swiety)$/.test(k)) return 'Sanctus';
    if (/^(agnus|agnus dei|baranku)$/.test(k)) return 'Agnus Dei';
    if (/^(kom|komunia)$/.test(k)) return 'Komunia';
    if (/^(uw|uwielbienie|dziekczynienie)$/.test(k)) return 'Uwielbienie';
    if (/^(wy|wyj|wyjscie|zakonczenie)$/.test(k)) return 'Wyjście';
    if (/^(mp|modlitwa powszechna|modlitwa wiernych)$/.test(k)) return 'Modlitwa powszechna';
    return null;
  }
  function partName(label) {
    const known = knownPart(label);
    if (known) return known;
    let raw = String(label).replace(/[:.\s]+$/, '').trim().replace(/\s+/g, ' ');
    // „KOLĘDOWANIE” → „Kolędowanie”
    if (raw === raw.toUpperCase() && raw !== raw.toLowerCase()) raw = raw.toLowerCase();
    return cap(raw);
  }

  // Kolejność części mszy – w zwykłym tekście część rozpoznana z początku tytułu („Kyrie - Missa Noel”,
  // „Alleluja radosne”) liczy się tylko wtedy, gdy wypada dalej w mszy niż bieżąca część
  // (żeby np. kolęda „Gloria in excelsis” w „Kolędowaniu” nie przeniosła się do Glorii).
  const MASS = ['Wejście', 'Kyrie', 'Gloria', 'Psalm', 'Alleluja lub Chwała', 'Modlitwa powszechna', 'Ofiarowanie',
    'Sanctus', 'Agnus Dei', 'Komunia', 'Uwielbienie', 'Wyjście'];
  const massIdx = (name) => MASS.indexOf(String(name || '').replace(/ \d+$/, ''));

  // Elementy liturgii, które są i częścią mszy, i utworem (mogą mieć nuty)
  const LITURGY = [['meka', 'Męka'], ['sekwencja', 'Sekwencja'], ['litania', 'Litania'], ['potrojne amen', 'Potrójne Amen'],
    ['modlitwa powszechna', 'Modlitwa powszechna']];
  const liturgyPart = (title) => {
    const k = norm(title);
    const hit = LITURGY.find(([w]) => k === w || k.startsWith(w + ' '));
    return hit ? hit[1] : null;
  };

  // „Ave Verum / Wysławiam zranienie (!)” → tytuły [„Ave Verum”, „Wysławiam zranienie”], uwaga „!”
  function cleanTitle(raw) {
    let s = ' ' + String(raw).replace(/\s+/g, ' ') + ' ';
    const notes = [];
    const add = (n) => { if (!notes.includes(n)) notes.push(n); };
    s = s.replace(/\(\s*ew\.?\s*\)|(^|\s)ew\.(?=\s)/gi, () => { add('ewentualnie'); return ' '; });
    s = s.replace(/\[\s*(\d+)\s*\]/g, (_, n) => { add(`[${n}]`); return ' '; });
    s = s.replace(/\(\s*!\s*\)|!+(?=\s*$)/g, () => { add('!'); return ' '; });
    s = s.replace(/\(\s*\?\s*\)|\?+(?=\s*$)/g, () => { add('?'); return ' '; });
    s = s.replace(/(\s[-–—]\s*|\(\s*)a[\s-]*cap+el+a\s*\)?(?=\s*$)/gi, () => { add('a cappella'); return ' '; });
    s = s.replace(/\s*[.…·_]{2,}\s*/g, ' ').replace(/…/g, ' ');
    s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/,\s*\(/g, ' (').replace(/\(\s*\)/g, ' ');
    // podział na pieśni do wyboru: „/” i „+” poza nawiasami
    const parts = [];
    let cur = '';
    let depth = 0;
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (!depth && (ch === '/' || ch === '+')) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    const titles = parts
      .map((p) => p.replace(/\s+/g, ' ').replace(/^[\s,;:.]+|[\s,;:.]+$/g, '').trim())
      .filter((p) => p && !junk(p) && /\p{L}/u.test(p))
      .map(cap);
    return { titles, note: notes.join(' ') };
  }

  // lines – linijki dokumentu (wiersz tabeli = komórki połączone tabulatorem, z pustymi komórkami)
  function parse(lines) {
    // bez żadnej tabeli – zwykły tekst „we: pieśń”, „Kyrie - Missa Noel”, „KOLĘDOWANIE:” (np. Pasterka2026.txt)
    if (!lines.some((l) => String(l).includes('\t'))) return parsePlain(lines);
    const rows = lines.map((l) => String(l).split('\t').map((c) => c.replace(/\s+/g, ' ').trim()))
      .filter((r) => r.some((c) => !junk(c)));
    // kolumna z tytułami pieśni: najczęstsza pozycja treści w wierszach z wypełnioną lewą kolumną
    const count = {};
    for (const r of rows) {
      if (junk(r[0])) continue;
      const i = r.findIndex((c, k) => k > 0 && !junk(c));
      if (i > 0) count[i] = (count[i] || 0) + 1;
    }
    const titleCol = Number(Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || 1);

    const days = [];
    const headers = []; // nagłówki bez pieśni (nazwa zestawu)
    let day = null;
    let part = null;
    const newDay = (name) => { day = { name, parts: [] }; days.push(day); part = null; };
    const usePart = (name) => {
      if (!day) newDay('');
      if (part && part.name === name) return part;
      part = { name, items: [] };
      day.parts.push(part);
      return part;
    };

    for (const r of rows) {
      const filled = r.map((c, i) => (junk(c) ? -1 : i)).filter((i) => i >= 0);
      if (filled.length === 1) {
        const i = filled[0];
        const text = r[i];
        const header = (r.length <= titleCol || (i !== 0 && i !== titleCol)) && !/:\s*$/.test(text);
        if (header) { newDay(text); continue; }
      }
      const label = junk(r[0]) ? '' : r[0];
      if (label) usePart(partName(label));
      const text = r.slice(1).filter((c) => !junk(c)).join(' ');
      if (!text) continue;
      const { titles, note } = cleanTitle(text);
      for (const t of titles) {
        const lit = !label && liturgyPart(t);
        const pt = lit ? usePart(lit) : part || usePart('Pieśni');
        pt.items.push({ title: t, note });
      }
    }

    // dni bez pieśni to nagłówki (np. „Triduum 2026”) – pierwszy z nich to nazwa zestawu
    const real = [];
    for (const d of days) {
      d.parts = d.parts.filter((p) => p.items.length);
      if (d.parts.length) real.push(d);
      else if (d.name) headers.push(d.name);
    }
    const group = headers[0] || '';
    real.forEach((d, i) => {
      if (!d.name) d.name = `Uroczystość ${i + 1}`;
    });
    return { group, days: real, titleCol };
  }

  // Zwykły tekst – jedna linijka = jedna pieśń, część mszy na początku linijki:
  //  „we: Wśród nocnej ciszy” – etykieta z dwukropkiem; „KOLĘDOWANIE:” – sama etykieta = nowa część;
  //  „Kyrie - Missa Noel”, „Alleluja radosne” – część z początku tytułu (tytuł zostaje cały);
  //  linijka bez oznaczenia = kolejna pieśń w tej samej części; tekst przed pierwszą pieśnią = nazwa uroczystości;
  //  linijka bez pieśni tuż przed „we: …” (gdy są już pieśni) = następna uroczystość.
  function parsePlain(lines) {
    const rows = lines.map((l) => String(l).replace(/\s+/g, ' ').trim()).filter((l) => !junk(l));
    const dayName = (s) => s.replace(/(\p{L})(\d{4})\b/gu, '$1 $2'); // „Pasterka2026” → „Pasterka 2026”
    const days = [];
    let day = null;
    let part = null;
    const newDay = (name) => { day = { name, parts: [], songs: 0 }; days.push(day); part = null; };
    const usePart = (name) => {
      if (!day) newDay('');
      if (part && part.name === name) return part;
      part = { name, items: [] };
      day.parts.push(part);
      return part;
    };
    const addSong = (text, pt) => {
      const { titles, note } = cleanTitle(text);
      for (const t of titles) {
        const lit = !pt && liturgyPart(t);
        const p = pt || (lit ? usePart(lit) : part || usePart('Pieśni'));
        p.items.push({ title: t, note });
        day.songs++;
      }
    };
    // etykieta z dwukropkiem: znana część, sama etykieta albo jedno słowo („Psalm: …” tak, „Jezus: moja radość” nie)
    const colon = (l) => {
      const m = l.match(/^([^:]{1,30}?)\s*:\s*(.*)$/);
      if (!m || !/\p{L}/u.test(m[1])) return null;
      const words = m[1].trim().split(' ').length;
      if (knownPart(m[1]) || (!m[2] && words <= 3) || words === 1) return { part: partName(m[1]), rest: m[2] };
      return null;
    };
    // część z początku tytułu (1–3 pierwsze słowa, najdłuższe dopasowanie) – tylko dalej w kolejności mszy
    const lead = (l) => {
      const words = norm(l).split(' ');
      for (let n = Math.min(3, words.length); n >= 1; n--) {
        const name = knownPart(words.slice(0, n).join(' '));
        if (!name) continue;
        const cur = part ? massIdx(part.name) : -1;
        if ((part && cur < 0) || massIdx(name) <= cur) return null;
        return name;
      }
      return null;
    };

    rows.forEach((l, idx) => {
      const c = colon(l);
      if (c) {
        if (!day) newDay('');
        const pt = usePart(c.part);
        if (c.rest) addSong(c.rest, pt);
        return;
      }
      const lp = lead(l);
      if (lp) { addSong(l, usePart(lp)); return; }
      const next = rows[idx + 1] && colon(rows[idx + 1]);
      if (!day || !day.songs) {
        // przed pierwszą pieśnią: nazwa uroczystości (kolejne linijki dopisywane)
        if (!day) newDay(dayName(l));
        else if (!day.parts.length) day.name = day.name ? `${day.name} – ${dayName(l)}` : dayName(l);
        else addSong(l);
        return;
      }
      if (next && next.part === 'Wejście') { newDay(dayName(l)); return; }
      addSong(l);
    });

    const real = days.filter((d) => (d.parts = d.parts.filter((p) => p.items.length)).length);
    real.forEach((d, i) => {
      delete d.songs;
      if (!d.name) d.name = `Uroczystość ${i + 1}`;
    });
    return { group: '', days: real, titleCol: 1 };
  }

  return { parse, cleanTitle, partName };
})();
if (typeof module !== 'undefined') module.exports = window.ProgImport;
