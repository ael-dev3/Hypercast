import { connectSpacetime, subscribeCasts, subscribeSyncState } from './spacetime-connection.js';
import { HypersnapCastFeed, formatCastAge } from './hypersnap-feed.js';
import {
  CLIENT_STORAGE_KEYS,
  type ClientConfig,
  isTrustedHypersnapHost,
  loadClientConfig,
} from './client-config.js';
import './styles.css';

type TransportMode = 'hypersnap' | 'spacetime';

interface FeedRow {
  hash: string;
  fid: number;
  createdAtMillis: bigint;
  text: string;
  mentions: number[];
  parentHash: string | null;
  parentFid: number | null;
  source: TransportMode;
}

interface UIElements {
  modeChip: HTMLElement;
  status: HTMLElement;
  statusDetail: HTMLElement;
  cursor: HTMLElement;
  count: HTMLElement;
  lastSync: HTMLElement;
  latency: HTMLElement;
  health: HTMLElement;
  transportMeta: HTMLElement;
  trustWarning: HTMLElement;
  endpointInput: HTMLInputElement;
  timeoutInput: HTMLInputElement;
  pageSizeInput: HTMLInputElement;
  pollIntervalInput: HTMLInputElement;
  maxPagesInput: HTMLInputElement;
  uiLimitInput: HTMLInputElement;
  modeSelect: HTMLSelectElement;
  allowUntrustedCheckbox: HTMLInputElement;
  reverseCheckbox: HTMLInputElement;
  refreshButton: HTMLButtonElement;
  retrySpacetimeButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  feed: HTMLElement;
}

interface UIState {
  mode: TransportMode;
  connected: boolean;
  transportStatus: string;
  details: string;
  health: string;
  cursor: string;
  visible: number;
  lastSync: string;
  latencyMs?: number;
  warning?: string;
  meta?: string;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

function nowLabel(): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());
}

function safeBigInt(input: unknown, fallback = 0n): bigint {
  if (typeof input === 'bigint') {
    return input;
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    return BigInt(Math.max(0, Math.trunc(input)));
  }
  if (typeof input === 'string') {
    const parsed = Number.parseFloat(input);
    return Number.isFinite(parsed) ? BigInt(Math.max(0, Math.trunc(parsed))) : fallback;
  }
  return fallback;
}

