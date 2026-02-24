import { fetchAllHypersnapPages } from './hypersnap.js';
import { isUpsert, type ParsedEvent } from './parse-hypersnap.js';
import type { PollCursor } from './types.js';

export interface FeedCastRow {
  hash: string;
  fid: number;
  text: string;
  createdAtMillis: bigint;
  parentFid: number | null;
  parentHash: string | null;
  mentions: number[];
  deleted: boolean;
  source: 'hypersnap';
  eventId: bigint;
}

export interface HypersnapFeedConfig {
  baseUrl: string;
  timeoutMs: number;
  pageSize: number;
  maxPages: number;
  reverse?: boolean;
}

export interface HypersnapFetchSummary {
  added: number;
  updated: number;
  removed: number;
  totalVisible: number;
  lastCursor: PollCursor;
  receivedCount: number;
  fromApi: string;
  latencyMs: number;
}

const DEFAULT_MAX_VISIBLE_CASTS = 250;

function safeBigInt(raw: unknown): bigint {
  try {
    if (typeof raw === 'string') {
      return BigInt(raw);
    }
  } catch {
    return 0n;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return BigInt(Math.max(0, Math.trunc(raw)));
  }

  return 0n;
}

export class HypersnapCastFeed {
  private readonly rowByHash = new Map<string, FeedCastRow>();
  private cursor: PollCursor = {
    fromEventId: 0n,
    pageToken: null,
  };
  private readonly maxVisible: number;

  constructor(private readonly config: HypersnapFeedConfig, maxVisible = DEFAULT_MAX_VISIBLE_CASTS) {
    const clamped = Math.max(1, Math.min(maxVisible, 500));
    this.maxVisible = clamped;
  }

  get rows(): FeedCastRow[] {
    return this.visibleRows();
  }

  get lastCursor(): PollCursor {
    return this.cursor;
  }

  private visibleRows(): FeedCastRow[] {
    return Array.from(this.rowByHash.values())
      .filter(row => !row.deleted)
      .sort((a, b) => {
        if (a.createdAtMillis !== b.createdAtMillis) {
          return b.createdAtMillis > a.createdAtMillis ? 1 : -1;
        }

        if (a.eventId !== b.eventId) {
          return b.eventId > a.eventId ? 1 : -1;
        }

        return b.fid - a.fid;
      })
      .slice(0, this.maxVisible);
  }

  async refresh(): Promise<HypersnapFetchSummary> {
    const startedAt = Date.now();

    const response = await fetchAllHypersnapPages(
      {
        baseUrl: this.config.baseUrl,
        pageSize: this.config.pageSize,
        timeoutMs: this.config.timeoutMs,
        reverse: this.config.reverse ?? false,
      },
      this.cursor,
      this.config.maxPages
    );

    let added = 0;
    let updated = 0;
    let removed = 0;

    for (const event of response.events) {
      if (isUpsert(event)) {
        const previous = this.rowByHash.get(event.hash);
        const previousEventId = previous?.eventId;
        const incomingEventId = safeBigInt(event.eventId);
        this.upsertCastFromEvent(event);

        if (!previous) {
          added += 1;
        } else if (previous.deleted || previousEventId < incomingEventId) {
          updated += 1;
        }
        continue;
      }

      const deleted = this.tombstoneCast(event.hash, safeBigInt(event.eventId));
      if (deleted) {
        removed += 1;
      }
    }

    if (response.cursor.fromEventId >= this.cursor.fromEventId) {
      this.cursor = response.cursor;
    }

    const visibleRows = this.visibleRows();
    const newestEventId = visibleRows.length > 0 ? visibleRows[0].eventId : this.cursor.fromEventId;

    return {
      added,
      updated,
      removed,
      receivedCount: response.receivedCount,
      totalVisible: visibleRows.length,
      lastCursor: {
        fromEventId: newestEventId || this.cursor.fromEventId,
        pageToken: response.cursor.pageToken,
      },
      fromApi: this.config.baseUrl,
      latencyMs: Date.now() - startedAt,
    };
  }

  reset(): void {
    this.rowByHash.clear();
    this.cursor = {
      fromEventId: 0n,
      pageToken: null,
    };
  }

  private upsertCastFromEvent(event: ParsedEvent & { kind: 'upsert' }): void {
    if (!event.hash) {
      return;
    }

    const createdAtMillis = BigInt(Math.max(0, Math.trunc(event.createdAtSeconds))) * 1000n;
    const existing = this.rowByHash.get(event.hash);
    const incomingEventId = safeBigInt(event.eventId);

    if (existing && existing.eventId > incomingEventId) {
      return;
    }

    this.rowByHash.set(event.hash, {
      hash: event.hash,
      fid: event.fid,
      text: event.text,
      createdAtMillis,
      parentFid: event.parentFid,
      parentHash: event.parentHash,
      mentions: event.mentions,
      deleted: false,
      source: 'hypersnap',
      eventId: incomingEventId,
    });
  }

  private tombstoneCast(hash: string, eventId: bigint): boolean {
    const existing = this.rowByHash.get(hash);
    if (!existing || existing.deleted) {
      return false;
    }

    if (existing) {
      existing.deleted = true;
      return true;
    }

    this.rowByHash.set(hash, {
      hash,
      fid: 0,
      text: '',
      createdAtMillis: 0n,
      parentFid: null,
      parentHash: null,
      mentions: [],
      deleted: true,
      source: 'hypersnap',
      eventId,
    });

    return true;
  }
}

export function formatCastAge(createdAtMillis: bigint): string {
  const timestamp = Number(createdAtMillis);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'unknown';
  }

  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diff < 60) {
    return `${diff}s ago`;
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m ago`;
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h ago`;
  }

  return `${Math.floor(diff / 86400)}d ago`;
}
