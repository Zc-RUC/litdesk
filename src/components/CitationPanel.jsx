import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { X, Copy, Check, FileUp, Download, LoaderCircle, BookOpenCheck, Info, ArrowUpRight } from 'lucide-react';
import { api, downloadReferences } from '../api.js';
import { copyRichText, classNames } from '../utils.js';

export default function CitationPanel({ ids, documents, styles, styleId, onStyleChange, onStyleAdded, integrations, onClose, notify }) {
  const [rendered, setRendered] = useState(null);
  const [mode, setMode] = useState('citation');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [inserting, setInserting] = useState('');
  const fileRef = useRef(null);
  const selected = ids.map((id) => documents.find((document) => document.id === id)).filter(Boolean);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      api.citations.render(ids, styleId).then((result) => {
        if (!cancelled) setRendered(result);
      }).catch((reason) => {
        if (!cancelled) setError(reason.message);
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ids, styleId]);

  const current = mode === 'citation'
    ? { html: rendered?.citationHtml, text: rendered?.citationText }
    : { html: rendered?.bibliographyHtml, text: rendered?.bibliographyText };

  const copy = async () => {
    if (!current.text) return;
    try {
      const kind = await copyRichText(current.html, current.text);
      setCopied(true);
      notify(mode === 'citation' ? '文内引用已复制，可在 Word/WPS 中粘贴' : `参考文献已复制${kind === 'rich' ? '，粘贴时保留斜体等格式' : ''}`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      notify('浏览器未允许访问剪贴板。你也可以使用下方 Word/WPS 插入，或选中预览文本手动复制。', 'warning', 7000);
    }
  };

  const insert = async (target) => {
    setInserting(target);
    try {
      const result = await api.citations.insert(ids, styleId, mode, target);
      notify(result.message, 'success', 5000);
    } catch (reason) {
      notify(reason.message, 'warning', 8000);
    } finally {
      setInserting('');
    }
  };

  const uploadStyle = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const style = await api.citations.addStyle(file.name, await file.text());
      onStyleAdded(style);
      onStyleChange(style.id);
      notify(`已添加样式：${style.name}`);
    } catch (reason) {
      notify(reason.message, 'warning');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="引用中心">
      <div className="modal citation-modal">
        <header className="modal-header">
          <div><span className="eyebrow">CITATION STUDIO</span><h2>引用中心</h2><p>{selected.length} 篇文献 · 由 CSL 引文引擎实时排版</p></div>
          <button className="icon-button" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="citation-controls">
          <label className="field grow"><span>引用格式</span><select value={styleId} onChange={(event) => onStyleChange(event.target.value)}>{styles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label>
          <button className="button secondary upload-style" onClick={() => fileRef.current.click()}><FileUp size={16} />导入 .csl</button>
          <input ref={fileRef} type="file" accept=".csl,text/xml" hidden onChange={uploadStyle} />
        </div>
        <div className="selected-citation-docs">{selected.map((document) => <span key={document.id}><BookOpenCheck size={13} />{document.title}</span>)}</div>
        <div className="segmented citation-mode">
          <button className={classNames(mode === 'citation' && 'active')} onClick={() => setMode('citation')}>文内引用</button>
          <button className={classNames(mode === 'bibliography' && 'active')} onClick={() => setMode('bibliography')}>参考文献表</button>
        </div>
        <section className="citation-preview-section">
          <div className="preview-label"><span>{mode === 'citation' ? '插入正文中的引文' : '按当前顺序生成的参考文献'}</span><span>{styles.find((style) => style.id === styleId)?.language}</span></div>
          <div className={classNames('citation-preview', mode === 'bibliography' && 'bibliography')}>
            {loading && <div className="center-status"><LoaderCircle className="spin" size={20} />正在排版…</div>}
            {!loading && error && <p className="error-text">{error}</p>}
            {!loading && !error && rendered && <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(current.html || '') }} />}
          </div>
          <div className="citation-actions">
            <button className="button primary" disabled={!current.text || loading} onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? '已复制' : '复制富文本'}</button>
            <span className="action-divider" />
            <span className="insert-label">插入到</span>
            {['word', 'wps'].map((target) => <button key={target} className="button app-button" disabled={!integrations?.[target]?.installed || !current.text || Boolean(inserting)} onClick={() => insert(target)}>
              {inserting === target ? <LoaderCircle className="spin" size={15} /> : <ArrowUpRight size={15} />}{integrations?.[target]?.label || target.toUpperCase()}
            </button>)}
          </div>
        </section>
        <div className="static-citation-note"><Info size={15} /><p><strong>域格式引用：</strong>一键插入为 Word/WPS 域，点击或选中引用时可显示浅灰底纹（取决于应用的“域底纹”设置）。暂不支持自动更新；“复制富文本”仍为普通文本。</p></div>
        <footer className="modal-footer citation-footer">
          <span>也可以导出后导入 Zotero、EndNote 或 LaTeX 工作流</span>
          <div><button className="text-button" onClick={() => downloadReferences(ids, 'csl')}><Download size={14} />CSL JSON</button><button className="text-button" onClick={() => downloadReferences(ids, 'bibtex')}><Download size={14} />BibTeX</button></div>
        </footer>
      </div>
    </div>
  );
}
