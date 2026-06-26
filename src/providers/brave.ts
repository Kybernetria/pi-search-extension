/**
 * Brave search provider.
 */

import { createRateLimiter, fetchWithRetry } from "./rate-limiter.js";
import type { SearchResult } from "./types.js";

const braveRateLimiter = createRateLimiter(120); // 120 req/min (conservative)

export async function searchBrave(
	query: string,
	opts: { maxResults: number; includeDomains?: string[]; excludeDomains?: string[] },
): Promise<SearchResult[]> {
	const apiKey = process.env.BRAVE_API_KEY;
	if (!apiKey) throw new Error("BRAVE_API_KEY not set");
	await braveRateLimiter();

	let q = query;
	if (opts.includeDomains?.length) {
		q = `${q} (${opts.includeDomains.map(d => `site:${d}`).join(" OR ")})`;
	}
	if (opts.excludeDomains?.length) {
		q = `${q} ${opts.excludeDomains.map(d => `-site:${d}`).join(" ")}`;
	}

	const params = new URLSearchParams({ q, count: Math.min(opts.maxResults, 20).toString() });
	const resp = await fetchWithRetry(`https://api.search.brave.com/res/v1/web/search?${params}`, {
		headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
	});
	if (!resp.ok) throw new Error(`Brave ${resp.status}: ${await resp.text()}`);

	const data = (await resp.json()) as {
		web?: { results?: Array<{ title: string; url: string; description: string; age?: string }> };
	};
	return (data.web?.results ?? []).map(r => ({
		title: r.title,
		url: r.url,
		snippet: r.description,
		source: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } })(),
		publishedDate: r.age,
	}));
}
