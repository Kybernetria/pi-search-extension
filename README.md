# pi-search-extension

Minimal private-first web access for Pi agents.

## Provides/tools

- `web_search` — simple web search using `SEARXNG_URL` first, optional `BRAVE_API_KEY` fallback.
- `fetch_content` — local-first URL/PDF extraction using direct fetch, Readability, and `unpdf`. Full content is cached locally.
- `get_cached_content` — retrieve cached full content by `id` or `url` with offset/length slicing.

Archived/non-MVP capabilities are in `archive/` and are not registered: polite/answer search, Exa code search, deep-research workflow/checkpoints, provider cascades, GitHub/YouTube special handling.

## Privacy defaults

No Exa, OpenAI, Perplexity, Gemini, Tavily, or Jina calls are made by default.

Configure one search backend:

```bash
# Preferred private-ish local metasearch
export SEARXNG_URL=http://localhost:8080

# Optional simpler API fallback
export BRAVE_API_KEY=...
```

Jina Reader is disabled unless explicitly enabled:

```bash
export JINA_ENABLED=true
```

Cache location defaults to `./.pi-search-cache`; override with:

```bash
export PI_SEARCH_CACHE_DIR=/path/to/cache
```

## Quick local SearXNG

```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng:latest
export SEARXNG_URL=http://localhost:8080
```

## Install/test

```bash
pi install /absolute/path/to/pi-search-extension
# or
pi -e /absolute/path/to/pi-search-extension/extension.ts
```
