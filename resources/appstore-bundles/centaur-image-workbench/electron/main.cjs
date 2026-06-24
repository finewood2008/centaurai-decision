/**
 * Centaur Image Studio — standalone desktop shell.
 *
 * Serves the prebuilt static SPA (../dist) over a loopback HTTP server so it
 * runs in a secure context (service worker works; unlike file://) and behaves
 * exactly like the known-good local launcher, then loads it in its own
 * BrowserWindow — a standalone app, not embedded in CentaurAI. The user
 * supplies their own API key in the app's Settings (BYOK).
 */

const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const resolved = path.join(DIST, urlPath);
      if (!resolved.startsWith(DIST)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      fs.readFile(resolved, (err, data) => {
        if (err) {
          // SPA fallback
          fs.readFile(path.join(DIST, 'index.html'), (e2, idx) => {
            if (e2) {
              res.writeHead(404);
              res.end('not found');
              return;
            }
            res.writeHead(200, { 'Content-Type': MIME['.html'] });
            res.end(idx);
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createWindow() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    title: '半人马 AI 图形工作台',
    backgroundColor: '#F5F0E6',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow);
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
