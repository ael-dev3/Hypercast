import { connectSpacetime, subscribeCasts, subscribeSyncState } from './spacetime-connection.js';
import { loadConfig } from './config.js';
import './styles.css';

type UIState = {
  lastCursor: string;
  lastUpdate: string;
  totalCasts: number;
  connected: boolean;
};

interface CastRow {
  hash: string;
  fid: number;
  created_at_millis: bigint;
  text: string;
  parent_fid: number | null;
  parent_hash: string | null;
  mentions: string;
  is_deleted: boolean;
}

function getElements() {
  const status = document.querySelector<HTMLElement>('#status');
  const lastSync = document.querySelector<HTMLElement>('#lastSync');
  const count = document.querySelector<HTMLElement>('#count');
  const list = document.querySelector<HTMLElement>('#feed');
  const refresh = document.querySelector<HTMLButtonElement>('#refresh');

  if (!status || !lastSync || !count || !list || !refresh) {
    throw new Error('Failed to initialize UI shell');
  }

  return { status, lastSync, count, list, refresh };
}

function nowString(): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());
}

function normalizeTimestamp(value: bigint | number | string | undefined | null): string {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber)) return value;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(asNumber));
  }

  const millis = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isFinite(millis) || millis <= 0) return 'n/a';
  return new Intl.DateTimeFormat('en-US', {
    timeStyle: 'medium',
    dateStyle: 'short',
  }).format(new Date(millis));
}

function decodeMentions(raw: string): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(v => Number.isInteger(v)) : [];
  } catch {
    return [];
  }
}

function createCastLink(fid: number, hash: string): string {
  return `https://warpcast.com/~/conversations/${fid}-${hash.replace(/^0x/, '')}`;
}

function renderFeed(container: HTMLElement, rows: CastRow[], state: UIState): void {
  container.replaceChildren();
  const title = document.createElement('header');
  title.className = 'feed-summary';
  title.textContent = `Live casts: ${rows.length}`;
  container.appendChild(title);

  for (const row of rows) {
    const rowNode = document.createElement('article');
    rowNode.className = 'cast-card';

    const meta = document.createElement('div');
    meta.className = 'cast-meta';
    meta.textContent = `#${row.fid} • ${normalizeTimestamp(row.created_at_millis)} • ${row.hash}`;

    const body = document.createElement('div');
    body.className = 'cast-text';
    body.textContent = row.text || '(empty cast)';

    const mentions = decodeMentions(row.mentions);
    const metaFooter = document.createElement('div');
    metaFooter.className = 'cast-meta';
    metaFooter.textContent = `mentions: ${mentions.length} • deleted: ${row.is_deleted ? 'yes' : 'no'}`;

    const link = document.createElement('a');
    link.href = createCastLink(row.fid, row.hash);
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'view on warpcast';

    rowNode.appendChild(meta);
    rowNode.appendChild(body);
    rowNode.appendChild(metaFooter);
    rowNode.appendChild(link);
    container.appendChild(rowNode);
  }

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No casts found yet. Poller has not synced or no live casts available.';
    container.appendChild(empty);
  }

  state.totalCasts = rows.length;
}

function updateStateBadges(elements: ReturnType<typeof getElements>, state: UIState): void {
  elements.status.classList.toggle('connected', state.connected);
  elements.status.classList.toggle('disconnected', !state.connected);
  elements.status.textContent = state.connected ? `connected (${state.lastUpdate})` : `disconnected (${state.lastUpdate})`;
  elements.lastSync.textContent = `sync cursor: ${state.lastCursor || 'unknown'}`;
  elements.count.textContent = `total: ${state.totalCasts}`;
}

function readRowsFromCache(conn: ReturnType<typeof connectSpacetime>['conn']): CastRow[] {
  const rows: CastRow[] = [];

  for (const row of conn.db.casts.iter()) {
    if (!row.is_deleted) {
      rows.push({
        hash: String(row.hash),
        fid: Number(row.fid),
        created_at_millis: row.created_at_millis,
        text: String(row.text ?? ''),
        parent_fid: row.parent_fid,
        parent_hash: row.parent_hash,
        mentions: String(row.mentions ?? '[]'),
        is_deleted: Boolean(row.is_deleted),
      });
    }
  }

  return rows
    .filter(row => !row.is_deleted)
    .sort((a, b) => Number(b.created_at_millis - a.created_at_millis))
    .slice(0, 200);
}

function refreshSyncCursor(conn: ReturnType<typeof connectSpacetime>['conn']): string {
  const rows = Array.from(conn.db.sync_state.iter());
  const latest = rows.find(row => row.id === 1);
  return latest ? String(latest.from_event_id) : 'n/a';
}

function boot() {
  const config = loadConfig();
  const ui = getElements();
  const state: UIState = {
    lastCursor: 'unknown',
    lastUpdate: nowString(),
    totalCasts: 0,
    connected: false,
  };

  const { conn } = connectSpacetime(
    config.spacetime,
    ({ token }) => {
      state.connected = true;
      state.lastUpdate = nowString();
      state.lastCursor = token.slice(0, 16);
      updateStateBadges(ui, state);

      subscribeCasts(
        conn,
        () => {
          const rows = readRowsFromCache(conn);
          renderFeed(ui.list, rows, state);
          state.lastUpdate = nowString();
          state.lastCursor = refreshSyncCursor(conn);
          updateStateBadges(ui, state);
        },
        (ctx, error) => {
          console.error('Subscription error', ctx, error);
        },
        config.ui.initialLimit
      );

      subscribeSyncState(
        conn,
        () => {
          state.lastCursor = refreshSyncCursor(conn);
          state.lastUpdate = nowString();
          updateStateBadges(ui, state);
        },
        (ctx, error) => {
          console.error('Sync state error', ctx, error);
        }
      );
    },
    (_ctx, error) => {
      state.connected = false;
      state.lastUpdate = nowString();
      updateStateBadges(ui, state);
      console.error('Spacetime connect error', error);
    },
    () => {
      state.connected = false;
      state.lastUpdate = nowString();
      updateStateBadges(ui, state);
    }
  );

  ui.refresh.addEventListener('click', () => {
    const rows = readRowsFromCache(conn);
    renderFeed(ui.list, rows, state);
    state.lastCursor = refreshSyncCursor(conn);
    state.lastUpdate = nowString();
    updateStateBadges(ui, state);
  });

  updateStateBadges(ui, state);
}

boot();
