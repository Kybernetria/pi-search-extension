/**
 * Tavily search provider.
 */

import { createRateLimiter, fetchWithRetry } from "./rate-limiter.js";
import type { SearchResult } from "./types.js";

const tavilyRateLimiter = createRateLimiter(60); // conservative within 1k/month

export async function searchTavily(
	query: string,
	opts: { maxResults: number; searchDepth: string; includeDomains?: string[]; excludeDomains?: string[] },
): Promise<SearchResult[]> {
	const apiKey = process.env.TAVILY_API_KEY;
	if (!apiKey) throw new Error("TAVILY_API_KEY not set");
	await tavilyRateLimiter();

	const body: Record<string, unknown> = {
		query,
		max_results: opts.maxResults,
		search_depth: opts.searchDepth,
		include_answer: false,
	};
	if (opts.includeDomains?.length) body.include_domains = opts.includeDomains;
	if (opts.excludeDomains?.length) body.exclude_domains = opts.excludeDomains;

	const resp = await fetchWithRetry("https://api.tavily.com/search", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify(body),
	});
	if (!resp.ok) throw new Error(`Tavily ${resp.status}: ${await resp.text()}`);

	const data = (await resp.json()) as {
		results: Array<{ title: string; url: string; content: string; score?: number; published_date?: string }>;
	};
	return data.results.map(r => ({
		title: r.title,
		url: r.url,
		snippet: r.content,
		source: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } })(),
		publishedDate: r.published_date,
		relevanceScore: r.score,
	}));
}
