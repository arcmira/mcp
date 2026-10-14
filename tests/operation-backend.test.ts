import { strict as assert } from 'node:assert';
import { it } from 'node:test';
import { checkOperationBackend } from '../src/operations/backend-contract.ts';

const contract = (parameters: unknown[]) => ({ paths: { '/v1/transcripts/{video_id}': {
  get: { operationId: 'get_transcript', parameters },
} } });

it('blocks operation release against backends missing the existing-credit contract', () => {
  for (const parameters of [[],
    [{ name: 'spending', in: 'query', schema: { type: 'string', enum: ['account_budget'] } }],
    [{ name: 'spending', in: 'header', schema: { type: 'string', enum: ['existing_credits'] } }],
    [{ name: 'spending', in: 'query', schema: { type: 'string' } }],
  ]) assert.throws(() => checkOperationBackend(contract(parameters)), /release blocked/);
  assert.throws(() => checkOperationBackend({ paths: {} }));
});

it('accepts an API contract that explicitly supports existing-credit Premium reads', () => {
  assert.doesNotThrow(() => checkOperationBackend(contract([
    { name: 'start', in: 'query', schema: { type: ['number', 'null'] } },
    { name: 'spending', in: 'query', schema: { type: 'string', enum: ['account_budget', 'existing_credits'] } },
  ])));
});
