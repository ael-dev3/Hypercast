import { describe, expect, it } from 'vitest';

import {
  buildHypersnapEventsUrl,
  parseEventsResponse,
  isUpsert,
} from '../src/parse-hypersnap.js';
import { cursorFromState, parsePollerState } from '../src/config.js';

describe('buildHypersnapEventsUrl', () => {
  it('builds page token and event cursor query params', () => {
    const base = buildHypersnapEventsUrl('http://127.0.0.1:3381', {
      fromEventId: 123n,
      pageToken: null,
    }, 77);

    expect(base).toContain('from_event_id=123');
    expect(base).toContain('pageSize=77');

    const withToken = buildHypersnapEventsUrl('http://127.0.0.1:3381', {
      fromEventId: 123n,
      pageToken: 'abc',
    }, 77);

    expect(withToken).toContain('pageToken=abc');
    expect(withToken).not.toContain('from_event_id');
  });
});

describe('parseEventsResponse', () => {
  it('parses cast add and remove actions', () => {
    const body = {
      events: [
        {
          type: 'HUB_EVENT_TYPE_MERGE_MESSAGE',
          id: 10,
          mergeMessageBody: {
            message: {
              hash: '0xdeadbeef',
              data: {
                type: 'MESSAGE_TYPE_CAST_ADD',
                fid: 123,
                timestamp: 1700000000,
                castAddBody: {
                  text: 'hello world',
                  mentions: [2, 3],
                  parentCastId: {
                    fid: 11,
                    hash: '0x11aa',
                  },
                },
              },
            },
            deletedMessages: [
              {
                data: {
                  type: 'MESSAGE_TYPE_CAST_REMOVE',
                  castRemoveBody: {
                    targetHash: '0xabc',
                  },
                },
                hash: '0xignored',
              },
            ],
          },
        },
      ],
      nextPageToken: 'tok',
    };

    const parsed = parseEventsResponse(JSON.stringify(body));
    expect(parsed.events).toHaveLength(2);
    expect(isUpsert(parsed.events[0])).toBe(true);
    expect(parsed.events[0]).toMatchObject({
      kind: 'upsert',
      hash: '0xdeadbeef',
      fid: 123,
      sourceType: 'HUB_EVENT_TYPE_MERGE_MESSAGE',
    });

    expect(parsed.events[1]).toMatchObject({
      kind: 'delete',
      hash: '0xabc',
      sourceType: 'HUB_EVENT_TYPE_MERGE_MESSAGE',
    });
    expect(parsed.cursor.fromEventId).toBe(11n);
    expect(parsed.pageToken).toBe('tok');
    expect(parsed.hasMore).toBe(true);
  });

  it('ignores unknown event shapes safely', () => {
    const body = {
      events: [
        {
          type: 'UNKNOWN',
          id: 99,
        },
        {
          type: 'HUB_EVENT_TYPE_MERGE_MESSAGE',
          id: 'bad',
          mergeMessageBody: {
            message: null,
          },
        },
      ],
    };

    const parsed = parseEventsResponse(JSON.stringify(body));
    expect(parsed.events).toHaveLength(0);
    expect(parsed.receivedCount).toBe(2);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.cursor.fromEventId).toBe(0n);
  });
});

describe('config state', () => {
  it('reads and writes poller state', () => {
    const state = parsePollerState('{"fromEventId":"123","pageToken":"abc"}');
    const cursor = cursorFromState(state);
    expect(cursor.fromEventId).toBe(123n);
    expect(cursor.pageToken).toBe('abc');
  });

  it('falls back on malformed state', () => {
    const state = parsePollerState('bad-json');
    expect(state.fromEventId).toBe('0');
    expect(state.pageToken).toBe(null);
  });
});
