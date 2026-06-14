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

const pickHost = (addresses: string[] | undefined): string => {
  const list = addresses ?? [];
  // Prefer a routable IPv4 address; fall back to the first address.
  const ipv4 = list.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a) && !a.startsWith('127.'));
  return ipv4 || list[0] || '';
};

const toRecord = (txt: unknown): Record<string, string> => {
  if (!txt || typeof txt !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(txt as Record<string, unknown>)) out[k] = String(v);
  return out;
};

/**
 * Advertise this machine as a CentaurAI server on the LAN. Call from the
 * server/WebUI startup. Safe to call once; returns a stop() handle.
 */
export function advertiseServer(options: { name: string; port: number; info?: Record<string, string> }): AdvertiseHandle {
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

  const keyOf = (s: Service) => `${s.name}:${s.port}`;
  const emit = () => onUpdate([...byKey.values()]);

  const browser = instance.find({ type: CENTAUR_SERVICE_TYPE, protocol: CENTAUR_SERVICE_PROTOCOL });
  browser.on('up', (s: Service) => {
    byKey.set(keyOf(s), {
      name: s.name,
      host: pickHost(s.addresses),
      port: s.port,
      addresses: s.addresses ?? [],
      txt: toRecord(s.txt),
      source: 'mdns',
    });
    emit();
  });
  browser.on('down', (s: Service) => {
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
      resolve(latest);
    }, timeoutMs);
  });
}
