/** The largest POST body an MCP endpoint reads, in bytes. The largest call the tools' own input limits allow is under a quarter of it. */
export const BODY_LIMIT = 1024 * 1024;

/** The answer to a POST whose body is over the limit, in the shape of the server's other refusals. */
export function tooLarge(): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: `The request body is over the limit of ${BODY_LIMIT} bytes.`,
        data: { code: 'request_too_large', limit_bytes: BODY_LIMIT },
      },
    },
    { status: 413 },
  );
}

/** True when the request states a body length over the limit. Such a request is refused before any of its body is read. */
export function declaresTooLarge(request: Request): boolean {
  const declared = request.headers.get('content-length');
  return declared !== null && Number(declared) > BODY_LIMIT;
}

export interface Counted {
  /** The same request, with its body behind the counter. */
  request: Request;
  /** True once the body has passed the limit. */
  over: () => boolean;
}

/**
 * The request with its body behind a byte counter, for a body that states no length or a wrong one. Past the limit the
 * counter ends the body with an error and stops reading the caller, so no reader of this request or of a copy of it gets
 * more than the limit.
 */
export function counted(request: Request): Counted {
  if (request.body === null) return { request, over: () => false };
  let seen = 0;
  let over = false;
  const body = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > BODY_LIMIT) {
          over = true;
          controller.error(new Error('The request body is over the limit.'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  // Node needs duplex for a stream body. workerd takes the stream as it is.
  const init: RequestInit & { duplex: 'half' } = { body, duplex: 'half' };
  return { request: new Request(request, init), over: () => over };
}
