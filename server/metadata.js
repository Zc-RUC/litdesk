import path from 'node:path';

const SURNAMES = new Set('王 李 张 刘 陈 杨 黄 赵 吴 周 徐 孙 马 朱 胡 郭 何 高 林 罗 郑 梁 谢 宋 唐 许 韩 冯 邓 曹 彭 曾 肖 田 董 袁 潘 蒋 蔡 余 杜 叶 程 苏 魏 吕 丁 任 沈 姚 卢 姜 崔 钟 谭 陆 汪 范 金 石 廖 贾 夏 韦 付 方 白 邹 孟 熊 秦 邱 侯 江 尹 薛 闫 段 雷 龙 黎 史 陶 贺 顾 毛 郝 龚 邵 万 钱 严 覃 武 戴 莫 孔 向 汤'.split(' '));
const COMPOUND_SURNAMES = ['欧阳', '司马', '诸葛', '上官', '夏侯', '皇甫', '尉迟', '公孙', '令狐', '慕容', '司徒'];
const TITLE_NOISE = /^(?:第[\d一二三四五六七八九十百]+[卷期](?:\s|$)|[-—–\d\s·]+|摘要|内容提要|关键词|引言|一[、\s]|DOI\b|收稿|作者简介|基金|调查报告|经济学管理学|CNKI\b|www\.|https?)/i;

export function cleanMetadataText(value = '') {
  return String(value).normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '')
    .replace(/\s*([，。；：、？！（）【】《》«»])\s*/g, '$1')
    .replace(/\s+([*†‡§])/g, '$1')
    .replace(/(?<=[\u3400-\u9fff])\s*:\s*/g, '：')
    .replace(/(?<=[\u3400-\u9fff])\s*,\s*/g, '，')
    .replace(/(?<=[\u3400-\u9fff])\s*;\s*/g, '；')
    .replace(/(?<=[\u3400-\u9fff])\s*\?\s*/g, '？')
    .replace(/(?<=[\u3400-\u9fff])\s*!\s*/g, '！')
    .replace(/(?<=[\u3400-\u9fff])\s*\(\s*/g, '（')
    .replace(/\s*\)\s*(?=[\u3400-\u9fff]|$)/g, '）')
    .trim();
}

export function compactMetadataText(value = '') {
  return cleanMetadataText(value).replace(/[\s\-–—_*†‡§·•]/g, '');
}

export function parseFilenameMetadata(filePath) {
  const basename = path.basename(filePath, path.extname(filePath));
  const match = basename.match(/^(.+)_([^_]+)_((?:19|20)\d{2})$/);
  if (!match) return null;
  return {
    title: cleanMetadataText(match[1].replace(/_+/g, ' ')),
    authorText: match[2].trim(),
    year: match[3],
  };
}

export function usefulMetadataTitle(value) {
  const title = cleanMetadataText(value);
  if (title.length < 4 || title.length > 300) return false;
  if (/^(?:untitled|document|microsoft word|adobe|scanned|cnki|author|unknown|none|null)$/i.test(title)) return false;
  const letters = title.match(/[\p{L}\p{N}]/gu)?.length || 0;
  return letters >= 4 && !TITLE_NOISE.test(title);
}

