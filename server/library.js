import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { watch } from 'chokidar';
import { db, getDocument, now } from './db.js';
import { extractPdfSnapshot, filenameTitle } from './pdf.js';

const METADATA_FIELDS = ['title', 'authors', 'year', 'publication', 'doi', 'abstract', 'language', 'item_type', 'pages', 'volume', 'issue', 'publisher', 'url'];
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.Trash', '$RECYCLE.BIN', 'System Volume Information']);

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function walk(folder) {
  const files = [];
  const entries = await readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) files.push(...await walk(fullPath));
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) files.push(fullPath);
  }
  return files;
}

function metadataValues(metadata) {
  return METADATA_FIELDS.map((field) => {
    const value = metadata[field];
    if (field === 'authors') return JSON.stringify(value || []);
    return value === undefined || value === null ? '' : String(value);
  });
}

export class Library extends EventEmitter {
  constructor() {
    super();
    this.watchers = new Map();
    this.queue = Promise.resolve();
    this.scanning = false;
  }

  enqueue(task) {
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  async init() {
    for (const folder of db.prepare('SELECT * FROM folders WHERE watching = 1').all()) {
      if (!existsSync(folder.path)) {
        db.prepare('UPDATE documents SET missing = 1, updated_at = ? WHERE folder_id = ?').run(now(), folder.id);
        continue;
      }
      this.watchFolder(folder);
      await this.scanFolder(folder.id);
    }
  }

  listFolders() {
    return db.prepare(`SELECT f.*, COUNT(d.id) AS document_count,
      SUM(CASE WHEN d.missing = 0 THEN 1 ELSE 0 END) AS available_count
      FROM folders f LEFT JOIN documents d ON d.folder_id = f.id
      GROUP BY f.id ORDER BY f.created_at`).all();
  }

  async addFolder(inputPath) {
    if (!path.isAbsolute(inputPath)) throw new Error('请输入文件夹的绝对路径');
    const resolved = await realpath(inputPath);
    if (!(await stat(resolved)).isDirectory()) throw new Error('所选位置不是文件夹');
    const timestamp = now();
    db.prepare(`INSERT INTO folders (path, name, created_at) VALUES (?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET watching = 1`).run(resolved, path.basename(resolved), timestamp);
    const folder = db.prepare('SELECT * FROM folders WHERE path = ?').get(resolved);
    if (!this.watchers.has(folder.id)) this.watchFolder(folder);
    await this.scanFolder(folder.id);
    return folder;
  }

  watchFolder(folder) {
    const watcher = watch(folder.path, {
      ignoreInitial: true,
      depth: 20,
      awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 150 },
      ignored: (filePath) => path.basename(filePath).startsWith('.') || IGNORED_DIRS.has(path.basename(filePath)),
    });
    watcher.on('add', (filePath) => {
      if (filePath.toLowerCase().endsWith('.pdf')) this.enqueue(() => this.ingestFile(folder.id, filePath));
    });
    watcher.on('change', (filePath) => {
      if (filePath.toLowerCase().endsWith('.pdf')) this.enqueue(() => this.ingestFile(folder.id, filePath, true));
    });
    watcher.on('unlink', (filePath) => this.enqueue(() => this.markMissing(filePath)));
    watcher.on('error', (error) => this.emit('update', { type: 'sync-error', message: error.message }));
    this.watchers.set(folder.id, watcher);
  }

  async scanFolder(folderId) {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
    if (!folder || !existsSync(folder.path)) return;
    this.scanning = true;
    this.emit('update', { type: 'sync-start', folderId });
    try {
      const files = await walk(folder.path);
      const seen = new Set(files.map((file) => path.resolve(file)));
      for (const file of files) await this.ingestFile(folderId, file);
      const existing = db.prepare('SELECT id, file_path FROM documents WHERE folder_id = ?').all(folderId);
      for (const item of existing) {
        if (item.file_path && !seen.has(path.resolve(item.file_path))) {
          db.prepare('UPDATE documents SET missing = 1, updated_at = ? WHERE id = ?').run(now(), item.id);
        }
      }
      db.prepare('UPDATE folders SET last_scan = ? WHERE id = ?').run(now(), folderId);
      this.emit('update', { type: 'sync-complete', folderId, count: files.length });
    } catch (error) {
      this.emit('update', { type: 'sync-error', folderId, message: error.message });
      throw error;
    } finally {
      this.scanning = false;
    }
  }

