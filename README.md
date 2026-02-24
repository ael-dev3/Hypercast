# Hypercast

A Firebase-hosted TypeScript prototype that ingests Hypersnap cast events, stores normalized cast state in SpacetimeDB, and renders a live cast feed.

## Architecture

1. **Poller (`scripts/poller.ts`)**
   - Polls `Hypersnap /v1/events`.
   - Extracts cast add/remove actions from `HUB_EVENT_TYPE_MERGE_MESSAGE` events.
   - Writes normalized casts + sync cursor into SpacetimeDB reducers.

2. **SpacetimeDB module (`spacetimedb/src/index.ts`)**
   - `casts` table (deduped by cast hash, with deletion support).
   - `sync_state` table (1-row cursor record for the poller).
   - Reducers:
     - `upsertCast`
     - `deleteCast`
     - `updateCursor`

3. **Web client (`src/main.ts` + `public/index.html`)**
   - Connects directly to SpacetimeDB.
   - Subscribes to live cast rows and renders newest-first feed.
   - Shows sync health and supports manual refresh.

## Safety and Reliability

- All incoming Hypersnap endpoint URLs are validated (protocol, hostname constraints).
- Only expected JSON fields are parsed.
- Poller can only write through typed SpacetimeDB reducers.
- Local state and cursor state are persisted to disk for restart continuity.

## Local Setup

```bash
cp .env.example .env
npm install
```

The repository includes `src/module_bindings/index.ts` to keep browser builds
functional in environments where the SpacetimeDB generator CLI is unavailable.
If you have the CLI available, regenerate this file from module sources via:

```bash
npm run spacetimedb:generate
```

## SpacetimeDB module

```bash
npm run spacetimedb:publish:local  # if you run local SpacetimeDB
npm run spacetimedb:publish        # publish to maincloud
```

## Run the poller

```bash
npm run poller:once
npm run poller  # repeats forever, default interval from HYPERSNAP_POLL_INTERVAL_MS
```

Default poll interval is 30 minutes (`1800000ms`) to match periodic heartbeat style.

## Run the web client

```bash
npm run build:bundle
firebase deploy --only hosting:hypercast-web
```

For local smoke tests:

```bash
npm run check
HYPERSNAP_ALLOW_UNTRUSTED=true npm run poller:once -- --max-pages=1 --timeout-ms=3000
```

## Notes

- Poller uses only Hypersnap API (`/v1/events`) and SpacetimeDB.
- No Snapchain write paths are used.
