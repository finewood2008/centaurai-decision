/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Distributed-client "select a server" screen. Shown when the app runs in
 * client mode (`window.__clientMode`) and no server is connected yet. Browses
 * the LAN for CentaurAI servers (mDNS) and offers a manual host:port fallback.
 * Picking a server calls `electronAPI.connectToServer`, which sets the backend
 * host/port and reloads the window so the app talks to the remote server.
 */
import { ipcBridge } from '@/common';
import type { DiscoveredServerInfo } from '@/common/adapter/ipcBridge';
import { Button, Input, InputNumber, Message, Spin } from '@arco-design/web-react';
import { Refresh, Search, Wifi } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';

const ConnectScreen: React.FC = () => {
  const [servers, setServers] = useState<DiscoveredServerInfo[]>([]);
  const [scanning, setScanning] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [manualHost, setManualHost] = useState('');
  const [manualPort, setManualPort] = useState<number>(25808);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const list = await ipcBridge.discovery.list.invoke({ timeoutMs: 3000 });
      setServers(list ?? []);
    } catch {
      setServers([]);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  const probeServer = useCallback(async (host: string, port: number): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`http://${host}:${port}/api/webui-host/health`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  const connect = useCallback(
    async (host: string, port: number, key: string) => {
      if (!host || !port) {
        Message.warning('请填写服务器地址和端口');
        return;
      }
      setConnecting(key);
      try {
        const reachable = await probeServer(host, port);
        if (!reachable) {
          Message.error('连接失败，请检查服务器地址');
          setConnecting(null);
          return;
        }
        await window.electronAPI?.connectToServer?.(host, port);
        // The main process reloads the window after this; no further action needed.
      } catch {
        Message.error('连接失败，请检查服务器地址');
        setConnecting(null);
      }
    },
    [probeServer]
  );

  return (
    <div className='centaur-brand flex h-100vh w-full items-center justify-center p-24px'>
      <div className='centaur-card w-full max-w-520px p-28px' style={{ borderRadius: 'var(--centaur-radius)' }}>
        <div className='flex items-center gap-12px'>
          <div className='centaur-mark h-48px w-48px shrink-0'>
            <Wifi size={24} />
          </div>
          <div>
            <div className='centaur-eyebrow'>CENTAUR · CONNECT</div>
            <div className='text-22px font-900 leading-28px' style={{ color: 'var(--centaur-ink)' }}>
              连接到服务器
            </div>
          </div>
        </div>
        <p className='mt-10px text-13px leading-20px' style={{ color: 'var(--centaur-ink-soft)' }}>
          选择局域网内的 CentaurAI 服务器，或手动输入服务器地址。连接后用账号登录即可使用。
        </p>

        {/* Discovered servers */}
        <div className='mt-18px flex items-center justify-between'>
          <span className='text-13px font-600' style={{ color: 'var(--centaur-ink)' }}>
            局域网发现
          </span>
          <Button size='mini' type='text' icon={<Refresh size={14} />} loading={scanning} onClick={() => void scan()}>
            刷新
          </Button>
        </div>
        <div className='mt-8px flex flex-col gap-8px'>
          {scanning && servers.length === 0 ? (
            <div
              className='flex items-center justify-center gap-8px py-20px text-13px'
              style={{ color: 'var(--centaur-ink-mute)' }}
            >
              <Spin size={16} /> 正在搜索服务器…
            </div>
          ) : servers.length === 0 ? (
            <div className='py-16px text-center text-13px' style={{ color: 'var(--centaur-ink-mute)' }}>
              未发现服务器，可在下方手动输入地址。
            </div>
          ) : (
            servers.map((s) => {
              const key = `${s.host}:${s.port}`;
              return (
                <div
                  key={key}
                  className='flex items-center justify-between gap-10px rounded-12px px-14px py-10px'
                  style={{ background: 'var(--centaur-bg-warm)', border: '1px solid var(--centaur-line)' }}
                >
                  <div className='min-w-0'>
                    <div className='truncate text-14px font-600' style={{ color: 'var(--centaur-ink)' }}>
                      {s.name}
                    </div>
                    <div className='truncate text-12px' style={{ color: 'var(--centaur-ink-mute)' }}>
                      {s.host}:{s.port}
                    </div>
                  </div>
                  <Button
                    type='primary'
                    size='small'
                    loading={connecting === key}
                    onClick={() => void connect(s.host, s.port, key)}
                  >
                    连接
                  </Button>
                </div>
              );
            })
          )}
        </div>

        {/* Manual entry */}
        <div className='mt-20px border-0 border-t b-solid pt-16px' style={{ borderColor: 'var(--centaur-line)' }}>
          <span className='text-13px font-600' style={{ color: 'var(--centaur-ink)' }}>
            手动输入
          </span>
          <div className='mt-8px flex items-center gap-8px'>
            <Input
              prefix={<Search size={14} />}
              placeholder='服务器 IP，例如 192.168.1.75'
              value={manualHost}
              onChange={setManualHost}
              className='flex-1'
            />
            <InputNumber
              min={1}
              max={65535}
              value={manualPort}
              onChange={(v) => setManualPort(Number(v) || 25808)}
              style={{ width: 110 }}
            />
            <Button
              type='primary'
              loading={connecting === 'manual'}
              onClick={() => void connect(manualHost.trim(), manualPort, 'manual')}
            >
              连接
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectScreen;
