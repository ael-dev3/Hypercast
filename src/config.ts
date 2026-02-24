import { PollerRuntimeConfig, AppConfig, SpaceTimeConfig, PollerState, PollCursor } from './types.js';

const DEFAULT_HYPERCAST_STATE_FILE = '.hypercast-state.json';

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseAllowedHosts(value: string | undefined): string[] {
  if (!value) return ['localhost', '127.0.0.1'];
  return value
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(host => host.length > 0);
}

function normalizeHosts(url: URL): string {
  return url.hostname.toLowerCase();
}

function validateHypersnapUrl(rawUrl: string, allowUntrusted: boolean, allowedHosts: string[]): string {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Hypersnap endpoint must use http or https. Received: ${parsed.protocol}`);
  }

  const host = normalizeHosts(parsed);
  if (!allowUntrusted && !allowedHosts.includes(host) && !allowedHosts.includes('*')) {
    throw new Error(
      `Hypersnap endpoint host '${host}' is not in allowlist. Set HYPERSNAP_ALLOW_UNTRUSTED=true or update HYPERSNAP_ALLOWED_HOSTS.`
    );
  }

  return parsed.origin;
}

export function parsePollerState(raw?: string | null): PollerState {
  if (!raw) {
    return {
      fromEventId: '0',
      pageToken: null,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.fromEventId === 'string' && parsed.fromEventId.trim()) {
      return {
        fromEventId: parsed.fromEventId,
        pageToken: typeof parsed.pageToken === 'string' ? parsed.pageToken : null,
      };
    }
  } catch {
    // malformed state should not block polling; fall back to defaults
  }

  return {
    fromEventId: '0',
    pageToken: null,
  };
}

export function cursorFromState(state: PollerState): PollCursor {
  let fromEventId = 0n;
  try {
    fromEventId = BigInt(state.fromEventId);
  } catch {
    fromEventId = 0n;
  }

  return {
    fromEventId,
    pageToken: state.pageToken ?? null,
  };
}

export function toStateFilePayload(cursor: PollCursor): PollerState {
  return {
    fromEventId: cursor.fromEventId.toString(),
    pageToken: cursor.pageToken,
  };
}

export function loadConfig(): AppConfig {
  const allowUntrusted = parseBoolEnv(process.env.HYPERSNAP_ALLOW_UNTRUSTED, false);
  const allowedHosts = parseAllowedHosts(process.env.HYPERSNAP_ALLOWED_HOSTS);
  const hypersnapHttpUrl = validateHypersnapUrl(
    process.env.HYPERSNAP_HTTP_URL ?? 'http://127.0.0.1:3381',
    allowUntrusted,
    allowedHosts
  );

  const poller: PollerRuntimeConfig = {
    hypersnapHttpUrl,
    hypersnapPollIntervalMs: parseIntEnv(process.env.HYPERSNAP_POLL_INTERVAL_MS, 30 * 60 * 1000),
    hypersnapTimeoutMs: parseIntEnv(process.env.HYPERSNAP_REQUEST_TIMEOUT_MS, 12_000),
    maxPagesPerPoll: parseIntEnv(process.env.HYPERSNAP_MAX_PAGES_PER_POLL, 4),
    hypersnapPageSize: parseIntEnv(process.env.HYPERSNAP_PAGE_SIZE, 100),
    eventLookbackMode: parseBoolEnv(process.env.HYPERSNAP_EVENT_LOOKBACK, false),
    pollerName: process.env.HYPERCAST_POLLER_NAME ?? 'local-poller',
    statePath: process.env.HYPERSNAP_STATE_PATH ?? DEFAULT_HYPERCAST_STATE_FILE,
    allowUntrustedEndpoint: allowUntrusted,
    allowedHypersnapHosts: allowedHosts,
  };

  const spacetime: SpaceTimeConfig = {
    uri: process.env.SPACETIMEDB_URI ?? 'ws://localhost:3000',
    databaseName: process.env.SPACETIMEDB_DB_NAME ?? 'hypercast',
  };

  return {
    poller,
    spacetime,
    ui: {
      initialLimit: parseIntEnv(process.env.HYPERCAST_UI_INITIAL_LIMIT, 100),
    },
  };
}
