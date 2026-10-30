import { db, getDocument, now } from './db.js';
import { getDocumentPages } from './pdf.js';
import { getAiConfig } from './settings.js';

export const SUMMARY_SECTIONS = [
  ['oneSentence', '一句话读懂'],
  ['researchQuestion', '研究问题'],
  ['researchDesign', '研究思路与设计'],
  ['data', '数据与样本'],
  ['methods', '分析方法'],
  ['findings', '主要结论'],
  ['limitations', '局限与阅读提示'],
];

export async function chatCompletion(config, messages, { jsonMode = false, maxTokens = 3000, retryOnLength = true, signal, onRequest } = {}) {
  if (!config.baseUrl || !config.model) throw new Error('请先在设置中填写 API 地址和模型名称');
  const body = {
    model: config.model,
    messages,
    temperature: config.temperature ?? 0.2,
    max_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const signals = [AbortSignal.timeout(180000)];
  if (signal) signals.push(signal);
  let attempt = 0;
  const request = async (payload, reason = 'initial') => {
    attempt += 1;
    onRequest?.({ attempt, maxTokens: payload.max_tokens, reason });
    return fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.any(signals),
    });
  };
  let response = await request(body);
  if (!response.ok && jsonMode && [400, 404, 422].includes(response.status)) {
    await response.body?.cancel();
    delete body.response_format;
    response = await request(body, 'compatibility');
  }
  if (!response.ok) {
    const raw = await response.text();
    let detail = raw;
    try { detail = JSON.parse(raw).error?.message || raw; } catch {}
    throw new Error(`AI 服务返回 ${response.status}：${String(detail).slice(0, 500)}`);
  }
  const payload = await response.json();
  const choice = payload.choices?.[0];
  if (retryOnLength && choice?.finish_reason === 'length' && maxTokens < 12000) {
    return chatCompletion(config, messages, {
      jsonMode,
      maxTokens: Math.min(maxTokens * 2, 12000),
      retryOnLength: false,
      signal,
      onRequest: (info) => onRequest?.({ ...info, attempt: info.attempt + 1, reason: info.reason === 'initial' ? 'length' : info.reason }),
    });
  }
  const content = choice?.message?.content;
  const text = Array.isArray(content) ? content.map((part) => part.text || '').join('\n') : content;
  if (!text) throw new Error(`AI 服务没有返回可读取的内容（${choice?.finish_reason || '未知原因'}）`);
  return text;
}

function selectExcerpt(pages) {
  const pattern = /abstract|introduction|methods?|methodology|data|sample|empirical|results?|conclusions?|robustness|摘要|引言|研究设计|方法|数据|样本|实证|结果|结论|稳健性/gi;
  const ranked = pages.map((page, index) => {
    const matches = page.content.match(pattern)?.length || 0;
    return { ...page, score: matches * 20 + (index < 2 ? 1000 : 0) + (/conclusions?|结论/i.test(page.content) ? 50 : 0) };
  }).sort((a, b) => b.score - a.score);
  const selected = [];
  let characters = 0;
  for (const page of ranked) {
    if (selected.length >= 10) break;
    const content = page.content.slice(0, 4800);
    if (characters + content.length > 32000 && selected.length) continue;
    selected.push({ page: page.page, content });
    characters += content.length;
    if (characters >= 32000) break;
  }
  return selected.sort((a, b) => a.page - b.page);
}

function normalizeSummary(content) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch {
    const object = cleaned.match(/\{[\s\S]*\}/)?.[0];
    if (!object) throw new Error('模型没有返回结构化 JSON，请重试或更换支持 JSON 的模型');
    parsed = JSON.parse(object);
  }
  const normalized = {};
  for (const [key] of SUMMARY_SECTIONS) {
    const value = parsed[key];
    normalized[key] = Array.isArray(value) ? value.map(String).join('\n') : String(value || '').trim();
  }
  if (!Object.values(normalized).some(Boolean)) throw new Error('模型返回了空摘要');
  return normalized;
}

export async function testAiConnection() {
  const config = getAiConfig();
  await chatCompletion(config, [{ role: 'user', content: 'Reply with OK only.' }], { maxTokens: 64 });
  return { success: true, model: config.model };
}

export async function summarizeDocument(id, signal, onProgress) {
  const document = getDocument(id);
  if (!document) throw new Error('文献不存在');
  if (document.missing) throw new Error('原文件当前不可用');
  onProgress?.({ stage: 'reading', percent: 10, message: '正在读取 PDF 文本' });
  const pages = await getDocumentPages(document);
  const totalCharacters = pages.reduce((sum, page) => sum + page.content.replace(/\s/g, '').length, 0);
  if (totalCharacters < 400) throw new Error('PDF 中没有足够的可提取文本。扫描版请先进行 OCR，再使用 AI 解析');
  const excerpt = selectExcerpt(pages);
  const source = excerpt.map((page) => `\n\n===== PDF 第 ${page.page} 页 =====\n${page.content}`).join('');
  onProgress?.({ stage: 'preparing', percent: 30, message: `已选取 ${excerpt.length} 页 · ${source.length.toLocaleString('zh-CN')} 字原文` });
  const config = getAiConfig();
  const content = await chatCompletion(config, [
    {
      role: 'system',
      content: `你是一名严谨的学术研究助手。根据用户提供的 PDF 分页文本分析文献，只陈述文本中有依据的内容，不补造数据、方法或结论。用简体中文输出一个 JSON 对象，不要 Markdown 代码围栏。必须包含以下字符串字段：oneSentence（一句话概括）、researchQuestion（研究问题）、researchDesign（研究思路、识别/实验/理论设计）、data（数据来源、样本范围、时间、样本量，如文本有）、methods（具体分析方法、模型或稳健性方法）、findings（主要结果）、limitations（文本明确承认的局限；没有就写“原文未明确说明”）。关键事实后用“（PDF 第 X 页）”标注页码。信息不足时明确写“所提供文本未说明”，不要猜测。`,
    },
    {
      role: 'user',
      content: `文献题名：${document.title}\n作者：${document.authors.map((author) => author.literal || `${author.given || ''} ${author.family || ''}`).join(', ')}\n年份：${document.year}\n\n以下是按研究相关度选取、再按页码排序的原文：${source}`,
    },
  ], {
    jsonMode: true,
    maxTokens: 3000,
    signal,
    onRequest: ({ attempt, reason }) => onProgress?.({
      stage: 'generating',
      percent: 55,
      message: attempt === 1 ? '模型正在生成文献解析' : reason === 'length' ? '内容被截断，正在提高额度重试' : '正在使用兼容模式重试',
      attempt,
    }),
  });
  onProgress?.({ stage: 'saving', percent: 90, message: '模型已返回，正在整理并保存解析' });
  const summary = normalizeSummary(content);
  db.prepare(`INSERT INTO summaries (document_id, content, model, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET content = excluded.content, model = excluded.model, created_at = excluded.created_at`)
    .run(id, JSON.stringify(summary), config.model, now());
  onProgress?.({ stage: 'complete', percent: 100, message: '文献解析已保存' });
  return getSummary(id);
}

export function getSummary(id) {
  const row = db.prepare('SELECT * FROM summaries WHERE document_id = ?').get(id);
  return row ? { ...row, content: JSON.parse(row.content) } : null;
}

export function summaryToMarkdown(summary) {
  return SUMMARY_SECTIONS.map(([key, label]) => `## ${label}\n\n${summary.content[key] || '未提供'}`).join('\n\n');
}
