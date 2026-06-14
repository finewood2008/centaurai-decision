/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// 集中管理 renderer 端的运行时补丁，使入口文件保持整洁
// Centralize renderer runtime patches so the entry file stays tidy

declare global {
  interface Window {
    __AionSafeResizeObserver__?: boolean;
    __AionResizeObserverPatched__?: boolean;
  }

  interface Console {
    __AionResizeObserverPatched__?: boolean;
  }
}

const RESIZE_OBSERVER_PATTERNS = [
  'resizeobserver loop limit exceeded',
  'resizeobserver loop completed with undelivered notifications',
];

// Silence Arco Design Message component key warnings (internal library issue)
// 抑制 Arco Design Message 组件的 key 警告（第三方库内部问题）
const ARCO_MESSAGE_KEY_PATTERNS = [
  'each child in a list should have a unique "key" prop',
  'check the render method of `layout`',
  'check the render method of `message`',
];

// Silence React 19 ref deprecation warnings from third-party libraries
// 抑制第三方库中 React 19 ref 废弃警告（等待库更新）
const REACT_19_REF_PATTERNS = ['accessing element.ref was removed in react 19', 'ref is now a regular prop'];

const patchLegacyWebApis = () => {
  const globalScope = globalThis as typeof globalThis & {
    structuredClone?: <T>(value: T) => T;
  };

  if (typeof Object.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      configurable: true,
      writable: true,
      value(object: object, key: PropertyKey) {
        return Object.prototype.hasOwnProperty.call(object, key);
      },
    });
  }

  const defineAt = <T extends { at?: (index: number) => unknown; length: number; [key: number]: unknown }>(
    proto: T
  ) => {
    if (typeof proto.at === 'function') {
      return;
    }

    Object.defineProperty(proto, 'at', {
      configurable: true,
      writable: true,
      value(index: number) {
        const length = Number(this.length) || 0;
        const normalizedIndex = Math.trunc(index) < 0 ? length + Math.trunc(index) : Math.trunc(index);
        if (normalizedIndex < 0 || normalizedIndex >= length) {
          return undefined;
        }
        return this[normalizedIndex];
      },
    });
  };

  defineAt(Array.prototype as Array<unknown> & { at?: (index: number) => unknown });
  defineAt(String.prototype as unknown as { at?: (index: number) => unknown; length: number; [key: number]: unknown });

  if (typeof globalScope.structuredClone !== 'function') {
    globalScope.structuredClone = <T>(value: T): T => {
      if (value === null || typeof value !== 'object') {
        return value;
      }
      if (value instanceof Date) {
        return new Date(value.getTime()) as T;
      }
      if (value instanceof RegExp) {
        return new RegExp(value.source, value.flags) as T;
      }
      if (Array.isArray(value)) {
        return value.map((item) => globalScope.structuredClone?.(item)) as T;
      }
      if (value instanceof Map) {
        return new Map(
          Array.from(value.entries(), ([key, entry]) => [
            globalScope.structuredClone?.(key),
            globalScope.structuredClone?.(entry),
          ])
        ) as T;
      }
      if (value instanceof Set) {
        return new Set(Array.from(value.values(), (entry) => globalScope.structuredClone?.(entry))) as T;
      }
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          globalScope.structuredClone?.(entry),
        ])
      ) as T;
    };
  }
};

const patchArrayCopyMethods = () => {
  // Older iPadOS Safari versions do not implement the ES2023 "change array by
  // copy" methods. The app uses them in the login, sidebar, and homepage paths;
  // missing methods cause a blank page before React can render.
  const proto = Array.prototype as Array<unknown> & {
    toReversed?: () => unknown[];
    toSorted?: (compareFn?: (a: unknown, b: unknown) => number) => unknown[];
    toSpliced?: (start: number, deleteCount?: number, ...items: unknown[]) => unknown[];
    with?: (index: number, value: unknown) => unknown[];
  };

  if (typeof proto.toReversed !== 'function') {
    Object.defineProperty(proto, 'toReversed', {
      configurable: true,
      writable: true,
      value() {
        return Array.from(this).toReversed();
      },
    });
  }

  if (typeof proto.toSorted !== 'function') {
    Object.defineProperty(proto, 'toSorted', {
      configurable: true,
      writable: true,
      value(compareFn?: (a: unknown, b: unknown) => number) {
        return Array.from(this).toSorted(compareFn);
      },
    });
  }

  if (typeof proto.toSpliced !== 'function') {
    Object.defineProperty(proto, 'toSpliced', {
      configurable: true,
      writable: true,
      value(start: number, deleteCount?: number, ...items: unknown[]) {
        const copy = Array.from(this);
        if (arguments.length === 1) {
          copy.splice(start);
        } else {
          copy.splice(start, deleteCount ?? 0, ...items);
        }
        return copy;
      },
    });
  }

  if (typeof proto.with !== 'function') {
    Object.defineProperty(proto, 'with', {
      configurable: true,
      writable: true,
      value(index: number, value: unknown) {
        const copy = Array.from(this);
        const normalizedIndex = index < 0 ? copy.length + index : index;
        if (normalizedIndex < 0 || normalizedIndex >= copy.length) {
          throw new RangeError('Invalid index');
        }
        copy[normalizedIndex] = value;
        return copy;
      },
    });
  }
};

