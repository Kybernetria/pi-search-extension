/**
 * greedy_search subprocess provider for polite_search.
 *
 * Calls @apmantza/greedysearch-pi (installed locally in .pi/npm/) as a
 * zero-API-key fallback. Requires a running Chrome instance; returns null
 * gracefully when Chrome is unavailable or the package is not installed.
 *
 * Invariant: query is user/LLM-controlled — MUST use argument array, never
 * template-literal interpolation into a shell string (see AUDIT.md invariant).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { sanitizeForJsonParse } from "./json-sanitize.js";

export function searchPoliteGreedy(query: string, binaryPath: string): string | null {
	if (!existsSync(binaryPath)) return null; // not installed locally

	try {
		const result = spawnSync(
			"node",
			[binaryPath, "perplexity", query, "--inline", "--fast"],
			{ encoding: "utf8", timeout: 45_000, env: process.env },
		);

		if (result.status !== 0 || !result.stdout?.trim()) return null;

		const data = JSON.parse(sanitizeForJsonParse(result.stdout)) as {
			answer?: string;
			sources?: Array<{ url?: string; title?: string }>;
		};

		const answer = data.answer;
		if (!answer) return null;

		let out = answer;
		const sources = data.sources ?? [];
		if (sources.length > 0) {
			out += "\n\n**Sources:**\n";
			for (let i = 0; i < Math.min(sources.length, 5); i++) {
				const s = sources[i];
				out += `${i + 1}. ${s.title ?? "Untitled"} — ${s.url ?? ""}\n`;
			}
		}
		return out;
	} catch {
		// Chrome not running, CAPTCHA, parse error — skip silently
		return null;
	}
}
