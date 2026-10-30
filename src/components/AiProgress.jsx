import { useEffect, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';

export default function AiProgress({ onCancel, progress }) {
  const [seconds, setSeconds] = useState(0);
  const current = progress || { stage: 'reading', percent: 5, message: '正在准备本地任务' };

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="ai-progress" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={19} />
      <div className="ai-progress-text">
        <div className="ai-progress-heading"><strong>{current.message}</strong><span>{current.percent}%</span></div>
        <div className="ai-progress-track" role="progressbar" aria-label={current.message} aria-valuemin={0} aria-valuemax={100} aria-valuenow={current.percent}><span style={{ width: `${current.percent}%` }} /></div>
        <span>已等待 {seconds} 秒{current.stage === 'generating' ? ' · 模型生成阶段，响应时间取决于服务商' : ''}</span>
        {current.stage === 'generating' && seconds >= 45 && <span>仍在等待模型响应，可以取消后重试</span>}
      </div>
      <button type="button" className="ai-progress-cancel" onClick={onCancel}><X size={13} />取消</button>
    </div>
  );
}
