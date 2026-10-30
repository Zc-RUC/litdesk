import { useEffect, useRef, useState } from 'react';
import { Save, LoaderCircle, RefreshCw, Sparkles, FolderOpen, FileText, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { authorsToText, textToAuthors, fileSize, formatDate } from '../utils.js';
import AiProgress from './AiProgress.jsx';

const sourceNames = { pdf: 'PDF 自动识别', crossref: 'Crossref 补全', manual: '手动编校', filename: '文件名', ai: 'AI 补全' };
const fieldLabels = { title: '题名', authors: '作者', year: '年份', publication: '来源', doi: 'DOI', abstract: '摘要', language: '语言', item_type: '文献类型', pages: '页码', volume: '卷', issue: '期', publisher: '出版方', url: 'URL' };
const fields = ['title', 'year', 'publication', 'doi', 'abstract', 'language', 'item_type', 'pages', 'volume', 'issue', 'publisher', 'url'];
const makeForm = (document) => ({ ...Object.fromEntries(fields.map((field) => [field, document[field] || ''])), authors: authorsToText(document.authors), tags: document.tags.join(', ') });

export default function MetadataPanel({ document, onUpdated, onOpenReader, onRemove, settings, onOpenSettings, notify }) {
  const [form, setForm] = useState(makeForm(document));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState('');
  const controllerRef = useRef(null);

  useEffect(() => {
    setForm(makeForm(document));
    setDirty(false);
    return () => controllerRef.current?.abort();
  }, [document.id, document.updated_at]);
  const edit = (field, value) => { setForm((current) => ({ ...current, [field]: value })); setDirty(true); };
  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setWorking('');
    notify('已取消本次 AI 补全', 'warning');
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.documents.update(document.id, {
        ...form,
        authors: textToAuthors(form.authors),
        tags: form.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      });
      onUpdated(updated);
      setDirty(false);
      notify('元数据已保存');
      return updated;
    } catch (error) {
      notify(error.message, 'warning');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const work = async (kind) => {
    setWorking(kind);
    try {
      const updated = kind === 'refresh' ? await api.documents.refresh(document.id) : await api.documents.enrich(document.id);
      onUpdated(updated);
      notify(kind === 'refresh' ? '已重新读取 PDF 文件信息，手动书目已保留' : 'Crossref 元数据已补全');
    } catch (error) {
      notify(error.message, 'warning');
    } finally {
      setWorking('');
    }
  };

  const completeMetadata = async () => {
    if (!settings?.ai?.configured) {
      onOpenSettings();
      return;
    }
    if (dirty && !(await save())) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking('ai-complete');
    try {
      const result = await api.documents.completeMetadata(document.id, { signal: controller.signal });
      onUpdated(result.document);
      if (result.changedFields.length) {
        notify(`AI 补全完成：${result.changedFields.map((field) => fieldLabels[field] || field).join('、')}`, 'success', 6000);
      } else {
        notify(result.model ? 'AI 未找到有原文依据的补全信息' : '没有需要补全的空缺字段', 'warning', 6000);
      }
    } catch (error) {
      if (error.name !== 'AbortError') notify(`AI 补全失败：${error.message}`, 'warning', 8000);
    } finally {
      if (controllerRef.current === controller) {
        setWorking('');
        controllerRef.current = null;
      }
    }
  };

  return (
    <div className="metadata-panel">
      <button className="reader-card" onClick={onOpenReader} disabled={document.missing}>
        <div className="reader-card-icon"><FileText size={23} /></div>
        <div><strong>{document.missing ? 'PDF 文件不可用' : '打开 PDF 阅读器'}</strong><span>{document.page_count ? `${document.page_count} 页` : '页数待识别'} · {fileSize(document.file_size)}</span></div>
        <span>阅读</span>
      </button>
      <button className="ai-complete-button" onClick={completeMetadata} disabled={document.missing || Boolean(working)} title={settings?.ai?.configured ? '仅填补空缺字段，不覆盖已有内容' : '先在设置中配置 AI API'}>
        {working === 'ai-complete' ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
        <strong>{working === 'ai-complete' ? 'AI 补全中…' : '一键 AI 补全'}</strong>
        <small>{working === 'ai-complete' ? '正在读取首页并核对字段' : '仅填空缺，不覆盖已有内容'}</small>
      </button>
      {working === 'ai-complete' && <AiProgress onCancel={cancel} />}
      {document.extraction_error && <div className="inline-warning">PDF 元数据读取不完整：{document.extraction_error}</div>}
      <div className="metadata-section-heading"><span>书目信息</span><span className="source-badge">{sourceNames[document.metadata_source] || document.metadata_source}</span></div>
      <label className="field"><span>题名</span><textarea rows="3" value={form.title} onChange={(event) => edit('title', event.target.value)} /></label>
      <label className="field"><span>作者 <small>每行一位；英文可写“名 姓”或“姓, 名”</small></span><textarea rows="2" value={form.authors} onChange={(event) => edit('authors', event.target.value)} placeholder="Alice Smith&#10;张三" /></label>
      <div className="field-row">
        <label className="field"><span>年份</span><input value={form.year} onChange={(event) => edit('year', event.target.value)} placeholder="2025" /></label>
        <label className="field"><span>文献类型</span><select value={form.item_type} onChange={(event) => edit('item_type', event.target.value)}><option value="article-journal">期刊论文</option><option value="paper-conference">会议论文</option><option value="book">图书</option><option value="chapter">图书章节</option><option value="thesis">学位论文</option><option value="report">报告</option><option value="webpage">网页</option></select></label>
      </div>
      <label className="field"><span>期刊 / 会议 / 来源</span><input value={form.publication} onChange={(event) => edit('publication', event.target.value)} /></label>
      <label className="field"><span>DOI</span><div className="input-action"><input value={form.doi} onChange={(event) => edit('doi', event.target.value)} placeholder="10.xxxx/xxxxx" /><button disabled={!form.doi || working === 'enrich'} title="先保存 DOI，再从 Crossref 补全" onClick={async () => { if (dirty) await save(); await work('enrich'); }}>{working === 'enrich' ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}补全</button></div></label>
      <div className="field-row three">
        <label className="field"><span>卷</span><input value={form.volume} onChange={(event) => edit('volume', event.target.value)} /></label>
        <label className="field"><span>期</span><input value={form.issue} onChange={(event) => edit('issue', event.target.value)} /></label>
        <label className="field"><span>页码</span><input value={form.pages} onChange={(event) => edit('pages', event.target.value)} /></label>
      </div>
      <details className="more-fields">
        <summary>更多出版信息</summary>
        <label className="field"><span>语言</span><input value={form.language} onChange={(event) => edit('language', event.target.value)} placeholder="zh-CN / en-US" /></label>
        <label className="field"><span>出版方</span><input value={form.publisher} onChange={(event) => edit('publisher', event.target.value)} /></label>
        <label className="field"><span>URL</span><input value={form.url} onChange={(event) => edit('url', event.target.value)} placeholder="https://…" /></label>
        <label className="field"><span>摘要</span><textarea rows="5" value={form.abstract} onChange={(event) => edit('abstract', event.target.value)} /></label>
      </details>
      <label className="field"><span>标签 <small>用逗号分隔</small></span><input value={form.tags} onChange={(event) => edit('tags', event.target.value)} placeholder="劳动经济学, 因果推断" /></label>
      <div className="metadata-actions"><button className="text-button" disabled={document.missing || working === 'refresh'} onClick={() => work('refresh')}>{working === 'refresh' ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}刷新文件信息</button><button className="text-button" onClick={() => api.documents.reveal(document.id).catch((error) => notify(error.message, 'warning'))}><FolderOpen size={14} />在 Finder 中显示</button></div>
      <div className="file-details"><span>文件位置</span><code>{document.file_path || '无附件'}</code><span>加入文库于 {formatDate(document.created_at)}</span></div>
      <div className="metadata-savebar"><button className="button danger-subtle icon-only" title="从文库移除（不删除原文件）" onClick={onRemove}><Trash2 size={16} /></button><button className="button primary grow" disabled={!dirty || saving} onClick={save}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? '保存中…' : dirty ? '保存元数据' : '所有更改已保存'}</button></div>
    </div>
  );
}
