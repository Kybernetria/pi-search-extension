import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchContent } from "./content/extractor.js";
import { getCachedContent, putCachedContent, sliceContent } from "./cache.js";

export interface SearchOptions {}

type SearchResult = { title: string; url: string; snippet?: string; publishedDate?: string; score?: number };

function truncate(text: string | undefined, max = 160): string | undefined {
	if (!text) return undefined;
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function roundScore(score: number | undefined): number | undefined {
	return score === undefined ? undefined : Math.round(score * 100) / 100;
}

function compactResults(results: SearchResult[]): SearchResult[] {
	return results.map(r => ({
		title: r.title,
		url: r.url,
		snippet: truncate(r.snippet),
		publishedDate: r.publishedDate,
		score: roundScore(r.score),
	}));
}

function formatSearchSummary(searches: Array<{ provider: string; results: SearchResult[] }>): string {
	const lines = [`Search complete (${searches.map(s => s.provider).join(", ")}).`];
	for (const search of searches) {
		search.results.forEach((r, i) => {
			if (i > 0 || lines.length > 1) lines.push("");
			lines.push(`${i + 1}. ${r.title}`);
			lines.push(`   ${r.url}`);
		});
	}
	return lines.join("\n");
}

function formatFetchSummary(args: { id: string; url: string; title?: string; method?: string; quality?: number; fullLength: number; cached?: boolean; preview: string }): string {
	return [
		args.cached ? "Cached content found." : "Content fetched and cached.",
		`ID: ${args.id}`,
		`URL: ${args.url}`,
		args.title ? `Title: ${args.title}` : undefined,
		args.method ? `Method: ${args.method}` : undefined,
		args.quality !== undefined ? `Quality: ${args.quality}` : undefined,
		`Full length: ${args.fullLength} chars`,
		"",
		"Preview:",
		args.preview,
	].filter(Boolean).join("\n");
}

async function searchSearxng(query: string, maxResults: number): Promise<SearchResult[]> {
	const base = process.env.SEARXNG_URL || "http://127.0.0.1:8888";
	const url = new URL("/search", base);
	url.searchParams.set("q", query);
	url.searchParams.set("format", "json");
	url.searchParams.set("language", "en");
	const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
	const data = await res.json() as { results?: Array<any> };
	return (data.results ?? []).slice(0, maxResults).map(r => ({
		title: String(r.title ?? r.url ?? "Untitled"),
		url: String(r.url),
		snippet: r.content ? String(r.content) : undefined,
		publishedDate: r.publishedDate ? String(r.publishedDate) : undefined,
		score: typeof r.score === "number" ? r.score : undefined,
	})).filter(r => r.url);
}

async function searchBrave(query: string, maxResults: number): Promise<SearchResult[]> {
	const key = process.env.BRAVE_API_KEY;
	if (!key) throw new Error("BRAVE_API_KEY is not configured");
	const url = new URL("https://api.search.brave.com/res/v1/web/search");
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(Math.min(maxResults, 20)));
	const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": key }, signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
	const data = await res.json() as { web?: { results?: Array<any> } };
	return (data.web?.results ?? []).map(r => ({
		title: String(r.title ?? r.url ?? "Untitled"),
		url: String(r.url),
		snippet: r.description ? String(r.description) : undefined,
		publishedDate: r.age ? String(r.age) : undefined,
	}));
}

