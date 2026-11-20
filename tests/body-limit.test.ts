import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { BODY_LIMIT, counted } from '../src/body-limit.ts';
import { listTools, withFetch } from './handler.ts';

const PIECE = 64 * 1024;
const MESSAGE = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}';
const REFUSAL = {
  jsonrpc: '2.0',
  id: null,
  error: { code: -32000, message: 'The request body is over the limit of 1048576 bytes.', data: { code: 'request_too_large', limit_bytes: 1048576 } },
};

/**
 * A tools/list message padded with spaces to `total` bytes, handed out in pieces, that records how much was taken.
 * `ended` settles when the body was read to its end or its reader stopped it.
 */
function body(total: number, piece = PIECE) {
  const bytes = new TextEncoder().encode(MESSAGE.padEnd(total, ' '));
  let taken = 0;
  let cancelled = false;
  let end = () => {};
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (taken >= bytes.byteLength) {
          end();
          return controller.close();
        }
        const next = bytes.subarray(taken, taken + piece);
        taken += next.byteLength;
        controller.enqueue(next);
      },
      cancel() {
        cancelled = true;
        end();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, ended, taken: () => taken, cancelled: () => cancelled };
}

interface Sent {
  path: string;
  size: number;
  /** The Content-Length header to state, when the request states one. */
  length?: number;
  /** The size of the pieces the body arrives in. 64 KiB when omitted. */
  piece?: number;
  origin?: string;
  credential?: boolean;
}

/** One POST through the Worker's fetch with a streamed body. Waits for the work the Worker left running, then reports what was read. */
async function post({ path, size, length, piece, origin, credential = true }: Sent) {
  const source = body(size, piece);
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (credential) headers.authorization = 'Bearer arc_sk_fixture';
  if (length !== undefined) headers['content-length'] = String(length);
  if (origin !== undefined) headers.origin = origin;
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers, body: source.stream, duplex: 'half' };
  const deferred: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => deferred.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  return withFetch(
    () => Response.json({ id: 'caller' }),
    async () => {
      const response = await worker.fetch(new Request(`https://mcp.arcmira.com${path}`, init), {}, ctx);
      const text = await response.text();
      await Promise.all(deferred);
      // A body that anything began to read is read to its end or stopped. A copy may do that after an early answer.
      if (source.taken() > 0) await source.ended;
      return { status: response.status, text, taken: source.taken(), cancelled: source.cancelled() };
    },
  );
}

const toolsOf = (text: string) => {
  const data = text.split('\n').find((line) => line.startsWith('data:'));
  return (JSON.parse(data ? data.slice(5) : text) as { result: { tools: unknown[] } }).result.tools;
};

// The Worker checks an account key once per isolate. Listing the tools first keeps that check out of every request below.
before(() => listTools());

