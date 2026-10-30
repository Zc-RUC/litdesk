import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, ROOT_DIR, getDocument, listDocuments, updateDocument, now } from './db.js';
import { Library } from './library.js';
import { getDocumentPages } from './pdf.js';
import { listStyles, addStyle, renderCitation, exportCsl, exportBibtex } from './citations.js';
import { getPublicSettings, saveSettings } from './settings.js';
import { summarizeDocument, getSummary, summaryToMarkdown, testAiConnection } from './ai.js';
import { completeDocumentMetadata } from './metadata-ai.js';
import { chooseFolder, integrationStatus, pasteToApplication, revealFile } from './integrations.js';

const app = express();
const library = new Library();
const port = Number(process.env.PORT || 8765);
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.disable('x-powered-by');
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || ![String(port), '5173'].includes(parsed.port)) {
        return res.status(403).json({ error: '只允许本机工作台访问' });
      }
    } catch {
      return res.status(403).json({ error: '无效的请求来源' });
    }
  }
  next();
});
app.use(express.json({ limit: '3mb' }));

const mapNote = (note) => note ? { ...note } : null;
const getNote = (id) => mapNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(id));
const requireDocument = (id) => {
  const document = getDocument(id);
  if (!document) throw new Error('文献不存在或已被移除');
  return document;
};
const selectedDocuments = (ids) => {
  if (!Array.isArray(ids) || !ids.length) throw new Error('请至少选择一篇文献');
  return ids.map(requireDocument);
};

function libraryStats() {
  const documents = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN missing = 0 THEN 1 ELSE 0 END) AS available,
    SUM(CASE WHEN missing = 1 THEN 1 ELSE 0 END) AS missing FROM documents`).get();
  return {
    ...documents,
    notes: db.prepare('SELECT COUNT(*) AS count FROM notes').get().count,
    summaries: db.prepare('SELECT COUNT(*) AS count FROM summaries').get().count,
    folders: db.prepare('SELECT COUNT(*) AS count FROM folders').get().count,
    syncing: library.scanning,
  };
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', name: 'LitDesk', version: '0.1.0' }));
app.get('/api/bootstrap', (req, res) => {
  const documents = listDocuments({ sort: 'updated', limit: 5000 });
  const tagCounts = {};
  for (const document of documents) for (const tag of document.tags) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  res.json({
    documents,
    folders: library.listFolders(),
    styles: listStyles(),
    integrations: integrationStatus(),
    settings: getPublicSettings(),
    stats: libraryStats(),
    tags: Object.entries(tagCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  });
});
app.get('/api/documents', (req, res) => {
  const items = listDocuments(req.query);
  res.json({ items, total: items.length });
});
app.get('/api/documents/:id', (req, res) => res.json(requireDocument(req.params.id)));
app.patch('/api/documents/:id', (req, res) => {
  requireDocument(req.params.id);
  if (req.body.title !== undefined && !String(req.body.title).trim()) return res.status(400).json({ error: '题名不能为空' });
  const document = updateDocument(req.params.id, req.body);
  library.emit('update', { type: 'document-updated', id: req.params.id });
  res.json(document);
});
app.delete('/api/documents/:id', (req, res) => {
  requireDocument(req.params.id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  library.emit('update', { type: 'document-removed', id: req.params.id });
  res.json({ success: true });
});
app.post('/api/documents/:id/refresh', asyncRoute(async (req, res) => res.json(await library.refreshDocument(req.params.id))));
app.post('/api/documents/:id/enrich', asyncRoute(async (req, res) => res.json(await library.enrichDocument(req.params.id))));
app.post('/api/documents/:id/complete-metadata', asyncRoute(async (req, res) => {
  const controller = new AbortController();
  req.socket.on('close', () => controller.abort());
  const requestId = String(req.body.requestId || '').slice(0, 100);
  const onProgress = (progress) => library.emit('update', { ...progress, type: 'ai-progress', operation: 'complete-metadata', documentId: req.params.id, requestId });
  const result = await completeDocumentMetadata(req.params.id, controller.signal, onProgress);
  if (result.changedFields.length) library.emit('update', { type: 'document-updated', id: req.params.id });
  res.json(result);
}));
app.get('/api/documents/:id/file', (req, res, next) => {
  const document = requireDocument(req.params.id);
  if (!document.file_path || !existsSync(document.file_path)) return res.status(404).json({ error: 'PDF 文件当前不可用' });
  res.type('application/pdf');
  res.sendFile(path.resolve(document.file_path), next);
});
app.get('/api/documents/:id/text', asyncRoute(async (req, res) => {
  const document = requireDocument(req.params.id);
  res.json({ pages: await getDocumentPages(document) });
}));
app.post('/api/documents/:id/reveal', asyncRoute(async (req, res) => {
  const document = requireDocument(req.params.id);
  if (!document.file_path || !existsSync(document.file_path)) throw new Error('原文件当前不可用');
  await revealFile(document.file_path);
  res.json({ success: true });
}));

app.get('/api/folders', (req, res) => res.json(library.listFolders()));
app.post('/api/folders', asyncRoute(async (req, res) => res.status(201).json(await library.addFolder(req.body.path || ''))));
app.post('/api/folders/choose', asyncRoute(async (req, res) => {
  const folderPath = await chooseFolder(req.body.defaultPath);
  if (!folderPath) return res.json({ cancelled: true });
  res.status(201).json(await library.addFolder(folderPath));
}));
app.post('/api/folders/:id/scan', asyncRoute(async (req, res) => {
  await library.scanFolder(Number(req.params.id));
  res.json({ success: true, stats: libraryStats() });
}));
app.delete('/api/folders/:id', asyncRoute(async (req, res) => {
  await library.removeFolder(req.params.id);
  res.json({ success: true });
}));

app.get('/api/notes', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const notes = db.prepare(`SELECT n.*, d.title AS document_title FROM notes n JOIN documents d ON d.id = n.document_id
    WHERE n.title LIKE ? OR n.content LIKE ? OR n.quote LIKE ? OR d.title LIKE ? ORDER BY n.updated_at DESC LIMIT 500`).all(q, q, q, q);
  res.json(notes);
});
app.get('/api/documents/:id/notes', (req, res) => {
  res.json(db.prepare('SELECT * FROM notes WHERE document_id = ? ORDER BY updated_at DESC').all(req.params.id));
});
app.post('/api/documents/:id/notes', (req, res) => {
  requireDocument(req.params.id);
  const id = randomUUID();
  const timestamp = now();
  db.prepare('INSERT INTO notes (id, document_id, title, content, quote, page, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, String(req.body.title || ''), String(req.body.content || ''), String(req.body.quote || ''), req.body.page ? Number(req.body.page) : null, timestamp, timestamp);
  res.status(201).json(getNote(id));
});
app.patch('/api/notes/:id', (req, res) => {
  if (!getNote(req.params.id)) return res.status(404).json({ error: '笔记不存在' });
  const current = getNote(req.params.id);
  db.prepare('UPDATE notes SET title = ?, content = ?, quote = ?, page = ?, updated_at = ? WHERE id = ?')
    .run(req.body.title ?? current.title, req.body.content ?? current.content, req.body.quote ?? current.quote,
      req.body.page === undefined ? current.page : (req.body.page ? Number(req.body.page) : null), now(), req.params.id);
  res.json(getNote(req.params.id));
});
app.delete('/api/notes/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/citation/styles', (req, res) => res.json(listStyles()));
app.post('/api/citation/styles', (req, res) => res.status(201).json(addStyle(String(req.body.filename || ''), String(req.body.xml || ''))));
app.post('/api/citation/render', (req, res) => {
  res.json(renderCitation(selectedDocuments(req.body.ids), req.body.styleId));
});
app.post('/api/citation/export', (req, res) => {
  const documents = selectedDocuments(req.body.ids);
  const format = req.body.format === 'bibtex' ? 'bibtex' : 'csl';
  const content = format === 'bibtex' ? exportBibtex(documents) : exportCsl(documents);
  res.type(format === 'bibtex' ? 'application/x-bibtex' : 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="litdesk-references.${format === 'bibtex' ? 'bib' : 'json'}"`);
  res.send(content);
});
app.post('/api/citation/insert', asyncRoute(async (req, res) => {
  const rendered = renderCitation(selectedDocuments(req.body.ids), req.body.styleId);
  const kind = req.body.kind === 'bibliography' ? 'bibliography' : 'citation';
  const text = kind === 'bibliography' ? rendered.bibliographyText : rendered.citationText;
  res.json(await pasteToApplication(text, req.body.target, { ids: req.body.ids, styleId: req.body.styleId, kind }));
}));

