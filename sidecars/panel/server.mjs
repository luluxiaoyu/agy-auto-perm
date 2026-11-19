import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { SidecarApp, Response } from 'sidecar_sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..', '..');
const configFile = join(pluginRoot, 'config.json');
const logFile = join(pluginRoot, 'audit.log');
const htmlFile = join(__dirname, 'index.html');

function readConfig() {
  try {
    if (existsSync(configFile)) {
      return JSON.parse(readFileSync(configFile, 'utf8'));
    }
  } catch (e) {}
  return { enabled: true, agyAuditEnabled: false };
}

function writeConfig(cfg) {
  try {
    writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {}
}

let cachedAgyPath = undefined;
function findAgy() {
  if (cachedAgyPath !== undefined) return cachedAgyPath;
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'where agy' : 'which agy';
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim().split('\n')[0];
    if (out && existsSync(out)) {
      cachedAgyPath = out;
      return cachedAgyPath;
    }
  } catch (e) {}

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = isWin
    ? [
        join(home, '.local', 'bin', 'agy.exe'),
        join(home, 'AppData', 'Local', 'Programs', 'agy', 'agy.exe')
      ]
    : [
        join(home, '.local', 'bin', 'agy'),
        '/usr/local/bin/agy',
        '/opt/homebrew/bin/agy'
      ];

  for (const c of candidates) {
    if (existsSync(c)) {
      cachedAgyPath = c;
      return cachedAgyPath;
    }
  }
  cachedAgyPath = null;
  return null;
}

let cachedAgyStatus = null;
let lastAgyStatusCheckTime = 0;
const AGY_STATUS_CACHE_TTL = 60 * 1000; // Cache status for 60s

