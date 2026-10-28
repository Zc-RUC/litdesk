import { useState } from 'react';
import { X, FolderPlus, FolderSync, Trash2, LoaderCircle, FolderOpen, ShieldCheck, CheckCircle2, XCircle, KeyRound, PlugZap, Info } from 'lucide-react';
import { api } from '../api.js';
import { formatDate } from '../utils.js';

export function FolderManager({ folders, onClose, onChanged, notify }) {
  const [busy, setBusy] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [showManual, setShowManual] = useState(false);

  const run = async (key, action, message) => {
    setBusy(key);
    try {
      const result = await action();
      if (!result?.cancelled) {
        await onChanged();
        if (message) notify(message);
      }
    } catch (error) {
      notify(error.message, 'warning', 7000);
    } finally {
      setBusy('');
    }
  };

  const remove = async (folder) => {
    if (!window.confirm(`停止同步“${folder.name}”？\n\n原 PDF 和已导入的文献、笔记都会保留，只移除这个文件夹的自动同步。`)) return;
    await run(folder.id, () => api.folders.remove(folder.id), '已停止同步该文件夹，原文件未改动');
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="文献文件夹管理">
      <div className="modal folder-modal">
        <header className="modal-header"><div><span className="eyebrow">WATCHED FOLDERS</span><h2>文献文件夹</h2><p>新增、修改或移除 PDF 时，文库会自动同步。</p></div><button className="icon-button" onClick={onClose}><X size={20} /></button></header>
        <div className="folder-add-actions"><button className="button primary" disabled={Boolean(busy)} onClick={() => run('choose', api.folders.choose, '文件夹已添加并完成扫描')}>{busy === 'choose' ? <LoaderCircle className="spin" size={16} /> : <FolderPlus size={16} />}选择系统文件夹…</button><button className="button secondary" onClick={() => setShowManual((value) => !value)}>输入路径</button></div>
        {showManual && <form className="manual-folder-form" onSubmit={(event) => { event.preventDefault(); if (manualPath.trim()) run('manual', () => api.folders.add(manualPath.trim()), '文件夹已添加'); }}><input autoFocus value={manualPath} onChange={(event) => setManualPath(event.target.value)} placeholder="/Users/user/Documents/我的文献" /><button className="button secondary" disabled={busy === 'manual'}>添加</button></form>}
        <div className="folder-list">
          {folders.map((folder) => <div className="folder-row" key={folder.id}>
            <div className="folder-icon"><FolderOpen size={19} /></div>
            <div className="folder-info"><strong>{folder.name}</strong><code>{folder.path}</code><span>{folder.document_count || 0} 篇 · {folder.last_scan ? `上次扫描 ${formatDate(folder.last_scan, true)}` : '等待首次扫描'}</span></div>
            <button className="icon-button" title="立即重新扫描" disabled={Boolean(busy)} onClick={() => run(folder.id, () => api.folders.scan(folder.id), '扫描完成')}>{busy === folder.id ? <LoaderCircle className="spin" size={16} /> : <FolderSync size={16} />}</button>
            <button className="icon-button danger" title="停止同步（保留文献）" disabled={Boolean(busy)} onClick={() => remove(folder)}><Trash2 size={16} /></button>
          </div>)}
          {!folders.length && <div className="modal-empty"><FolderPlus size={30} /><h3>还没有受管文件夹</h3><p>选择存放 PDF 的文件夹，已有文献会自动进入文库。</p></div>}
        </div>
        <div className="folder-safety"><ShieldCheck size={16} /><p>原文件始终留在原位置。LitDesk 不会移动或改写 PDF；文件暂时缺失时，书目和笔记仍会保留。</p></div>
      </div>
    </div>
  );
}

const presets = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', placeholder: '例如 gpt-4o-mini' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', placeholder: '填写你的 Kimi 模型名称' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', placeholder: '例如 deepseek-chat' },
  { name: '本地模型', baseUrl: 'http://127.0.0.1:11434/v1', placeholder: '例如 Ollama 中已安装的模型' },
];