app.get('/api/settings', (req, res) => res.json(getPublicSettings()));
app.put('/api/settings', (req, res) => res.json(saveSettings(req.body)));
app.post('/api/ai/test', asyncRoute(async (req, res) => res.json(await testAiConnection())));
app.get('/api/documents/:id/summary', (req, res) => res.json(getSummary(req.params.id)));
app.post('/api/documents/:id/summarize', asyncRoute(async (req, res) => {
  const controller = new AbortController();
  req.socket.on('close', () => controller.abort());
  const requestId = String(req.body.requestId || '').slice(0, 100);
  const onProgress = (progress) => library.emit('update', { ...progress, type: 'ai-progress', operation: 'summarize', documentId: req.params.id, requestId });
  res.json(await summarizeDocument(req.params.id, controller.signal, onProgress));
}));
app.post('/api/documents/:id/summary/note', (req, res) => {
  requireDocument(req.params.id);
  const summary = getSummary(req.params.id);
  if (!summary) return res.status(404).json({ error: '还没有可保存的 AI 解析' });
  const id = randomUUID();
  const timestamp = now();
  db.prepare('INSERT INTO notes (id, document_id, title, content, quote, page, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, 'AI 文献解析', summaryToMarkdown(summary), '', null, timestamp, timestamp);
  res.status(201).json(getNote(id));
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: connected\ndata: {"status":"ready"}\n\n`);
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  library.on('update', send);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    library.off('update', send);
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
app.use(express.static(path.join(ROOT_DIR, 'dist')));
app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) return next();
  const index = path.join(ROOT_DIR, 'dist', 'index.html');
  if (existsSync(index)) return res.sendFile(index);
  res.status(503).send('LitDesk 尚未构建。请先运行 npm run build。');
});
app.use((error, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, error.message);
  if (res.headersSent) return next(error);
  res.status(error.status || 400).json({ error: error.message || '操作失败' });
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`\n  LitDesk is ready at http://127.0.0.1:${port}\n`);
  library.init().catch((error) => console.error('Library sync failed:', error.message));
});

async function shutdown() {
  server.close();
  await Promise.race([
    library.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1200).unref()),
  ]);
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
