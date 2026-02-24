export interface ClientSpacetimeConfig {
  uri: string;
  databaseName: string;
  enabled: boolean;
}

export interface ClientHypersnapConfig {
  baseUrl: string;
  timeoutMs: number;
  pageSize: number;
  pollIntervalMs: number;
  maxPagesPerPoll: number;
  reverse: boolean;
  allowUntrustedHost: boolean;
  hostIsTrusted: boolean;
}

export interface ClientUiConfig {
  initialLimit: number;
  fallbackMode: 'hypersnap' | 'spacetime';
}

export interface ClientConfig {
  spacetime: ClientSpacetimeConfig;
  hypersnap: ClientHypersnapConfig;
  ui: ClientUiConfig;
}

export const CLIENT_STORAGE_KEYS = {
  hypersnapUrl: 'hypercast.hypersnapUrl',
  hypersnapTimeoutMs: 'hypercast.hypersnapTimeoutMs',
  hypersnapPageSize: 'hypercast.hypersnapPageSize',
  hypersnapPollIntervalMs: 'hypercast.hypersnapPollIntervalMs',
  hypersnapMaxPages: 'hypercast.hypersnapMaxPages',
  hypersnapReverse: 'hypercast.hypersnapReverse',
  allowUntrustedHost: 'hypercast.allowUntrustedHost',
  uiLimit: 'hypercast.uiLimit',
  mode: 'hypercast.mode',
  spacetimeUri: 'hypercast.spacetimeUri',
  spacetimeDb: 'hypercast.spacetimeDb',
  spacetimeEnabled: 'hypercast.spacetimeEnabled',
} as const;

const DEFAULT_HYPERSNAP_BASE_URL = 'http://127.0.0.1:3381';
const DEFAULT_HYPERSNAP_TIMEOUT_MS = 15_000;
const DEFAULT_HYPERSNAP_PAGE_SIZE = 100;
const DEFAULT_HYPERSNAP_POLL_MS = 30_000;
const DEFAULT_HYPERSNAP_MAX_PAGES = 2;
const DEFAULT_UI_LIMIT = 200;

const TRUSTED_LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

function parseBoolean(value: string | null, fallback = false): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseInteger(value: string | null, fallback: number, min = 1, max = 2_000_000): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
}

function safeParseUrl(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function getQueryParam(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const query = new URLSearchParams(window.location.search);
  return query.get(key);
}

function readStoredValue(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function isTrustedHypersnapHost(url: URL): boolean {
  return TRUSTED_LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith('.farcaster.xyz');
}

export function loadClientConfig(): ClientConfig {
  const endpointFromQuery = safeParseUrl(getQueryParam('hypersnap') ?? getQueryParam('hypersnapBaseUrl'));
  const endpointFromStorage = safeParseUrl(readStoredValue(CLIENT_STORAGE_KEYS.hypersnapUrl));
  const baseUrl = endpointFromQuery ?? endpointFromStorage ?? DEFAULT_HYPERSNAP_BASE_URL;
  const parsedBaseUrl = new URL(baseUrl);

  const allowUntrustedHost = parseBoolean(
    getQueryParam('hypersnapAllowUntrustedHost') ??
      getQueryParam('allowUntrustedHost') ??
      getQueryParam('allow_untrusted') ??
      readStoredValue(CLIENT_STORAGE_KEYS.allowUntrustedHost),
    false
  );

  const hypersnap = {
    baseUrl,
    timeoutMs: parseInteger(
      getQueryParam('hypersnapTimeoutMs') ?? readStoredValue(CLIENT_STORAGE_KEYS.hypersnapTimeoutMs),
      DEFAULT_HYPERSNAP_TIMEOUT_MS,
      1_000,
      120_000
    ),
    pageSize: parseInteger(
      getQueryParam('hypersnapPageSize') ?? readStoredValue(CLIENT_STORAGE_KEYS.hypersnapPageSize),
      DEFAULT_HYPERSNAP_PAGE_SIZE,
      10,
      500
    ),
    pollIntervalMs: parseInteger(
      getQueryParam('hypersnapPollIntervalMs') ??
        readStoredValue(CLIENT_STORAGE_KEYS.hypersnapPollIntervalMs),
      DEFAULT_HYPERSNAP_POLL_MS,
      5_000,
      120_000
    ),
    maxPagesPerPoll: parseInteger(
      getQueryParam('hypersnapMaxPages') ?? readStoredValue(CLIENT_STORAGE_KEYS.hypersnapMaxPages),
      DEFAULT_HYPERSNAP_MAX_PAGES,
      1,
      50
    ),
    reverse: parseBoolean(
      getQueryParam('hypersnapReverse') ?? readStoredValue(CLIENT_STORAGE_KEYS.hypersnapReverse),
      true
    ),
    allowUntrustedHost,
    hostIsTrusted: allowUntrustedHost || isTrustedHypersnapHost(parsedBaseUrl),
  } as const;

  const uiLimit = parseInteger(
    getQueryParam('uiLimit') ?? readStoredValue(CLIENT_STORAGE_KEYS.uiLimit),
    DEFAULT_UI_LIMIT,
    5,
    500
  );

  const spacetimeEnabled = parseBoolean(
    getQueryParam('spacetimeEnabled') ?? readStoredValue(CLIENT_STORAGE_KEYS.spacetimeEnabled),
    true
  );

  return {
    hypersnap,
    spacetime: {
      uri:
        getQueryParam('spacetimedbUri') ??
        readStoredValue(CLIENT_STORAGE_KEYS.spacetimeUri) ??
        'ws://localhost:3000',
      databaseName:
        getQueryParam('spacetimedbDb') ??
        readStoredValue(CLIENT_STORAGE_KEYS.spacetimeDb) ??
        'hypercast',
      enabled: spacetimeEnabled,
    },
    ui: {
      initialLimit: uiLimit,
      fallbackMode:
        getQueryParam('mode') === 'spacetime'
          ? 'spacetime'
          : getQueryParam('mode') === 'hypersnap'
            ? 'hypersnap'
            : (readStoredValue(CLIENT_STORAGE_KEYS.mode) as 'spacetime' | 'hypersnap' | null) ?? 'hypersnap',
    },
  };
}