const extractMessage = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && 'message' in value && typeof (value as any).message === 'string') {
    return (value as { message: string }).message;
  }
  return undefined;
};

const shouldSilence = (message?: string) => {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    RESIZE_OBSERVER_PATTERNS.some((pattern) => normalized.includes(pattern)) ||
    ARCO_MESSAGE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern)) ||
    REACT_19_REF_PATTERNS.some((pattern) => normalized.includes(pattern))
  );
};

const patchGlobalErrorListeners = () => {
  const nativeAdd = window.addEventListener.bind(window);
  const nativeRemove = window.removeEventListener.bind(window);
  const listenerMap = new WeakMap<EventListenerOrEventListenerObject, EventListenerOrEventListenerObject>();

  // Hook the top-level error listeners so we can filter ResizeObserver noise before
  // Arco overlays run (避免在 overlay 触发前就被 ResizeObserver 循环警告刷屏，同时保留真实报错).
  window.addEventListener = ((type: any, listener: any, options: any) => {
    if ((type === 'error' || type === 'unhandledrejection') && listener) {
      const wrapped: EventListenerOrEventListenerObject = (event: any) => {
        const message =
          type === 'error' ? (extractMessage(event.error) ?? event.message) : extractMessage(event.reason);
        if (shouldSilence(message)) {
          event.preventDefault?.();
          event.stopImmediatePropagation?.();
          return;
        }
        if (typeof listener === 'function') {
          return listener(event);
        }
        return listener.handleEvent?.(event);
      };
      listenerMap.set(listener, wrapped);
      return nativeAdd(type, wrapped, options);
    }
    return nativeAdd(type, listener, options);
  }) as typeof window.addEventListener;

  window.removeEventListener = ((type: any, listener: any, options: any) => {
    if ((type === 'error' || type === 'unhandledrejection') && listenerMap.has(listener)) {
      const wrapped = listenerMap.get(listener) as EventListenerOrEventListenerObject;
      listenerMap.delete(listener);
      return nativeRemove(type, wrapped, options);
    }
    return nativeRemove(type, listener, options);
  }) as typeof window.removeEventListener;
};

const patchResizeObserver = () => {
  // Wrap ResizeObserver callbacks in requestAnimationFrame to break the feedback loop that
  // browsers treat as "ResizeObserver loop" (在下一帧执行回调，可彻底规避 ResizeObserver loop limit 警告).
  if (!window.__AionSafeResizeObserver__ && typeof ResizeObserver !== 'undefined') {
    const NativeResizeObserver = window.ResizeObserver;
    class SafeResizeObserver extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        let frame = 0;
        super((entries, observer) => {
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            frame = 0;
            try {
              callback(entries, observer);
            } catch (error) {
              if (!shouldSilence(extractMessage(error))) {
                throw error;
              }
            }
          });
        });
      }
    }
    window.ResizeObserver = SafeResizeObserver as typeof ResizeObserver;
    window.__AionSafeResizeObserver__ = true;
  }
};

const patchGlobalErrorFilters = () => {
  // Global error/rejection filter: quietly drop known RO-loop messages but keep other errors
  // (全局过滤 ResizeObserver 循环提示，只忽略白名单消息，其余错误依然向外抛出).
  if (!window.__AionResizeObserverPatched__) {
    const errorHandler = (event: ErrorEvent) => {
      if (shouldSilence(extractMessage(event.error) ?? event.message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      if (shouldSilence(extractMessage(event.reason))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('error', errorHandler, true);
    window.addEventListener('unhandledrejection', rejectionHandler, true);
    window.__AionResizeObserverPatched__ = true;
  }
};

const patchConsole = () => {
  // Console patch mirrors the listener filters so devtools logs stay clean（控制台同样做拦截，防止被重复警告淹没）.
  if (typeof console !== 'undefined' && !console.__AionResizeObserverPatched__) {
    const rawError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      if (args.some((arg) => shouldSilence(extractMessage(arg)))) {
        return;
      }
      rawError(...args);
    };
    console.__AionResizeObserverPatched__ = true;
  }
};

export const applyRuntimePatches = () => {
  if (typeof window === 'undefined') {
    return;
  }
  patchLegacyWebApis();
  patchArrayCopyMethods();
  patchGlobalErrorListeners();
  patchResizeObserver();
  patchGlobalErrorFilters();
  patchConsole();
};

applyRuntimePatches();