function checkAgyStatus(force = false) {
  const now = Date.now();
  if (!force && cachedAgyStatus && (now - lastAgyStatusCheckTime < AGY_STATUS_CACHE_TTL)) {
    return cachedAgyStatus;
  }

  const agyPath = findAgy();
  if (!agyPath) {
    cachedAgyStatus = { installed: false, path: null, version: null, authenticated: false };
    lastAgyStatusCheckTime = now;
    return cachedAgyStatus;
  }

  let version = null;
  try {
    version = execSync(`"${agyPath}" --version`, { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim();
  } catch (e) {}

  let authenticated = false;
  try {
    execSync(`"${agyPath}" -p "ping" --disable-slash-commands --print-timeout 2s`, {
      encoding: 'utf8',
      timeout: 3500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    authenticated = true;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    authenticated = !stderr.includes('Authentication required');
  }

  cachedAgyStatus = {
    installed: true,
    path: agyPath,
    version: version || 'unknown',
    authenticated
  };
  lastAgyStatusCheckTime = now;
  return cachedAgyStatus;
}

function parseAgyModels(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const lines = raw.split('\n');
  const list = [];
  const seen = new Set();

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (/^(error|please sign in|usage|available|model\s+desc)/i.test(line)) continue;
    if (/^[=\-─_]+$/.test(line)) continue;

    line = line.replace(/^[\*\-\•\>]\s*/, '').trim();

    let modelId = '';
    let label = '';

    if (line.includes(':')) {
      const parts = line.split(':');
      modelId = parts[0].trim();
      label = parts.slice(1).join(':').trim();
    } else if (line.includes('\t') || /\s{2,}/.test(line)) {
      const parts = line.split(/\t|\s{2,}/);
      modelId = parts[0].trim();
      label = parts.slice(1).join(' ').trim();
    } else {
      modelId = line.split(/\s+/)[0].trim();
    }

    modelId = modelId.replace(/[\(\)\[\],]$/g, '').trim();

    if (modelId && !seen.has(modelId) && /^[a-zA-Z0-9_\-\.]+$/.test(modelId)) {
      seen.add(modelId);
      list.push({
        id: modelId,
        name: label ? `${modelId} (${label})` : modelId
      });
    }
  }

  return list;
}

let cachedModels = null;
let lastModelsCheckTime = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000; // Cache models for 5 minutes

function getAgyModels(force = false) {
  const now = Date.now();
  if (!force && cachedModels && (now - lastModelsCheckTime < MODELS_CACHE_TTL)) {
    return cachedModels;
  }

  const agyPath = findAgy();
  if (agyPath) {
    try {
      const raw = execSync(`"${agyPath}" models`, {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const parsed = parseAgyModels(raw);
      if (parsed.length > 0) {
        if (!parsed.some(m => m.id === 'auto')) {
          parsed.unshift({ id: 'auto', name: 'auto (自动自适应)' });
        }
        cachedModels = parsed;
        lastModelsCheckTime = now;
        return cachedModels;
      }
    } catch (e) {}
  }

  if (cachedModels) return cachedModels;

  const fallback = [
    { id: 'auto', name: 'auto (自动自适应)' },
    { id: 'flash', name: 'flash (极速响应，推荐)' },
    { id: 'pro', name: 'pro (深度推理，较慢)' },
    { id: 'gemini-3.8-flash-low', name: 'gemini-3.8-flash-low' },
    { id: 'gemini-3.8-flash-medium', name: 'gemini-3.8-flash-medium' },
    { id: 'gemini-3.8-flash-high', name: 'gemini-3.8-flash-high' },
    { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' }
  ];
  cachedModels = fallback;
  lastModelsCheckTime = now;
  return fallback;
}

function readLogs() {
  try {
    if (existsSync(logFile)) {
      const raw = readFileSync(logFile, 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      const results = [];
      
      for (let i = lines.length - 1; i >= 0 && results.length < 30; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object') {
            results.push(parsed);
            continue;
          }
        } catch (e) {}
        
        // Backward compatibility for legacy string logs
        const match = line.match(/^\[(.*?)\]\s*\[(ALLOW|ASK)\]\s*(.*?)\s*->\s*(.*)$/);
        if (match) {
          results.push({
            time: match[1],
            decision: match[2].toLowerCase(),
            cmd: match[3],
            reason: match[4]
          });
        }
      }
      return results;
    }
  } catch (e) {}
  return [];
}

const app = new SidecarApp();

app.page('/', () => readFileSync(htmlFile, 'utf8'));

app.api('/api/status', () => {
  const config = readConfig();
  const logs = readLogs();
  const agyStatus = checkAgyStatus();
  const availableModels = getAgyModels();
  return new Response(JSON.stringify({
    enabled: config.enabled !== false,
    agyAuditEnabled: config.agyAuditEnabled === true,
    agyModel: config.agyModel || 'auto',
    availableModels,
    agyStatus,
    logs
  }), {
    contentType: 'application/json'
  });
}, 'GET');

app.api('/api/toggle', () => {
  const config = readConfig();
  config.enabled = config.enabled === false ? true : false;
  writeConfig(config);
  return new Response(JSON.stringify({ enabled: config.enabled, status: 'ok' }), {
    contentType: 'application/json'
  });
}, 'POST');

app.api('/api/toggle-agy', () => {
  const config = readConfig();
  config.agyAuditEnabled = config.agyAuditEnabled === true ? false : true;
  writeConfig(config);
  return new Response(JSON.stringify({ agyAuditEnabled: config.agyAuditEnabled, status: 'ok' }), {
    contentType: 'application/json'
  });
}, 'POST');

function normalizeModelId(name) {
  if (!name || typeof name !== 'string') return 'auto';
  const clean = name.trim();
  
  const KNOWN_MAP = {
    'gpt-oss 120b (medium)': 'gpt-oss-120b-medium',
    'gpt-oss-120b (medium)': 'gpt-oss-120b-medium',
    'gpt-oss 120b': 'gpt-oss-120b-medium',
    'gemini 3.8 flash (high)': 'gemini-3.8-flash-high',
    'gemini 3.8 flash (medium)': 'gemini-3.8-flash-medium',
    'gemini 3.8 flash (low)': 'gemini-3.8-flash-low',
    'claude sonnet 4.6': 'claude-sonnet-4-6',
    'claude sonnet 4.6 (thinking)': 'claude-sonnet-4-6',
    'claude opus 4.6': 'claude-opus-4-6-thinking',
    'claude opus 4.6 (thinking)': 'claude-opus-4-6-thinking'
  };
  
  const lower = clean.toLowerCase();
  if (KNOWN_MAP[lower]) return KNOWN_MAP[lower];
  
  if (/^[a-zA-Z0-9_\-\.]+$/.test(clean)) {
    return clean.toLowerCase();
  }
  
  return clean
    .toLowerCase()
    .replace(/[\(\)\[\]]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_\-\.]/g, '');
}

app.api('/api/set-model', (data) => {
  let raw = '';
  if (data) {
    if (typeof data.model === 'string') raw = data.model;
    else if (typeof data === 'string') {
      try {
        const p = JSON.parse(data);
        raw = p.model || data;
      } catch (e) {
        raw = data;
      }
    }
  }
  const model = normalizeModelId(raw);
  if (model) {
    const config = readConfig();
    config.agyModel = model;
    writeConfig(config);
    return new Response(JSON.stringify({ success: true, agyModel: config.agyModel }), {
      contentType: 'application/json'
    });
  }
  return new Response(JSON.stringify({ success: false, error: 'Invalid model' }), {
    status: 400,
    contentType: 'application/json'
  });
}, 'POST');

app.api('/api/refresh', () => {
  cachedAgyPath = undefined;
  checkAgyStatus(true);
  getAgyModels(true);
  return new Response(JSON.stringify({ status: 'ok' }), {
    contentType: 'application/json'
  });
}, 'POST');

app.run();
