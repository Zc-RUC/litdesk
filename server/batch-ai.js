import { completeDocumentMetadata } from './metadata-ai.js';

export async function completeDocumentMetadataBatch(documents, { signal, onProgress } = {}) {
  const items = [];
  for (const [index, document] of documents.entries()) {
    signal?.throwIfAborted();
    const report = (progress) => onProgress?.({
      stage: progress.stage,
      percent: Math.round(((index + progress.percent / 100) / documents.length) * 100),
      message: `第 ${index + 1}/${documents.length} 篇 · ${document.title}`,
      detail: progress.detail || progress.message,
      current: index + 1,
      total: documents.length,
      currentDocumentId: document.id,
      attempt: progress.attempt,
    });
    try {
      report({ stage: 'reading', percent: 0, message: '正在检查书目' });
      const result = await completeDocumentMetadata(document.id, signal, report);
      items.push({ id: document.id, title: document.title, success: true, changedFields: result.changedFields, model: result.model });
      report({ stage: 'complete', percent: 100, message: result.model ? '本篇补全完成' : '本篇无需补全' });
    } catch (error) {
      if (signal?.aborted) throw error;
      items.push({ id: document.id, title: document.title, success: false, error: error.message });
      report({ stage: 'error', percent: 100, message: '本篇未完成', detail: error.message });
    }
  }
  return {
    total: documents.length,
    succeeded: items.filter((item) => item.success).length,
    failed: items.filter((item) => !item.success).length,
    items,
  };
}
