/**
 * Exa search provider. Includes both web_search (search/answer endpoints)
 * and polite_search (/answer with richer citation detail) entry points.
 */

import { createRateLimiter, fetchWithRetry } from "./rate-limiter.js";
import type { SearchResult } from "./types.js";

/** Rate limiter shared between web_search Exa and code_search. */
export const exaRateLimiter = createRateLimiter(30); // conservative within 1k/month

/** Separate rate limiter for polite_search Exa slot (different call budget). */
const politeExaRateLimiter = createRateLimiter(15);

export async function searchExa(
	query: string,
	opts: { maxResults: number; includeDomains?: string[]; excludeDomains?: string[] },
): Promise<SearchResult[]> {
	const apiKey = process.env.EXA_API_KEY;
	if (!apiKey) throw new Error("EXA_API_KEY not set");
	await exaRateLimiter();

	// Use /answer for simple queries (faster, returns synthesized answer + citations).
	// Fall back to /search if domain filters are needed.
	const useSearch = !!(opts.includeDomains?.length || opts.excludeDomains?.length || opts.maxResults !== 5);

	if (!useSearch) {
		const resp = await fetchWithRetry("https://api.exa.ai/answer", {
			method: "POST",
			headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
			body: JSON.stringify({ query, text: true }),
		});
		if (!resp.ok) throw new Error(`Exa answer ${resp.status}: ${await resp.text()}`);

		const data = (await resp.json()) as {
			answer?: string;
			citations?: Array<{ url?: string; title?: string; publishedDate?: string }>;
		};
		const snippet = data.answer ?? "";
		return (data.citations ?? []).slice(0, opts.maxResults).map((c, i) => ({
			title: c.title ?? `Source ${i + 1}`,
			url: c.url ?? "",
			snippet: i === 0 ? snippet.slice(0, 600) : "",
			source: c.url ? (() => { try { return new URL(c.url!).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "",
			publishedDate: c.publishedDate,
		}));
	}

	const body: Record<string, unknown> = {
		query,
		type: "auto",
		numResults: opts.maxResults,
		contents: { text: { maxCharacters: 3000 }, highlights: true },
	};
	if (opts.includeDomains?.length) body.includeDomains = opts.includeDomains;
	if (opts.excludeDomains?.length) body.excludeDomains = opts.excludeDomains;

	const resp = await fetchWithRetry("https://api.exa.ai/search", {
		method: "POST",
		headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!resp.ok) throw new Error(`Exa search ${resp.status}: ${await resp.text()}`);

	const data = (await resp.json()) as {
		results?: Array<{ title?: string; url?: string; text?: string; publishedDate?: string }>;
	};
	return (data.results ?? []).map((r, i) => ({
		title: r.title ?? `Result ${i + 1}`,
		url: r.url ?? "",
		snippet: (r.text ?? "").slice(0, 600),
		source: r.url ? (() => { try { return new URL(r.url!).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "",
		publishedDate: r.publishedDate,
	}));
}

/** polite_search Exa slot: /answer with depth-based citation detail. */
export async function searchPoliteExa(query: string, depth: string): Promise<string> {
	const apiKey = process.env.EXA_API_KEY;
	if (!apiKey) throw new Error("EXA_API_KEY not set");

	await politeExaRateLimiter();

	const resp = await fetchWithRetry("https://api.exa.ai/answer", {
		method: "POST",
		headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
		body: JSON.stringify({ query, text: true }),
	});
	if (!resp.ok) throw new Error(`Exa answer ${resp.status}: ${await resp.text()}`);

	const data = (await resp.json()) as {
		answer?: string;
		citations?: Array<{ url?: string; title?: string; snippet?: string; publishedDate?: string }>;
	};

	const answer = data.answer ?? "No answer available.";
	const citations = data.citations ?? [];

	// Depth-based citation detail
	const maxCitations = depth === "fast" ? 3 : depth === "standard" ? 5 : 8;
	const topCitations = citations.slice(0, maxCitations);

	let result = `${answer}\n\n**Sources:**\n`;
	for (let i = 0; i < topCitations.length; i++) {
		const c = topCitations[i];
		result += `${i + 1}. **${c.title ?? "Untitled"}**\n   ${c.url ?? ""}\n`;
		if (depth === "standard" || depth === "deep") {
			if (c.snippet) result += `   ${c.snippet}\n`;
		}
		if (depth === "deep" && c.publishedDate) {
			result += `   Published: ${c.publishedDate}\n`;
		}
		result += "\n";
	}

	if (depth === "deep" && citations.length > maxCitations) {
		result += `\n*Plus ${citations.length - maxCitations} additional sources not shown.*\n`;
		result += `\n**Suggested follow-up queries:**\n- ${query} latest developments\n- ${query} expert analysis\n- ${query} case studies\n`;
	}

	return result;
}
