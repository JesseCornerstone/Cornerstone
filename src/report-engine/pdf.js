function createTextPdfBuffer(title, lines) {
  const cleanTitle = normalisePdfText(title || 'Lot Companion report');
  const wrapped = [];

  for (const line of lines || []) {
    const text = normalisePdfText(line);
    if (!text) {
      wrapped.push('');
      continue;
    }
    wrapped.push(...wrapLine(text, 92));
  }

  const allLines = [cleanTitle, '', ...wrapped];
  const pages = chunkLines(allLines, 48);
  const objects = [];
  const pageObjectIds = [];

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pages.forEach((pageLines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    pageObjectIds.push(pageId);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    const stream = buildPageStream(pageLines);
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`;
  });

  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;

  const maxId = Math.max(...Object.keys(objects).map(Number));
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'binary');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${maxId + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let id = 1; id <= maxId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'binary');
}

function buildPageStream(lines) {
  const commands = ['BT', '/F1 11 Tf', '14 TL', '50 792 Td'];
  lines.forEach((line, index) => {
    if (index > 0) commands.push('T*');
    if (index === 0) commands.push('/F1 16 Tf');
    if (index === 1) commands.push('/F1 11 Tf');
    commands.push(`(${escapePdfString(line)}) Tj`);
  });
  commands.push('ET');
  return commands.join('\n');
}

function escapePdfString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ');
}

function wrapLine(value, width) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= width) {
      current += ` ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function chunkLines(lines, size) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) {
    chunks.push(lines.slice(i, i + size));
  }
  return chunks.length ? chunks : [['']];
}

function normalisePdfText(value) {
  return String(value ?? '')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trim();
}

module.exports = {
  createTextPdfBuffer
};
