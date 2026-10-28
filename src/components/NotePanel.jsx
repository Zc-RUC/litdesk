import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Plus, Trash2, Eye, PenLine, LoaderCircle, Check, NotebookPen, Quote } from 'lucide-react';
import { api } from '../api.js';
import { formatDate, classNames } from '../utils.js';

const asDraft = (note) => ({ title: note.title || '', content: note.content || '', quote: note.quote || '', page: note.page || '' });

export default function NotePanel({ document, quoteRequest, onQuoteConsumed, onCountsChange, notify }) {
  const [notes, setNotes] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const select = useCallback((note) => {
    setActiveId(note?.id || null);
    setDraft(note ? asDraft(note) : null);
    setDirty(false);
    setPreview(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.documents.notes(document.id);
      setNotes(items);
      select(items[0] || null);
    } catch (error) {
      notify(error.message, 'warning');
    } finally {
      setLoading(false);
    }
  }, [document.id, notify, select]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (values = draftRef.current) => {
    if (!activeId || !values) return;
    setSaving(true);
    try {
      const updated = await api.notes.update(activeId, values);
      setNotes((items) => items.map((note) => note.id === activeId ? updated : note));
      setDraft(asDraft(updated));
      setDirty(false);
      setSavedAt(new Date());
    } catch (error) {
      notify(`自动保存失败：${error.message}`, 'warning');
    } finally {
      setSaving(false);
    }
  }, [activeId, notify]);

  useEffect(() => {
    if (!dirty || !activeId) return;
    const timer = setTimeout(() => save(), 800);
    return () => clearTimeout(timer);
  }, [draft, dirty, activeId, save]);

  const create = async (seed = {}) => {
    try {
      const note = await api.notes.create(document.id, { title: seed.title || '', content: seed.content || '', quote: seed.quote || '', page: seed.page || null });
      setNotes((items) => [note, ...items]);
      select(note);
      onCountsChange();
    } catch (error) {
      notify(error.message, 'warning');
    }
  };

  useEffect(() => {
    if (quoteRequest) {
      create({ quote: quoteRequest.quote, page: quoteRequest.page, title: `第 ${quoteRequest.page} 页摘录` });
      onQuoteConsumed();
    }
  }, [quoteRequest]);

  const edit = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };

  const switchNote = async (note) => {
    if (dirty) await save();
    select(note);
  };

  const remove = async () => {
    if (!activeId || !window.confirm('删除这份笔记？此操作不会影响原 PDF，但无法撤销。')) return;
    await api.notes.remove(activeId);
    const remaining = notes.filter((note) => note.id !== activeId);
    setNotes(remaining);
    select(remaining[0] || null);
    onCountsChange();
    notify('笔记已删除');
  };

  return (
    <div className="notes-panel">
      <div className="panel-toolbar">
        <span>{notes.length} 份笔记</span>
        <button className="button small secondary" onClick={() => create()}><Plus size={14} />新建笔记</button>
      </div>
      {loading ? <div className="center-status"><LoaderCircle className="spin" size={18} />读取笔记…</div> : <>
        <div className="note-list">
          {notes.map((note) => <button key={note.id} className={classNames('note-list-item', note.id === activeId && 'active')} onClick={() => switchNote(note)}>
            <NotebookPen size={15} />
            <span><strong>{note.title || '无题笔记'}</strong><small>{note.page ? `第 ${note.page} 页 · ` : ''}{formatDate(note.updated_at, true)}</small></span>
          </button>)}
          {!notes.length && <div className="mini-empty"><NotebookPen size={24} /><p>记录疑问、方法和阅读灵感。<br />PDF 中的摘录会自动带上页码。</p></div>}
        </div>
        {draft && <div className="note-editor">
          <div className="note-editor-top">
            <input className="note-title-input" value={draft.title} placeholder="笔记标题" onChange={(event) => edit('title', event.target.value)} />
            <div><button className="icon-button" title={preview ? '编辑' : '预览'} onClick={() => setPreview((value) => !value)}>{preview ? <PenLine size={16} /> : <Eye size={16} />}</button><button className="icon-button danger" onClick={remove}><Trash2 size={16} /></button></div>
          </div>
          <div className="note-context-row">
            <label>页码 <input type="number" min="1" value={draft.page} onChange={(event) => edit('page', event.target.value)} /></label>
            <span className="save-state">{saving ? <><LoaderCircle className="spin" size={12} />保存中</> : dirty ? '编辑中…' : savedAt ? <><Check size={12} />已自动保存</> : '自动保存'}</span>
          </div>
          {draft.quote && <div className="note-quote"><Quote size={14} /><textarea value={draft.quote} onChange={(event) => edit('quote', event.target.value)} rows="2" /></div>}
          {preview ? <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(draft.content || '还没有正文。')) }} /> : <textarea className="note-content-input" value={draft.content} placeholder="支持 Markdown：## 小标题、- 列表、**重点**…" onChange={(event) => edit('content', event.target.value)} />}
        </div>}
      </>}
    </div>
  );
}
