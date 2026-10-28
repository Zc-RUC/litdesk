export function formatAuthors(authors = [], limit = 3) {
  const names = authors.map((author) => author.literal || [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean);
  if (!names.length) return '作者待补全';
  return names.slice(0, limit).join(' · ') + (names.length > limit ? ` 等 ${names.length} 人` : '');
}

export function authorsToText(authors = []) {
  return authors.map((author) => author.literal || [author.given, author.family].filter(Boolean).join(' ')).join('\n');
}

export function textToAuthors(value) {
  return String(value).split('\n').map((name) => name.trim()).filter(Boolean).map((name) => {
    if (/^[\u3400-\u9fff·•]{2,8}$/.test(name)) return { literal: name };
    if (name.includes(',')) {
      const [family, ...given] = name.split(',');
      return { family: family.trim(), given: given.join(',').trim() };
    }
    const parts = name.split(/\s+/);
    return parts.length === 1 ? { literal: name } : { family: parts.at(-1), given: parts.slice(0, -1).join(' ') };
  });
}

export function formatDate(value, includeTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('zh-CN', includeTime
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

export function fileSize(bytes = 0) {
  if (!bytes) return '—';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export async function copyRichText(html, text) {
  let clipboardError;
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return 'rich';
    } catch (error) {
      clipboardError = error;
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'plain';
    } catch (error) {
      clipboardError = error;
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;left:-9999px;opacity:0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw clipboardError || new Error('浏览器未允许访问剪贴板');
  return 'plain';
}

export function classNames(...values) {
  return values.filter(Boolean).join(' ');
}
