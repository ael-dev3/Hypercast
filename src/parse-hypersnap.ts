import type {
  ParsedCastAction,
  ParsedDeleteAction,
  ParsedEvent,
  ParsedEventsPage,
  PollCursor,
} from './types.js';

interface RawHypersnapEnvelope {
  events?: unknown;
  nextPageToken?: unknown;
  next_page_token?: unknown;
}

interface RawCastAdd {
  text?: unknown;
  mentions?: unknown;
  parentCastId?: { fid?: unknown; hash?: unknown };
}

interface RawCastRemove {
  targetHash?: unknown;
}

interface RawMessageData {
  type?: string;
  fid?: unknown;
  timestamp?: unknown;
  castAddBody?: RawCastAdd;
  castRemoveBody?: RawCastRemove;
}

interface RawMessage {
  data?: RawMessageData;
  hash?: unknown;
}

interface RawMergeMessageBody {
  message?: RawMessage;
  deletedMessages?: RawMessage[];
}

interface RawHypersnapEvent {
  type?: string;
  id?: unknown;
  blockNumber?: unknown;
  mergeMessageBody?: RawMergeMessageBody;
}

const MAX_TEXT_LENGTH = 2048;

function asString(input: unknown, fallback = ''): string {
  return typeof input === 'string' ? input : fallback;
}

