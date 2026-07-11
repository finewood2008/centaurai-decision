/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LAN service discovery for the distributed-client model.
 *
 * The admin server (the machine running the backend / WebUI) advertises a
 * `_centaurai._tcp` mDNS service. Each distributed client browses the LAN for
 * that service on launch, lets the user pick a server, then connects + logs in.
 * A native client is an Electron "secure context", so microphone / voice input
 * works (unlike a plain-HTTP LAN browser tab). See httpBridge `__backendHost`.
 */

import { Bonjour, type Service } from 'bonjour-service';

type BonjourService = InstanceType<typeof Service>;

export const CENTAUR_SERVICE_TYPE = 'centaurai';
export const CENTAUR_SERVICE_PROTOCOL = 'tcp' as const;

/** A server discovered on the LAN (or entered manually). */
export type DiscoveredServer = {
  /** Display name advertised by the server (e.g. "CentaurAI · 市场部"). */
  name: string;
  /** Best-effort reachable host (IPv4 preferred) or manual hostname/IP. */
  host: string;
  port: number;
  /** All advertised addresses (IPv4 + IPv6). */
  addresses: string[];
  /** Advertised metadata (version, os, etc.). */
  txt: Record<string, string>;
  /** 'mdns' = auto-discovered; 'manual' = user-entered. */
  source: 'mdns' | 'manual';
};

/** Handle returned by {@link advertiseServer}; call stop() to unpublish. */
export type AdvertiseHandle = { stop: () => Promise<void> };

const DISCOVERY_PROBE_TIMEOUT_MS = 900;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

const isIpv4Address = (addr: string): boolean => {
  if (!IPV4_RE.test(addr)) return false;
  return addr.split('.').every((part) => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
};

const isProxyOrCgnatAddr = (addr: string): boolean => {
  if (/^198\.1[89]\./.test(addr)) return true;
  const cgnat = /^100\.(\d+)\./.exec(addr);
  if (cgnat && Number(cgnat[1]) >= 64 && Number(cgnat[1]) <= 127) return true;
  return false;
};

const isUsableLanAddr = (addr: string): boolean => {
  if (!isIpv4Address(addr)) return false;
  if (addr.startsWith('127.') || addr.startsWith('0.') || addr.startsWith('169.254.')) return false;
  if (Number(addr.split('.')[0]) >= 224) return false;
  return !isProxyOrCgnatAddr(addr);
};

const lanAddrScore = (addr: string): number => {
  if (addr.startsWith('192.168.')) return 3;
  if (addr.startsWith('10.')) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 2;
  return 1;
};

const unique = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
};

const toRecord = (txt: unknown): Record<string, string> => {
  if (!txt || typeof txt !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(txt as Record<string, unknown>)) out[k] = String(v);
  return out;
};

export const getDiscoveredHostCandidates = (
  addresses: string[] | undefined,
  txt: Record<string, string> = {}
): string[] => {
  const txtLanIP = txt.lanIP?.trim();
  const usable = (addresses ?? []).filter(isUsableLanAddr).sort((a, b) => lanAddrScore(b) - lanAddrScore(a));
  const fallback = addresses?.[0] ? [addresses[0]] : [];
  return unique([...(txtLanIP && isUsableLanAddr(txtLanIP) ? [txtLanIP] : []), ...usable, ...fallback]);
};

export const pickDiscoveredHost = (addresses: string[] | undefined, txt: Record<string, string> = {}): string => {
  return getDiscoveredHostCandidates(addresses, txt)[0] ?? '';
};

const httpHost = (host: string): string => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host);

const probeUrlOk = async (url: string, timeoutMs: number): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const probeHost = async (host: string, port: number, timeoutMs: number): Promise<boolean> => {
  const baseUrl = `http://${httpHost(host)}:${port}`;
  if (await probeUrlOk(`${baseUrl}/api/webui-host/health`, timeoutMs)) return true;
  return probeUrlOk(`${baseUrl}/api/auth/status`, timeoutMs);
};

