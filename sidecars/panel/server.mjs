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

function findAgy() {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'where agy' : 'which agy';
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0];
    if (out && existsSync(out)) return out;
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
    if (existsSync(c)) return c;
  }
  return null;
}

function checkAgyStatus() {
  const agyPath = findAgy();
  if (!agyPath) {
    return { installed: false, path: null, version: null, authenticated: false };
  }

  let version = null;
  try {
    version = execSync(`"${agyPath}" --version`, { encoding: 'utf8', timeout: 3000 }).trim();
  } catch (e) {}

  let authenticated = false;
  try {
    execSync(`"${agyPath}" -p "ping" --disable-slash-commands --print-timeout 2s`, {
      encoding: 'utf8',
      timeout: 3500,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    authenticated = true;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    authenticated = !stderr.includes('Authentication required');
  }

  return {
    installed: true,
    path: agyPath,
    version: version || 'unknown',
    authenticated
  };
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
  return new Response(JSON.stringify({
    enabled: config.enabled !== false,
    agyAuditEnabled: config.agyAuditEnabled === true,
    agyModel: config.agyModel || 'auto',
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

app.api('/api/set-model', (data) => {
  const model = data && typeof data.model === 'string' ? data.model.trim() : '';
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

app.run();
