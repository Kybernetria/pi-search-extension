# pi-search-extension

A standalone Pi extension that gives agents responsible internet access: web search, polite citation-based search, page extraction, code/docs search, and a structured deep-research workflow.

## Tools

- `web_search` — search the web with Tavily → Exa → Brave → SerpAPI fallback.
- `polite_search` — rate-limited synthesized answers with citations via Perplexity → Exa answer → OpenRouter → local greedy search.
- `web_extract` — extract clean markdown from a web page or PDF URL.
- `fetch_content` — advanced extraction with method and quality details.
- `code_search` — search code examples, API docs, GitHub/examples, and debugging sources.
- `research_checkpoint` — progress gate for deep research workflows.

Deep research is exposed as the `/deep-research` extension command and as a `deep_research` protocol provide. The workflow prompt/reference files are bundled, but they are not registered as a Pi skill, so no skill-command is created.

## pi-protocol

This repository includes a root `pi.protocol.json` manifest (`protocolVersion: "0.2.0"`) and handler-backed provides for:

- `web_search`
- `polite_search`
- `web_extract`
- `fetch_content`
- `code_search`
- `research_checkpoint`
- `deep_research` — returns the deep-research workflow prompt for protocol callers

When `@kyvernitria/pi-protocol-minimal` is available, `extension.ts` registers the manifest with the shared fabric via `ensureProtocolFabric()`/`registerProtocolManifest()`. The dependency is optional so the extension still loads as a standalone Pi package without protocol installed. Programmatic users can also import `createHandlers` from `pi-search-extension/protocol/handlers`.

## Install / load

From a Pi project:

```bash
pi install /absolute/path/to/pi-search-extension
```

For quick testing:

```bash
pi -e /absolute/path/to/pi-search-extension/extension.ts
```

## Environment variables

Configure any providers you want. Missing keys are skipped gracefully; no single key is required for the extension to load.

```bash
export TAVILY_API_KEY=...
export EXA_API_KEY=...
export BRAVE_API_KEY=...
export SERPAPI_API_KEY=...
export PERPLEXITY_API_KEY=...
export OPENROUTER_API_KEY=...
```

Provider behavior is unchanged for Pi tools and protocol handlers:

- `web_search`: `TAVILY_API_KEY` → `EXA_API_KEY` → `BRAVE_API_KEY` → `SERPAPI_API_KEY`
- `polite_search`: `PERPLEXITY_API_KEY` → `EXA_API_KEY` → `OPENROUTER_API_KEY` → local greedy search if installed
- `code_search`: currently requires `EXA_API_KEY`

Missing providers degrade gracefully: unconfigured providers are skipped and user-facing error output explains what to configure.

## Deep research command

Use `/deep-research <topic>` to start the structured multi-round research workflow. It asks the agent to plan, search, extract promising sources, call `research_checkpoint` after each round, and save a Markdown report when ready.

The package intentionally does **not** register the workflow as a Pi skill, so it will not appear as a skill-command.

## Development

```bash
npm install
npm run typecheck
```
