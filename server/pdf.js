import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument as openPdf } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { db } from './db.js';
import { cleanMetadataText, parseFilenameMetadata, usefulMetadataTitle, bestTitleFromLines, authorsFromFirstPage, publicationFromLines } from './metadata.js';

async function loadPdf(filePath) {
  const data = new Uint8Array(await readFile(filePath));
  const task = openPdf({
    data,
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });
  return task.promise;
}

async function pageText(page) {
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    text += item.str;
    text += item.hasEOL ? '\n' : ' ';
  }
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeDoi(value = '') {
  const source = cleanMetadataText(value).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  const match = source.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  if (!match) return '';
  let doi = match[0];
  const continuation = source.slice(match.index + match[0].length).match(/^\s*(\.\d{1,4})(?=\s|$)/);
  if (continuation) doi += continuation[1];
  doi = doi.replace(/(?<=\d)(?:Finance|Journal|Science|Management|Press|Copyright|Received|Accepted).*$/g, '');
  return doi.replace(/[.,;*\])}]+$/g, '');
}

export function parseAuthors(value = '') {
  if (Array.isArray(value)) return value;
  const invalid = /^(?:cnki|author|admin|administrator|user|unknown|anonymous|untitled|none|null|n\/a)$/i;
  return String(value).split(/\s*(?:;|\band\b|&|、)\s*/i).map(cleanMetadataText).filter((name) => name && !invalid.test(name)).map((name) => {
    if (/^[\u3400-\u9fff·•\s]+$/.test(name)) return { literal: name.replace(/\s+/g, '') };
    if (name.includes(',')) {
      const [family, ...given] = name.split(',');
      return { family: family.trim(), given: given.join(',').trim() };
    }
    const parts = name.split(/\s+/);
    if (parts.length === 1) return { literal: name };
    return { family: parts.at(-1), given: parts.slice(0, -1).join(' ') };
  });
}

export function filenameTitle(filePath) {
  return cleanMetadataText(path.basename(filePath, path.extname(filePath)).replace(/[_]+/g, ' '));
}

export async function extractPdfSnapshot(filePath) {
  let pdf;
  try {
    pdf = await loadPdf(filePath);
    const { info } = await pdf.getMetadata();
    const pages = [];
    for (let number = 1; number <= Math.min(pdf.numPages, 4); number += 1) {
      pages.push(await pageText(await pdf.getPage(number)));
    }
    const text = pages.join('\n');
    const lines = text.split('\n').map(cleanMetadataText).filter(Boolean);
    const fileMetadata = parseFilenameMetadata(filePath);
    const infoTitle = cleanMetadataText(info?.Title || '');
    const title = fileMetadata?.title || (usefulMetadataTitle(infoTitle)
      ? infoTitle
      : bestTitleFromLines(lines, filenameTitle(filePath)));
    const baselineAuthors = fileMetadata ? parseAuthors(fileMetadata.authorText) : parseAuthors(info?.Author || '');
    const year = fileMetadata?.year
      || pages[0]?.match(/\b(?:19|20)\d{2}\b/)?.[0]
      || String(info?.CreationDate || '').match(/(?:D:)?((?:19|20)\d{2})/)?.[1]
      || '';
    return {
      title,
      authors: authorsFromFirstPage(lines, baselineAuthors),
      year,
      doi: normalizeDoi(text),
      publication: publicationFromLines(lines, title, String(info?.Subject || '')),
      pageCount: pdf.numPages,
      hasText: text.replace(/\s/g, '').length > 80,
    };
  } finally {
    if (pdf) await pdf.loadingTask.destroy();
  }
}

export async function extractPdfPages(filePath) {
  let pdf;
  try {
    pdf = await loadPdf(filePath);
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      pages.push({ page: number, content: await pageText(await pdf.getPage(number)) });
    }
    return pages;
  } finally {
    if (pdf) await pdf.loadingTask.destroy();
  }
}

export async function getDocumentPages(document) {
  const cached = db.prepare('SELECT page, content FROM text_pages WHERE document_id = ? ORDER BY page').all(document.id);
  if (cached.length && cached.length === document.page_count) return cached;
  const pages = await extractPdfPages(document.file_path);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM text_pages WHERE document_id = ?').run(document.id);
    const insert = db.prepare('INSERT INTO text_pages (document_id, page, content) VALUES (?, ?, ?)');
    for (const item of pages) insert.run(document.id, item.page, item.content);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  if (document.page_count !== pages.length) {
    db.prepare('UPDATE documents SET page_count = ? WHERE id = ?').run(pages.length, document.id);
  }
  return pages;
}
