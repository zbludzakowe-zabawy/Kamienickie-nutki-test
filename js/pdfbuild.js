// Składanie jednego PDF-a ze śpiewnikiem: spis treści + nuty w kolejności spisu.
window.PdfBuild = (() => {
  'use strict';
  const A4 = [595.28, 841.89];
  const MARGIN = 18;
  let libP = null;

  // pdf-lib wczytujemy dopiero, gdy jest potrzebny (tylko u administratora)
  function lib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!libP) {
      libP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/pdf-lib.min.js';
        s.onload = () => resolve(window.PDFLib);
        s.onerror = () => { libP = null; reject(new Error('Nie udało się wczytać modułu PDF.')); };
        document.head.appendChild(s);
      });
    }
    return libP;
  }

  const sniff = (u8) => {
    if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) return 'pdf';
    if (u8[0] === 0xff && u8[1] === 0xd8) return 'jpg';
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'png';
    return 'other';
  };

  // obrazy w innych formatach (webp, gif, bmp…) zamieniamy na JPEG przez canvas
  async function toJpeg(u8) {
    const bmp = await createImageBitmap(new Blob([u8]));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return new Uint8Array(await blob.arrayBuffer());
  }

  function addImagePage(doc, img) {
    const landscape = img.width > img.height * 1.15;
    const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
    const scale = Math.min((pw - 2 * MARGIN) / img.width, (ph - 2 * MARGIN) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }

  // Strony spisu treści rysujemy na canvasie (polskie znaki bez dodatkowych czcionek).
  const TOC_LINES = 34;
  function tocPages(title, rows, subtitle) {
    const W = 1240;
    const H = 1754;
    const pages = [];
    for (let start = 0, n = 0; start < rows.length || n === 0; start += TOC_LINES, n++) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      c.links = []; // miejsca klikalnych tytułów: { page, y } (y = linia pisma na canvasie)
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#222';
      let y = 150;
      if (n === 0) {
        g.font = 'bold 56px Georgia, "Times New Roman", serif';
        g.fillText(title, 110, y, W - 220);
        y += 50;
        g.font = '26px Georgia, "Times New Roman", serif';
        g.fillStyle = '#777';
        g.fillText(subtitle || `Spis treści · ${new Date().toLocaleDateString('pl-PL')}`, 110, y);
        y += 60;
      } else {
        y = 110;
      }
      for (const r of rows.slice(start, start + TOC_LINES)) {
        if (r.section) { // nagłówek części (program uroczystości)
          g.font = 'bold 30px Georgia, "Times New Roman", serif';
          g.fillStyle = '#8c2f39';
          g.textAlign = 'left';
          g.fillText(r.title, 110, y + 6, W - 220);
          y += 50;
          continue;
        }
        g.font = '30px Georgia, "Times New Roman", serif';
        g.fillStyle = r.page ? '#222' : '#aaa';
        g.textAlign = 'right';
        g.fillText(r.no || '', 170, y);
        g.textAlign = 'left';
        g.fillText(r.title, 195, y, 800);
        g.textAlign = 'right';
        g.fillText(r.page ? String(r.page) : 'brak nut', W - 110, y);
        g.textAlign = 'left';
        if (r.page) c.links.push({ page: r.page, y });
        y += 44;
      }
      pages.push(c);
      if (start + TOC_LINES >= rows.length) break;
    }
    return pages;
  }

  // Klikalny spis treści: na każdy tytuł z nutami nakładamy niewidoczny link do jego strony.
  function addLinks(doc, tocCanvases) {
    const { PDFName } = window.PDFLib;
    const s = A4[0] / 1240; // canvas 1240 px → szerokość A4 w punktach
    const refs = doc.getPages().map((p) => p.ref);
    tocCanvases.forEach((c, i) => {
      const annots = c.links.filter((l) => refs[l.page - 1]).map((l) => doc.context.register(doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [100 * s, A4[1] - (l.y + 12) * s, (1240 - 100) * s, A4[1] - (l.y - 34) * s],
        Border: [0, 0, 0],
        Dest: [refs[l.page - 1], 'Fit'],
      })));
      if (annots.length) doc.getPage(i).node.set(PDFName.of('Annots'), doc.context.obj(annots));
    });
  }

  // Zakładki PDF (panel boczny czytnika): „Spis treści”, potem pieśni; w programach pogrupowane według części.
  function addOutline(doc, rows, tocCount) {
    const { PDFName, PDFHexString, PDFNumber } = window.PDFLib;
    const ctx = doc.context;
    const refs = doc.getPages().map((p) => p.ref);
    const entries = [{ title: 'Spis treści', page: 1 }];
    let section = null;
    for (const r of rows) {
      if (r.section) { section = { title: r.title, children: [] }; entries.push(section); continue; }
      if (!r.page) continue;
      const e = { title: `${r.no ? r.no + '. ' : ''}${r.title}`, page: r.page };
      if (section) section.children.push(e);
      else entries.push(e);
    }
    const clean = entries.filter((e) => !e.children || e.children.length);
    clean.forEach((e) => { if (e.children) e.page = e.children[0].page; });
    const build = (list, parentRef) => {
      const items = list.map((e) => ({ e, ref: ctx.nextRef() }));
      items.forEach(({ e, ref }, i) => {
        const d = {
          Title: PDFHexString.fromText(e.title),
          Parent: parentRef,
          Dest: [refs[Math.min(e.page, refs.length) - 1], 'Fit'],
        };
        if (i > 0) d.Prev = items[i - 1].ref;
        if (i < items.length - 1) d.Next = items[i + 1].ref;
        if (e.children && e.children.length) {
          const kids = build(e.children, ref);
          d.First = kids[0].ref;
          d.Last = kids[kids.length - 1].ref;
          d.Count = PDFNumber.of(kids.length);
        }
        ctx.assign(ref, ctx.obj(d));
      });
      return items;
    };
    const rootRef = ctx.nextRef();
    const top = build(clean, rootRef);
    ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top[0].ref, Last: top[top.length - 1].ref, Count: PDFNumber.of(top.length) }));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines')); // czytnik od razu pokaże zakładki
    return tocCount;
  }

  // book – spis; getBytes(fileId) → Uint8Array; zwraca { bytes, missing: [opisy], pages }
  async function build(book, getBytes, onProgress) {
    const { PDFDocument } = await lib();
    const doc = await PDFDocument.create();
    doc.setTitle(book.name);
    doc.setCreator('Kamienickie Nutki');
    const rows = [];
    const problems = [];
    const withNotes = book.items.filter((it) => !it.section && (it.state === 'ok' || it.state === 'auto') && it.files.length);
    let done = 0;
    for (const it of book.items) {
      if (it.section) { rows.push({ section: true, title: it.title }); continue; }
      const row = { no: it.no, title: it.title, page: 0 };
      rows.push(row);
      if (!withNotes.includes(it)) continue;
      const first = doc.getPageCount();
      for (const fid of it.files) {
        try {
          let u8 = await getBytes(fid);
          const kind = sniff(u8);
          if (kind === 'pdf') {
            const src = await PDFDocument.load(u8, { ignoreEncryption: true });
            const pages = await doc.copyPages(src, src.getPageIndices());
            pages.forEach((p) => doc.addPage(p));
          } else {
            if (kind === 'other') u8 = await toJpeg(u8);
            const img = kind === 'png' ? await doc.embedPng(u8) : await doc.embedJpg(u8);
            addImagePage(doc, img);
          }
        } catch (e) {
          console.warn(e);
          problems.push(`${it.no ? it.no + '. ' : ''}${it.title}`);
        }
      }
      if (doc.getPageCount() > first) row.page = first + 1; // bez spisu treści – poprawiamy niżej
      done++;
      onProgress && onProgress(done, withNotes.length);
    }
    // spis treści na początku
    const toc = tocPages(book.name, rows, book.subtitle);
    rows.forEach((r) => { if (r.page) r.page += toc.length; });
    const tocFinal = tocPages(book.name, rows, book.subtitle);
    for (let i = 0; i < tocFinal.length; i++) {
      const blob = await new Promise((r) => tocFinal[i].toBlob(r, 'image/png'));
      const img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
      const page = doc.insertPage(i, A4);
      page.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
    }
    addLinks(doc, tocFinal);
    addOutline(doc, rows, tocFinal.length);
    return { bytes: await doc.save(), problems: [...new Set(problems)], pages: doc.getPageCount() };
  }

  // Obrót pliku o 90/180/270° (zgodnie z ruchem wskazówek zegara). Oryginał na Dysku się nie zmienia –
  // obracamy kopię dla chórzystów i strony w PDF. Zwraca { bytes, ext, mime }.
  async function rotate(u8, rot) {
    const r = ((Number(rot) || 0) % 360 + 360) % 360;
    const kind = sniff(u8);
    if (kind === 'pdf') {
      if (!r) return { bytes: u8, ext: '.pdf', mime: 'application/pdf' };
      const { PDFDocument, degrees } = await lib();
      const doc = await PDFDocument.load(u8, { ignoreEncryption: true });
      doc.getPages().forEach((pg) => pg.setRotation(degrees((pg.getRotation().angle + r) % 360)));
      return { bytes: await doc.save(), ext: '.pdf', mime: 'application/pdf' };
    }
    const png = kind === 'png';
    if (!r) return { bytes: u8, ext: png ? '.png' : '.jpg', mime: png ? 'image/png' : 'image/jpeg' };
    const bmp = await createImageBitmap(new Blob([u8]));
    const swap = r === 90 || r === 270;
    const c = document.createElement('canvas');
    c.width = swap ? bmp.height : bmp.width;
    c.height = swap ? bmp.width : bmp.height;
    const g = c.getContext('2d');
    if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.translate(c.width / 2, c.height / 2);
    g.rotate((r * Math.PI) / 180);
    g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    const type = png ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((res) => c.toBlob(res, type, 0.92));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: png ? '.png' : '.jpg', mime: type };
  }

  return { build, rotate };
})();
