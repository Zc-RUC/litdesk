import { Info, Sparkles, NotebookPen, BookOpen, X } from 'lucide-react';
import MetadataPanel from './MetadataPanel.jsx';
import AiPanel from './AiPanel.jsx';
import NotePanel from './NotePanel.jsx';
import { classNames } from '../utils.js';

export default function Inspector({ document, tab, onTabChange, onClose, onUpdated, onOpenReader, onRemove, settings, onOpenSettings, quoteRequest, onQuoteConsumed, onCountsChange, notify }) {
  if (!document) return <aside className="inspector empty-inspector"><div><BookOpen size={34} /><h3>选择一篇文献</h3><p>查看书目信息、AI 解析与阅读笔记</p></div></aside>;
  return (
    <aside className="inspector">
      <header className="inspector-header">
        <div><span className="eyebrow">DOCUMENT</span><h2>{document.title}</h2></div>
        <button className="icon-button inspector-close" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="inspector-tabs">
        <button className={classNames(tab === 'details' && 'active')} onClick={() => onTabChange('details')}><Info size={15} />详情</button>
        <button className={classNames(tab === 'ai' && 'active')} onClick={() => onTabChange('ai')}><Sparkles size={15} />AI 解析</button>
        <button className={classNames(tab === 'notes' && 'active')} onClick={() => onTabChange('notes')}><NotebookPen size={15} />笔记</button>
      </div>
      <div className="inspector-content">
        {tab === 'details' && <MetadataPanel document={document} onUpdated={onUpdated} onOpenReader={onOpenReader} onRemove={onRemove} notify={notify} />}
        {tab === 'ai' && <AiPanel document={document} settings={settings} onOpenSettings={onOpenSettings} onCountsChange={onCountsChange} notify={notify} />}
        {tab === 'notes' && <NotePanel document={document} quoteRequest={quoteRequest} onQuoteConsumed={onQuoteConsumed} onCountsChange={onCountsChange} notify={notify} />}
      </div>
    </aside>
  );
}
