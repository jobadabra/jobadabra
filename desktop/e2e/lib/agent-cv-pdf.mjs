// A one-page PDF of a persona's CV lines (Helvetica 10 pt, no PDF library), the way desktop/e2e/fixtures/make-personas.py builds the committed ones, so the app's CV reads see a person's CV.
// Job: serve stored answers

const latin1 = text => String(text).normalize('NFC').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');   // Why (3 Nov 2026, AI user agents 8/12): a Type1 Helvetica string holds Latin-1 only; a persona's CV is in the languages the spec names, so a letter outside it becomes "?" and never breaks the file
const escape = text => latin1(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * `lines` -> a Buffer holding a valid one-page PDF with those lines top to bottom (at most 56 fit; the rest are cut, a CV of 56 lines is already the long shape).
 * Invariant: the xref offsets are byte offsets of the file as written (latin1), so any reader opens it without repair.
 */
export function cvPdf(lines) {
  const stream = `BT /F1 10 Tf 40 800 Td 14 TL\n${lines.slice(0, 56).map(line => `(${escape(line)}) Tj T*`).join('\n')}\nET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
