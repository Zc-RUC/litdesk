import { zipSync, strToU8 } from 'fflate';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function fieldParagraph(text, instruction, bibliography) {
  const display = text.replace(/\s*\n\s*/g, ' ').trim();
  return `<w:p>${bibliography ? '<w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr>' : ''}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${xmlEscape(instruction)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve">${xmlEscape(display)}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
}

export function createCitationDocx(text, metadata) {
  const bibliography = metadata.kind === 'bibliography';
  const kind = bibliography ? 'BIBLIOGRAPHY' : 'CITATION';
  const encoded = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64');
  const instruction = ` ADDIN LITDESK_${kind} ${encoded} `;
  const entries = bibliography ? text.split(/\n{2,}/).filter((entry) => entry.trim()) : [text];
  const paragraphs = entries.map((entry) => fieldParagraph(entry, instruction, bibliography)).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const archive = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(relationships),
    'word/document.xml': strToU8(documentXml),
  });
  const directory = mkdtempSync(path.join(tmpdir(), 'litdesk-citation-'));
  const sourceName = `${path.basename(directory)}.docx`;
  const filePath = path.join(directory, sourceName);
  writeFileSync(filePath, Buffer.from(archive));
  return { directory, filePath, sourceName };
}
