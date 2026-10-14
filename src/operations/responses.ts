import { z } from 'zod';

export type ResponseFields =
  | { kind: 'scalar' }
  | { kind: 'array'; items: ResponseFields }
  | { kind: 'object'; properties: Record<string, ResponseFields> }
  | { kind: 'error'; properties: Record<string, ResponseFields> };

export const responseFieldsSchema: z.ZodType<ResponseFields> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scalar') }),
  z.object({ kind: z.literal('array'), items: responseFieldsSchema }),
  z.object({ kind: z.literal('object'), properties: z.record(z.string(), responseFieldsSchema) }),
  z.object({ kind: z.literal('error'), properties: z.record(z.string(), responseFieldsSchema) }),
]));

const record = z.record(z.string(), z.unknown());
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const errorFields = z.object({
  type: z.string(), code: z.string(), message: z.string(),
  reason: z.string().optional(), param: z.string().optional(), gate: z.string().optional(),
  retry_after_seconds: z.number().optional(), retry_after: z.string().optional(),
});
const entitlementCodes = new Set([
  'api_not_enabled', 'feature_not_available', 'filter_requires_paid', 'freshness_requires_paid',
  'owner_plan_required', 'pagination_gated', 'paid_plan_required', 'premium_transcript_requested',
  'recipient_upgrade_required', 'recommendations_not_enabled', 'tracker_limit',
]);

/** Preserve actionable error facts without forwarding signup or payment instructions. */
export function researchError(value: unknown): Record<string, unknown> {
  const error = errorFields.parse(value);
  if (error.type === 'authentication_error') return {
    ...error, message: 'Connect your Arcmira account through the host to use this tool.',
    doc_url: 'https://arcmira.com/docs/authentication',
  };
  if (error.type === 'quota_exceeded' || entitlementCodes.has(error.code)
    || ['plan', 'rows', 'freshness', 'exposure_law', 'pagination'].includes(error.gate ?? '')) return {
    ...error,
    message: error.type === 'quota_exceeded'
      ? 'This request exceeds the account usage allowance or spending limit. The requested data was not returned.'
      : 'The account does not include the requested feature or data scope. Keep the requested quality and filters unchanged.',
    doc_url: 'https://arcmira.com/docs/usage-and-billing',
  };
  return {
    ...error,
    ...(error.type === 'server_error' ? { message: 'The requested operation could not be completed. Check its state before retrying a write with the same idempotency key.' } : {}),
    doc_url: 'https://arcmira.com/docs/errors',
  };
}

/** The generated contract is an allowlist. New upstream fields require a reviewed catalog rebuild. */
export function projectResponse(value: unknown, fields: ResponseFields): unknown {
  if (value === null) return null;
  switch (fields.kind) {
    case 'scalar': return scalar.parse(value);
    case 'array': return z.array(z.unknown()).parse(value).map((item) => projectResponse(item, fields.items));
    case 'object':
    case 'error': {
      const input = record.parse(value);
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(fields.properties)) {
        if (Object.hasOwn(input, key)) output[key] = projectResponse(input[key], child);
      }
      if (fields.kind === 'error') return { ...output, ...researchError(input) };
      if (input.unlock || input.upgrade) output.account_information = {
        message: 'Some requested data or features are outside the account allowance. See the API documentation for access details.',
        doc_url: 'https://arcmira.com/docs/usage-and-billing',
      };
      if (typeof input.webhook_secret === 'string') output.setup_notice =
        'A webhook signing secret was generated but is not exposed to the model. Webhook receiver setup is incomplete until the account owner configures the secret through a secure channel. API documentation: https://arcmira.com/docs';
      return output;
    }
    default: { const unreachable: never = fields; return unreachable; }
  }
}
