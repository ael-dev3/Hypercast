# Hypercast Heartbeat

Hypercast keeps itself in sync with Hypersnap using the poller loop.

## Default Cadence

- `HYPERSNAP_POLL_INTERVAL_MS=1800000` (30 minutes)
- `HYPERSNAP_MAX_PAGES_PER_POLL=4`
- `HYPERSNAP_PAGE_SIZE=100`

## Recommended Operational Flow

1. Start SpacetimeDB module (`spacetimedb publish` or local instance).
2. Deploy/update host page (`bundle.js` built from `src/main.ts`).
3. Run:

```bash
npm run poller
```

This will poll indefinitely and persist cursor state to `.hypercast-state.json`.

To run a single pass for local checks:

```bash
npm run poller:once
```

## Recovery

If poller restarts, it uses last persisted cursor state to resume from the next unprocessed event.
