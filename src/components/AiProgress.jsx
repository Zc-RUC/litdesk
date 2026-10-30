import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';

export default function AiProgress({ onCancel, progress }) {
  const [seconds, setSeconds] = useState(0);
  const [displayPercent, setDisplayPercent] = useState(0);
  const displayedRef = useRef(0);
  const requestRef = useRef(null);
  const current = progress || { stage: 'reading', percent: 5, message: '正在准备本地任务' };
  const target = Number(current.percent) || 0;

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (requestRef.current !== current.requestId) {
      requestRef.current = current.requestId;
      displayedRef.current = 0;
      setDisplayPercent(0);
    }
    const from = displayedRef.current;
    const started = performance.now();
    const duration = current.stage === 'generating' ? 30000 : 1400;
    let frame;
    const animate = (now) => {
      const elapsed = Math.min((now - started) / duration, 1);
      const eased = elapsed < 0.5 ? 2 * elapsed * elapsed : 1 - ((-2 * elapsed + 2) ** 2) / 2;
      const value = from + (target - from) * eased;
      displayedRef.current = value;
      setDisplayPercent(Math.floor(value));
      if (elapsed < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [target, current.stage, current.requestId]);

  return (
    <div className="ai-progress" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={19} />
      <div className="ai-progress-text">
        <div className="ai-progress-heading"><strong>{current.message}</strong><span>{displayPercent}%</span></div>
        <div className="ai-progress-track" role="progressbar" aria-label={current.message} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayPercent}><span style={{ width: `${displayPercent}%` }} /></div>
        {current.detail && <span>{current.detail}</span>}
        <span>已等待 {seconds} 秒{current.stage === 'generating' ? ' · 模型生成阶段，响应时间取决于服务商' : ''}</span>
        {current.stage === 'generating' && seconds >= 45 && <span>仍在等待模型响应，可以取消后重试</span>}
      </div>
      <button type="button" className="ai-progress-cancel" onClick={onCancel}><X size={13} />取消</button>
    </div>
  );
}