function safeNumber(input: unknown, fallback = 0): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === 'string') {
    const parsed = Number.parseInt(input, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function safeInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function safeUrl(input: string): string | null {
  try {
    const parsed = new URL(input);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseMentions(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map(item => safeNumber(item, -1)).filter(item => Number.isInteger(item) && item >= 0);
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parseMentions(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function shortHash(hash: string): string {
  if (hash.length <= 14 || !hash.startsWith('0x')) {
    return hash;
  }
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
}

function getElements(): UIElements {
  const lookup = <T extends HTMLElement>(id: string) => {
    const el = document.querySelector<T>(`#${id}`);
    if (!el) {
      throw new Error(`Missing UI element #${id}`);
    }
    return el;
  };

  return {
    modeChip: lookup<HTMLElement>('mode-chip'),
    status: lookup<HTMLElement>('status'),
    statusDetail: lookup<HTMLElement>('statusDetail'),
    cursor: lookup<HTMLElement>('lastCursor'),
    count: lookup<HTMLElement>('count'),
    lastSync: lookup<HTMLElement>('lastSyncTime'),
    latency: lookup<HTMLElement>('feedLatency'),
    health: lookup<HTMLElement>('health'),
    transportMeta: lookup<HTMLElement>('transportMeta'),
    trustWarning: lookup<HTMLElement>('trustWarning'),
    endpointInput: lookup<HTMLInputElement>('hypersnapEndpoint'),
    timeoutInput: lookup<HTMLInputElement>('hypersnapTimeoutMs'),
    pageSizeInput: lookup<HTMLInputElement>('hypersnapPageSize'),
    pollIntervalInput: lookup<HTMLInputElement>('hypersnapPollIntervalMs'),
    maxPagesInput: lookup<HTMLInputElement>('hypersnapMaxPages'),
    uiLimitInput: lookup<HTMLInputElement>('uiLimit'),
    modeSelect: lookup<HTMLSelectElement>('modeSelect'),
    allowUntrustedCheckbox: lookup<HTMLInputElement>('allowUntrustedHost'),
    reverseCheckbox: lookup<HTMLInputElement>('hypersnapReverse'),
    refreshButton: lookup<HTMLButtonElement>('refresh'),
    retrySpacetimeButton: lookup<HTMLButtonElement>('retry-spacetime'),
    saveButton: lookup<HTMLButtonElement>('saveEndpoint'),
    feed: lookup<HTMLElement>('feed'),
  };
}

function updateState(ui: UIElements, state: UIState): void {
  ui.modeChip.textContent = `mode: ${state.mode}`;
  ui.status.textContent = state.transportStatus;
  ui.statusDetail.textContent = state.details;
  ui.cursor.textContent = `cursor: ${state.cursor}`;
  ui.count.textContent = `visible casts: ${state.visible}`;
  ui.lastSync.textContent = `last sync: ${state.lastSync}`;
  ui.latency.textContent = `latency: ${state.latencyMs === undefined ? 'n/a' : `${state.latencyMs}ms`}`;
  ui.health.textContent = state.health;
  ui.transportMeta.textContent = state.meta ?? '';
  ui.trustWarning.textContent = state.warning ?? '';

  ui.modeChip.classList.toggle('connected', state.connected);
  ui.modeChip.classList.toggle('disconnected', !state.connected);
  ui.status.classList.toggle('connected', state.connected);
  ui.status.classList.toggle('disconnected', !state.connected);
}

function createRenderRow(
  row: { hash: string; fid: number; createdAtMillis: bigint; text: string; source: TransportMode; mentions: number[]; parentHash: string | null }
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'cast-card';

  const top = document.createElement('header');
  top.className = 'cast-card__top';

  const source = document.createElement('span');
  source.className = 'source-pill';
  source.textContent = row.source;

  const meta = document.createElement('p');
  meta.className = 'cast-meta';
  meta.textContent = `@FID ${row.fid} • ${formatCastAge(row.createdAtMillis)} • ${shortHash(row.hash)}`;

  const body = document.createElement('p');
  body.className = 'cast-text';
  body.textContent = row.text || '(empty)';

  const footer = document.createElement('footer');
  footer.className = 'cast-footer';
  const details = document.createElement('span');
  details.className = 'muted';
  details.textContent = `mentions: ${row.mentions.length} • parent: ${row.parentHash ? shortHash(row.parentHash) : 'none'}`;

  const link = document.createElement('a');
  link.href = `https://warpcast.com/~/conversations/${row.fid}-${row.hash.replace(/^0x/, '')}`;
  link.rel = 'noreferrer';
  link.target = '_blank';
  link.textContent = 'open on warpcast';

  top.append(source, meta);
  footer.append(details, link);
  card.append(top, body, footer);
  return card;
}

function renderFeed(ui: UIElements, rows: FeedRow[], limit: number): void {
  ui.feed.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No casts available. Run a refresh or switch transport.';
    ui.feed.appendChild(empty);
    return;
  }

  for (const row of rows.slice(0, limit)) {
    ui.feed.appendChild(
      createRenderRow({
        hash: row.hash,
        fid: row.fid,
        createdAtMillis: row.createdAtMillis,
        text: row.text,
        source: row.source,
        mentions: row.mentions,
        parentHash: row.parentHash,
      })
    );
  }
}

function readRowsFromCache(
  conn: ReturnType<typeof connectSpacetime>['conn'],
  limit: number
): FeedRow[] {
  const rows: FeedRow[] = [];

  for (const row of conn.db.casts.iter()) {
    if (row.is_deleted) continue;

    rows.push({
      hash: String(row.hash),
      fid: safeNumber(row.fid, 0),
      createdAtMillis: safeBigInt(row.created_at_millis),
      text: String(row.text ?? ''),
      mentions: parseMentions(row.mentions),
      parentHash: row.parent_hash ? String(row.parent_hash) : null,
      parentFid: row.parent_fid ? safeNumber(row.parent_fid, 0) : null,
      source: 'spacetime',
    });
  }

  return rows
    .sort((a, b) => (b.createdAtMillis > a.createdAtMillis ? 1 : b.createdAtMillis < a.createdAtMillis ? -1 : b.fid - a.fid))
    .slice(0, limit);
}

function snapshotSpacetimeCursor(conn: ReturnType<typeof connectSpacetime>['conn']): string {
  for (const row of conn.db.sync_state.iter()) {
    if (row.id === 1) {
      return `${row.from_event_id}/${row.page_token ?? 'none'}`;
    }
  }
  return 'n/a';
}

function connectSpacetimeWithTimeout(
  config: ClientConfig['spacetime']
): Promise<ReturnType<typeof connectSpacetime>['conn']> {
  return new Promise((resolve, reject) => {
    let connected = false;
    const timeout = window.setTimeout(() => {
      if (!connected) {
        reject(new Error(`SpacetimeDB connect timeout (${DEFAULT_CONNECT_TIMEOUT_MS}ms)`));
      }
    }, DEFAULT_CONNECT_TIMEOUT_MS);

    connectSpacetime(
      config,
      ({ conn }) => {
        connected = true;
        window.clearTimeout(timeout);
        resolve(conn);
      },
      (_ctx, error) => {
        if (!connected) {
          window.clearTimeout(timeout);
          reject(error);
        }
      },
      () => {
        if (!connected) {
          window.clearTimeout(timeout);
          reject(new Error('SpacetimeDB disconnected before connect'));
        }
      }
    );
  });
}

function readConfigFromForm(
  current: ClientConfig,
  ui: UIElements,
  rawEndpoint: string
): ClientConfig {
  const endpoint = safeUrl(rawEndpoint) ?? current.hypersnap.baseUrl;
  const parsedEndpoint = new URL(endpoint);
  const allowUntrusted = ui.allowUntrustedCheckbox.checked;

  return {
    hypersnap: {
      ...current.hypersnap,
      baseUrl: parsedEndpoint.origin,
      timeoutMs: safeInt(ui.timeoutInput.value, current.hypersnap.timeoutMs, 1_000, 120_000),
      pageSize: safeInt(ui.pageSizeInput.value, current.hypersnap.pageSize, 10, 500),
      pollIntervalMs: safeInt(ui.pollIntervalInput.value, current.hypersnap.pollIntervalMs, 5_000, 120_000),
      maxPagesPerPoll: safeInt(ui.maxPagesInput.value, current.hypersnap.maxPagesPerPoll, 1, 50),
      reverse: ui.reverseCheckbox.checked,
      allowUntrustedHost: allowUntrusted,
      hostIsTrusted: allowUntrusted || isTrustedHypersnapHost(parsedEndpoint),
    },
    spacetime: {
      ...current.spacetime,
    },
    ui: {
      initialLimit: safeInt(ui.uiLimitInput.value, current.ui.initialLimit, 5, 500),
      fallbackMode: ui.modeSelect.value === 'spacetime' ? 'spacetime' : 'hypersnap',
    },
  };
}

function persistConfig(config: ClientConfig): void {
  const write = (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // storage is best effort
    }
  };

  write(CLIENT_STORAGE_KEYS.hypersnapUrl, config.hypersnap.baseUrl);
  write(CLIENT_STORAGE_KEYS.hypersnapTimeoutMs, String(config.hypersnap.timeoutMs));
  write(CLIENT_STORAGE_KEYS.hypersnapPageSize, String(config.hypersnap.pageSize));
  write(CLIENT_STORAGE_KEYS.hypersnapPollIntervalMs, String(config.hypersnap.pollIntervalMs));
  write(CLIENT_STORAGE_KEYS.hypersnapMaxPages, String(config.hypersnap.maxPagesPerPoll));
  write(CLIENT_STORAGE_KEYS.hypersnapReverse, String(config.hypersnap.reverse));
  write(CLIENT_STORAGE_KEYS.allowUntrustedHost, String(config.hypersnap.allowUntrustedHost));
  write(CLIENT_STORAGE_KEYS.uiLimit, String(config.ui.initialLimit));
  write(CLIENT_STORAGE_KEYS.mode, config.ui.fallbackMode);
}

function hydrateForm(ui: UIElements, config: ClientConfig): void {
  ui.endpointInput.value = config.hypersnap.baseUrl;
  ui.timeoutInput.value = String(config.hypersnap.timeoutMs);
  ui.pageSizeInput.value = String(config.hypersnap.pageSize);
  ui.pollIntervalInput.value = String(config.hypersnap.pollIntervalMs);
  ui.maxPagesInput.value = String(config.hypersnap.maxPagesPerPoll);
  ui.reverseCheckbox.checked = config.hypersnap.reverse;
  ui.allowUntrustedCheckbox.checked = config.hypersnap.allowUntrustedHost;
  ui.modeSelect.value = config.ui.fallbackMode;
  ui.uiLimitInput.value = String(config.ui.initialLimit);
}

function boot() {
  const ui = getElements();
  let config = loadClientConfig();
  hydrateForm(ui, config);

  let spacetimeDisconnect: (() => void) | null = null;
  let refreshTimer: ReturnType<typeof window.setInterval> | null = null;
  let activeFeed: HypersnapCastFeed | null = null;
  let inFlight = false;
  let mode: TransportMode = config.ui.fallbackMode;

  const stopTransport = () => {
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (spacetimeDisconnect) {
      spacetimeDisconnect();
      spacetimeDisconnect = null;
    }
    activeFeed = null;
    inFlight = false;
  };

  const setEmpty = (message: string) => {
    ui.feed.replaceChildren();
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = message;
    ui.feed.appendChild(p);
  };

  const renderState = (
    currentMode: TransportMode,
    connected: boolean,
    status: string,
    details: string,
    health: string,
    cursor: string,
    visible: number,
    latencyMs?: number,
    warning?: string,
    meta?: string
  ): void => {
    updateState(ui, {
      mode: currentMode,
      connected,
      transportStatus: status,
      details,
      health,
      cursor,
      visible,
      lastSync: nowLabel(),
      latencyMs,
      warning,
      meta,
    });
  };

  const startSpacetimeMode = async () => {
    stopTransport();
    mode = 'spacetime';
    config = { ...config, ui: { ...config.ui, fallbackMode: 'spacetime' } };
    if (!config.spacetime.enabled) {
      throw new Error('Spacetime is disabled by config');
    }

    renderState('spacetime', false, 'Connecting to SpacetimeDB...', 'initializing subscriptions', 'connecting', 'n/a', 0);
    const conn = await connectSpacetimeWithTimeout(config.spacetime);

    const render = () => {
      const rows = readRowsFromCache(conn, config.ui.initialLimit);
      renderFeed(ui, rows, config.ui.initialLimit);
      renderState(
        'spacetime',
        true,
        'Connected to SpacetimeDB',
        'live cache',
        `visible casts: ${rows.length}`,
        snapshotSpacetimeCursor(conn),
        rows.length,
        undefined,
        undefined,
        'Data source: persistent reducer state'
      );
    };

    subscribeCasts(
      conn,
      () => {
        render();
      },
      (_ctx, error) => {
        console.error('Spacetime subscription error', error);
      },
      config.ui.initialLimit
    );

    subscribeSyncState(
      conn,
      () => {
        render();
      },
      (_ctx, error) => {
        console.error('Spacetime sync error', error);
      }
    );

    render();
    spacetimeDisconnect = () => {
      conn.disconnect();
    };
  };

  const startHypersnapMode = async () => {
    stopTransport();
    mode = 'hypersnap';
    config = { ...config, ui: { ...config.ui, fallbackMode: 'hypersnap' } };

    if (!config.hypersnap.hostIsTrusted) {
      const warning =
        'Blocked: untrusted Hypersnap host. Enable "Allow untrusted host" or use a trusted hostname.';
      setEmpty(warning);
      renderState('hypersnap', false, 'Blocked by safety policy', warning, warning, 'n/a', 0, undefined, warning);
      return;
    }

    activeFeed = new HypersnapCastFeed({
      baseUrl: config.hypersnap.baseUrl,
      pageSize: config.hypersnap.pageSize,
      timeoutMs: config.hypersnap.timeoutMs,
      maxPages: config.hypersnap.maxPagesPerPoll,
      reverse: config.hypersnap.reverse,
    });

    const poll = async () => {
      if (inFlight || !activeFeed) {
        return;
      }

      inFlight = true;
      try {
        const summary = await activeFeed.refresh();
        const rows = activeFeed.rows.slice(0, config.ui.initialLimit);
        renderFeed(ui, rows, config.ui.initialLimit);

        renderState(
          'hypersnap',
          true,
          'Connected to Hypersnap',
          `freshest-first, deduped`,
          `visible: ${rows.length} | added ${summary.added} | updated ${summary.updated} | removed ${summary.removed}`,
          `from_event_id ${summary.lastCursor.fromEventId}`,
          rows.length,
          summary.latencyMs,
          summary.totalVisible === 0 ? 'No rows in returned window.' : undefined,
          `received ${summary.receivedCount} events, pageToken ${summary.lastCursor.pageToken ?? 'none'}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        console.error('Hypersnap poll failed', error);
        renderState(
          'hypersnap',
          false,
          'Hypersnap polling failed',
          'retry on next interval',
          `error: ${message}`,
          'n/a',
          ui.feed.querySelectorAll('.cast-card').length,
          undefined,
          'Network/API error. Check endpoint and CORS/cert chain.',
          'poll failed'
        );
      } finally {
        inFlight = false;
      }
    };

    void poll();
    refreshTimer = window.setInterval(() => {
      void poll();
    }, Math.max(5_000, config.hypersnap.pollIntervalMs));

    ui.modeSelect.value = 'hypersnap';
  };

  const applyForm = () => {
    const rawEndpoint = ui.endpointInput.value.trim();
    if (!rawEndpoint) {
      setEmpty('Endpoint is required to run Hypersnap fetches');
      return;
    }
    if (!safeUrl(rawEndpoint)) {
      setEmpty('Invalid endpoint URL: must be a valid http(s) URL');
      return;
    }

    config = readConfigFromForm(config, ui, rawEndpoint);
    persistConfig(config);
    hydrateForm(ui, config);
    mode = config.ui.fallbackMode;
    startMode(mode);
  };

  const startMode = (nextMode: TransportMode) => {
    mode = nextMode;
    ui.modeSelect.value = nextMode;
    stopTransport();
    if (nextMode === 'spacetime') {
      void startSpacetimeMode().catch(error => {
        const message = error instanceof Error ? error.message : 'unknown error';
        renderState(
          'spacetime',
          false,
          'Spacetime connection failed',
          'falling back to Hypersnap',
          `error: ${message}`,
          'n/a',
          ui.feed.querySelectorAll('.cast-card').length,
          undefined,
          'Check URI/db and module availability',
          'fallback next'
        );
        void startHypersnapMode();
      });
      return;
    }

    void startHypersnapMode();
  };

  ui.saveButton.addEventListener('click', applyForm);
  ui.refreshButton.addEventListener('click', () => {
    if (mode === 'hypersnap') {
      void startHypersnapMode();
      return;
    }

    if (!spacetimeDisconnect) {
      void startMode('spacetime');
      return;
    }

    void startMode('spacetime');
  });

  ui.retrySpacetimeButton.addEventListener('click', () => {
    ui.modeSelect.value = 'spacetime';
    void startMode('spacetime');
  });

  ui.modeSelect.addEventListener('change', () => {
    const next = ui.modeSelect.value === 'spacetime' ? 'spacetime' : 'hypersnap';
    void startMode(next);
  });

  renderState('hypersnap', false, 'booting', 'reading config', 'initializing', 'n/a', 0, undefined, 'Load time');
  startMode(config.ui.fallbackMode);
}

boot();
