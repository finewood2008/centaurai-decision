#!/usr/bin/env tsx
/**
 * LAN discovery demo / prototype for the distributed CentaurAI client.
 *
 *   # On the admin server machine — advertise this server on the LAN:
 *   tsx scripts/centaur-discovery.ts advertise --name "CentaurAI · 市场部" --port 25808
 *
 *   # On each client machine — discover servers on the LAN:
 *   tsx scripts/centaur-discovery.ts discover
 *
 * The eventual desktop client uses the same `lanDiscovery` module (see
 * packages/desktop/src/process/discovery/lanDiscovery.ts) to populate its
 * "select a server" screen, then connects via the backend host override.
 */

import os from 'os';
import {
  advertiseServer,
  discoverServers,
  type DiscoveredServer,
} from '../packages/desktop/src/process/discovery/lanDiscovery';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const mode = process.argv[2];

if (mode === 'advertise') {
  const name = arg('name', `CentaurAI · ${os.hostname()}`)!;
  const port = Number(arg('port', '25808'));
  const handle = advertiseServer({ name, port, info: { ver: '2.5.0', os: process.platform, host: os.hostname() } });
  console.log(`📡 Advertising "${name}" on _centaurai._tcp port ${port}. Ctrl+C to stop.`);
  const shutdown = () => void handle.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else if (mode === 'discover') {
  console.log('🔎 Browsing the LAN for CentaurAI servers (Ctrl+C to stop)...\n');
  const render = (servers: DiscoveredServer[]) => {
    console.clear();
    console.log('🔎 CentaurAI servers found on this LAN:\n');
    if (servers.length === 0) {
      console.log('   (none yet — make sure a server is advertising on the same network)');
      return;
    }
    servers.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.name}`);
      console.log(`     ${s.host}:${s.port}   ${s.addresses.join(', ')}`);
      if (Object.keys(s.txt).length) console.log(`     ${JSON.stringify(s.txt)}`);
    });
  };
  const handle = discoverServers(render);
  const shutdown = () => {
    handle.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  console.log('Usage: tsx scripts/centaur-discovery.ts <advertise|discover> [--name <name>] [--port <port>]');
  process.exit(1);
}
