import { z } from 'zod';

const transcriptContract = z.object({
  paths: z.object({
    '/v1/transcripts/{video_id}': z.object({
      get: z.object({
        operationId: z.literal('get_transcript'),
        parameters: z.array(z.object({
          name: z.string(), in: z.string(),
          schema: z.unknown(),
        })),
      }),
    }),
  }),
});

/** Check the deployed backend before routing traffic to the operation server. */
export function checkOperationBackend(value: unknown): void {
  const { parameters } = transcriptContract.parse(value).paths['/v1/transcripts/{video_id}'].get;
  const spending = parameters.find((parameter) => parameter.name === 'spending' && parameter.in === 'query');
  const schema = z.object({ type: z.literal('string'), enum: z.array(z.string()) }).safeParse(spending?.schema);
  if (!schema.success || !schema.data.enum.includes('existing_credits')) {
    throw new Error('Operation release blocked: the API does not advertise spending=existing_credits for Premium reads. Deploy and verify backend enforcement first.');
  }
}
