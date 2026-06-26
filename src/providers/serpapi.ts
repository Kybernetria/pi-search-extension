/**
 * SerpAPI search provider.
 */

import { createRateLimiter, fetchWithRetry } from "./rate-limiter.js";
import type { SearchResult } from "./types.js";

const serpapiRateLimiter = createRateLimiter(10); // very conservative: 100/month free

export async function searchSerpApi(
	query: string,
	opts: { maxResults: number; includeDomains?: string[]; excludeDomains?: string[] },
): Promise<SearchResult[]> {
	const apiKey = process.env.SERPAPI_API_KEY;
	if (!apiKey) throw new Error("SERPAPI_API_KEY not set");
	await serpapiRateLimiter();

	let q = query;
	if (opts.includeDomains?.length) {
		q = `(${opts.includeDomains.map(d => `site:${d}`).join(" OR ")}) ${q}`;
	}
	if (opts.excludeDomains?.length) {
		q = `${q} ${opts.excludeDomains.map(d => `-site:${d}`).join(" ")}`;
	}

	const params = new URLSearchParams({
		q,
		engine: "google",
		num: Math.min(opts.maxResults, 10).toString(),
		api_key: apiKey,
	});

	const resp = await fetchWithRetry(`https://serpapi.com/search.json?${params}`);
	if (!resp.ok) throw new Error(`SerpAPI ${resp.status}: ${await resp.text()}`);

	const data = (await resp.json()) as {
		organic_results?: Array<{ title?: string; link?: string; snippet?: string; date?: string; position?: number }>;
	};
	return (data.organic_results ?? []).slice(0, opts.maxResults).map((r, i) => ({
		title: r.title ?? "Untitled",
		url: r.link ?? "",
		snippet: r.snippet ?? "",
		source: r.link ? (() => { try { return new URL(r.link!).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "",
		publishedDate: r.date,
		relevanceScore: 1.0 / (r.position ?? i + 1),
	}));
}
