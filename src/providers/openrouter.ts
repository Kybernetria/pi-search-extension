/**
 * OpenRouter provider for polite_search (tertiary fallback, pay-per-token).
 */

import { fetchWithRetry } from "./rate-limiter.js";

export async function searchPoliteOpenRouter(query: string, _depth: string): Promise<string | null> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) return null; // not configured

	console.warn("[polite_search] Using OpenRouter/Perplexity — pay-per-token, use sparingly");

	const model = "perplexity/sonar";
	const resp = await fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			"HTTP-Referer": "pi-bakery",
			"X-Title": "pi-bakery",
		},
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: query }],
			stream: false,
		}),
	});
	if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`);

	const data = (await resp.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};

	const content = data.choices?.[0]?.message?.content ?? "No answer available.";
	return content;
}
