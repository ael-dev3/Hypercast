/**
 * Local, generated-style SpacetimeDB bindings for Hypercast.
 *
 * The app expects generated bindings (from `spacetimedb generate`) to provide a
 * typed DbConnection class. We keep the same runtime shape here so the project can
 * build without the external CLI in this environment.
 */

import {
  DbConnectionBuilder as __DbConnectionBuilder,
  DbConnectionImpl as __DbConnectionImpl,
  SubscriptionBuilderImpl as __SubscriptionBuilderImpl,
  convertToAccessorMap as __convertToAccessorMap,
  type DbConnectionConfig,
  type ErrorContextInterface as __ErrorContextInterface,
  type EventContextInterface as __EventContextInterface,
  type ReducerEventContextInterface as __ReducerEventContextInterface,
  type SubscriptionEventContextInterface as __SubscriptionEventContextInterface,
  type SubscriptionHandleImpl as __SubscriptionHandleImpl,
  procedures,
  reducerSchema,
  reducers as __reducers,
  schema,
  table,
  t,
} from 'spacetimedb/sdk';

const tablesSchema = schema({
  casts: table(
    {
      name: 'casts',
      public: true,
      indexes: [
        {
          accessor: 'casts_created_idx',
          algorithm: 'btree',
          columns: ['is_deleted', 'created_at_millis'],
        },
      ],
    },
    {
      hash: t.string().primaryKey(),
      fid: t.u32(),
      created_at_millis: t.u64(),
      event_timestamp_millis: t.u64(),
      event_id: t.u64(),
      source_type: t.string(),
      source_event_id: t.string(),
      text: t.string(),
      parent_fid: t.u32().optional(),
      parent_hash: t.string().optional(),
      mentions: t.string(),
      is_deleted: t.bool().index('btree'),
      block_number: t.i64().optional(),
      received_at_millis: t.u64(),
      updated_at_millis: t.u64(),
    }
  ),
  sync_state: table(
    {
      name: 'sync_state',
      public: true,
    },
    {
      id: t.u32().primaryKey(),
      from_event_id: t.u64(),
      page_token: t.string().optional(),
      last_updated_millis: t.u64(),
      poller_name: t.string().optional(),
    }
  ),
});

const reducersSchema = __reducers(
  reducerSchema('upsertCast', {
    hash: t.string(),
    fid: t.u32(),
    text: t.string(),
    createdAtMillis: t.u64(),
    eventTimestampMillis: t.u64(),
    eventId: t.u64(),
    sourceType: t.string(),
    sourceEventId: t.string(),
    blockNumber: t.i64().optional(),
    parentFid: t.u32().optional(),
    parentHash: t.string().optional(),
    mentionsJson: t.string(),
  }),
  reducerSchema('deleteCast', {
    hash: t.string(),
    eventId: t.u64(),
    sourceType: t.string(),
    sourceEventId: t.string(),
    blockNumber: t.i64().optional(),
    eventTimestampMillis: t.u64(),
  }),
  reducerSchema('updateCursor', {
    fromEventId: t.u64(),
    pageToken: t.string().optional(),
    pollerName: t.string(),
  })
);

const proceduresSchema = procedures();

/** The remote module schema, both runtime and type information. */
const REMOTE_MODULE = {
  procedures: proceduresSchema.procedures,
  versionInfo: {
    cliVersion: '2.0.0-local' as const,
  },
  tables: tablesSchema.schemaType.tables,
  reducers: reducersSchema.reducersType.reducers,
};

/** Reducer accessors in the generated style. */
export const reducers = __convertToAccessorMap(reducersSchema.reducersType.reducers);

/** Context types returned by event callbacks. */
export type EventContext = __EventContextInterface<typeof REMOTE_MODULE>;
export type ReducerEventContext = __ReducerEventContextInterface<typeof REMOTE_MODULE>;
export type SubscriptionEventContext = __SubscriptionEventContextInterface<typeof REMOTE_MODULE>;
export type ErrorContext = __ErrorContextInterface<typeof REMOTE_MODULE>;
export type SubscriptionHandle = __SubscriptionHandleImpl<typeof REMOTE_MODULE>;

/** Subscription builder with typed module context. */
export class SubscriptionBuilder extends __SubscriptionBuilderImpl<typeof REMOTE_MODULE> {}

/** Database connection builder with typed module context. */
export class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}

/**
 * Typed database connection for the Hypercast module.
 */
export class DbConnection extends __DbConnectionImpl<typeof REMOTE_MODULE> {
  /** Creates a typed builder preloaded with module metadata. */
  static builder(): DbConnectionBuilder {
    return new DbConnectionBuilder(
      REMOTE_MODULE,
      (config: DbConnectionConfig<typeof REMOTE_MODULE>) => new DbConnection(config)
    );
  }

  /** Creates a typed subscription builder for this module. */
  override subscriptionBuilder = (): SubscriptionBuilder => {
    return new SubscriptionBuilder(this);
  };
}
