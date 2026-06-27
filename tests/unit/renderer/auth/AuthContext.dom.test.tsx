import React, { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

describe('AuthContext login', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('accepts a successful /login response without an embedded user and fetches /api/auth/user', async () => {
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-webui-gate-token': 'gate-token' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, user: { id: 'u1', username: 'admin' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchSpy);
    const onResult = vi.fn();
    const { AuthProvider, useAuth } = await import('@/renderer/hooks/context/AuthContext');
    const LoginProbe: React.FC = () => {
      const { login, status } = useAuth();
      const didLogin = useRef(false);
      useEffect(() => {
        if (status === 'checking' || didLogin.current) return;
        didLogin.current = true;
        void login({ username: 'admin', password: 'pw' }).then(onResult);
      }, [login, status]);
      return null;
    };

    render(
      <AuthProvider>
        <LoginProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ success: true }));
    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual(['/api/auth/user', '/login', '/api/auth/user']);
  });
});
