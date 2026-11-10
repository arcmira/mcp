import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { RULE_PUSH } from '../src/reference.ts';
import { WEEKLY_JOBS } from '../src/prompts.ts';
import { TOOLS } from '../src/tools.ts';

/** One JSON-RPC call through the Worker's fetch, the way a host sends it. */
async function rpc(method: string, params: Record<string, unknown> = {}, path = '/mcp') {
  const request = new Request(`https://mcp.arcmira.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer arc_sk_fixture' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ id: 'caller' })) as typeof fetch;
  try {
    const text = await (await worker.fetch(request, {}, ctx)).text();
    const data = text.split('\n').find((line) => line.startsWith('data:'));
    return JSON.parse(data ? data.slice(5) : text);
  } finally {
    globalThis.fetch = original;
  }
}

const textOf = (reply: { result: { messages: Array<{ content: { text: string } }> } }) => reply.result.messages.map((m) => m.content.text).join('\n');

describe('weekly-job prompts', () => {
  it('initialize advertises prompts', async () => {
    const reply = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.ok(reply.result.capabilities.prompts, JSON.stringify(reply.result.capabilities));
  });

  it('prompts/list returns the six jobs, each with one optional argument', async () => {
    const reply = await rpc('prompts/list');
    const listed = reply.result.prompts as Array<{ name: string; title: string; description: string; arguments: Array<{ name: string; required?: boolean }> }>;
    assert.deepEqual(listed.map((p) => p.name), WEEKLY_JOBS.map((j) => j.name));
    for (const p of listed) {
      assert.equal(p.arguments.length, 1, p.name);
      assert.notEqual(p.arguments[0].required, true, p.name);
      assert.doesNotMatch(p.description, RULE_PUSH, p.name);
    }
  });

  it('prompts/get fills in the names, keeps the steps, and adds the Free note only to index jobs', async () => {
    const brand = textOf(await rpc('prompts/get', { name: 'weekly-brand-watch', arguments: { names: 'Render, Fly.io' } }));
    assert.match(brand, /about Render, Fly\.io on YouTube/);
    assert.match(brand, /claude\.ai\/customize\/connectors/);
    assert.match(brand, /claude\.ai\/code\/routines/);
    assert.match(brand, /9:07/);
    assert.match(brand, /my plan can't read those dates, say so in one line, then run the same search over the newest 7 days it can read\./);
    assert.match(brand, /uses credits from my Arcmira plan/);
    assert.match(brand, /On another assistant, tell me how it schedules a task/);
    assert.doesNotMatch(brand, /Pro\+/);
    const scout = textOf(await rpc('prompts/get', { name: 'weekly-sponsor-scout', arguments: { channels: 'TBPN' } }));
    assert.match(scout, /If Arcmira says my plan can't read this, say so in one line and use what it did return\./);
    const reads = textOf(await rpc('prompts/get', { name: 'weekly-competitor-reads', arguments: { names: 'Ramp' } }));
    assert.match(reads, /my plan can't read this, say so in one line/);
    assert.doesNotMatch(brand, /plan can't read this,/);
    const digest = textOf(await rpc('prompts/get', { name: 'weekly-show-digest', arguments: { shows: 'Lex Fridman Podcast' } }));
    assert.match(digest, /Read each new episode's transcript with Arcmira/);
    assert.doesNotMatch(digest, /can't read those dates|Pro\+/);
  });

  it('with no names, the message asks for them first; the roundup needs none', async () => {
    const bare = textOf(await rpc('prompts/get', { name: 'weekly-person-tracker', arguments: {} }));
    assert.match(bare, /\(none given\)\. If none are given/);
    assert.match(bare, /find what \{names\} said/);
    const roundup = textOf(await rpc('prompts/get', { name: 'weekly-monitor-roundup', arguments: {} }));
    assert.doesNotMatch(roundup, /none given|Slack connector/);
    const slack = textOf(await rpc('prompts/get', { name: 'weekly-monitor-roundup', arguments: { slack_channel: '#market-intel' } }));
    assert.match(slack, /Post the roundup to #market-intel with my Slack connector\./);
  });

  it('tools/list is unchanged and no tool text mentions scheduling', async () => {
    const reply = await rpc('tools/list');
    const tools = reply.result.tools as Array<{ name: string; description: string }>;
    assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort());
    for (const t of tools) assert.doesNotMatch(t.description, /schedul|weekly job|routine/i, t.name);
  });

  it('names no plan tier and uses straight apostrophes', async () => {
    for (const job of WEEKLY_JOBS) {
      const text = textOf(await rpc('prompts/get', { name: job.name, arguments: { [job.arg.name]: 'Ramp' } }));
      for (const s of [text, job.title, job.description, job.arg.description]) {
        assert.doesNotMatch(s, /\bPro\b|Pro\+|Enterprise|\u2019|\u2018|\u201c|\u201d/, job.name);
      }
    }
  });

  it('/mcp/apps lists no prompts', async () => {
    const reply = await rpc('prompts/list', {}, '/mcp/apps');
    assert.equal(reply.result?.prompts?.length ?? 0, 0, JSON.stringify(reply));
  });
});
