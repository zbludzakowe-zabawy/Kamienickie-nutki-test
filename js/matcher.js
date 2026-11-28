// Dopasowanie pozycji spisu do plików z nutami (po tytule, odporne na literówki i polskie znaki).
window.Matcher = (() => {
  'use strict';
  const SURE = 0.85; // od tej wartości dopasowanie uznajemy za pewne
  const MAYBE = 0.5; // od tej – propozycja do sprawdzenia
  const HINT = 0.3; // od tej – podpowiedź przy ręcznym wyborze

  // słowa, które w nazwach plików nic nie mówią o tytule
  const JUNK = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'heic', 'img', 'image', 'dsc', 'skan', 'scan',
    'kopia', 'copy', 'strona', 'str', 'page', 'nuty', 'nuta', 'wersja', 'final', 'zdjecie', 'scaled', 'edited']);

  const stripExt = (s) => String(s || '').replace(/\.[a-z0-9]{2,5}$/i, '');

  // „O Krwi najdroższa (Kusz)” → główne słowa [o, krwi, najdrozsza] + dopiski [kusz]
  function split(text) {
    const s = String(text || '');
    const extra = (s.match(/\(([^)]*)\)?/g) || []).join(' ');
    const main = s.replace(/\([^)]*\)?/g, ' ');
    return { main: toks(main), extra: toks(extra) };
  }
  function toks(s) {
    return Catalog.norm(s).split(' ').filter((t) => t && !JUNK.has(t) && !/^\d+$/.test(t));
  }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function tokSim(a, b) {
    if (a === b) return 1;
    const short = Math.min(a.length, b.length);
    if (short >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.9; // odmiana: pokarmie / pokarmi
    if (short >= 5 && lev(a, b, 1) <= 1) return 0.85;
    if (short >= 8 && lev(a, b, 2) <= 2) return 0.75;
    return 0;
  }

  // Słowa częste w tytułach pieśni mówią mało – liczą się słabiej niż słowa rzadkie.
  const COMMON = new Set(['o', 'i', 'w', 'z', 'a', 'u', 'na', 'do', 'za', 'ze', 'we', 'sie', 'nas', 'mnie', 'mi', 'ci', 'cie', 'nie',
    'jest', 'ty', 'tys', 'twoj', 'twoje', 'twa', 'moj', 'moja', 'pan', 'pana', 'panie', 'panu', 'jezu', 'jezus', 'boze', 'bog', 'boga',
    'alleluja', 'maryjo', 'maryja', 'matko', 'swiety', 'swieta']);
  const weight = (t) => (t.length <= 2 ? 0.3 : COMMON.has(t) ? 0.4 : 1);
  const sum = (arr) => arr.reduce((a, t) => a + weight(t), 0);

  // Jak bardzo nazwa kandydata pasuje do tytułu (ok. 0–1; do porównań, może lekko przekraczać 1)
  function score(title, cand) {
    if (!title.main.length || !cand.all.length) return 0;
    const used = new Array(cand.all.length).fill(false);
    let got = 0;
    for (const t of title.main) {
      let best = 0;
      let at = -1;
      cand.all.forEach((c, i) => {
        if (used[i]) return;
        const s = tokSim(t, c);
        if (s > best) { best = s; at = i; }
      });
      if (at >= 0) { used[at] = true; got += best * weight(t); }
    }
    // dopisek w nawiasie (np. kompozytor) rozstrzyga między wersjami tej samej pieśni
    let bonus = 0;
    for (const t of title.extra) {
      if (t.length < 3) continue;
      const i = cand.all.findIndex((c, k) => !used[k] && tokSim(t, c) >= 0.85);
      if (i >= 0) { used[i] = true; bonus += 0.08; } else bonus -= 0.04;
    }
    const titleW = sum(title.main);
    const recall = got / titleW;
    const precision = sum(cand.all.filter((_, i) => used[i])) / sum(cand.all);
    let s = 0.7 * recall + 0.3 * precision + Math.max(-0.08, Math.min(bonus, 0.16));
    // tytuł z samych częstych słów (np. „Alleluja”) – mniej pewności
    if (titleW < 1) s *= 0.5 + 0.5 * titleW;
    return s;
  }

  // Kandydaci: pliki (własna nazwa i nazwa pliku) oraz małe foldery (np. „Barka” ze stronami jako obrazy)
  // manual = ręczny wybór pliku (okno „Wybierz plik…”): pomijamy tylko „to nie nuty”; automatyczne dopasowanie pomija też „nieistotne”
  function candidates(nodes, meta, idx, manual) {
    const out = [];
    const skip = (id) => { const f = Catalog.flagOf(nodes, meta, id); return manual ? f === 'notes' : !!f; };
    for (const n of Object.values(nodes)) {
      if (n.folder) {
        if (n.parent === null || (!manual && skip(n.id))) continue;
        const files = (idx.children[n.id] || []).filter((c) => !c.folder && !skip(c.id)).map((c) => c.id);
        if (!files.length || files.length > 30) continue;
        const t = split(n.name);
        out.push({ key: 'd:' + n.id, files, all: [...t.main, ...t.extra], folder: true });
      } else {
        if (skip(n.id)) continue;
        const own = meta[n.id] && meta[n.id].title;
        const names = own ? [own, stripExt(n.name)] : [stripExt(n.name)];
        for (const nm of names) {
          const t = split(nm);
          out.push({ key: 'f:' + n.id, files: [n.id], all: [...t.main, ...t.extra], own: nm === own });
        }
      }
    }
    return out;
  }

  // Najlepsze propozycje dla jednego tytułu (bez powtórzeń tych samych plików)
  function rank(titleText, cands, limit = 5, min = HINT) {
    const t = split(titleText);
    const scored = [];
    for (const c of cands) {
      let s = score(t, c);
      if (c.own && s > 0) s += 0.05; // nazwa nadana przez Ciebie liczy się bardziej
      if (s >= min) scored.push({ files: c.files, score: s, folder: !!c.folder });
    }
    scored.sort((a, b) => b.score - a.score || (a.folder ? 1 : -1));
    const seen = new Set();
    const out = [];
    for (const s of scored) {
      const k = s.files.join(',');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  }

  // Dopasowuje pozycje, których nie zatwierdziłeś ręcznie (stan ok / missing zostaje bez zmian).
  function matchItems(items, nodes, meta, idx) {
    const cands = candidates(nodes, meta, idx);
    const titleCount = {};
    for (const it of items) {
      const k = Catalog.norm(it.title);
      titleCount[k] = (titleCount[k] || 0) + 1;
    }
    for (const it of items) {
      if (it.state === 'ok' || it.state === 'missing') continue;
      const rejected = new Set(it.rejected || []);
      const r = rankAll([it.title, ...(it.alt || [])], cands, 6).filter((s) => !rejected.has(s.files.join(','))).slice(0, 4);
      const best = r[0];
      const second = r[1];
      const twin = titleCount[Catalog.norm(it.title)] > 1;
      const round = (x) => Math.round(Math.min(1, x) * 100) / 100;
      it.sugg = r.slice(1).map((s) => ({ files: s.files, score: round(s.score) }));
      if (best && best.score >= SURE && !twin && !(second && best.score - second.score < 0.05)) {
        it.state = 'auto';
        it.files = best.files;
        it.score = round(best.score);
      } else if (best && best.score >= MAYBE) {
        it.state = 'check';
        it.files = best.files;
        it.score = round(best.score);
      } else {
        it.state = 'none';
        it.files = [];
        it.score = 0;
        it.sugg = r.map((s) => ({ files: s.files, score: round(s.score) }));
      }
    }
    return items;
  }

  // Najlepsze propozycje dla kilku tytułów tej samej pieśni (tytuł + tytuły alternatywne) – liczy się najlepszy wynik
  function rankAll(titles, cands, limit = 5, min = HINT) {
    const best = new Map();
    for (const t of titles) {
      for (const r of rank(t, cands, limit * 2, min)) {
        const k = r.files.join(',');
        if (!best.has(k) || best.get(k).score < r.score) best.set(k, r);
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  return { matchItems, rank, rankAll, candidates, split, score, SURE, MAYBE };
})();
