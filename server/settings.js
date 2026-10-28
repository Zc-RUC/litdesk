import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

const SETTINGS_FILE = path.join(DATA_DIR, 'local-settings.json');
const defaults = {
  ai: {
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    apiKey: '',
  },
};

function readSettings() {
  if (!existsSync(SETTINGS_FILE)) return structuredClone(defaults);
  try {
    const saved = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...defaults, ...saved, ai: { ...defaults.ai, ...saved.ai } };
  } catch {
    return structuredClone(defaults);
  }
}

function writeSettings(settings) {
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
  chmodSync(SETTINGS_FILE, 0o600);
}

export function getAiConfig() {
  const settings = readSettings();
  return {
    baseUrl: process.env.LITDESK_AI_BASE_URL || settings.ai.baseUrl,
    model: process.env.LITDESK_AI_MODEL || settings.ai.model,
    apiKey: process.env.LITDESK_AI_API_KEY || settings.ai.apiKey,
  };
}

export function getPublicSettings() {
  const config = getAiConfig();
  return {
    ai: {
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: Boolean(config.apiKey),
      keyPreview: config.apiKey ? `••••••••${config.apiKey.slice(-4)}` : '',
      environmentKey: Boolean(process.env.LITDESK_AI_API_KEY),
      configured: Boolean(config.baseUrl && config.model && (config.apiKey || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(config.baseUrl))),
    },
  };
}

export function saveSettings(input) {
  const settings = readSettings();
  if (input.ai?.baseUrl !== undefined) {
    const url = new URL(input.ai.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS');
    settings.ai.baseUrl = input.ai.baseUrl.replace(/\/$/, '');
  }
  if (input.ai?.model !== undefined) settings.ai.model = String(input.ai.model).trim();
  if (input.ai?.apiKey) settings.ai.apiKey = String(input.ai.apiKey).trim();
  if (input.ai?.clearApiKey) settings.ai.apiKey = '';
  writeSettings(settings);
  return getPublicSettings();
}
