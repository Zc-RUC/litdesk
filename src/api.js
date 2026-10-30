async function request(path, options = {}) {
  const config = { ...options, headers: { ...options.headers } };
  if (config.body && typeof config.body !== 'string') {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(path, config);
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || `请求失败 (${response.status})`);
  return payload;
}

export const api = {
  bootstrap: () => request('/api/bootstrap'),
  folders: {
    add: (path) => request('/api/folders', { method: 'POST', body: { path } }),
    choose: () => request('/api/folders/choose', { method: 'POST', body: {} }),
    scan: (id) => request(`/api/folders/${id}/scan`, { method: 'POST', body: {} }),
    remove: (id) => request(`/api/folders/${id}`, { method: 'DELETE' }),
  },
  documents: {
    update: (id, data) => request(`/api/documents/${id}`, { method: 'PATCH', body: data }),
    remove: (id) => request(`/api/documents/${id}`, { method: 'DELETE' }),
    refresh: (id) => request(`/api/documents/${id}/refresh`, { method: 'POST', body: {} }),
    enrich: (id) => request(`/api/documents/${id}/enrich`, { method: 'POST', body: {} }),
    completeMetadata: (id, { signal, requestId } = {}) => request(`/api/documents/${id}/complete-metadata`, { method: 'POST', body: { requestId }, signal }),
    reveal: (id) => request(`/api/documents/${id}/reveal`, { method: 'POST', body: {} }),
    notes: (id) => request(`/api/documents/${id}/notes`),
    summary: (id) => request(`/api/documents/${id}/summary`),
    summarize: (id, { signal, requestId } = {}) => request(`/api/documents/${id}/summarize`, { method: 'POST', body: { requestId }, signal }),
    summaryToNote: (id) => request(`/api/documents/${id}/summary/note`, { method: 'POST', body: {} }),
  },
  notes: {
    list: (q = '') => request(`/api/notes?q=${encodeURIComponent(q)}`),
    create: (documentId, data) => request(`/api/documents/${documentId}/notes`, { method: 'POST', body: data }),
    update: (id, data) => request(`/api/notes/${id}`, { method: 'PATCH', body: data }),
    remove: (id) => request(`/api/notes/${id}`, { method: 'DELETE' }),
  },
  citations: {
    render: (ids, styleId) => request('/api/citation/render', { method: 'POST', body: { ids, styleId } }),
    insert: (ids, styleId, kind, target) => request('/api/citation/insert', { method: 'POST', body: { ids, styleId, kind, target } }),
    addStyle: (filename, xml) => request('/api/citation/styles', { method: 'POST', body: { filename, xml } }),
  },
  settings: {
    save: (data) => request('/api/settings', { method: 'PUT', body: data }),
    test: () => request('/api/ai/test', { method: 'POST', body: {} }),
  },
};

export async function downloadReferences(ids, format) {
  const response = await fetch('/api/citation/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, format }),
  });
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error || '导出失败');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = format === 'bibtex' ? 'litdesk-references.bib' : 'litdesk-references.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
