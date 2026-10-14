/** Each entry is a separately reviewed API operation, never an arbitrary path or program. */
export const OPERATION_DEFINITIONS = [
  ['get_me', 'Account access', 'Read the connected account and its current API access and usage.', 'read'],
  ['resolve_entity', 'Resolve a name', 'Find the indexed person, organization, product, topic or channel matching a name. Use returned IDs in research filters; ambiguous names may need clarification.', 'read'],
  ['get_entity', 'Read entity details', 'Read indexed metadata for one entity ID.', 'read'],
  ['search', 'Search YouTube transcripts', 'Find spoken passages about one topic across indexed YouTube videos and livestreams. Returns text and timestamped source links. Filters use resolved IDs; coverage and speaker attribution can be incomplete.', 'read'],
  ['list_mentions', 'Find mentions', 'Find where an indexed entity was mentioned, with source context and pagination.', 'read'],
  ['list_recommendations', 'Find recommendations', 'Find recommendations of an entity and their organic or sponsored classification. Check the cited source; classifications can be incomplete or wrong.', 'read'],
  ['list_channel_sponsors', 'Find channel sponsors', 'Find recurring sponsors and ad reads in an indexed channel. Results describe observed evidence, not proof of a private commercial agreement.', 'read'],
  ['get_entity_momentum', 'Read entity momentum', 'Read mention momentum for one entity in the indexed catalog.', 'read'],
  ['get_channel_coverage', 'Check channel coverage', 'Read how much of a channel is indexed before interpreting missing results.', 'read'],
  ['list_channel_videos', 'List channel videos', 'List the indexed videos of a channel within a publication window.', 'read'],
  ['count_mentions', 'Count mentions', 'Rank entity mentions within specified channels, videos or entities. Counts describe indexed coverage.', 'read'],
  ['get_transcript', 'Get a video transcript', 'Retrieve the explicitly requested transcript source for a YouTube video. Premium can start whole-video transcription using existing credits only, with no new on-demand charge. Pending and failed responses contain no finished transcript. Never substitute captions for requested Premium. An explicit retry after failure can spend existing credits again.', 'purchase'],
  ['quote_transcription', 'Quote Premium transcription', 'Preview the whole-video Premium transcription price without buying or starting transcription.', 'readOpen'],
  ['list_monitors', 'List saved monitors', 'List the connected account’s saved research monitors before changing one.', 'read'],
  ['list_monitor_trackers', 'List monitor trackers', 'Read the trackers attached to a saved monitor.', 'read'],
  ['list_slack_integrations', 'List Slack destinations', 'List Slack workspaces already connected to the account for monitor delivery. Does not connect a new workspace.', 'read'],
  ['create_monitor', 'Create a monitor', 'Save a research monitor with the user’s chosen delivery destinations and frequency. Can enable future email, Slack or webhook notifications. Ask for delivery preferences before creating it.', 'writeOpen'],
  ['update_monitor', 'Update a monitor', 'Change or pause an existing monitor. Can overwrite settings and change future email, Slack or webhook delivery. Use the monitor ID returned by the account’s monitor list.', 'writeOpen'],
  ['add_monitor_trackers', 'Attach monitor trackers', 'Attach existing account trackers to a monitor. Future matches may trigger its configured notifications.', 'write'],
  ['add_monitor_entities', 'Follow entities in a monitor', 'Create or reuse account trackers for entity IDs or exact names and attach them to a monitor. Future matches may trigger its configured notifications.', 'write'],
  ['submit_feedback', 'Send research feedback', 'Persist feedback or a correction for a prior API result. Send only the relevant issue, never credentials or unrelated personal details. Repeated requests without the same idempotency key may create separate records.', 'append'],
] as const;

export type OperationId = (typeof OPERATION_DEFINITIONS)[number][0];
export type OperationEffect = (typeof OPERATION_DEFINITIONS)[number][3];

export const EFFECTS = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  readOpen: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  purchase: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  writeOpen: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  write: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  append: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
} satisfies Record<OperationEffect, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }>;
