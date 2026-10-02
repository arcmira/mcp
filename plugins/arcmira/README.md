# Arcmira: YouTube Transcript Search

Give your AI the ability to find who said what with timestamps, discover what’s being discussed across videos and livestreams, and distinguish organic recommendations from sponsored ad reads.

Arcmira is the search engine for the spoken web. This plugin connects your coding agent to indexed YouTube and podcast transcripts, and to a catalog of who is mentioned on which show, who sponsors whom, and who recommends what on air.

## What it bundles

- The remote Arcmira MCP server at `https://mcp.arcmira.com/mcp`. It exposes four tools: `arcmira_describe` returns the client reference, `arcmira_execute_read` runs JavaScript that reads (and prepares Premium transcripts within the account's on-demand budget), `arcmira_execute_write` saves what you follow to your monitors, and `arcmira_feedback` tells Arcmira what went wrong. The host signs you in through OAuth on first use.
- The `arcmira` skill, which teaches the agent to resolve names to ids, run one program per question, and cite the date the index runs through.
- Five task skills, each with a worked program and the bar for a good answer: `sponsor-research`, `company-watch` (sets up a monitor), `find-quotes`, `person-research`, `compare-shows`. Each starts from the names you give, says which entity it used, and offers to save what it found to a monitor.

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

Cursor: the marketplace application is awaiting review. The repo root carries `.cursor-plugin/marketplace.json` for team marketplaces.

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
- Keep me posted on data center discourse, as a daily email.

## Help improve the skills

[Share plugin feedback](https://github.com/arcmira/mcp/issues/new?template=plugin-feedback.yml) with your host, plugin version, and what you expected versus what happened. Use a public or redacted example. For private support, [contact Arcmira](https://arcmira.com/contact).

The skills are versioned files. Updates reach installed copies through your host's update mechanism; directory releases may also require review. Maintainers edit `src/reference.ts` and `src/skills.ts`, run `pnpm skill:build`, check the generated files, and release a new version. Please include the version when reporting feedback so we can reproduce it.

[Documentation](https://arcmira.com/docs/mcp-server) · [Support](https://arcmira.com/contact) · [Privacy](https://arcmira.com/privacy) · [Terms](https://arcmira.com/terms)

Coverage depends on the index and your account access. Speaker attribution and sponsorship classifications can be incomplete or incorrect; inspect cited passages and surrounding context.

## License

Apache-2.0. See `LICENSE`.
