import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
export const DATA_DIR = process.env.LITDESK_DATA_DIR
  ? path.resolve(process.env.LITDESK_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(path.join(DATA_DIR, 'litdesk.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    watching INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_scan TEXT
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    file_path TEXT UNIQUE,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    year TEXT NOT NULL DEFAULT '',
    publication TEXT NOT NULL DEFAULT '',
    doi TEXT NOT NULL DEFAULT '',
    abstract TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    item_type TEXT NOT NULL DEFAULT 'article-journal',
    pages TEXT NOT NULL DEFAULT '',
    volume TEXT NOT NULL DEFAULT '',
    issue TEXT NOT NULL DEFAULT '',
    publisher TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    file_size INTEGER NOT NULL DEFAULT 0,
    file_mtime TEXT NOT NULL DEFAULT '',
    content_hash TEXT,
    page_count INTEGER NOT NULL DEFAULT 0,
    missing INTEGER NOT NULL DEFAULT 0,
    metadata_source TEXT NOT NULL DEFAULT 'filename',
    extraction_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    quote TEXT NOT NULL DEFAULT '',
    page INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS summaries (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS text_pages (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY (document_id, page)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
  CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);
  CREATE INDEX IF NOT EXISTS idx_notes_document ON notes(document_id);
`);

export const now = () => new Date().toISOString();
export const json = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

export function mapDocument(row) {
  if (!row) return null;
  return {
    ...row,
    authors: json(row.authors, []),
    tags: json(row.tags, []),
    missing: Boolean(row.missing),
  };
}

export function getDocument(id) {
  return mapDocument(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
}

export function listDocuments({ q = '', folderId, tag, missing, ids, sort = 'updated', limit = 1000 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push(`(title LIKE ? OR authors LIKE ? OR doi LIKE ? OR publication LIKE ? OR tags LIKE ?)`);
    const term = `%${q}%`;
    params.push(term, term, term, term, term);
  }
  if (folderId) { where.push('folder_id = ?'); params.push(Number(folderId)); }
  if (tag) { where.push('tags LIKE ?'); params.push(`%"${tag.replaceAll('"', '')}"%`); }
  if (missing === 'missing') where.push('missing = 1');
  if (missing === 'available') where.push('missing = 0');
  if (ids?.length) {
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const order = {
    title: 'title COLLATE NOCASE ASC',
    year: 'year DESC, title COLLATE NOCASE ASC',
    added: 'created_at DESC',
    updated: 'updated_at DESC',
  }[sort] || 'updated_at DESC';
  params.push(Math.min(Number(limit) || 1000, 5000));
  const rows = db.prepare(`SELECT * FROM documents ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`).all(...params);
  return rows.map(mapDocument);
}

export function updateDocument(id, input) {
  const allowed = ['title', 'authors', 'year', 'publication', 'doi', 'abstract', 'language', 'item_type', 'pages', 'volume', 'issue', 'publisher', 'url', 'tags'];
  const fields = allowed.filter((key) => input[key] !== undefined);
  if (!fields.length) return getDocument(id);
  const values = fields.map((key) => ['authors', 'tags'].includes(key) ? JSON.stringify(input[key]) : String(input[key] ?? ''));
  const set = fields.map((key) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE documents SET ${set}, metadata_source = 'manual', updated_at = ? WHERE id = ?`).run(...values, now(), id);
  return getDocument(id);
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? json(row.value, fallback) : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