export const probeLanServer = (
  host: string,
  port: number,
  timeoutMs = DISCOVERY_PROBE_TIMEOUT_MS
): Promise<boolean> => {
  return probeHost(host, port, timeoutMs);
};

export const probeDiscoveredServer = async (
  server: DiscoveredServer,
  timeoutMs = DISCOVERY_PROBE_TIMEOUT_MS
): Promise<DiscoveredServer | null> => {
  const candidates = getDiscoveredHostCandidates(server.addresses, server.txt);
  if (server.host && !candidates.includes(server.host)) candidates.push(server.host);
  const results = await Promise.all(
    candidates.map(async (host) => ({ host, ok: await probeHost(host, server.port, timeoutMs) }))
  );
  const reachable = candidates.find((host) => results.some((result) => result.host === host && result.ok));
  if (!reachable) return null;
  return { ...server, host: reachable, addresses: unique([reachable, ...server.addresses]) };
};

export const filterReachableDiscoveredServers = async (
  servers: DiscoveredServer[],
  timeoutMs = DISCOVERY_PROBE_TIMEOUT_MS
): Promise<DiscoveredServer[]> => {
  const probed = await Promise.all(servers.map((server) => probeDiscoveredServer(server, timeoutMs)));
  return probed.filter((server): server is DiscoveredServer => server !== null);
};

const serviceToDiscoveredServer = (s: BonjourService): DiscoveredServer => {
  const txt = toRecord(s.txt);
  return {
    name: s.name,
    host: pickDiscoveredHost(s.addresses, txt),
    port: s.port,
    addresses: s.addresses ?? [],
    txt,
    source: 'mdns',
  };
};

/**
 * Advertise this machine as a CentaurAI server on the LAN. Call from the
 * server/WebUI startup. Safe to call once; returns a stop() handle.
 */
export function advertiseServer(options: {
  name: string;
  port: number;
  info?: Record<string, string>;
}): AdvertiseHandle {
  const instance = new Bonjour();
  const service = instance.publish({
    name: options.name,
    type: CENTAUR_SERVICE_TYPE,
    protocol: CENTAUR_SERVICE_PROTOCOL,
    port: options.port,
    txt: options.info ?? {},
  });
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        try {
          service.stop?.(() => {
            instance.destroy();
            resolve();
          });
          // Fallback if stop() never calls back.
          setTimeout(() => {
            try {
              instance.destroy();
            } catch {
              /* already destroyed */
            }
            resolve();
          }, 1500);
        } catch {
          resolve();
        }
      }),
  };
}

/** Live browser returned by {@link discoverServers}. */
export type DiscoveryHandle = { stop: () => void };

/**
 * Browse the LAN for CentaurAI servers. `onUpdate` is called with the full
 * current list whenever a server appears or disappears. Call stop() to end.
 */
export function discoverServers(onUpdate: (servers: DiscoveredServer[]) => void): DiscoveryHandle {
  const instance = new Bonjour();
  const byKey = new Map<string, DiscoveredServer>();

  const keyOf = (s: BonjourService) => `${s.name}:${s.port}`;
  const emit = () => onUpdate([...byKey.values()]);

  const browser = instance.find({ type: CENTAUR_SERVICE_TYPE, protocol: CENTAUR_SERVICE_PROTOCOL });
  browser.on('up', (s: BonjourService) => {
    byKey.set(keyOf(s), serviceToDiscoveredServer(s));
    emit();
  });
  browser.on('down', (s: BonjourService) => {
    byKey.delete(keyOf(s));
    emit();
  });

  return {
    stop: () => {
      try {
        browser.stop();
      } catch {
        /* noop */
      }
      instance.destroy();
    },
  };
}

/** One-shot discovery: collect servers for `timeoutMs`, then resolve + stop. */
export function discoverServersOnce(timeoutMs = 3000): Promise<DiscoveredServer[]> {
  return new Promise((resolve) => {
    let latest: DiscoveredServer[] = [];
    const handle = discoverServers((servers) => {
      latest = servers;
    });
    setTimeout(() => {
      handle.stop();
      void filterReachableDiscoveredServers(latest).then(resolve);
    }, timeoutMs);
  });
}
