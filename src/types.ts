export interface RawJsonObject {
  [key: string]: unknown;
}

export type EventAction = 'upsert' | 'delete';

export interface ParsedCastAction {
  kind: 'upsert';
  hash: string;
  fid: number;
  createdAtSeconds: number;
  text: string;
  mentions: number[];
  parentFid: number | null;
  parentHash: string | null;
  sourceType: string;
  eventId: string;
  blockNumber: number | null;
}

export interface ParsedDeleteAction {
  kind: 'delete';
  hash: string;
  eventId: string;
  sourceType: string;
  blockNumber: number | null;
  eventTimestampSeconds: number;
}

export type ParsedEvent = ParsedCastAction | ParsedDeleteAction;

export interface ParsedEventsPage {
  events: ParsedEvent[];
  cursor: PollCursor;
  hasMore: boolean;
  receivedCount: number;
  pageToken: string | null;
}

export interface PollCursor {
  fromEventId: bigint;
  pageToken: string | null;
}

export interface PollerState {
  fromEventId: string;
  pageToken: string | null;
}

export interface PollerRuntimeConfig {
  hypersnapHttpUrl: string;
  hypersnapPollIntervalMs: number;
  hypersnapTimeoutMs: number;
  maxPagesPerPoll: number;
  hypersnapPageSize: number;
  eventLookbackMode: boolean;
  pollerName: string;
  statePath: string;
  allowUntrustedEndpoint: boolean;
  allowedHypersnapHosts: string[];
}

export interface SpaceTimeConfig {
  uri: string;
  databaseName: string;
}

export interface AppConfig {
  poller: PollerRuntimeConfig;
  spacetime: SpaceTimeConfig;
  ui: {
    initialLimit: number;
  };
}

export interface CastReducerPayload {
  hash: string;
  fid: number;
  text: string;
  createdAtMillis: bigint;
  eventTimestampMillis: bigint;
  eventId: bigint;
  sourceType: string;
  sourceEventId: string;
  blockNumber: bigint | null;
  parentFid: number | null;
  parentHash: string | null;
  mentionsJson: string;
}

export interface DeleteReducerPayload {
  hash: string;
  eventId: bigint;
  sourceType: string;
  sourceEventId: string;
  blockNumber: bigint | null;
  eventTimestampMillis: bigint;
}

export interface CursorReducerPayload {
  fromEventId: bigint;
  pageToken: string | null;
  pollerName: string;
}
