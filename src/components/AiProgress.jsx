import { useEffect, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';

export default function AiProgress({ onCancel }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="ai-progress" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={19} />
      <div className="ai-progress-text">
        <strong>模型正在生成</strong>
        <span>已等待 {seconds} 秒 · 推理模型可能需要 1–3 分钟</span>
        {seconds >= 45 && <span>仍在等待模型响应，可以取消后重试</span>}
      </div>
      <button type="button" className="ai-progress-cancel" onClick={onCancel}><X size={13} />取消</button>
    </div>
  );
}
