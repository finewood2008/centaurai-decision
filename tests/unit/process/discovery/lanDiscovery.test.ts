/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filterReachableDiscoveredServers,
  getDiscoveredHostCandidates,
  pickDiscoveredHost,
  probeDiscoveredServer,
  type DiscoveredServer,
} from '@/process/discovery/lanDiscovery';

const makeServer = (overrides: Partial<DiscoveredServer> = {}): DiscoveredServer => ({
  name: 'CentaurAI',
  host: '192.168.1.10',
  port: 25809,
  addresses: ['192.168.1.10'],
  txt: {},
  source: 'mdns',
  ...overrides,
});

describe('lanDiscovery address selection', () => {
  it('prefers the advertised LAN IP over Bonjour address ordering', () => {
    expect(pickDiscoveredHost(['198.18.0.1', '100.90.62.113', '192.168.1.10'], { lanIP: '192.168.6.165' })).toBe(
      '192.168.6.165'
    );
  });

  it('filters proxy, CGNAT, link-local, and loopback candidates before falling back', () => {
    expect(
      getDiscoveredHostCandidates(['127.0.0.1', '169.254.1.8', '198.18.0.1', '100.90.62.113', '10.0.0.7'])
    ).toEqual(['10.0.0.7', '127.0.0.1']);
  });

  it('ignores an unusable TXT LAN IP and selects a usable advertised address', () => {
    expect(pickDiscoveredHost(['192.168.1.76', '198.18.0.1'], { lanIP: '100.90.62.113' })).toBe('192.168.1.76');
  });
});

describe('lanDiscovery reachability probing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a discovered server when the WebHost health endpoint answers', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await probeDiscoveredServer(makeServer(), 50);

    expect(result?.host).toBe('192.168.1.10');
    expect(fetchSpy).toHaveBeenCalledWith('http://192.168.1.10:25809/api/webui-host/health', expect.any(Object));
  });

  it('falls back to /api/auth/status when older servers do not expose WebHost health', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await probeDiscoveredServer(makeServer(), 50);

    expect(result?.host).toBe('192.168.1.10');
    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
      'http://192.168.1.10:25809/api/webui-host/health',
      'http://192.168.1.10:25809/api/auth/status',
    ]);
  });

  it('drops stale discovered servers that cannot be reached on any candidate address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')));

    await expect(
      probeDiscoveredServer(
        makeServer({
          host: '192.168.1.76',
          addresses: ['192.168.1.76', '198.18.0.1'],
          txt: { lanIP: '192.168.1.76' },
        }),
        50
      )
    ).resolves.toBeNull();
  });

  it('returns only reachable servers from a one-shot discovery result', async () => {
    const fetchSpy = vi.fn((url: string) =>
      Promise.resolve(new Response('', { status: url.includes('192.168.1.11') ? 200 : 404 }))
    );
    vi.stubGlobal('fetch', fetchSpy);

    const servers = await filterReachableDiscoveredServers(
      [
        makeServer({ host: '192.168.1.10', addresses: ['192.168.1.10'] }),
        makeServer({ host: '192.168.1.11', addresses: ['192.168.1.11'] }),
      ],
      50
    );

    expect(servers.map((server) => server.host)).toEqual(['192.168.1.11']);
  });
});
