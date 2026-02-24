import {
  DbConnection as SdkDbConnection,
  type ErrorContext,
  type EventContext,
} from './module_bindings/index.js';

import type {
  CastReducerPayload,
  DeleteReducerPayload,
  CursorReducerPayload,
  SpaceTimeConfig,
} from './types.js';

export interface SpacetimeConnection {
  conn: SdkDbConnection;
}

export type SpacetimeReducerClient = {
  upsertCast: (payload: CastReducerPayload) => Promise<void>;
  deleteCast: (payload: DeleteReducerPayload) => Promise<void>;
  updateCursor: (payload: CursorReducerPayload) => Promise<void>;
};

const REQUIRED_REDUCER_NAMES: Array<keyof SpacetimeReducerClient> = [
  'upsertCast',
  'deleteCast',
  'updateCursor',
];

export function connectSpacetime(
  config: SpaceTimeConfig,
  onConnect: (ctx: {
    conn: SdkDbConnection;
    identityHex: string;
    token: string;
  }) => void,
  onError: (ctx: ErrorContext, error: Error) => void,
  onDisconnect: () => void
): SpacetimeConnection {
  const builder = SdkDbConnection.builder()
    .withUri(config.uri)
    .withDatabaseName(config.databaseName)
    .onConnect((conn, identity, token) => {
      const identityHex = identity.toHexString();
      onConnect({ conn, identityHex, token: token ?? '' });
    })
    .onConnectError(onError)
    .onDisconnect(onDisconnect);

  return { conn: builder.build() };
}

export function getTables(conn: SdkDbConnection) {
  return {
    casts: conn.db.casts,
    sync_state: conn.db.sync_state,
  };
}

export function subscribeCasts(
  conn: SdkDbConnection,
  onReady: (ctx: EventContext) => void,
  onError: (ctx: ErrorContext, error: Error) => void,
  limit: number
): void {
  const sql = `SELECT * FROM casts WHERE is_deleted = FALSE ORDER BY created_at_millis DESC LIMIT ${Math.max(1, limit)}`;

  conn
    .subscriptionBuilder()
    .onApplied((ctx: EventContext) => {
      onReady(ctx);
    })
    .onError(onError)
    .subscribe(sql);
}

export function subscribeSyncState(
  conn: SdkDbConnection,
  onReady: (ctx: EventContext) => void,
  onError: (ctx: ErrorContext, error: Error) => void
): void {
  conn
    .subscriptionBuilder()
    .onApplied((ctx: EventContext) => {
      onReady(ctx);
    })
    .onError(onError)
    .subscribe('SELECT * FROM sync_state');
}

export function getReducerFunctions(conn: SdkDbConnection): SpacetimeReducerClient {
  const reducers = conn.reducers as Record<string, (payload: unknown) => Promise<void>>;

  for (const name of REQUIRED_REDUCER_NAMES) {
    if (typeof reducers[name] !== 'function') {
      throw new Error(`SpacetimeDB reducer '${name}' is not available on this connection`);
    }
  }

  return {
    upsertCast: (payload: CastReducerPayload) => reducers.upsertCast(payload),
    deleteCast: (payload: DeleteReducerPayload) => reducers.deleteCast(payload),
    updateCursor: (payload: CursorReducerPayload) => reducers.updateCursor(payload),
  };
}
