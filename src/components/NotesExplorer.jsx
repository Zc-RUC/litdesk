import { useEffect, useState } from 'react';
import { NotebookPen, Quote, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { api } from '../api.js';
import { formatDate } from '../utils.js';

export default function NotesExplorer({ query, onJump, notify }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.notes.list(query).then((items) => { if (!cancelled) setNotes(items); }).catch((error) => notify(error.message, 'warning')).finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return (
    <div className="notes-explorer">
      <div className="list-panel-heading"><div><span className="eyebrow">NOTEBOOK</span><h2>全部笔记 <span>{notes.length}</span></h2></div></div>
      <div className="notes-results">
        {loading && <div className="center-status"><LoaderCircle className="spin" size={18} />搜索笔记…</div>}
        {!loading && !notes.length && <div className="empty-list"><NotebookPen size={32} /><h3>{query ? '没有匹配的笔记' : '笔记会汇集在这里'}</h3><p>{query ? '试试其他关键词。' : '打开一篇文献，在右侧“笔记”中开始记录。'}</p></div>}
        {!loading && notes.map((note) => <button className="note-result" key={note.id} onClick={() => onJump(note.document_id)}>
          <div className="note-result-top"><span>{note.document_title}</span><time>{formatDate(note.updated_at)}</time></div>
          <h3>{note.title || '无题笔记'}<ArrowUpRight size={15} /></h3>
          {note.quote && <p className="note-result-quote"><Quote size={13} />{note.quote}</p>}
          <p>{note.content || '这份笔记只有摘录，还没有正文。'}</p>
          <small>{note.page ? `PDF 第 ${note.page} 页` : '文献笔记'}</small>
        </button>)}
      </div>
    </div>
  );
}
