import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';

import {
  AppConfig,
  ParsedEvent,
  PollerState,
} from '../src/types.js';
import { connectSpacetime, getReducerFunctions, type SpacetimeReducerClient } from '../src/spacetime-connection.js';
import { fetchAllHypersnapPages } from '../src/hypersnap.js';
import { isUpsert } from '../src/parse-hypersnap.js';
import {
  cursorFromState,
  loadConfig,
  parsePollerState,
  toStateFilePayload,
} from '../src/config.js';

interface CliOptions {
  once: boolean;
  maxPages: number;
  pollTimeoutMs: number;
}

interface Summary {
  applied: number;
  inserted: number;
  deleted: number;
  receivedFromApi: number;
  pageCount: number;
  cursor: bigint;
  error?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const rawMaxPages = args.find(arg => arg.startsWith('--max-pages='));
  const rawTimeout = args.find(arg => arg.startsWith('--timeout-ms='));

  const parsePositive = (raw: string | undefined, fallback: number): number => {
    const parsed = raw ? Number.parseInt(raw.split('=')[1] ?? '', 10) : fallback;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    once,
    maxPages: parsePositive(rawMaxPages, 4),
    pollTimeoutMs: parsePositive(rawTimeout, 12_000),
  };
}

async function readState(statePath: string): Promise<PollerState> {
  const absolute = path.resolve(process.cwd(), statePath);
  const raw = await readFile(absolute, 'utf8').catch(() => null);
  return parsePollerState(raw);
}

async function writeState(statePath: string, state: PollerState): Promise<void> {
  const absolute = path.resolve(process.cwd(), statePath);
  await writeFile(absolute, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function parseDeleteEventMillis(event: Extract<ParsedEvent, { kind: 'delete' }>): bigint {
  return BigInt(Math.max(0, event.eventTimestampSeconds)) * 1000n;
}

function buildReducePayloads(event: ParsedEvent) {
  if (isUpsert(event)) {
    const createdAtMillis = BigInt(Math.max(0, event.createdAtSeconds)) * 1000n;
    const eventId = BigInt(event.eventId);
    const blockNumber = event.blockNumber === null ? null : BigInt(event.blockNumber);

    return {
      upsert: {
        hash: event.hash,
        fid: event.fid,
        text: event.text,
        createdAtMillis,
        eventTimestampMillis: createdAtMillis,
        eventId,
        sourceType: event.sourceType,
        sourceEventId: event.eventId,
        blockNumber,
        parentFid: event.parentFid,
        parentHash: event.parentHash,
        mentionsJson: JSON.stringify(event.mentions),
      } as const,
      delete: null,
    };
  }

  const deleteEvent = event;
  return {
    upsert: null,
    delete: {
      hash: deleteEvent.hash,
      eventId: BigInt(deleteEvent.eventId),
      sourceType: deleteEvent.sourceType,
      sourceEventId: deleteEvent.eventId,
      blockNumber: deleteEvent.blockNumber === null ? null : BigInt(deleteEvent.blockNumber),
      eventTimestampMillis: parseDeleteEventMillis(deleteEvent),
    } as const,
  };
}

function logSummary(message: string, summary: Summary): void {
  const status = {
    ...summary,
    cursor: summary.cursor.toString(),
  };

  if (summary.error) {
    console.error(`[poller] ${message}`, status);
    return;
  }

  console.log(`[poller] ${message}`, status);
}

function withDefaultCursor(stateCursorFrom: bigint, reducerActionsCount: number, parsedCursor: bigint): bigint {
  return reducerActionsCount === 0 ? stateCursorFrom : parsedCursor;
}

async function pollOnce(
  config: AppConfig,
  reducers: SpacetimeReducerClient,
  maxPages: number,
  pollTimeoutMs: number
): Promise<Summary> {
  const state = await readState(config.poller.statePath);
  const stateCursor = cursorFromState(state);

  const result = await fetchAllHypersnapPages(
    {
      baseUrl: config.poller.hypersnapHttpUrl,
      pageSize: config.poller.hypersnapPageSize,
      timeoutMs: Math.min(30_000, Math.max(5_000, pollTimeoutMs)),
    },
    stateCursor,
    maxPages
  );

  const reducerActions = result.events.map(buildReducePayloads);
  const nextFromEventId = withDefaultCursor(stateCursor.fromEventId, reducerActions.length, result.cursor.fromEventId);
  const summary: Summary = {
    applied: 0,
    inserted: 0,
    deleted: 0,
    receivedFromApi: result.receivedCount,
    pageCount: reducerActions.length,
    cursor: nextFromEventId,
  };

  for (const action of reducerActions) {
    if (action.upsert) {
      await reducers.upsertCast(action.upsert);
      summary.applied += 1;
      summary.inserted += 1;
      continue;
    }

    await reducers.deleteCast(action.delete!);
    summary.applied += 1;
    summary.deleted += 1;
  }

  const nextCursorState = toStateFilePayload({
    fromEventId: nextFromEventId,
    pageToken: reducerActions.length > 0 ? result.cursor.pageToken : null,
  });

  await reducers.updateCursor({
    fromEventId: nextFromEventId,
    pageToken: nextCursorState.pageToken,
    pollerName: config.poller.pollerName,
  });
  await writeState(config.poller.statePath, nextCursorState);

  return summary;
}

function createFailureSummary(error: unknown): Summary {
  return {
    applied: 0,
    inserted: 0,
    deleted: 0,
    receivedFromApi: 0,
    pageCount: 0,
    cursor: 0n,
    error: error instanceof Error ? error.message : 'unknown error',
  };
}

async function waitForSpacetimeConnection(config: AppConfig['spacetime']) {
  return await new Promise<ReturnType<typeof connectSpacetime>['conn']>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('SpacetimeDB connect timeout'));
    }, 15_000);

    const onDone = () => {
      clearTimeout(timeout);
    };

    connectSpacetime(
      config,
      ({ conn, identityHex }) => {
        onDone();
        console.log(`SpacetimeDB connected: ${identityHex.slice(0, 16)}...`);
        resolve(conn);
      },
      (_ctx, error) => {
        onDone();
        reject(error);
      },
      () => {
        console.log('SpacetimeDB disconnected.');
      }
    );
  });
}

(async () => {
  const args = parseArgs();
  const config = loadConfig();

  const conn = await waitForSpacetimeConnection(config.spacetime);
  const reducers = getReducerFunctions(conn);

  const runCycle = async (label: string) => {
    try {
      const summary = await pollOnce(config, reducers, args.maxPages, args.pollTimeoutMs);
      logSummary(label, summary);
    } catch (error) {
      logSummary(label, createFailureSummary(error));
    }
  };

  await runCycle(args.once ? 'once completed' : 'poll cycle completed');

  if (args.once) {
    conn.disconnect();
    return;
  }

  const timer = setInterval(() => {
    void runCycle('poll cycle completed');
  }, config.poller.hypersnapPollIntervalMs);

  const shutdown = () => {
    clearInterval(timer);
    conn.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // keep process alive
  await new Promise<void>(() => undefined);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
