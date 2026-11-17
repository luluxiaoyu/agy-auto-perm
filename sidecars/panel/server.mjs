import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  return { enabled: true };
}

function writeConfig(cfg) {
  try {
    writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {}
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
  return new Response(JSON.stringify({ enabled: config.enabled !== false, logs }), {
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

app.run();