describe('a POST body over 1 MiB is refused with 413', () => {
  it('the limit is 1 MiB', () => assert.equal(BODY_LIMIT, 1_048_576));

  for (const path of ['/mcp', '/mcp/apps']) {
    it(`${path}: a stated length one byte over the limit is refused before any of the body is read`, async () => {
      const reply = await post({ path, size: BODY_LIMIT + 1, length: BODY_LIMIT + 1 });
      assert.equal(reply.status, 413);
      assert.deepEqual(JSON.parse(reply.text), REFUSAL);
      assert.equal(reply.taken, 0);
    });

    it(`${path}: a body of 8 MiB that states no length is refused, and the reading stops near the limit`, async () => {
      const reply = await post({ path, size: 8 * BODY_LIMIT });
      assert.equal(reply.status, 413);
      assert.deepEqual(JSON.parse(reply.text), REFUSAL);
      assert.ok(reply.taken <= BODY_LIMIT + 3 * PIECE, `${reply.taken} bytes were taken`);
      assert.ok(reply.cancelled, 'the caller is no longer read');
    });

    it(`${path}: a body of 8 MiB that states a length of 100 is refused the same way`, async () => {
      const reply = await post({ path, size: 8 * BODY_LIMIT, length: 100 });
      assert.equal(reply.status, 413);
      assert.deepEqual(JSON.parse(reply.text), REFUSAL);
      assert.ok(reply.taken <= BODY_LIMIT + 3 * PIECE, `${reply.taken} bytes were taken`);
      assert.ok(reply.cancelled, 'the caller is no longer read');
    });

    it(`${path}: a body one byte over the limit that states no length is refused`, async () => {
      const reply = await post({ path, size: BODY_LIMIT + 1 });
      assert.equal(reply.status, 413);
      assert.deepEqual(JSON.parse(reply.text), REFUSAL);
    });

    for (const stated of [true, false]) {
      it(`${path}: a body of exactly the limit, ${stated ? 'with' : 'without'} a stated length, is answered as before`, async () => {
        const reply = await post({ path, size: BODY_LIMIT, ...(stated ? { length: BODY_LIMIT } : {}) });
        assert.equal(reply.status, 200, reply.text.slice(0, 300));
        assert.ok(toolsOf(reply.text).length > 0);
        assert.equal(reply.taken, BODY_LIMIT);
      });
    }

    it(`${path}: a request with no credential gets its 401 as before, and none of its body is read`, async () => {
      const reply = await post({ path, size: 8 * BODY_LIMIT, length: 8 * BODY_LIMIT, credential: false });
      assert.equal(reply.status, 401);
      assert.equal(reply.taken, 0);
    });

    it(`${path}: a body of 8 MiB that arrives as one piece is refused`, async () => {
      const reply = await post({ path, size: 8 * BODY_LIMIT, piece: 8 * BODY_LIMIT });
      assert.equal(reply.status, 413);
      assert.deepEqual(JSON.parse(reply.text), REFUSAL);
      assert.ok(reply.cancelled, 'the caller is no longer read');
    });

    it(`${path}: a foreign Origin with a body of 8 MiB that states no length keeps its 403, and the reading stops near the limit`, async () => {
      const reply = await post({ path, size: 8 * BODY_LIMIT, origin: 'https://evil.example' });
      assert.equal(reply.status, 403);
      assert.ok(reply.taken <= BODY_LIMIT + 3 * PIECE, `${reply.taken} bytes were taken`);
      assert.ok(reply.cancelled, 'the caller is no longer read');
    });

    it(`${path}: a foreign Origin that states a length over the limit is refused with 413 before any of the body is read`, async () => {
      const reply = await post({ path, size: 8 * BODY_LIMIT, length: 8 * BODY_LIMIT, origin: 'https://evil.example' });
      assert.equal(reply.status, 413);
      assert.equal(reply.taken, 0);
    });
  }
});

describe('the counted request stands in for the original', () => {
  const original = (signal?: AbortSignal) => {
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-arcmira-client': 'fixture', 'mcp-session-id': 'abc' },
      body: body(100).stream,
      duplex: 'half',
      signal,
    };
    return new Request('https://mcp.arcmira.com/mcp/apps?listing=dir-example', init);
  };

  it('keeps the method, the address with its query and every header', async () => {
    const request = original();
    const sent = [...request.headers];
    const { request: inbound, over } = counted(request);
    assert.equal(inbound.method, 'POST');
    assert.equal(inbound.url, 'https://mcp.arcmira.com/mcp/apps?listing=dir-example');
    assert.deepEqual([...inbound.headers], sent);
    assert.equal((await inbound.text()).trim(), MESSAGE);
    assert.equal(over(), false);
  });

  it('is aborted when the original is', () => {
    const controller = new AbortController();
    const { request: inbound } = counted(original(controller.signal));
    assert.equal(inbound.signal.aborted, false);
    controller.abort(new Error('the caller left'));
    assert.equal(inbound.signal.aborted, true);
  });

  it('is the original itself when there is no body', () => {
    const request = new Request('https://mcp.arcmira.com/mcp', { method: 'POST' });
    assert.equal(counted(request).request, request);
  });
});
