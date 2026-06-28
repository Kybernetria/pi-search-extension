/**
 * Perplexity provider for polite_search (sonar / sonar-deep-research).
 */

import { createRateLimiter, fetchWithRetry } from "./rate-limiter.js";

const perplexityRateLimiter = createRateLimiter(8); // conservative within free tier 10/min

export async function searchPolitePerplexity(query: string, depth: string): Promise<string | null> {
	const apiKey = process.env.PERPLEXITY_API_KEY;
	if (!apiKey) return null; // not configured, not an error

	await perplexityRateLimiter();

	const model = depth === "deep" ? "sonar-deep-research" : "sonar";
	const resp = await fetchWithRetry("https://api.perplexity.ai/chat/completions", {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: query }],
			stream: false,
		}),
	});
	if (!resp.ok) throw new Error(`Perplexity ${resp.status}: ${await resp.text()}`);

	const data = (await resp.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
		citations?: string[];
	};

	const content = data.choices?.[0]?.message?.content ?? "No answer available.";
	const citations = data.citations ?? [];

	let result = content;
	if (citations.length > 0) {
		result += `\n\n**Sources:**\n`;
		for (let i = 0; i < citations.length; i++) {
			result += `${i + 1}. ${citations[i]}\n`;
		}
	}

	return result;
}
