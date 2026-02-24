# Hypercast

A Firebase-hosted TypeScript prototype that renders cast history from Hypersnap in a modern, dark UI and can switch to SpacetimeDB for persisted reads.

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
   - Primary path: direct Hypersnap polling with dedupe + newest-first rendering.
   - Optional path: SpacetimeDB live subscription mode for persisted cache reads.
   - Explicit transport controls:
     - endpoint, poll interval, page size, max pages
     - rows-to-render limit
     - untrusted host override
     - mode switch with auto-fallback from SpacetimeDB to Hypersnap
   - Health indicators and last-sync latency to support weak-agent clarity.

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

## Browser controls

- `mode` selector defaults to `hypersnap` but supports `spacetime`.
- `save settings` persists transport values to localStorage:
  - `hypersnap` URL, page size, poll interval, timeout
  - max pages per refresh, reverse sort flag
  - row limit and host trust override

The app blocks non-whitelisted Hypersnap hosts by default and requires explicit
`allowUntrustedHost` to run unsafe endpoints.

## Notes

- Poller uses only Hypersnap API (`/v1/events`) and SpacetimeDB.
- No Snapchain write paths are used.
