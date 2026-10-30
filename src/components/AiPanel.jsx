import { useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Settings2, BookPlus, LoaderCircle, ShieldCheck, CircleAlert } from 'lucide-react';
import { api } from '../api.js';
import { formatDate } from '../utils.js';
import AiProgress from './AiProgress.jsx';

const sections = [
  ['researchQuestion', '研究问题'],
  ['researchDesign', '研究思路与设计'],
  ['data', '数据与样本'],
  ['methods', '分析方法'],
  ['findings', '主要结论'],
  ['limitations', '局限与阅读提示'],
];

export default function AiPanel({ document, settings, onOpenSettings, onCountsChange, notify }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const controllerRef = useRef(null);

  useEffect(() => {
    setSummary(null);
    setChecking(true);
    api.documents.summary(document.id).then(setSummary).catch(() => {}).finally(() => setChecking(false));
    return () => controllerRef.current?.abort();
  }, [document.id]);

  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
    notify('已取消本次 AI 解析', 'warning');
  };

  const generate = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await api.documents.summarize(document.id, { signal: controller.signal });
      setSummary(result);
      onCountsChange();
      notify('AI 文献解析已完成并保存');
    } catch (reason) {
      if (reason.name !== 'AbortError') setError(reason.message);
    } finally {
      if (controllerRef.current === controller) {
        setLoading(false);
        controllerRef.current = null;
      }
    }
  };

  const saveNote = async () => {
    try {
      await api.documents.summaryToNote(document.id);
      onCountsChange();
      notify('已保存到这篇文献的笔记');
    } catch (reason) {
      notify(reason.message, 'warning');
    }
  };

  if (checking) return <div className="center-status panel-loading"><LoaderCircle className="spin" size={20} />读取已有解析…</div>;

  return (
    <div className="ai-panel">
      <div className="ai-intro">
        <div className="ai-mark"><Sparkles size={20} /></div>
        <div><h3>从原文到研究脉络</h3><p>提炼问题、数据与方法，关键事实附原文页码。</p></div>
      </div>
      {!settings?.ai?.configured && <button className="setup-callout" onClick={onOpenSettings}><Settings2 size={18} /><span><strong>先连接你的 AI API</strong><small>兼容 OpenAI、Kimi、DeepSeek 及本地模型</small></span></button>}
      {error && <div className="inline-error"><CircleAlert size={17} /><p>{error}</p></div>}
      {!summary && <div className="ai-empty">
        <div className="analysis-map"><span>研究问题</span><i /><span>研究设计</span><i /><span>数据 · 方法</span><i /><span>结论</span></div>
        <p>LitDesk 会优先读取摘要、研究设计、数据、方法和结论页。长文档将选取相关页面，而不是只分析首页。</p>
        <button className="button primary wide" disabled={loading || !settings?.ai?.configured || document.missing} onClick={generate}>{loading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{loading ? '正在阅读与解析…' : '开始解析这篇文献'}</button>
        {loading && <AiProgress onCancel={cancel} />}
        <small className="privacy-hint"><ShieldCheck size={13} />仅在点击后向你配置的 API 发送文献文本</small>
      </div>}
      {summary && <div className="summary-content">
        <div className="summary-lead"><span>一句话读懂</span><p>{summary.content.oneSentence || '未提供'}</p></div>
        {sections.map(([key, label]) => <section className="summary-section" key={key}><h4>{label}</h4><p>{summary.content[key] || '未提供'}</p></section>)}
        <div className="summary-meta">由 {summary.model} 生成 · {formatDate(summary.created_at, true)}<br />AI 可能误读，请结合原文页码核对。</div>
        <div className="summary-actions"><button className="button secondary" onClick={saveNote}><BookPlus size={15} />存为笔记</button><button className="button secondary" disabled={loading} onClick={generate}>{loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}重新解析</button></div>
      </div>}
      {loading && summary && <div className="generating-overlay"><AiProgress onCancel={cancel} /></div>}
    </div>
  );
}
