import { readFileSync } from 'node:fs';

interface ErrorCode {
  code: string;
  type: string;
  gate?: string;
}

const document = JSON.parse(readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8')) as {
  components: { schemas: { Error: { 'x-arcmira-codes': ErrorCode[] } } };
};

/** The read_only_request entry of the API document, which gives the type and code of a marked request the API refuses. */
export const READ_ONLY_REQUEST = document.components.schemas.Error['x-arcmira-codes'].find((entry) => entry.code === 'read_only_request');

/** The API's messages for a marked request it refuses, from its change that refuses marked requests. */
export const READ_ONLY_MESSAGES = {
  premium: 'This request is marked read-only and would have started a Premium transcript or translation, so nothing was charged.',
  sponsors: 'This request is marked read-only and would have used credits from the plan to show more sponsors, so nothing was charged.',
  receipts: 'This request is marked read-only and would have used credits from the plan to show more receipts, so nothing was charged.',
  owned: (video: string) =>
    `This request is marked read-only, and the account already owns this Premium transcript, so nothing was charged and no job was recorded. Read it with GET /v1/transcripts/${video}?quality=premium.`,
};

/** The 403 body the API sends for a marked request it refuses, in the shape the API document gives read_only_request. */
export function readOnlyRefusal(message: string, requestId = 'req_marked') {
  const { type, code } = READ_ONLY_REQUEST!;
  return { error: { type, code, message, doc_url: `https://arcmira.com/docs/errors#${code}`, request_id: requestId } };
}