export function bestTitleFromLines(lines, fallback = '') {
  const cleaned = lines.map(cleanMetadataText).filter(Boolean);
  const candidates = [];
  for (let index = 0; index < Math.min(cleaned.length, 60); index += 1) {
    const line = cleaned[index];
    if (!usefulMetadataTitle(line)) continue;
    const letters = line.match(/[\p{L}]/gu)?.length || 0;
    if (letters < 5) continue;
    let score = Math.min(line.length, 140) + (index < 12 ? 45 : 0) - (index > 35 ? 20 : 0);
    if (line.length > 180) score -= 100;
    if (/摘要|内容提要|关键词|引言/.test(line)) score -= 80;
    if (/[。；]$/.test(line)) score -= 40;
    candidates.push({ line, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.line || fallback;
}

function nextSurnameIndex(text, start) {
  for (let index = start + 1; index <= Math.min(start + 3, text.length - 2); index += 1) {
    if (COMPOUND_SURNAMES.some((surname) => text.startsWith(surname, index))) return index;
    if (SURNAMES.has(text[index])) return index;
  }
  return -1;
}

function segmentNames(value, anchor) {
  const text = compactMetadataText(value).replace(/^[*†‡§]+|[*†‡§]+$/g, '');
  const anchorIndex = text.indexOf(anchor);
  if (anchorIndex < 0) return [];
  if (anchorIndex > 4) return [];
  const names = [];
  let rest = text.slice(anchorIndex);
  while (rest.length) {
    if (rest.length < 2) return [];
    const next = nextSurnameIndex(rest, 1);
    const name = next > 0 ? rest.slice(0, next) : rest;
    if (name.length < 2 || name.length > 4) return [];
    names.push(name);
    if (next < 0) break;
    rest = rest.slice(next);
    if (names.length > 6) return [];
  }
  return names[0] === anchor ? names.map((literal) => ({ literal })) : [];
}

export function authorsFromFirstPage(lines, baselineAuthors = []) {
  if (!baselineAuthors.length) return baselineAuthors;
  const first = baselineAuthors[0];
  const anchor = compactMetadataText(first.literal || `${first.given || ''}${first.family || ''}`);
  if (!anchor) return baselineAuthors;
  const cleaned = lines.map(cleanMetadataText).filter(Boolean);
  for (const line of cleaned.slice(0, 45)) {
    if (line.length > 110 || /摘要|内容提要|关键词|引言|DOI|收稿|基金|邮编|大学|学院|邮箱|@/i.test(line)) continue;
    const compact = compactMetadataText(line);
    if (!compact.includes(anchor)) continue;
    if (compact.length > anchor.length * 5 && compact.length > 30) continue;
    if (/、|,|，|;|；|&/.test(line)) {
      const parts = line.split(/、|,|，|;|；|&/).map((part) => cleanMetadataText(part).replace(/[*†‡§]/g, '')).filter(Boolean);
      if (parts.length > 1 && parts.every((part) => /^[\u3400-\u9fff·•]{2,5}$/.test(part)) && compact.includes(anchor)) {
        return parts.map((literal) => ({ literal }));
      }
    }
    const segmented = segmentNames(line, anchor);
    if (segmented.length) return segmented;
  }
  return baselineAuthors;
}

function validJournalName(value, title) {
  let name = cleanMetadataText(value).replace(/^[*†‡§\s]+|[*†‡§\s]+$/g, '');
  if (name.length < 2 || name.length > 60) return '';
  if (compactMetadataText(name) === compactMetadataText(title)) return '';
  if (TITLE_NOISE.test(name) || /摘要|内容提要|关键词|引言|作者|收稿|基金|DOI/i.test(name)) return '';
  if (/[�《》]|参见|载《|：|，|；/.test(name) || /^[A-Za-z]\s/.test(name)) return '';
  const chinaIndex = name.lastIndexOf('中国');
  if (chinaIndex > 0 && chinaIndex <= 12) name = name.slice(chinaIndex);
  return name;
}

export function publicationFromLines(lines, title = '', subject = '') {
  const cleaned = lines.map(cleanMetadataText).filter(Boolean);
  for (const line of cleaned.slice(0, 8)) {
    const bilingual = line.match(/^(?:\d+\s+)?(.{2,40}?)\s+[A-Za-z][A-Za-z ]+$/);
    if (bilingual && /学报|研究|世界|法学|科学|经济|管理|人口|社会|财政|金融|劳动/.test(bilingual[1])) {
      const journal = validJournalName(bilingual[1], title);
      if (journal) return journal;
    }
  }
  const patterns = [
    /^《([^》]{2,50})》$/,
    /^(.+?)\s*\*\s*(?:19|20)\d{2}\s*年\s*第/i,
    /^(.+?)(?:19|20)\d{2}\s*年\s*第/i,
    /(?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*(.{2,50})$/i,
    /^(?:19|20)\d{2}\s+\d{1,2}\s+([A-Za-z][A-Za-z ]{5,90})$/,
  ];
  for (const line of cleaned.slice(0, 12)) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      let candidate = match[1];
      if (pattern === patterns[1] || pattern === patterns[2]) candidate = candidate.replace(/^[·\s]+/, '');
      const journal = validJournalName(candidate, title);
      if (journal) return journal;
    }
  }
  return validJournalName(subject, title);
}
