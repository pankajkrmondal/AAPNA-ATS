// Wrap one JPEG in a one-page A4 PDF, byte for byte (DCTDecode: the image is not re-encoded).
// Why: a scanned resume stored as .jpg is "not a resume" to the ATS (utils/resumeCheck.js accepts
// .pdf/.doc/.docx only) and HR Upload itself accepts only pdf, docx and zip. No dependency, no network.

function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9] };
    }
    i += 2 + len;
  }
  throw new Error('JPEG size marker not found');
}

/** @param {Buffer} jpg  @returns {Buffer} the PDF */
export function jpgToPdf(jpg) {
  const { width, height, components } = jpegInfo(jpg);
  const cs = components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
  const decode = components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
  const PW = 595; const PH = 842; const M = 18; // A4 in points, small margin
  const s = Math.min((PW - 2 * M) / width, (PH - 2 * M) / height);
  const w = +(width * s).toFixed(2); const h = +(height * s).toFixed(2);
  const x = +((PW - w) / 2).toFixed(2); const y = +((PH - h) / 2).toFixed(2);
  const content = Buffer.from(`q ${w} 0 0 ${h} ${x} ${y} cm /Im0 Do Q\n`, 'latin1');
  const parts = []; const offsets = []; let size = 0;
  const push = (b) => { const x2 = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(x2); size += x2.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream']);
  obj(5, [`<< /Length ${content.length} >>\nstream\n`, content, 'endstream']);
  const xref = size;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}
