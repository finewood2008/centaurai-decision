import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { handleDownloadGet, handleDownloadsList, listInstallers } from './downloads.js';

async function mkInstallerDir(files: Array<{ name: string; bytes?: number }>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-installers-'));
  for (const f of files) {
    await fs.writeFile(path.join(dir, f.name), Buffer.alloc(f.bytes ?? 4));
  }
  return dir;
}

describe('listInstallers', () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('returns [] for an unset directory', async () => {
    expect(await listInstallers(undefined)).toEqual([]);
  });

  it('returns [] for a missing directory', async () => {
    expect(await listInstallers('/nonexistent/path/should/not/exist')).toEqual([]);
  });

  it('ignores non-installer files and parses os/arch/version/size', async () => {
    dir = await mkInstallerDir([
      { name: 'CentaurAI-2.1.14-win-x64.exe', bytes: 10 },
      { name: 'CentaurAI-2.1.14-mac-arm64.dmg', bytes: 20 },
      { name: 'CentaurAI-2.1.14-linux-x64.AppImage', bytes: 30 },
      { name: 'README.md' },
      { name: '.DS_Store' },
    ]);
    const list = await listInstallers(dir);
    expect(list).toHaveLength(3);

    const win = list.find((i) => i.os === 'windows');
    expect(win).toMatchObject({ os: 'windows', arch: 'x64', ext: 'exe', version: '2.1.14', size: 10 });

    const mac = list.find((i) => i.os === 'macos');
    expect(mac).toMatchObject({ os: 'macos', arch: 'arm64', ext: 'dmg' });

    const linux = list.find((i) => i.os === 'linux');
    expect(linux).toMatchObject({ os: 'linux', arch: 'x64', ext: 'appimage' });
  });
});

/**
 * Spin up a real http server that routes /api/downloads/* through the handlers,
 * so pipe()/stream behavior is exercised against a genuine ServerResponse.
 */
async function startDownloadServer(
  installerDir: string | undefined
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/downloads/list')) {
      void handleDownloadsList(res, installerDir);
    } else if (req.url?.startsWith('/api/downloads/get')) {
      void handleDownloadGet(req, res, installerDir);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('downloads endpoints', () => {
  let dir: string | null = null;
  let srv: { port: number; close: () => Promise<void> } | null = null;
  afterEach(async () => {
    if (srv) await srv.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    srv = null;
    dir = null;
  });

  it('list responds with a { success, data } envelope', async () => {
    dir = await mkInstallerDir([{ name: 'CentaurAI-1.0.0-win-x64.exe' }]);
    srv = await startDownloadServer(dir);
    const resp = await fetch(`http://127.0.0.1:${srv.port}/api/downloads/list`);
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
  });

  it('get streams a valid installer as an attachment', async () => {
    dir = await mkInstallerDir([{ name: 'CentaurAI-1.0.0-win-x64.exe', bytes: 8 }]);
    srv = await startDownloadServer(dir);
    const resp = await fetch(`http://127.0.0.1:${srv.port}/api/downloads/get?file=CentaurAI-1.0.0-win-x64.exe`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-disposition')).toContain('CentaurAI-1.0.0-win-x64.exe');
    const buf = Buffer.from(await resp.arrayBuffer());
    expect(buf).toHaveLength(8);
  });

  it('get rejects path traversal attempts', async () => {
    dir = await mkInstallerDir([{ name: 'CentaurAI-1.0.0-win-x64.exe' }]);
    srv = await startDownloadServer(dir);
    const resp = await fetch(`http://127.0.0.1:${srv.port}/api/downloads/get?file=..%2F..%2Fetc%2Fpasswd`);
    expect(resp.status).toBe(400);
  });

  it('get 404s a missing file', async () => {
    dir = await mkInstallerDir([]);
    srv = await startDownloadServer(dir);
    const resp = await fetch(`http://127.0.0.1:${srv.port}/api/downloads/get?file=CentaurAI-9.9.9-win-x64.exe`);
    expect(resp.status).toBe(404);
  });
});
