import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
      return raw.trim().split('\n').slice(-30).reverse();
    }
  } catch (e) {}
  return [];
}

// Check for Antigravity Sidecar SDK
let isSidecarSdk = false;
try {
  const { SidecarApp, Response: SResponse } = await import('sidecar_sdk');
  const app = new SidecarApp();
  
  app.page('/', () => {
    return readFileSync(htmlFile, 'utf8');
  });

  app.api('/api/status', () => {
    const config = readConfig();
    const logs = readLogs();
    return new SResponse(JSON.stringify({ enabled: config.enabled !== false, logs }), {
      contentType: 'application/json'
    });
  }, 'GET');

  app.api('/api/toggle', () => {
    const config = readConfig();
    config.enabled = config.enabled === false ? true : false;
    writeConfig(config);
    return new SResponse(JSON.stringify({ enabled: config.enabled, status: 'ok' }), {
      contentType: 'application/json'
    });
  }, 'POST');

  isSidecarSdk = true;
} catch (err) {
  // Fallback to standalone HTTP server
}

if (!isSidecarSdk) {
  const port = process.env.PORT || 18989;
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(htmlFile, 'utf8'));
      return;
    }
    
    if (url.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: readConfig().enabled !== false, logs: readLogs() }));
      return;
    }
    
    if (url.pathname === '/api/toggle' && req.method === 'POST') {
      const config = readConfig();
      config.enabled = config.enabled === false ? true : false;
      writeConfig(config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: config.enabled, status: 'ok' }));
      return;
    }
    
    res.writeHead(404);
    res.end('Not found');
  });
  
  server.listen(port, '127.0.0.1', () => {});
}
