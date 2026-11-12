import { CALL_HEADER, CLIENT_HEADER, DEFAULT_API_BASE, READ_ONLY_HEADER, SRC, TOOL_HEADER, USER_AGENT, type Env } from './api.ts';
import { outboundAllowed, type Access } from './sandbox.ts';

export interface OutboundProps {
  key: string;
  client: string | null;
  /** The tool call this program runs for; sent upstream so the API's request events join its span. */
  call?: { id: string; tool: string };
  /** Which allowlist applies. Absent means read. */
  access?: Access;
}

/** The largest request body a sandbox program may send upstream. Monitor bodies are a few hundred bytes. */
const OUTBOUND_BODY_CAP = 16_384;

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;

/** What an arcmira_execute_read program reads, as write_tool_required, when the API refuses its marked request for a Premium transcript or translation. */
export const WRITE_TOOL_REQUIRED =
  'This read would start a Premium transcript or translation, and arcmira_execute_read only reads, so nothing was charged. Run it in arcmira_execute_write. It uses credits from your plan, then your on-demand budget.';
/** The API's read_only_request message for a Premium transcript or translation, exactly. Any other message is another refusal. */
const PREMIUM_REFUSAL = 'This request is marked read-only and would have started a Premium transcript or translation, so nothing was charged.';

function refused(base: URL, access: Access, method: string, path: string, message?: string): Response {
  const writable = access === 'read' && outboundAllowed('write', method, path);
  return Response.json(
    {
      error: {
        type: 'invalid_request_error',
        code: 'outbound_refused',
        message:
          message ??
          (writable
            ? `${method} ${path} changes the account; run it in arcmira_execute_write.`
            : access === 'write'
              ? `The sandbox reaches only GET ${base.origin}/v1/*, POST or PATCH under /v1/monitors, and PATCH under /v1/trackers. Use the arcmira client methods; there is no other network.`
              : `The sandbox reaches only GET ${base.origin}/v1/*. Use the arcmira client methods; there is no other network.`),
        doc_url: 'https://arcmira.com/docs/mcp-server',
        request_id: `mcp_${crypto.randomUUID()}`,
      },
    },
    { status: 403 },
  );
}

/**
 * The API's Premium read_only_request refusal as write_tool_required in WRITE_TOOL_REQUIRED's words, for a client method and a
 * raw fetch() alike. Any other answer, another read_only_request included, reaches the program as the API sent it.
 */
async function asWriteToolRequired(response: Response): Promise<Response> {
  if (response.status !== 403) return response;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: Record<string, unknown> } | null;
  if (body?.error?.code !== 'read_only_request' || body.error.message !== PREMIUM_REFUSAL) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return Response.json({ error: { ...body.error, code: 'write_tool_required', message: WRITE_TOOL_REQUIRED } }, { status: response.status, headers });
}

/**
 * One sandbox request, as ApiOutbound in src/index.ts serves it. A request outside the access allowlist is
 * refused. Any other goes to the Arcmira API through `upstream` with the caller's credential, which the
 * program never sees. Every request outside arcmira_execute_write carries the read-only mark.
 */
export async function forward(request: Request, env: Env, props: OutboundProps, upstream: (url: URL, init: RequestInit) => Promise<Response>): Promise<Response> {
  const base = new URL(env.ARCMIRA_API_BASE ?? DEFAULT_API_BASE);
  const url = new URL(request.url);
  const access: Access = props.access === 'write' ? 'write' : 'read';
  const method = request.method.toUpperCase();
  if (url.origin !== base.origin || !outboundAllowed(access, method, url.pathname)) return refused(base, access, method, url.pathname);
  let body: string | undefined;
  if (method !== 'GET') {
    body = await request.text();
    if (body.length > OUTBOUND_BODY_CAP) return refused(base, access, method, url.pathname, `The request body is over ${OUTBOUND_BODY_CAP} characters.`);
  }
  url.searchParams.set('src', SRC);
  const headers = new Headers({ authorization: `Bearer ${props.key}`, accept: 'application/json', 'user-agent': USER_AGENT });
  if (body !== undefined) headers.set('content-type', 'application/json');
  const idempotencyKey = request.headers.get('idempotency-key');
  if (body !== undefined && idempotencyKey !== null && IDEMPOTENCY_KEY.test(idempotencyKey)) headers.set('idempotency-key', idempotencyKey);
  if (props.client) headers.set(CLIENT_HEADER, props.client);
  if (props.call) {
    headers.set(CALL_HEADER, props.call.id);
    headers.set(TOOL_HEADER, props.call.tool);
  }
  if (access !== 'write') headers.set(READ_ONLY_HEADER, '1');
  const response = await upstream(url, {
    method,
    headers,
    body,
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400)
    return Response.json(
      {
        error: {
          code: 'redirect_refused',
          message: 'Authenticated redirect refused; no bearer reached the target.',
        },
      },
      { status: 502 },
    );
  return access === 'write' ? response : asWriteToolRequired(response);
}
