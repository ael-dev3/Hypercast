import { schema, table, t } from 'spacetimedb/server';

const spacetimedb = schema({
  casts: table(
    {
      name: 'casts',
      public: true,
      indexes: [
        {
          name: 'casts_created_idx',
          algorithm: 'btree',
          columns: ['is_deleted', 'created_at_millis'] as const,
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

export default spacetimedb;

const INITIAL_SYNC_STATE_ID = 1;

export const init = spacetimedb.init(ctx => {
  ctx.db.sync_state.insert({
    id: INITIAL_SYNC_STATE_ID,
    from_event_id: 0n,
    page_token: null,
    last_updated_millis: BigInt(Date.now()),
    poller_name: 'bootstrap',
  });
});

export const upsertCast = spacetimedb.reducer(
  {
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
  },
  (ctx, args) => {
    const existing = ctx.db.casts.hash.find(args.hash);
    const now = BigInt(Date.now());
    const source = {
      source_type: args.sourceType,
      source_event_id: args.sourceEventId,
      event_id: args.eventId,
      event_timestamp_millis: args.eventTimestampMillis,
      block_number: args.blockNumber,
    };

    const row = {
      hash: args.hash,
      fid: args.fid,
      text: args.text,
      created_at_millis: args.createdAtMillis,
      event_timestamp_millis: args.eventTimestampMillis,
      event_id: args.eventId,
      is_deleted: false,
      mentions: args.mentionsJson,
      source_type: args.sourceType,
      source_event_id: args.sourceEventId,
      block_number: args.blockNumber,
      parent_fid: args.parentFid,
      parent_hash: args.parentHash,
      received_at_millis: now,
      updated_at_millis: now,
    };

    if (existing === null) {
      ctx.db.casts.insert(row);
      return;
    }

    existing.update({ ...existing, ...row, ...source });
  }
);

export const deleteCast = spacetimedb.reducer(
  {
    hash: t.string(),
    eventId: t.u64(),
    sourceType: t.string(),
    sourceEventId: t.string(),
    blockNumber: t.i64().optional(),
    eventTimestampMillis: t.u64(),
  },
  (ctx, args) => {
    const existing = ctx.db.casts.hash.find(args.hash);
    const now = BigInt(Date.now());

    if (existing === null) {
      ctx.db.casts.insert({
        hash: args.hash,
        fid: 0,
        text: '',
        created_at_millis: now,
        event_timestamp_millis: args.eventTimestampMillis,
        event_id: args.eventId,
        source_type: args.sourceType,
        source_event_id: args.sourceEventId,
        mentions: '[]',
        is_deleted: true,
        block_number: args.blockNumber,
        parent_fid: null,
        parent_hash: null,
        received_at_millis: now,
        updated_at_millis: now,
      });
      return;
    }

    existing.update({
      ...existing,
      is_deleted: true,
      source_type: args.sourceType,
      source_event_id: args.sourceEventId,
      event_id: args.eventId,
      event_timestamp_millis: args.eventTimestampMillis,
      block_number: args.blockNumber,
      updated_at_millis: now,
    });
  }
);

export const updateCursor = spacetimedb.reducer(
  {
    fromEventId: t.u64(),
    pageToken: t.string().optional(),
    pollerName: t.string(),
  },
  (ctx, args) => {
    const existing = ctx.db.sync_state.id.find(1);
    if (existing === null) {
      ctx.db.sync_state.insert({
        id: 1,
        from_event_id: args.fromEventId,
        page_token: args.pageToken,
        last_updated_millis: BigInt(Date.now()),
        poller_name: args.pollerName,
      });
      return;
    }

    existing.update({
      ...existing,
      from_event_id: args.fromEventId,
      page_token: args.pageToken,
      last_updated_millis: BigInt(Date.now()),
      poller_name: args.pollerName,
    });
  }
);
