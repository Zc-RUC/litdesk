import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, Quote, LoaderCircle, FileWarning } from 'lucide-react';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({ document, onClose, onQuote }) {
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.15);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);
  const [selection, setSelection] = useState('');
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ url: `/api/documents/${document.id}/file` });
    setPdf(null);
    setError('');
    setPageNumber(1);
    task.promise.then((loaded) => {
      if (!cancelled) setPdf(loaded);
    }).catch((reason) => {
      if (!cancelled) setError(reason.message || 'PDF 加载失败');
    });
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [document.id]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let renderTask;
    let textLayer;
    setRendering(true);
    setSelection('');
    const render = async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const container = textRef.current;
        container.replaceChildren();
        container.style.width = `${Math.floor(viewport.width)}px`;
        container.style.height = `${Math.floor(viewport.height)}px`;
        container.style.setProperty('--scale-factor', String(scale));
        renderTask = page.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
        renderTask.promise.catch((reason) => {
          if (!cancelled && reason?.name !== 'RenderingCancelledException') setError(reason.message || '页面渲染失败');
        });
        const textContentSource = await page.getTextContent();
        if (cancelled) return;
        textLayer = new TextLayer({ textContentSource, container, viewport });
        await textLayer.render();
      } catch (reason) {
        if (!cancelled && reason?.name !== 'RenderingCancelledException') setError(reason.message || '页面渲染失败');
      } finally {
        if (!cancelled) setRendering(false);
      }
    };
    render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, pageNumber, scale]);

  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') onClose();
      if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
      if (event.key === 'ArrowLeft') setPageNumber((page) => Math.max(1, page - 1));
      if (event.key === 'ArrowRight') setPageNumber((page) => Math.min(pdf?.numPages || 1, page + 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, pdf]);

  const fitWidth = async () => {
    if (!pdf || !stageRef.current) return;
    const page = await pdf.getPage(pageNumber);
    const width = page.getViewport({ scale: 1 }).width;
    setScale(Math.max(0.5, Math.min(2.5, (stageRef.current.clientWidth - 80) / width)));
  };

  const captureSelection = () => {
    const text = window.getSelection()?.toString().trim();
    if (text) setSelection(text);
  };

  return (
    <div className="reader-overlay" role="dialog" aria-modal="true" aria-label={`阅读 ${document.title}`}>
      <div className="reader-window">
        <header className="reader-header">
          <div className="reader-title">
            <span className="eyebrow">PDF READER</span>
            <strong>{document.title}</strong>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭阅读器"><X size={20} /></button>
        </header>
        <div className="reader-toolbar">
          <div className="toolbar-group">
            <button className="icon-button" disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => page - 1)}><ChevronLeft size={18} /></button>
            <label className="page-control"><input type="number" min="1" max={pdf?.numPages || 1} value={pageNumber} onChange={(event) => setPageNumber(Math.max(1, Math.min(pdf?.numPages || 1, Number(event.target.value))))} /> / {pdf?.numPages || document.page_count || '—'}</label>
            <button className="icon-button" disabled={pageNumber >= (pdf?.numPages || 1)} onClick={() => setPageNumber((page) => page + 1)}><ChevronRight size={18} /></button>
          </div>
          <div className="toolbar-group">
            <button className="icon-button" onClick={() => setScale((value) => Math.max(0.5, value - 0.15))}><ZoomOut size={18} /></button>
            <span className="zoom-label">{Math.round(scale * 100)}%</span>
            <button className="icon-button" onClick={() => setScale((value) => Math.min(2.5, value + 0.15))}><ZoomIn size={18} /></button>
            <button className="icon-button" onClick={fitWidth} title="适合宽度"><Maximize size={17} /></button>
          </div>
          <button className="button secondary quote-button" disabled={!selection} onClick={() => { onQuote({ quote: selection, page: pageNumber }); onClose(); }}>
            <Quote size={16} />{selection ? '将所选写入笔记' : '选择原文后可摘录'}
          </button>
        </div>
        <div className="reader-stage" ref={stageRef} onMouseUp={captureSelection}>
          {(rendering || !pdf) && !error && <div className="reader-loading"><LoaderCircle className="spin" size={22} /><span>正在呈现页面…</span></div>}
          {error && <div className="reader-error"><FileWarning size={36} /><h3>无法打开这份 PDF</h3><p>{error}</p></div>}
          <div className="pdf-page" style={{ visibility: error ? 'hidden' : 'visible' }}>
            <canvas ref={canvasRef} />
            <div className="textLayer" ref={textRef} />
          </div>
        </div>
        <footer className="reader-footer"><span>← → 翻页 · 可选择原文并关联页码</span><span>{document.file_path}</span></footer>
      </div>
    </div>
  );
}
