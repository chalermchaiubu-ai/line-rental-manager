// Turn the on-screen bills (PrintBills page) into PDF files in the browser.
// Libraries are loaded on demand from jsDelivr so the app bundle stays small.
//   html-to-image -> snapshot of one bill element. The browser itself lays out
//                    the text (SVG foreignObject), so Thai text sits exactly
//                    where it does on screen. (html2canvas drew Thai text too
//                    low, overlapping the table lines.)
//   jsPDF       -> one A5-landscape page per bill (half of A4, same as the cut paper)
//   JSZip       -> all per-room PDFs in one .zip, named in room order
const CDN = {
  htmlToImage: 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm',
  jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm',
};

let libs = null;
async function loadLibs() {
  if (libs) return libs;
  const [hti, jspdfMod, jszipMod] = await Promise.all([
    import(/* @vite-ignore */ CDN.htmlToImage),
    import(/* @vite-ignore */ CDN.jspdf),
    import(/* @vite-ignore */ CDN.jszip),
  ]);
  libs = {
    htmlToImage: hti,
    jsPDF: jspdfMod.jsPDF || jspdfMod.default?.jsPDF || jspdfMod.default,
    JSZip: jszipMod.default || jszipMod,
  };
  return libs;
}

async function billToCanvas(el) {
  const { htmlToImage } = await loadLibs();
  if (document.fonts?.ready) await document.fonts.ready;
  // A field still being edited is highlighted yellow on screen; drop focus so
  // the highlight doesn't end up in the PDF.
  if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
  return htmlToImage.toCanvas(el, { pixelRatio: 2.5, backgroundColor: '#ffffff' });
}

// A5 landscape (210 x 148 mm) with the bill centred inside an 8 mm margin.
function addCanvasPage(pdf, canvas, isFirst) {
  if (!isFirst) pdf.addPage('a5', 'landscape');
  const pageW = 210;
  const pageH = 148;
  const margin = 8;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const ratio = canvas.width / canvas.height;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pageW - w) / 2, (pageH - h) / 2, w, h);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|\s]+/g, '');

// "01", "02", ... "28" so files sort in room order; non-numeric names kept.
function roomKey(roomNumber, width) {
  const r = String(roomNumber ?? '').trim();
  return /^\d+$/.test(r) ? r.padStart(width, '0') : safe(r);
}

export function billFileName(roomNumber, monthText, width = 2) {
  return `บิล_ห้อง${roomKey(roomNumber, width)}_${safe(monthText)}.pdf`;
}

async function billPdfBlob(el) {
  const { jsPDF } = await loadLibs();
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' });
  addCanvasPage(pdf, await billToCanvas(el), true);
  return pdf.output('blob');
}

// One room -> one PDF download.
export async function downloadOneBill(el, roomNumber, monthText) {
  download(await billPdfBlob(el), billFileName(roomNumber, monthText));
}

// Phones: open the share sheet (LINE, Save to Files …) with the PDF so the
// owner can send it straight to the tenant. Returns 'shared' | 'cancelled' |
// 'downloaded'. Throws { code: 'NEED_TAP', file } when the browser blocked the
// share because PDF creation took too long after the tap — the caller then
// offers a second button that shares the already-built file instantly.
export function canShareFiles() {
  try {
    return typeof navigator !== 'undefined' && !!navigator.canShare &&
      navigator.canShare({ files: [new File([new Blob(['x'])], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

export async function shareFile(file) {
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    if (err?.name === 'NotAllowedError') {
      const e = new Error('NEED_TAP');
      e.code = 'NEED_TAP';
      e.file = file;
      throw e;
    }
    download(file, file.name);
    return 'downloaded';
  }
}

export async function shareOneBill(el, roomNumber, monthText) {
  const name = billFileName(roomNumber, monthText);
  const blob = await billPdfBlob(el);
  const file = new File([blob], name, { type: 'application/pdf' });
  if (!canShareFiles()) {
    download(blob, name);
    return 'downloaded';
  }
  return shareFile(file);
}

// items: [{ el, roomNumber }] already in room order.
// Returns a .zip of per-room PDFs (and onProgress(i, total) while working).
export async function downloadBillsZip(items, monthText, onProgress) {
  const { JSZip } = await loadLibs();
  const zip = new JSZip();
  const width = Math.max(2, ...items.map((x) => (/^\d+$/.test(String(x.roomNumber)) ? String(x.roomNumber).length : 0)));
  for (let i = 0; i < items.length; i += 1) {
    onProgress?.(i + 1, items.length);
    zip.file(billFileName(items[i].roomNumber, monthText, width), await billPdfBlob(items[i].el));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  download(blob, `บิลแยกห้อง_${safe(monthText)}.zip`);
}

// All rooms in ONE PDF, one bill per page in room order.
export async function downloadBillsCombined(items, monthText, onProgress) {
  const { jsPDF } = await loadLibs();
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' });
  for (let i = 0; i < items.length; i += 1) {
    onProgress?.(i + 1, items.length);
    addCanvasPage(pdf, await billToCanvas(items[i].el), i === 0);
  }
  download(pdf.output('blob'), `บิลทุกห้อง_${safe(monthText)}.pdf`);
}
