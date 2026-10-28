import CSL from 'citeproc';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT_DIR, DATA_DIR } from './db.js';

const STYLE_DIR = path.join(ROOT_DIR, 'server', 'csl');
const CUSTOM_DIR = path.join(DATA_DIR, 'styles');
mkdirSync(CUSTOM_DIR, { recursive: true, mode: 0o700 });

const builtIn = [
  { id: 'apa', name: 'APA 7th edition', shortName: 'APA 7', file: 'apa.csl', language: '英文 · 著者—年份' },
  { id: 'gbt7714', name: 'GB/T 7714—2015 顺序编码', shortName: 'GB/T 7714', file: 'china-national-standard-gb-t-7714-2015-numeric.csl', language: '国标 · 顺序编码' },
  { id: 'gbt7714-author-date', name: 'GB/T 7714—2015 著者—出版年', shortName: 'GB/T 著者—年份', file: 'china-national-standard-gb-t-7714-2015-author-date.csl', language: '国标 · 著者—年份' },
  { id: 'ieee', name: 'IEEE', shortName: 'IEEE', file: 'ieee.csl', language: '英文 · 顺序编码' },
  { id: 'mla', name: 'MLA 9th edition', shortName: 'MLA 9', file: 'modern-language-association.csl', language: '英文 · 著者—页码' },
  { id: 'chicago', name: 'Chicago 17th edition · author-date', shortName: 'Chicago', file: 'chicago-author-date.csl', language: '英文 · 著者—年份' },
];

function decodeXml(value = '') {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function listStyles() {
  const custom = readdirSync(CUSTOM_DIR).filter((file) => file.endsWith('.csl')).map((file) => {
    const xml = readFileSync(path.join(CUSTOM_DIR, file), 'utf8');
    return {
      id: `custom-${path.basename(file, '.csl')}`,
      name: decodeXml(xml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || file),
      shortName: decodeXml(xml.match(/<title-short>([\s\S]*?)<\/title-short>/)?.[1]?.trim() || '自定义 CSL'),
      language: '自定义样式',
      custom: true,
    };
  });
  return [...builtIn.map(({ file, ...style }) => ({ ...style, custom: false })), ...custom];
}

function resolveStyle(styleId) {
  const style = builtIn.find((item) => item.id === styleId);
  if (style) return path.join(STYLE_DIR, style.file);
  if (/^custom-[a-f0-9-]{36}$/.test(styleId)) {
    const customPath = path.join(CUSTOM_DIR, `${styleId.slice(7)}.csl`);
    if (existsSync(customPath)) return customPath;
  }
  throw new Error('未找到所选 CSL 样式');
}

export function addStyle(filename, xml) {
  if (!filename.toLowerCase().endsWith('.csl') || !/<style[\s>]/i.test(xml) || !/<\/style>/i.test(xml)) {
    throw new Error('请上传有效的 CSL XML 样式文件');
  }
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024) throw new Error('CSL 文件不能超过 2 MB');
  const id = randomUUID();
  writeFileSync(path.join(CUSTOM_DIR, `${id}.csl`), xml, { mode: 0o600 });
  return listStyles().find((style) => style.id === `custom-${id}`);
}

export function toCsl(document) {
  const item = {
    id: String(document.id),
    type: document.item_type || 'article-journal',
    title: document.title,
    author: document.authors.map((author) => author.literal ? { literal: author.literal } : { given: author.given || '', family: author.family || '' }),
    'container-title': document.publication || undefined,
    DOI: document.doi || undefined,
    URL: document.url || undefined,
    abstract: document.abstract || undefined,
    language: document.language || undefined,
    volume: document.volume || undefined,
    issue: document.issue || undefined,
    page: document.pages || undefined,
    publisher: document.publisher || undefined,
  };
  if (document.year) item.issued = { 'date-parts': [[Number(document.year) || document.year]] };
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined && value !== ''));
}

function htmlToText(html) {
  return decodeXml(String(html)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/div>\s*<div class="csl-right-inline">/gi, ' ')
    .replace(/<\/(?:div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code.replace(/^x/i, ''), /^x/i.test(code) ? 16 : 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n'))
    .trim();
}

export function renderCitation(documents, styleId = 'apa') {
  if (!documents.length) throw new Error('请至少选择一篇文献');
  const items = Object.fromEntries(documents.map((document) => [String(document.id), toCsl(document)]));
  const sys = {
    retrieveItem: (id) => items[String(id)],
    retrieveLocale: (language) => {
      const locale = language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
      return readFileSync(path.join(STYLE_DIR, `locales-${locale}.xml`), 'utf8');
    },
  };
  const engine = new CSL.Engine(sys, readFileSync(resolveStyle(styleId), 'utf8'));
  const cluster = documents.map((document) => ({ id: String(document.id) }));
  engine.updateItems(cluster.map((item) => item.id));
  const citationHtml = engine.makeCitationCluster(cluster);
  const bibliography = engine.makeBibliography();
  const entries = bibliography?.[1] || [];
  const bibliographyHtml = entries.length ? `<div class="litdesk-bibliography">${entries.join('')}</div>` : '';
  return {
    citationHtml: `<span class="litdesk-citation">${citationHtml}</span>`,
    citationText: htmlToText(citationHtml),
    bibliographyHtml,
    bibliographyText: entries.map(htmlToText).filter(Boolean).join('\n\n'),
  };
}

export function exportCsl(documents) {
  return JSON.stringify(documents.map(toCsl), null, 2);
}

function bibEscape(value = '') {
  return String(value).replace(/[\\{}]/g, (match) => `\\${match}`).replace(/[&%#_]/g, (match) => `\\${match}`);
}

export function exportBibtex(documents) {
  const keys = new Set();
  return documents.map((document) => {
    const first = document.authors[0];
    const authorPart = (first?.family || first?.literal || 'anon').replace(/[^\p{L}\p{N}]/gu, '');
    const titlePart = (document.title.split(/\s+/)[0] || 'work').replace(/[^\p{L}\p{N}]/gu, '');
    let key = `${authorPart}${document.year || 'nd'}${titlePart}`;
    while (keys.has(key)) key += 'a';
    keys.add(key);
    const type = document.item_type === 'book' ? 'book' : document.item_type === 'paper-conference' ? 'inproceedings' : 'article';
    const fields = {
      title: document.title,
      author: document.authors.map((author) => author.literal ? bibEscape(author.literal) : `${bibEscape(author.family)}, ${bibEscape(author.given)}`).join(' and '),
      year: document.year,
      journal: type === 'article' ? document.publication : undefined,
      booktitle: type === 'inproceedings' ? document.publication : undefined,
      volume: document.volume,
      number: document.issue,
      pages: document.pages,
      publisher: document.publisher,
      doi: document.doi,
      url: document.url,
      abstract: document.abstract,
    };
    return `@${type}{${key},\n${Object.entries(fields).filter(([, value]) => value).map(([field, value]) => `  ${field} = {${bibEscape(value)}}`).join(',\n')}\n}`;
  }).join('\n\n');
}
