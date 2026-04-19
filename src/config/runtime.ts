const DEFAULT_PROXY_HTTP = 'http://127.0.0.1:3001';
const DEFAULT_PROXY_WS = 'ws://127.0.0.1:3001/terminal';

declare global {
  interface Window {
    __DEVUTILITY_RUNTIME__?: {
      httpBaseUrl?: string;
      wsBaseUrl?: string;
      desktop?: boolean;
    };
  }
}

function normalizeWsBaseUrl(httpBaseUrl: string) {
  if (httpBaseUrl.startsWith('https://')) {
    return `wss://${httpBaseUrl.slice('https://'.length)}/terminal`;
  }
  if (httpBaseUrl.startsWith('http://')) {
    return `ws://${httpBaseUrl.slice('http://'.length)}/terminal`;
  }
  return DEFAULT_PROXY_WS;
}

function getInjectedRuntime() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__DEVUTILITY_RUNTIME__ ?? null;
}

export function getProxyHttpBaseUrl() {
  const injected = getInjectedRuntime();
  if (injected?.httpBaseUrl) {
    return injected.httpBaseUrl;
  }

  const envBase = import.meta.env.VITE_PROXY_HTTP;
  if (envBase) {
    return envBase;
  }

  if (!import.meta.env.DEV && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return DEFAULT_PROXY_HTTP;
}

export function getProxyWsBaseUrl() {
  const injected = getInjectedRuntime();
  if (injected?.wsBaseUrl) {
    return injected.wsBaseUrl;
  }

  const envBase = import.meta.env.VITE_PROXY_WS;
  if (envBase) {
    return envBase;
  }

  return normalizeWsBaseUrl(getProxyHttpBaseUrl());
}

export const PROXY_HTTP_BASE = getProxyHttpBaseUrl();
export const PROXY_WS_BASE = getProxyWsBaseUrl();
