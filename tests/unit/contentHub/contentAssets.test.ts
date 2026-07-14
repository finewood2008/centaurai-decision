import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contentAssetArchive,
  contentAssetDiscardDraft,
  contentAssetPromoteDraft,
  contentAssetSaveFromPath,
  contentAssetStageFromPath,
  contentAssetsList,
  handleContentAssetArchive,
  handleContentAssetDiscardDraft,
  handleContentAssetDownload,
  handleContentAssetPreview,
  handleContentAssetPromoteDraft,
  handleContentAssetUpload,
  handleContentAssetsList,
} from '../../../packages/web-host/src/content-assets';

const roots: string[] = [];

async function fixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'decision-assets-'));
  roots.push(root);
  const project = path.join(root, 'project');
  const managed = path.join(root, 'managed');
  await fs.promises.mkdir(project);
  const source = path.join(project, 'plan.md');
  await fs.promises.writeFile(source, 'project original');
  return { managed, source };
}

function request(url: string, body?: string | Buffer): IncomingMessage {
  const req = Readable.from(body == null ? [] : [body]) as unknown as IncomingMessage;
  req.url = url;
  return req;
}

function response() {
  let status = 0;
  let headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as unknown as ServerResponse;
  Object.assign(res, {
    headersSent: false,
    writeHead(nextStatus: number, nextHeaders: Record<string, string> = {}) {
      status = nextStatus;
      headers = nextHeaders;
      this.headersSent = true;
      return this;
    },
  });
  return {
    res,
    status: () => status,
    headers: () => headers,
    body: () => Buffer.concat(chunks),
    json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

describe('personal asset lifecycle', () => {
  it('promotes a draft to a stable saved copy', async () => {
    const { managed, source } = await fixture();
    const draft = await contentAssetStageFromPath(managed, {
      sourcePath: source,
      name: 'plan.md',
      ownerUserId: 'system_default_user',
    });

    await fs.promises.writeFile(source, 'project changed');
    const saved = await contentAssetPromoteDraft(managed, draft.id, 'system_default_user');

    expect(saved?.statusFlags).toContain('saved');
    expect(await fs.promises.readFile(saved!.storagePath, 'utf8')).toBe('project original');
    expect(await contentAssetPromoteDraft(managed, draft.id, 'system_default_user')).toBeNull();
    expect(await contentAssetDiscardDraft(managed, draft.id, 'system_default_user')).toBe(false);
  });

  it('saves a sanitized stable copy with inferred metadata', async () => {
    const { managed, source } = await fixture();
    const saved = await contentAssetSaveFromPath(managed, {
      sourcePath: source,
      name: '../unsafe:plan.md',
      ownerUserId: 'alice/example',
      tags: ['meeting'],
      category: 'Q3',
      sourceConversationId: 'conversation-1',
    });

    expect(saved).toMatchObject({
      title: 'unsafe_plan.md',
      kind: 'document',
      ownerUserId: 'alice/example',
      tags: ['meeting'],
      category: 'Q3',
      sourceConversationId: 'conversation-1',
      statusFlags: ['saved'],
      size: 16,
    });
    expect(saved.storagePath).not.toBe(source);
    expect(await fs.promises.readFile(saved.storagePath, 'utf8')).toBe('project original');
  });

  it('rejects directories as source files', async () => {
    const { managed, source } = await fixture();
    await expect(
      contentAssetSaveFromPath(managed, {
        sourcePath: path.dirname(source),
        name: 'project',
        ownerUserId: 'alice',
      })
    ).rejects.toThrow('SOURCE_NOT_FILE');
  });

  it('discards only the managed draft and preserves the project original', async () => {
    const { managed, source } = await fixture();
    const draft = await contentAssetStageFromPath(managed, {
      sourcePath: source,
      name: 'plan.md',
      ownerUserId: 'system_default_user',
    });

    expect(await contentAssetDiscardDraft(managed, draft.id, 'system_default_user')).toBe(true);
    expect(await fs.promises.readFile(source, 'utf8')).toBe('project original');
    expect(await contentAssetsList(managed, 'system_default_user')).toEqual([]);
  });

  it('rejects archive transitions from draft state', async () => {
    const { managed, source } = await fixture();
    const draft = await contentAssetStageFromPath(managed, {
      sourcePath: source,
      name: 'plan.md',
      ownerUserId: 'system_default_user',
    });

    expect(await contentAssetArchive(managed, draft.id, 'system_default_user')).toBeNull();
    expect(await contentAssetArchive(managed, 'missing', 'system_default_user')).toBeNull();
  });

  it('archives a saved item without deleting its stable file', async () => {
    const { managed, source } = await fixture();
    const saved = await contentAssetSaveFromPath(managed, {
      sourcePath: source,
      name: 'plan.md',
      ownerUserId: 'alice',
    });
    const archived = await contentAssetArchive(managed, saved.id, 'alice');
    expect(archived?.statusFlags).toEqual(['archived']);
    expect(await fs.promises.readFile(archived!.storagePath, 'utf8')).toBe('project original');
  });

  it('isolates list and lifecycle operations by server-bound owner', async () => {
    const { managed, source } = await fixture();
    const alice = await contentAssetStageFromPath(managed, {
      sourcePath: source,
      name: 'alice.md',
      ownerUserId: 'alice',
    });
    const bob = await contentAssetStageFromPath(managed, {
      sourcePath: source,
      name: 'bob.md',
      ownerUserId: 'bob',
    });

    expect((await contentAssetsList(managed, 'alice')).map((asset) => asset.id)).toEqual([alice.id]);
    expect((await contentAssetsList(managed, 'bob')).map((asset) => asset.id)).toEqual([bob.id]);
    expect(await contentAssetPromoteDraft(managed, alice.id, 'bob')).toBeNull();
    expect(await contentAssetDiscardDraft(managed, bob.id, 'alice')).toBe(false);
  });

  it('rejects a forged owner on the owner-scoped WebUI API', async () => {
    let status = 0;
    let body = '';
    const req = { url: '/api/content-assets/list?owner=attacker' } as IncomingMessage;
    const res = {
      writeHead(nextStatus: number) {
        status = nextStatus;
        return this;
      },
      end(chunk?: string) {
        body = chunk || '';
        return this;
      },
    } as unknown as ServerResponse;

    await handleContentAssetsList(req, res, undefined, 'system_default_user');

    expect(status).toBe(403);
    expect(JSON.parse(body)).toEqual({ success: false, error: 'FORBIDDEN' });
  });

  it('normalizes valid legacy manifest rows and skips malformed rows', async () => {
    const { managed, source } = await fixture();
    await fs.promises.mkdir(managed, { recursive: true });
    await fs.promises.writeFile(
      path.join(managed, 'manifest.json'),
      JSON.stringify([
        { id: '', title: 'bad', ownerUserId: 'alice', storagePath: source },
        {
          id: 'legacy',
          title: 'script.ts',
          ownerUserId: 'alice',
          storagePath: source,
          sourceWorkspacePath: source,
          visibility: 'invalid',
          storageProvider: 'invalid',
          statusFlags: ['saved', 'invalid'],
          tags: ['ok', 2],
          createdAt: 5,
          updatedAt: 6,
          size: -5,
        },
      ])
    );

    expect(await contentAssetsList(managed)).toEqual([
      expect.objectContaining({
        id: 'legacy',
        kind: 'code',
        visibility: 'private',
        storageProvider: 'personal_content',
        statusFlags: ['saved'],
        tags: ['ok'],
        size: 0,
      }),
    ]);
    expect(await contentAssetsList(undefined)).toEqual([]);
  });

  it('refuses to delete a forged path outside the managed draft root', async () => {
    const { managed, source } = await fixture();
    await fs.promises.mkdir(managed, { recursive: true });
    await fs.promises.writeFile(
      path.join(managed, 'manifest.json'),
      JSON.stringify([
        {
          id: 'forged',
          title: 'plan.md',
          kind: 'document',
          ownerUserId: 'system_default_user',
          visibility: 'private',
          sourceWorkspacePath: source,
          storageProvider: 'personal_content',
          storagePath: source,
          tags: [],
          statusFlags: ['draft'],
          createdAt: 1,
          updatedAt: 1,
        },
      ])
    );

    await expect(contentAssetDiscardDraft(managed, 'forged', 'system_default_user')).rejects.toThrow('UNMANAGED_DRAFT');
    expect(await fs.promises.readFile(source, 'utf8')).toBe('project original');
  });
});

describe('personal asset WebUI handlers', () => {
  it('lists only the server-bound owner', async () => {
    const { managed, source } = await fixture();
    await contentAssetSaveFromPath(managed, { sourcePath: source, name: 'alice.md', ownerUserId: 'alice' });
    await contentAssetSaveFromPath(managed, { sourcePath: source, name: 'bob.md', ownerUserId: 'bob' });
    const output = response();
    await handleContentAssetsList(request('/api/content-assets/list'), output.res, managed, 'alice');
    await finished(output.res);
    expect(output.status()).toBe(200);
    expect(output.json().data).toEqual([expect.objectContaining({ ownerUserId: 'alice' })]);
  });

  it.each([
    ['promote', handleContentAssetPromoteDraft],
    ['archive', handleContentAssetArchive],
    ['discard', handleContentAssetDiscardDraft],
  ] as const)('rejects forged owners on %s', async (route, handler) => {
    const output = response();
    await handler(request(`/api/content-assets/${route}?id=any&owner=attacker`), output.res, '/tmp/assets', 'alice');
    await finished(output.res);
    expect(output.status()).toBe(403);
  });

  it('handles draft upload, promote, archive and failed discard transitions', async () => {
    const { managed } = await fixture();
    const upload = response();
    await handleContentAssetUpload(
      request('/api/content-assets/draft-upload?name=report.pdf&conversation_id=c1&category=reports', 'payload'),
      upload.res,
      managed,
      'alice',
      'draft'
    );
    await finished(upload.res);
    expect(upload.status()).toBe(200);
    const draft = upload.json().data;
    expect(draft).toMatchObject({ ownerUserId: 'alice', statusFlags: ['draft'], size: 7 });

    const promoted = response();
    await handleContentAssetPromoteDraft(
      request(`/api/content-assets/promote?id=${draft.id}`),
      promoted.res,
      managed,
      'alice'
    );
    await finished(promoted.res);
    expect(promoted.json().data.statusFlags).toEqual(['saved']);

    const archived = response();
    await handleContentAssetArchive(
      request(`/api/content-assets/archive?id=${draft.id}`),
      archived.res,
      managed,
      'alice'
    );
    await finished(archived.res);
    expect(archived.json().data.statusFlags).toEqual(['archived']);

    const discard = response();
    await handleContentAssetDiscardDraft(
      request(`/api/content-assets/discard?id=${draft.id}`),
      discard.res,
      managed,
      'alice'
    );
    await finished(discard.res);
    expect(discard.status()).toBe(404);
  });

  it('validates upload availability, metadata and owner', async () => {
    const disabled = response();
    await handleContentAssetUpload(request('/upload?name=a.txt'), disabled.res, undefined, 'alice');
    await finished(disabled.res);
    expect(disabled.status()).toBe(503);

    const missing = response();
    await handleContentAssetUpload(request('/upload'), missing.res, '/tmp/assets', 'alice');
    await finished(missing.res);
    expect(missing.status()).toBe(400);

    const forged = response();
    await handleContentAssetUpload(request('/upload?name=a.txt&owner=bob'), forged.res, '/tmp/assets', 'alice');
    await finished(forged.res);
    expect(forged.status()).toBe(403);
  });

  it('rejects uploads above the hard size limit without allocating the body', async () => {
    const { managed } = await fixture();
    const req = new EventEmitter() as EventEmitter & IncomingMessage;
    req.url = '/upload?name=huge.bin';
    req.pause = () => req;
    req.resume = () => req;
    const output = response();
    const pending = handleContentAssetUpload(req, output.res, managed, 'alice');
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        if (req.listenerCount('data') > 0) resolve();
        else if (Date.now() < deadline) setTimeout(check, 5);
        else reject(new Error('upload handler did not attach its data listener'));
      };
      check();
    });
    req.emit('data', { length: 1024 * 1024 * 1024 + 1 });
    await pending;
    await finished(output.res);
    expect(output.status()).toBe(413);
  });

  it('streams safe inline previews and attachment downloads', async () => {
    const { managed, source } = await fixture();
    const html = await contentAssetSaveFromPath(managed, {
      sourcePath: source,
      name: 'payload.html',
      ownerUserId: 'alice',
    });

    const preview = response();
    await handleContentAssetPreview(request(`/preview?id=${html.id}`), preview.res, managed, 'alice');
    await finished(preview.res);
    expect(preview.status()).toBe(200);
    expect(preview.headers()['content-type']).toBe('text/plain; charset=utf-8');
    expect(preview.headers()['content-security-policy']).toContain('sandbox');
    expect(preview.body().toString()).toBe('project original');

    const download = response();
    await handleContentAssetDownload(request(`/download?id=${html.id}`), download.res, managed, 'alice');
    await finished(download.res);
    expect(download.headers()['content-type']).toBe('application/octet-stream');
    expect(download.headers()['content-disposition']).toContain('attachment');
  });

  it('returns safe errors for unavailable, unknown and missing preview files', async () => {
    const disabled = response();
    await handleContentAssetPreview(request('/preview?id=x'), disabled.res, undefined, 'alice');
    await finished(disabled.res);
    expect(disabled.status()).toBe(404);

    const { managed, source } = await fixture();
    const unknown = response();
    await handleContentAssetPreview(request('/preview?id=unknown'), unknown.res, managed, 'alice');
    await finished(unknown.res);
    expect(unknown.status()).toBe(404);

    const saved = await contentAssetSaveFromPath(managed, {
      sourcePath: source,
      name: 'gone.pdf',
      ownerUserId: 'alice',
    });
    await fs.promises.rm(saved.storagePath);
    const missing = response();
    await handleContentAssetPreview(request(`/preview?id=${saved.id}`), missing.res, managed, 'alice');
    await finished(missing.res);
    expect(missing.status()).toBe(404);
    expect(missing.json().error).toBe('FILE_NOT_FOUND');
  });

  it('rejects inline previews above 100 MiB before streaming', async () => {
    const { managed, source } = await fixture();
    const huge = path.join(path.dirname(source), 'huge.pdf');
    await fs.promises.writeFile(huge, 'x');
    await fs.promises.truncate(huge, 100 * 1024 * 1024 + 1);
    await fs.promises.mkdir(managed, { recursive: true });
    await fs.promises.writeFile(
      path.join(managed, 'manifest.json'),
      JSON.stringify([
        {
          id: 'huge',
          title: 'huge.pdf',
          kind: 'document',
          ownerUserId: 'alice',
          visibility: 'private',
          sourceWorkspacePath: huge,
          storageProvider: 'personal_content',
          storagePath: huge,
          tags: [],
          statusFlags: ['saved'],
          createdAt: 1,
          updatedAt: 1,
          size: 100 * 1024 * 1024 + 1,
        },
      ])
    );
    const output = response();
    await handleContentAssetPreview(request('/preview?id=huge'), output.res, managed, 'alice');
    await finished(output.res);
    expect(output.status()).toBe(413);
  });
});
