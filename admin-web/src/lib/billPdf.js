// Turn the on-screen bills (PrintBills page) into PDF files in the browser.
// Libraries are loaded on demand from jsDelivr so the app bundle stays small.
//   html2canvas -> snapshot of one bill element
//   jsPDF       -> one A5-landscape page per bill (half of A4, same as the cut paper)
//   JSZip       -> all per-room PDFs in one .zip, named in room order
const CDN = {
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm',
  jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm',
};

let libs = null;
async function loadLibs() {
  if (libs) return libs;
  const [h2c, jspdfMod, jszipMod] = await Promise.all([
    import(/* @vite-ignore */ CDN.html2canvas),
    import(/* @vite-ignore */ CDN.jspdf),
    import(/* @vite-ignore */ CDN.jszip),
  ]);
  libs = {
    html2canvas: h2c.default || h2c,
    jsPDF: jspdfMod.jsPDF || jspdfMod.default?.jsPDF || jspdfMod.default,
    JSZip: jszipMod.default || jszipMod,
  };
  return libs;
}

// Editable bill fields are <input>s; canvas snapshots of inputs misalign text,
// so in the snapshot copy each input is swapped for a plain span with its value.
function inputsToText(liveEl, clonedEl) {
  const live = liveEl.querySelectorAll('input.bill-input');
  const cloned = clonedEl.querySelectorAll('input.bill-input');
  cloned.forEach((input, i) => {
    const span = clonedEl.ownerDocument.createElement('span');
    span.textContent = live[i]?.value ?? '';
    const cs = liveEl.ownerDocument.defaultView.getComputedStyle(live[i] || input);
    span.style.display = 'block';
    span.style.width = '100%';
    span.style.textAlign = cs.textAlign;
    span.style.fontWeight = cs.fontWeight;
    span.style.fontSize = cs.fontSize;
    span.style.lineHeight = cs.lineHeight;
    span.style.minHeight = '1em';
    input.replaceWith(span);
  });
}

async function billToCanvas(el) {
  const { html2canvas } = await loadLibs();
  if (document.fonts?.ready) await document.fonts.ready;
  return html2canvas(el, {
    scale: 2.5,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    onclone: (doc, clonedEl) => inputsToText(el, clonedEl),
  });
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