  async ingestFile(folderId, filePath, forceMetadata = false) {
    if (!existsSync(filePath) || !filePath.toLowerCase().endsWith('.pdf')) return;
    const fileStat = await stat(filePath);
    const mtime = fileStat.mtime.toISOString();
    const existing = db.prepare('SELECT * FROM documents WHERE file_path = ?').get(filePath);
    if (existing && !forceMetadata && existing.file_size === fileStat.size && existing.file_mtime === mtime) {
      if (existing.missing) db.prepare('UPDATE documents SET missing = 0, updated_at = ? WHERE id = ?').run(now(), existing.id);
      return getDocument(existing.id);
    }
    const contentHash = await hashFile(filePath);
    const renamed = !existing ? db.prepare('SELECT * FROM documents WHERE content_hash = ? AND file_path != ?').all(contentHash, filePath)
      .find((item) => item.missing || !existsSync(item.file_path)) : null;
    const record = existing || renamed;
    let metadata;
    let extractionError = '';
    try {
      metadata = await extractPdfSnapshot(filePath);
    } catch (error) {
      extractionError = error.message;
      metadata = { title: filenameTitle(filePath), authors: [], year: '', doi: '', publication: '', pageCount: 0, hasText: false };
    }
    const timestamp = now();
    if (record) {
      const preserveManual = ['manual', 'ai'].includes(record.metadata_source);
      if (preserveManual) {
        db.prepare(`UPDATE documents SET folder_id = ?, file_path = ?, file_size = ?, file_mtime = ?, content_hash = ?,
          page_count = ?, missing = 0, extraction_error = ?, updated_at = ? WHERE id = ?`)
          .run(folderId, filePath, fileStat.size, mtime, contentHash, metadata.pageCount || 0, extractionError, timestamp, record.id);
      } else {
        db.prepare(`UPDATE documents SET folder_id = ?, file_path = ?, title = ?, authors = ?, year = ?, publication = ?, doi = ?,
          file_size = ?, file_mtime = ?, content_hash = ?, page_count = ?, missing = 0, metadata_source = 'pdf', extraction_error = ?, updated_at = ?
          WHERE id = ?`).run(folderId, filePath, ...metadataValues({ ...metadata, item_type: record.item_type }).slice(0, 5),
          fileStat.size, mtime, contentHash, metadata.pageCount || 0, extractionError, timestamp, record.id);
      }
      if (existing?.content_hash !== contentHash) db.prepare('DELETE FROM text_pages WHERE document_id = ?').run(record.id);
      this.emit('update', { type: 'document-updated', id: record.id });
      return getDocument(record.id);
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO documents
      (id, folder_id, file_path, title, authors, year, publication, doi, file_size, file_mtime, content_hash, page_count, metadata_source, extraction_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pdf', ?, ?, ?)`)
      .run(id, folderId, filePath, metadata.title || filenameTitle(filePath), JSON.stringify(metadata.authors || []), metadata.year || '',
        metadata.publication || '', metadata.doi || '', fileStat.size, mtime, contentHash, metadata.pageCount || 0, extractionError, timestamp, timestamp);
    this.emit('update', { type: 'document-added', id });
    return getDocument(id);
  }

  markMissing(filePath) {
    const result = db.prepare('UPDATE documents SET missing = 1, updated_at = ? WHERE file_path = ?').run(now(), filePath);
    if (result.changes) this.emit('update', { type: 'document-missing', filePath });
  }

  async removeFolder(id) {
    const watcher = this.watchers.get(Number(id));
    if (watcher) await watcher.close();
    this.watchers.delete(Number(id));
    db.prepare('DELETE FROM folders WHERE id = ?').run(Number(id));
    this.emit('update', { type: 'folder-removed', id: Number(id) });
  }

  async refreshDocument(id) {
    const document = getDocument(id);
    if (!document || document.missing) throw new Error('文件不可用，无法重新读取');
    return this.ingestFile(document.folder_id, document.file_path, true);
  }

  async enrichDocument(id) {
    const document = getDocument(id);
    if (!document?.doi) throw new Error('请先填写有效的 DOI');
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(document.doi)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'LitDesk/0.1 (local literature workspace)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Crossref 返回 ${response.status}，请检查 DOI 或稍后重试`);
    const { message: work } = await response.json();
    const metadata = {
      title: work.title?.[0] || document.title,
      authors: work.author?.map((author) => ({ given: author.given || '', family: author.family || '', literal: author.name || undefined })) || document.authors,
      year: work.issued?.['date-parts']?.[0]?.[0] || document.year,
      publication: work['container-title']?.[0] || work.publisher || document.publication,
      doi: work.DOI || document.doi,
      abstract: String(work.abstract || document.abstract || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      item_type: work.type === 'book' ? 'book' : work.type === 'paper-conference' ? 'paper-conference' : 'article-journal',
      pages: work.page || document.pages,
      volume: work.volume || document.volume,
      issue: work.issue || document.issue,
      publisher: work.publisher || document.publisher,
      url: work.URL || document.url,
    };
    const sets = METADATA_FIELDS.map((field) => `${field} = ?`).join(', ');
    db.prepare(`UPDATE documents SET ${sets}, metadata_source = 'crossref', updated_at = ? WHERE id = ?`)
      .run(...metadataValues(metadata), now(), id);
    this.emit('update', { type: 'document-updated', id });
    return getDocument(id);
  }

  async close() {
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.close()));
  }
}