async function doSearch(query: string, maxResults: number, provider?: string): Promise<{ provider: string; results: SearchResult[] }> {
	const providers = provider ? [provider] : ["searxng", process.env.BRAVE_API_KEY ? "brave" : undefined].filter(Boolean) as string[];
	const errors: string[] = [];
	for (const p of providers) {
		try {
			if (p === "searxng") return { provider: p, results: await searchSearxng(query, maxResults) };
			if (p === "brave") return { provider: p, results: await searchBrave(query, maxResults) };
			throw new Error(`Unknown provider '${p}'`);
		} catch (err) { errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`); }
	}
	throw new Error(`All providers failed: ${errors.join("; ")}`);
}

export function registerWebSearchTools(pi: ExtensionAPI, _options?: SearchOptions): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Minimal web search. Private/local-first via SEARXNG_URL, optional Brave fallback via BRAVE_API_KEY.",
		parameters: Type.Object({
			query: Type.Optional(Type.String()),
			queries: Type.Optional(Type.Array(Type.String(), { maxItems: 5 })),
			max_results: Type.Optional(Type.Number({ default: 5, maximum: 20 })),
			provider: Type.Optional(Type.String({ description: '"searxng" or "brave"' })),
		}),
		async execute(_id, params): Promise<any> {
			const max = Math.min(params.max_results ?? 5, 20);
			const queries = params.queries?.length ? params.queries : params.query ? [params.query] : [];
			if (!queries.length) return { isError: true, details: { ok: false }, content: [{ type: "text", text: "Provide query or queries." }] };
			try {
				const batches = await Promise.all(queries.map(q => doSearch(q, max, params.provider)));
				const compact = batches.map(b => ({ provider: b.provider, results: compactResults(b.results) }));
				const data = { ok: true, searches: compact };
				return { details: data, content: [{ type: "text", text: formatSearchSummary(compact) }] };
			} catch (err) {
				return { isError: true, details: { ok: false }, content: [{ type: "text", text: `web_search failed: ${err instanceof Error ? err.message : String(err)}` }] };
			}
		},
	});

	pi.registerTool({
		name: "fetch_content",
		label: "Fetch Content",
		description: "Fetch and locally extract URL/PDF content. Jina fallback is disabled unless JINA_ENABLED=true or force_jina=true. Full content is cached locally.",
		parameters: Type.Object({
			url: Type.String(),
			quality_threshold: Type.Optional(Type.Number({ default: 50 })),
			force_jina: Type.Optional(Type.Boolean({ default: false })),
			max_chars: Type.Optional(Type.Number({ default: 12000 })),
		}),
		async execute(_id, params): Promise<any> {
			try {
				const existing = getCachedContent({ url: params.url });
				if (existing) {
					const s = sliceContent(existing.content, 0, params.max_chars ?? 12000);
					const data = { ok: true, cached: true, id: existing.id, url: existing.url, title: existing.title, preview: s.text, full_length: s.fullLength };
					return { details: data, content: [{ type: "text", text: formatFetchSummary({ id: existing.id, url: existing.url, title: existing.title, fullLength: s.fullLength, cached: true, preview: s.text }) }] };
				}
				const result = await fetchContent(params.url, { qualityThreshold: params.quality_threshold ?? 50, forceJina: !!params.force_jina });
				const rec = putCachedContent({ url: params.url, title: result.title, content: result.content, method: result.method, quality: result.quality, wordCount: result.wordCount });
				const s = sliceContent(rec.content, 0, params.max_chars ?? 12000);
				const data = { ok: true, cached: false, id: rec.id, url: rec.url, title: rec.title, method: result.method, quality: result.quality, preview: s.text, full_length: s.fullLength };
				return { details: data, content: [{ type: "text", text: formatFetchSummary({ id: rec.id, url: rec.url, title: rec.title, method: result.method, quality: result.quality, fullLength: s.fullLength, preview: s.text }) }] };
			} catch (err) {
				return { isError: true, details: { ok: false }, content: [{ type: "text", text: `fetch_content failed: ${err instanceof Error ? err.message : String(err)}` }] };
			}
		},
	});

	pi.registerTool({
		name: "get_cached_content",
		label: "Get Cached Content",
		description: "Retrieve locally cached full content by id or URL, with offset/length slicing.",
		parameters: Type.Object({
			id: Type.Optional(Type.String()),
			url: Type.Optional(Type.String()),
			start: Type.Optional(Type.Number({ default: 0 })),
			max_chars: Type.Optional(Type.Number({ default: 20000 })),
		}),
		async execute(_id, params): Promise<any> {
			const rec = getCachedContent({ id: params.id, url: params.url });
			if (!rec) return { isError: true, details: { ok: false }, content: [{ type: "text", text: "No cached content found for id/url." }] };
			const s = sliceContent(rec.content, params.start ?? 0, params.max_chars ?? 20000);
			const data = { ok: true, id: rec.id, url: rec.url, title: rec.title, start: s.start, end: s.end, full_length: s.fullLength, content: s.text };
			return { details: data, content: [{ type: "text", text: s.text }] };
		},
	});
}
