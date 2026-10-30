import path from 'node:path';
import { db, getDocument, now } from './db.js';
import { getDocumentPages, normalizeDoi, parseAuthors } from './pdf.js';
import { getAiConfig } from './settings.js';
import { chatCompletion } from './ai.js';

const FIELDS = ['title', 'authors', 'year', 'publication', 'doi', 'abstract', 'language', 'item_type', 'pages', 'volume', 'issue', 'publisher', 'url'];
const ITEM_TYPES = new Set(['article-journal', 'paper-conference', 'book', 'chapter', 'thesis', 'report', 'webpage']);
const FIELD_PROMPTS = {
  title: 'title：原文题名',
  authors: 'authors：作者数组，每项为 {"literal":"完整姓名"} 或 {"given":"名","family":"姓"}，不要把 CNKI 当作者',
  year: 'year：四位出版年份',
  publication: 'publication：期刊、会议或其他来源名称',
  doi: 'doi：DOI，不带 URL 前缀',
  abstract: 'abstract：仅在原文有摘要时提炼，保留研究问题、数据、方法与结论；没有摘要则为空',
  language: 'language：原文语言，如 zh-CN 或 en-US',
  item_type: 'item_type：只能是 article-journal、paper-conference、book、chapter、thesis、report、webpage',
  pages: 'pages：原文页码范围',
  volume: 'volume：卷号',
  issue: 'issue：期号',
  publisher: 'publisher：出版方',
  url: 'url：原文明确给出的 HTTP(S) 链接',
};

function parseJson(content) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {
    const object = cleaned.match(/\{[\s\S]*\}/)?.[0];
    if (!object) throw new Error('模型没有返回有效的 JSON 元数据');
    return JSON.parse(object);
  }
}

function text(value, maximum = 5000) {
  return value === undefined || value === null ? '' : String(value).trim().slice(0, maximum);
}

function normalizeAuthors(value) {
  const input = Array.isArray(value) ? value : [value];
  return input.flatMap((author) => {
    if (typeof author === 'string') return parseAuthors(author);
    if (!author || typeof author !== 'object') return [];
    if (author.literal && !/^(?:cnki|unknown|anonymous)$/i.test(author.literal)) return [{ literal: text(author.literal, 200) }];
    if (author.family || author.given) return [{ family: text(author.family, 150), given: text(author.given, 150) }];
    return [];
  }).filter((author) => author.literal || author.family || author.given).slice(0, 30);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizeProposal(content) {
  const parsed = parseJson(content);
  return {
    title: text(parsed.title, 1000),
    authors: normalizeAuthors(parsed.authors),
    year: /^(?:19|20)\d{2}$/.test(String(parsed.year)) ? String(parsed.year) : '',
    publication: text(parsed.publication, 500),
    doi: normalizeDoi(parsed.doi || ''),
    abstract: text(parsed.abstract, 20000),
    language: text(parsed.language, 40),
    item_type: ITEM_TYPES.has(parsed.item_type) ? parsed.item_type : '',
    pages: text(parsed.pages, 80),
    volume: text(parsed.volume, 80),
    issue: text(parsed.issue, 80),
    publisher: text(parsed.publisher, 500),
    url: normalizeUrl(parsed.url || ''),
  };
}

function empty(document, field) {
  if (field === 'authors') return !document.authors.length;
  return document[field] === undefined || document[field] === null || String(document[field]).trim() === '';
}

export async function completeDocumentMetadata(id, signal, onProgress) {
  const document = getDocument(id);
  if (!document) throw new Error('文献不存在');
  if (document.missing) throw new Error('原文件当前不可用');
  const requested = FIELDS.filter((field) => empty(document, field));
  if (!requested.length) return { document, changedFields: [], model: null };
  onProgress?.({ stage: 'reading', percent: 10, message: '正在读取 PDF 前两页' });
  const pages = (await getDocumentPages(document)).slice(0, 2);
  const source = pages.map((page) => `\n\n===== PDF 第 ${page.page} 页 =====\n${page.content.slice(0, 6000)}`).join('').slice(0, 12000);
  if (source.replace(/\s/g, '').length < 200) throw new Error('PDF 可提取文本太少，扫描版请先 OCR，再使用 AI 补全');
  onProgress?.({ stage: 'preparing', percent: 30, message: `已整理 ${source.length.toLocaleString('zh-CN')} 字原文 · 核对 ${requested.length} 个空缺字段` });
  const config = getAiConfig();
  const content = await chatCompletion(config, [
    {
      role: 'system',
      content: `你是严谨的文献元数据编校助手。根据文件名、已有字段和 PDF 文本识别书目。只能给出原文中有明确依据的信息，禁止猜测或编造。输出一个 JSON 对象，不要 Markdown 代码围栏。只需返回这些字段：\n${requested.map((field) => FIELD_PROMPTS[field]).join('\n')}\n没有依据的字段返回空字符串或空数组，不要修改或评论任何已有字段。`,
    },
    {
      role: 'user',
      content: `文件名：${path.basename(document.file_path)}\n已有题名：${document.title}\n已有作者：${JSON.stringify(document.authors)}\n已有年份：${document.year}\n已有 DOI：${document.doi}\n\n只需识别这些目前缺失的字段：${requested.join(', ')}\n\nPDF 文本：${source}`,
    },
  ], {
    jsonMode: true,
    maxTokens: 7000,
    signal,
    onRequest: ({ attempt, reason }) => onProgress?.({
      stage: 'generating',
      percent: 55,
      message: attempt === 1 ? '模型正在识别空缺字段' : reason === 'length' ? '内容被截断，正在提高额度重试' : '正在使用兼容模式重试',
      attempt,
    }),
  });
  onProgress?.({ stage: 'saving', percent: 90, message: '模型已返回，正在核对并保存空缺字段' });
  const proposal = normalizeProposal(content);
  const changes = {};
  for (const field of requested) {
    const value = proposal[field];
    if (field === 'authors' ? value.length : Boolean(value)) changes[field] = value;
  }
  if (Object.keys(changes).length) {
    const assignments = Object.keys(changes).map((field) => `${field} = ?`).join(', ');
    const values = Object.values(changes).map((value) => Array.isArray(value) ? JSON.stringify(value) : value);
    db.prepare(`UPDATE documents SET ${assignments}, metadata_source = 'ai', updated_at = ? WHERE id = ?`).run(...values, now(), id);
  }
  onProgress?.({ stage: 'complete', percent: 100, message: '书目核对完成' });
  return { document: getDocument(id), changedFields: Object.keys(changes), model: config.model };
}