function asNumber(input: unknown, fallback = 0): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input < 0 ? fallback : Math.trunc(input);
  }

  if (typeof input === 'string') {
    const parsed = Number.parseInt(input, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  return fallback;
}

function asBigInt(input: unknown, fallback = 0n): bigint {
  try {
    if (typeof input === 'number' && Number.isFinite(input)) {
      return input < 0 ? fallback : BigInt(Math.trunc(input));
    }

    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) return fallback;
      if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
      if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed);
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function normalizeHash(input: unknown): string | null {
  const raw = asString(input);
  if (!raw) return null;

  if (/^0x[0-9a-fA-F]+$/.test(raw)) {
    return `0x${raw.slice(2).toLowerCase()}`;
  }

  if (/^[0-9a-fA-F]+$/.test(raw)) {
    return `0x${raw.toLowerCase()}`;
  }

  if (/^[A-Za-z0-9+/=]+$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, 'base64');
      return decoded.length === 0 ? null : `0x${decoded.toString('hex')}`;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeText(input: unknown): string {
  const value = asString(input).replace(/\u0000/g, '').trim();
  if (value.length <= MAX_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}

function normalizeMentions(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(item => asNumber(item, -1))
    .filter(item => Number.isInteger(item) && item >= 0);
}

function parseCastAdd(
  message: RawMessage | undefined,
  eventId: bigint,
  blockNumber: number,
  sourceType: string,
  timestampSeconds: number
): ParsedCastAction | null {
  if (!message?.data || message.data.type !== 'MESSAGE_TYPE_CAST_ADD') return null;

  const hash = normalizeHash(message.hash);
  const castAddBody = message.data.castAddBody ?? {};
  if (!hash) return null;

  const createdAtSeconds = asNumber(message.data.timestamp, timestampSeconds);
  const parentHash = normalizeHash(castAddBody.parentCastId?.hash);
  const parentFid = parentHash ? asNumber(castAddBody.parentCastId?.fid, 0) : null;

  return {
    kind: 'upsert',
    hash,
    fid: asNumber(message.data.fid, 0),
    createdAtSeconds,
    text: normalizeText(castAddBody.text),
    mentions: normalizeMentions(castAddBody.mentions),
    parentFid,
    parentHash,
    sourceType,
    eventId: eventId.toString(),
    blockNumber,
  };
}

function parseCastRemove(
  message: RawMessage | undefined,
  eventId: bigint,
  blockNumber: number,
  sourceType: string,
  timestampSeconds: number
): ParsedDeleteAction | null {
  if (!message?.data || message.data.type !== 'MESSAGE_TYPE_CAST_REMOVE') return null;

  const targetHash = normalizeHash(message.data.castRemoveBody?.targetHash);
  if (!targetHash) return null;

  return {
    kind: 'delete',
    hash: targetHash,
    eventId: eventId.toString(),
    sourceType,
    blockNumber,
    eventTimestampSeconds: timestampSeconds,
  };
}

function parseDeletedMessage(
  message: RawMessage | undefined,
  eventId: bigint,
  blockNumber: number,
  sourceType: string,
  timestampSeconds: number
): ParsedEvent[] {
  const actions: ParsedEvent[] = [];

  const added = parseCastAdd(message, eventId, blockNumber, sourceType, timestampSeconds);
  if (added) {
    actions.push(added);
  }

  const removed = parseCastRemove(message, eventId, blockNumber, sourceType, timestampSeconds);
  if (removed) {
    actions.push(removed);
  }

  return actions;
}

function parseDeletedMessageList(
  deletedMessages: RawMessage[] | undefined,
  eventId: bigint,
  blockNumber: number,
  eventSource: string,
  timestampSeconds: number
): ParsedEvent[] {
  if (!Array.isArray(deletedMessages) || deletedMessages.length === 0) return [];

  const actions: ParsedEvent[] = [];
  for (const message of deletedMessages) {
    actions.push(...parseDeletedMessage(message, eventId, blockNumber, eventSource, timestampSeconds));
  }

  return actions;
}

export function parseEventsResponse(rawJson: string): ParsedEventsPage {
  let payload: RawHypersnapEnvelope;
  try {
    payload = JSON.parse(rawJson) as RawHypersnapEnvelope;
  } catch {
    throw new Error('Hypersnap response was not valid JSON');
  }

  const incoming = Array.isArray(payload.events) ? payload.events : [];
  const parsed: ParsedEvent[] = [];
  let maxEventId = 0n;
  let pageToken: string | null = null;

  for (const evt of incoming as RawHypersnapEvent[]) {
    if (!evt || typeof evt !== 'object') continue;
    if (evt.type !== 'HUB_EVENT_TYPE_MERGE_MESSAGE') continue;

    const eventId = asBigInt(evt.id, 0n);
    const blockNumber = asNumber(evt.blockNumber, 0);
    const eventSource = evt.type as string;
    const timestampSeconds = asNumber(evt.mergeMessageBody?.message?.data?.timestamp, Math.floor(Date.now() / 1000));

    const eventActions = parseDeletedMessage(evt.mergeMessageBody?.message, eventId, blockNumber, eventSource, timestampSeconds);
    for (const action of eventActions) {
      parsed.push(action);
    }

    for (const deleted of parseDeletedMessageList(
      evt.mergeMessageBody?.deletedMessages,
      eventId,
      blockNumber,
      eventSource,
      timestampSeconds
    )) {
      parsed.push(deleted);
    }

    if (eventId >= maxEventId) maxEventId = eventId;
  }

  const next =
    asString(payload.nextPageToken, '') || asString(payload.next_page_token, '');
  if (next.length > 0) {
    pageToken = next;
  }

  const hasMore = pageToken !== null && parsed.length > 0;
  const nextCursor = parsed.length > 0 ? maxEventId + 1n : 0n;

  return {
    events: parsed,
    receivedCount: incoming.length,
    hasMore,
    pageToken,
    cursor: {
      fromEventId: nextCursor,
      pageToken,
    },
  };
}

export function buildHypersnapEventsUrl(
  baseUrl: string,
  cursor: PollCursor,
  pageSize: number,
  reverse = false
): string {
  const normalized = new URL(baseUrl);
  normalized.pathname = '/v1/events';
  const params = normalized.searchParams;
  params.set('pageSize', String(Math.max(1, pageSize)));
  if (reverse) {
    params.set('reverse', 'true');
  }

  if (cursor.pageToken) {
    params.set('pageToken', cursor.pageToken);
  } else {
    params.set('from_event_id', cursor.fromEventId.toString());
  }

  return normalized.toString();
}

export function isUpsert(action: ParsedEvent): action is ParsedCastAction {
  return action.kind === 'upsert';
}
