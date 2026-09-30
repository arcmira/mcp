# Arcmira plugin

Arcmira is the search engine for the spoken web. This plugin connects your coding agent to indexed YouTube and podcast transcripts, and to a catalog of who is mentioned on which show, who sponsors whom, and who recommends what on air.

## What it bundles

- The remote Arcmira MCP server at `https://mcp.arcmira.com/mcp`. It exposes two tools: `describe` returns the client reference, and `execute` runs a JavaScript program against the `arcmira` client. The host signs you in through OAuth on first use.
- The `arcmira` skill, which teaches the agent to resolve names to ids, run one program per question, and cite the date the index runs through.
- Five task skills, each with a worked program and the bar for a good answer: `sponsor-research`, `company-watch`, `find-quotes`, `person-research`, `compare-shows`. Each starts from the names you give and says which entity it used.

The plugin runs no local code. The agent sends your questions, as JavaScript programs, to `mcp.arcmira.com`, which reads the Arcmira API on your account.

## Install

Claude Code:

```sh
claude plugin marketplace add arcmira/mcp
claude plugin install arcmira@arcmira
```

Codex:

```sh
codex plugin marketplace add arcmira/mcp
```

Then open `/plugins` and install Arcmira.

Cursor: install Arcmira from the Cursor Marketplace. The repo root carries `.cursor-plugin/marketplace.json` for team marketplaces.

Gemini CLI: copy this folder to `~/.gemini/extensions/arcmira/`. Gemini reads `gemini-extension.json` and loads the skill as context.

Skills only, for any agent that reads `.agents/skills`:

```sh
npx skills add arcmira/mcp
```

## Keep it updated

Arcmira ships changes weekly. The MCP server is remote and always current; the skills in this plugin are files on your machine, so turn auto-update on.

- Claude Code: run `/plugin`, open **Marketplaces**, pick `arcmira`, and choose **Enable auto-update** (off by default for third-party marketplaces). Update now: `claude plugin update arcmira@arcmira`.
- Codex: `codex plugin marketplace upgrade arcmira`.
- Skills from `npx skills add arcmira/mcp`: `npx skills update`.

## Example prompts

- What did TBPN say about stablecoins in the last 90 days?
- Which sponsors do All-In Podcast and TBPN share?
- Is talk about Linear accelerating or fading on podcasts?
- Which shows has Mercury sponsored in the last 90 days?
- I'm interviewing Sam Altman next week. What has he said recently, and where?

Docs: https://arcmira.com/docs/mcp-server. Issues: https://github.com/arcmira/mcp/issues.

## License

Apache-2.0. See `LICENSE`.
