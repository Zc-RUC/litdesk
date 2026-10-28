import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument as openPdf } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { db } from './db.js';

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
  const match = String(value).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').match(/10\.\d{4,9}\/[^\s<>"']+/i);
  return match ? match[0].replace(/[.,;\])}]+$/g, '') : '';
}

export function parseAuthors(value = '') {
  if (Array.isArray(value)) return value;
  return String(value).split(/\s*(?:;|\band\b|&|、)\s*/i).map((name) => name.trim()).filter(Boolean).map((name) => {
    if (/^[\u3400-\u9fff·•\s]+$/.test(name) && !name.includes(' ')) return { literal: name };
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
  return path.basename(filePath, path.extname(filePath))
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length >= 6);
    const fallbackTitle = lines.find((line) =>
      line.length <= 300 && !/^(doi|https?|www\.|copyright|©|issn|received|accepted|abstract|journal)\b/i.test(line)
    ) || '';
    const infoTitle = String(info?.Title || '').trim();
    const title = infoTitle && !/^(untitled|microsoft word|adobe|scanned)/i.test(infoTitle)
      ? infoTitle
      : fallbackTitle || filenameTitle(filePath);
    const year = String(info?.CreationDate || '').match(/(?:D:)?((?:19|20)\d{2})/)?.[1]
      || text.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
    return {
      title: title.replace(/\s+/g, ' ').trim(),
      authors: parseAuthors(info?.Author || ''),
      year,
      doi: normalizeDoi(text),
      publication: String(info?.Subject || '').trim(),
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
