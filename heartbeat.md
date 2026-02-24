# Hypercast Heartbeat

Hypercast keeps itself in sync with Hypersnap using two paths:

- server-side poller loop (`scripts/poller.ts`) for persisted storage
- browser-side Hypersnap direct fetch for immediate UX fallback

## Default Cadence

- `HYPERSNAP_POLL_INTERVAL_MS=1800000` (30 minutes)
- `HYPERSNAP_MAX_PAGES_PER_POLL=4`
- `HYPERSNAP_PAGE_SIZE=100`

Web UI defaults:

- `hypersnapPollIntervalMs=30000` (30 seconds)
- `hypersnapPageSize=100`
- `hypersnapMaxPages=2`
- `hypersnapReverse=true`

## Recommended Operational Flow

1. Start SpacetimeDB module (`spacetimedb publish` or local instance).
2. Deploy/update host page (`bundle.js` built from `src/main.ts`).
3. Run:

```bash
npm run poller
```

This will poll indefinitely and persist cursor state to `.hypercast-state.json`.

## Browser fallback path

Open the app and choose `Hypersnap` mode to fetch directly from the endpoint defined in UI.
The UI persists endpoint/rate/page settings in localStorage and continuously refreshes
based on the configured interval.

To run a single pass for local checks:

```bash
npm run poller:once
```

## Recovery

If poller restarts, it uses last persisted cursor state to resume from the next unprocessed event.