export function SettingsModal({ settings, integrations, onSaved, onClose, notify }) {
  const [baseUrl, setBaseUrl] = useState(settings?.ai?.baseUrl || '');
  const [model, setModel] = useState(settings?.ai?.model || '');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [placeholder, setPlaceholder] = useState('输入服务商提供的模型名称');
  const [busy, setBusy] = useState('');

  const save = async () => {
    const saved = await api.settings.save({ ai: { baseUrl, model, ...(apiKey ? { apiKey } : {}), clearApiKey } });
    onSaved(saved);
    setApiKey('');
    setClearApiKey(false);
    return saved;
  };
  const saveOnly = async () => {
    setBusy('save');
    try { await save(); notify('AI 设置已保存在本机'); } catch (error) { notify(error.message, 'warning'); } finally { setBusy(''); }
  };
  const test = async () => {
    setBusy('test');
    try {
      await save();
      const result = await api.settings.test();
      notify(`连接成功：${result.model}`, 'success', 6000);
    } catch (error) { notify(error.message, 'warning', 9000); } finally { setBusy(''); }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="设置">
      <div className="modal settings-modal">
        <header className="modal-header"><div><span className="eyebrow">PREFERENCES</span><h2>设置</h2><p>本地数据与外部服务连接</p></div><button className="icon-button" onClick={onClose}><X size={20} /></button></header>
        <div className="settings-content">
          <section className="settings-section"><div className="settings-heading"><KeyRound size={18} /><div><h3>AI 文献解析</h3><p>使用任意 OpenAI 兼容的 Chat Completions API</p></div></div>
            <div className="preset-row">{presets.map((preset) => <button key={preset.name} className="preset-chip" onClick={() => { setBaseUrl(preset.baseUrl); setPlaceholder(preset.placeholder); }}>{preset.name}</button>)}</div>
            <label className="field"><span>Base URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label>
            <label className="field"><span>模型名称</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder={placeholder} /></label>
            <label className="field"><span>API Key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.ai?.hasApiKey ? `已保存 ${settings.ai.keyPreview}；留空则不更改` : 'sk-…'} /></label>
            {settings?.ai?.environmentKey && <p className="field-hint">当前由 LITDESK_AI_API_KEY 环境变量提供密钥，优先于本地保存值。</p>}
            <label className="checkbox-label"><input type="checkbox" checked={clearApiKey} onChange={(event) => setClearApiKey(event.target.checked)} />清除本地保存的 API Key</label>
            <div className="settings-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={test}>{busy === 'test' ? <LoaderCircle className="spin" size={15} /> : <PlugZap size={15} />}保存并测试连接</button><button className="button primary" disabled={Boolean(busy)} onClick={saveOnly}>{busy === 'save' ? <LoaderCircle className="spin" size={15} /> : null}保存设置</button></div>
            <div className="settings-privacy"><ShieldCheck size={15} /><p>密钥以仅当前用户可读权限保存在 LitDesk 本地数据目录。只有点击“测试”“解析”或“AI 补全”时才会连接所配置的服务商；不会经过其他中继。</p></div>
          </section>
          <section className="settings-section"><div className="settings-heading"><Info size={18} /><div><h3>Word / WPS 集成</h3><p>在当前光标处插入带浅灰底纹的域格式引文</p></div></div>
            <div className="integration-list">{['word', 'wps'].map((target) => <div key={target}>{integrations?.[target]?.installed ? <CheckCircle2 className="success-icon" size={18} /> : <XCircle className="warning-icon" size={18} />}<span><strong>{integrations?.[target]?.label || target}</strong><small>{integrations?.[target]?.installed ? '已检测 · 可通过引用中心插入' : '未在标准应用目录检测到'}</small></span></div>)}</div>
            <p className="integration-help">首次自动粘贴时，macOS 可能要求“辅助功能”或“自动化”权限。请授权运行 LitDesk 的终端；也可以始终使用“复制富文本”后按 ⌘V。域内保存 LitDesk 元数据，但暂不支持自动更新全文引文。</p>
          </section>
        </div>
      </div>
    </div>
  );
}
