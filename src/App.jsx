import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LibraryBig, Search, FolderPlus, Settings2, BookOpen, Files, FileWarning, NotebookPen, Tag, ChevronDown, Check, Plus, ArrowUpRight, LoaderCircle, RefreshCw, X, Quote, PanelRightClose, Wifi, WifiOff } from 'lucide-react';
import { api } from './api.js';
import { formatAuthors, classNames } from './utils.js';
import Inspector from './components/Inspector.jsx';
import PdfReader from './components/PdfReader.jsx';
import CitationPanel from './components/CitationPanel.jsx';
import NotesExplorer from './components/NotesExplorer.jsx';
import { FolderManager, SettingsModal } from './components/Modals.jsx';

const emptyData = { documents: [], folders: [], styles: [], integrations: {}, settings: {}, stats: {}, tags: [] };

export default function App() {
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [activeId, setActiveId] = useState(() => localStorage.getItem('litdesk.activeDocument'));
  const [selectedIds, setSelectedIds] = useState([]);
  const [view, setView] = useState('library');
  const [folderFilter, setFolderFilter] = useState(null);
  const [tagFilter, setTagFilter] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  const [tab, setTab] = useState('details');
  const [modal, setModal] = useState(null);
  const [styleId, setStyleId] = useState(() => localStorage.getItem('litdesk.citationStyle') || 'gbt7714');
  const [quoteRequest, setQuoteRequest] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [liveStatus, setLiveStatus] = useState('online');
  const [aiProgress, setAiProgress] = useState({});
  const initialSelection = useRef(false);
  const searchRef = useRef(null);

  const notify = useCallback((message, type = 'success', duration = 3500) => {
    const id = crypto.randomUUID();
    setToasts((items) => [...items, { id, message, type }]);
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), duration);
  }, []);

  const refresh = useCallback(async () => {
    const next = await api.bootstrap();
    setData(next);
    setSelectedIds((current) => current.filter((id) => next.documents.some((document) => document.id === id)));
    setActiveId((current) => {
      if (!initialSelection.current) {
        initialSelection.current = true;
        return current && next.documents.some((document) => document.id === current) ? current : (next.documents[0]?.id || null);
      }
      if (current && !next.documents.some((document) => document.id === current)) return next.documents[0]?.id || null;
      return current;
    });
    return next;
  }, []);

  useEffect(() => {
    refresh().catch((error) => setLoadError(error.message)).finally(() => setLoaded(true));
  }, [refresh]);

  useEffect(() => {
    const events = new EventSource('/api/events');
    let timer;
    events.onopen = () => setLiveStatus('online');
    events.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === 'ai-progress') {
        setAiProgress((current) => ({ ...current, [`${event.documentId}:${event.operation}`]: event }));
        return;
      }
      if (event.type === 'sync-start') setLiveStatus('syncing');
      if (event.type === 'sync-complete') setLiveStatus('online');
      if (event.type === 'sync-error') {
        setLiveStatus('online');
        notify(`同步失败：${event.message}`, 'warning', 7000);
      }
      clearTimeout(timer);
      timer = setTimeout(() => refresh().catch((error) => notify(error.message, 'warning')), 350);
    };
    events.onerror = () => setLiveStatus('offline');
    return () => { events.close(); clearTimeout(timer); };
  }, [refresh, notify]);

  useEffect(() => {
    if (activeId) localStorage.setItem('litdesk.activeDocument', activeId);
    else localStorage.removeItem('litdesk.activeDocument');
  }, [activeId]);

  const activeDocument = data.documents.find((document) => document.id === activeId) || null;
  const filteredDocuments = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = data.documents.filter((document) => {
      if (view === 'missing' && !document.missing) return false;
      if (folderFilter && document.folder_id !== Number(folderFilter)) return false;
      if (tagFilter && !document.tags.includes(tagFilter)) return false;
      if (term && ![document.title, document.publication, document.doi, document.year, formatAuthors(document.authors, 20), ...document.tags].join(' ').toLowerCase().includes(term)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      if (sort === 'year') return (b.year || '').localeCompare(a.year || '') || a.title.localeCompare(b.title, 'zh-CN');
      if (sort === 'added') return b.created_at.localeCompare(a.created_at);
      return b.updated_at.localeCompare(a.updated_at);
    });
  }, [data.documents, view, folderFilter, tagFilter, query, sort]);

  const selectDocument = (id) => {
    setActiveId(id);
    if (view === 'notes') setView('library');
  };
  const toggleSelected = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const openCitation = useCallback(() => {
    if (!selectedIds.length && activeId) setSelectedIds([activeId]);
    if (selectedIds.length || activeId) setModal('citation');
  }, [selectedIds, activeId]);

  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'c') { event.preventDefault(); openCitation(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openCitation]);

  const changeStyle = (value) => { setStyleId(value); localStorage.setItem('litdesk.citationStyle', value); };
  const updateDocument = (updated) => setData((current) => ({ ...current, documents: current.documents.map((document) => document.id === updated.id ? updated : document) }));
  const removeDocument = async () => {
    if (!activeDocument) return;
    if (!window.confirm(`从文库移除“${activeDocument.title}”？\n\n不会删除原 PDF，但会删除关联笔记和 AI 摘要。若它仍在受管文件夹中，下次扫描会作为新文献重新导入。`)) return;
    try {
      await api.documents.remove(activeDocument.id);
      await refresh();
      notify('文献记录已移除，原 PDF 未改动');
    } catch (error) { notify(error.message, 'warning'); }
  };
  const jumpToNote = (id) => { setActiveId(id); setView('library'); setTab('notes'); };
  const setLibraryView = (next) => { setView(next); setFolderFilter(null); setTagFilter(null); };

  const allVisibleSelected = filteredDocuments.length > 0 && filteredDocuments.every((document) => selectedIds.includes(document.id));
  const currentFolder = data.folders.find((folder) => folder.id === Number(folderFilter));

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setLibraryView('library')}><span className="brand-mark"><LibraryBig size={23} /></span><span><strong>LitDesk</strong><small>文献工作台</small></span></button>
        <div className="global-search"><Search size={17} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === 'notes' ? '搜索笔记、摘录或文献…' : '搜索题名、作者、DOI、标签…'} /><kbd>⌘ K</kbd>{query && <button onClick={() => setQuery('')}><X size={14} /></button>}</div>
        <div className="header-actions">
          <span className={classNames('sync-status', liveStatus)}>{liveStatus === 'offline' ? <WifiOff size={14} /> : liveStatus === 'syncing' ? <RefreshCw className="spin" size={14} /> : <Wifi size={14} />}<span>{liveStatus === 'offline' ? '连接中断' : liveStatus === 'syncing' ? '同步中' : '本地已同步'}</span></span>
          <button className="icon-button" title="设置" onClick={() => setModal('settings')}><Settings2 size={19} /></button>
          <button className="button primary add-folder-button" onClick={() => setModal('folders')}><FolderPlus size={16} />管理文件夹</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <nav className="sidebar-nav">
            <div className="nav-label">文库</div>
            <button className={classNames(view === 'library' && !folderFilter && !tagFilter && 'active')} onClick={() => setLibraryView('library')}><Files size={17} /><span>全部文献</span><em>{data.stats.total || 0}</em></button>
            <button className={classNames(view === 'missing' && 'active')} onClick={() => setLibraryView('missing')}><FileWarning size={17} /><span>文件缺失</span><em>{data.stats.missing || 0}</em></button>
            <button className={classNames(view === 'notes' && 'active')} onClick={() => setLibraryView('notes')}><NotebookPen size={17} /><span>全部笔记</span><em>{data.stats.notes || 0}</em></button>
          </nav>
          <div className="sidebar-section">
            <div className="nav-label">文献文件夹<button onClick={() => setModal('folders')}><Plus size={14} /></button></div>
            {data.folders.map((folder) => <button key={folder.id} className={classNames('sidebar-folder', folderFilter === folder.id && 'active')} onClick={() => { setView('library'); setFolderFilter(folder.id); setTagFilter(null); }}><span className="folder-dot" /><span>{folder.name}</span><em>{folder.document_count || 0}</em></button>)}
            {!data.folders.length && <button className="sidebar-hint" onClick={() => setModal('folders')}>添加一个 PDF 文件夹<ArrowUpRight size={13} /></button>}
          </div>
          <div className="sidebar-section tags-section">
            <div className="nav-label">标签</div>
            {data.tags.slice(0, 10).map((tag) => <button key={tag.name} className={classNames('sidebar-tag', tagFilter === tag.name && 'active')} onClick={() => { setView('library'); setTagFilter(tag.name); setFolderFilter(null); }}><Tag size={14} /><span>{tag.name}</span><em>{tag.count}</em></button>)}
            {!data.tags.length && <p className="sidebar-empty">给文献添加标签后，<br />会显示在这里。</p>}
          </div>
          <div className="sidebar-bottom"><div className="local-card"><span className="local-pulse" /><div><strong>本地优先</strong><p>文献与笔记保存在你的电脑</p></div></div><span>LITDESK · v0.1</span></div>
        </aside>

        <main className="library-panel">
          {view === 'notes' ? <NotesExplorer query={query} onJump={jumpToNote} notify={notify} /> : <>
            <div className="list-panel-heading">
              <div><span className="eyebrow">{currentFolder ? 'FOLDER' : tagFilter ? 'TAG' : view === 'missing' ? 'ATTENTION' : 'YOUR LIBRARY'}</span><h2>{currentFolder?.name || (tagFilter ? `# ${tagFilter}` : view === 'missing' ? '文件缺失' : '全部文献')} <span>{filteredDocuments.length}</span></h2></div>
              <button className="icon-button mobile-inspector-close" onClick={() => setActiveId(null)}><PanelRightClose size={18} /></button>
            </div>
            <div className="list-toolbar">
              <label className="select-all"><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedIds(allVisibleSelected ? selectedIds.filter((id) => !filteredDocuments.some((document) => document.id === id)) : [...new Set([...selectedIds, ...filteredDocuments.map((document) => document.id)])])} /><span>全选</span></label>
              <div className="sort-control"><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">最近更新</option><option value="added">最近添加</option><option value="year">出版年份</option><option value="title">题名</option></select><ChevronDown size={13} /></div>
            </div>
            <div className="document-list">
              {!loaded && <div className="center-status"><LoaderCircle className="spin" size={22} />正在打开你的文库…</div>}
              {loaded && loadError && <div className="empty-list"><FileWarning size={34} /><h3>无法连接本地服务</h3><p>{loadError}</p><button className="button secondary" onClick={() => window.location.reload()}>重新连接</button></div>}
              {loaded && !loadError && !data.documents.length && <div className="welcome-empty">
                <div className="empty-books"><BookOpen size={42} /></div><span className="eyebrow">A QUIET PLACE FOR RESEARCH</span><h2>让你的文献，各就各位。</h2><p>选择一个存放 PDF 的文件夹。LitDesk 会读取现有文献，<br />并在每次新增时自动更新。</p>
                <button className="button primary" onClick={() => setModal('folders')}><FolderPlus size={17} />选择文献文件夹</button>
                <div className="empty-features"><span><Check size={14} />自动同步</span><span><Check size={14} />CSL 引用</span><span><Check size={14} />AI 解析</span><span><Check size={14} />阅读笔记</span></div>
              </div>}
              {loaded && data.documents.length > 0 && !filteredDocuments.length && <div className="empty-list"><Search size={32} /><h3>没有匹配的文献</h3><p>调整搜索词或清除文件夹、标签筛选。</p><button className="button secondary" onClick={() => { setQuery(''); setFolderFilter(null); setTagFilter(null); }}>清除筛选</button></div>}
              {filteredDocuments.map((document) => <article key={document.id} className={classNames('document-row', activeId === document.id && 'active', document.missing && 'missing')} onClick={() => selectDocument(document.id)} onDoubleClick={() => { setActiveId(document.id); if (!document.missing) setModal('reader'); }} tabIndex="0" onKeyDown={(event) => { if (event.key === 'Enter') selectDocument(document.id); }}>
                <label className="document-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(document.id)} onChange={() => toggleSelected(document.id)} /><span><Check size={11} /></span></label>
                <div className="document-type-icon"><BookOpen size={19} /></div>
                <div className="document-main">
                  <div className="document-title-line"><h3>{document.title}</h3>{document.missing && <span className="missing-badge">文件缺失</span>}</div>
                  <p className="document-authors">{formatAuthors(document.authors)}<span>·</span>{document.year || '年份待补'}</p>
                  <p className="document-source">{document.publication || document.file_path?.split('/').pop()}</p>
                  {(document.tags.length > 0 || document.doi) && <div className="document-labels">{document.tags.slice(0, 3).map((tag) => <span key={tag}><Tag size={11} />{tag}</span>)}{document.doi && <span className="doi-label">DOI</span>}</div>}
                </div>
                <button className="row-open" title="打开 PDF" disabled={document.missing} onClick={(event) => { event.stopPropagation(); setActiveId(document.id); setModal('reader'); }}><ArrowUpRight size={16} /></button>
              </article>)}
            </div>
          </>}
          {selectedIds.length > 0 && view !== 'notes' && <div className="citation-tray"><button className="selection-count" onClick={() => setSelectedIds([])}><span>{selectedIds.length}</span>已选<X size={12} /></button><select value={styleId} onChange={(event) => changeStyle(event.target.value)}>{data.styles.map((style) => <option key={style.id} value={style.id}>{style.shortName}</option>)}</select><button className="button primary" onClick={() => setModal('citation')}><Quote size={15} />引用文献<kbd>⌘⇧C</kbd></button></div>}
        </main>

        <Inspector document={activeDocument} tab={tab} onTabChange={setTab} onClose={() => setActiveId(null)} onUpdated={updateDocument} onOpenReader={() => setModal('reader')} onRemove={removeDocument} settings={data.settings} onOpenSettings={() => setModal('settings')} quoteRequest={quoteRequest} onQuoteConsumed={() => setQuoteRequest(null)} onCountsChange={() => refresh().catch(() => {})} notify={notify} aiProgress={aiProgress} />
      </div>

      {modal === 'reader' && activeDocument && <PdfReader document={activeDocument} onClose={() => setModal(null)} onQuote={({ quote, page }) => { setQuoteRequest({ quote, page, timestamp: Date.now() }); setTab('notes'); }} />}
      {modal === 'citation' && <CitationPanel ids={selectedIds} documents={data.documents} styles={data.styles} styleId={styleId} onStyleChange={changeStyle} onStyleAdded={(style) => setData((current) => ({ ...current, styles: [...current.styles, style] }))} integrations={data.integrations} onClose={() => setModal(null)} notify={notify} />}
      {modal === 'folders' && <FolderManager folders={data.folders} onClose={() => setModal(null)} onChanged={refresh} notify={notify} />}
      {modal === 'settings' && <SettingsModal settings={data.settings} integrations={data.integrations} onSaved={(settings) => setData((current) => ({ ...current, settings }))} onClose={() => setModal(null)} notify={notify} />}
      <div className="toast-stack">{toasts.map((toast) => <div key={toast.id} className={classNames('toast', toast.type)}><span />{toast.message}<button onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}><X size={14} /></button></div>)}</div>
    </div>
  );
}
