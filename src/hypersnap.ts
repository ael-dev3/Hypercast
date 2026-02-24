import type { PollCursor, ParsedEventsPage } from './types.js';
import { buildHypersnapEventsUrl, parseEventsResponse } from './parse-hypersnap.js';

interface FetchHypersnapConfig {
  baseUrl: string;
  pageSize: number;
  timeoutMs: number;
  reverse?: boolean;
}

export async function fetchHypersnapPage(
  config: FetchHypersnapConfig,
  cursor: PollCursor
): Promise<ParsedEventsPage> {
  const url = buildHypersnapEventsUrl(
    config.baseUrl,
    cursor,
    config.pageSize,
    config.reverse ?? false
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Hypersnap request failed (${response.status} ${response.statusText}) ${text.slice(0, 400)}`);
    }

    const body = await response.text();
    return parseEventsResponse(body);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAllHypersnapPages(
  config: FetchHypersnapConfig,
  startCursor: PollCursor,
  maxPages: number
): Promise<ParsedEventsPage> {
  let cursor = startCursor;
  const aggregate: ParsedEventsPage = {
    events: [],
    hasMore: false,
    pageToken: null,
    cursor,
    receivedCount: 0,
  };

  for (let page = 0; page < maxPages; page += 1) {
    const pageResult = await fetchHypersnapPage(config, cursor);
    aggregate.events.push(...pageResult.events);
    aggregate.receivedCount += pageResult.receivedCount;
    if (!pageResult.hasMore || pageResult.cursor.fromEventId <= cursor.fromEventId) {
      aggregate.hasMore = false;
      aggregate.cursor = cursor;
      aggregate.pageToken = cursor.pageToken;
      break;
    }

    if (!pageResult.pageToken && pageResult.events.length === 0) {
      aggregate.hasMore = false;
      aggregate.cursor = pageResult.cursor;
      aggregate.pageToken = pageResult.pageToken;
      break;
    }

    cursor = pageResult.cursor;
    aggregate.cursor = cursor;
    aggregate.pageToken = pageResult.pageToken;
    aggregate.hasMore = page === maxPages - 1 ? false : pageResult.hasMore;
  }

  return aggregate;
}
