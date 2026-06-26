/**
 * Pi Search Extension tool registrations.
 *
 * Canonical home for the 6 web search tools:
 *   web_search, polite_search, web_extract, fetch_content, code_search, research_checkpoint
 *
 * Fork lineage: pi-deep-research v0.1.6.
 *
 * Changes from upstream:
 *  - web_search:      Multi-provider cascade with adaptive fallback:
 *                     Tavily → Exa → Brave → SerpAPI
 *                     Skips any provider not configured (no key = skip, not error).
 *  - polite_search:   Rate-limited alternative to greedy_search. Cascade:
 *                     Perplexity API → Exa /answer → OpenRouter → greedy_search subprocess.
 *  - web_extract:     Retained as-is from upstream.
 *  - research_checkpoint: Retained as-is from upstream.
 *
 * Env vars:
 *   TAVILY_API_KEY     — Tavily (1,000 req/month free)
 *   EXA_API_KEY        — Exa answer/search API (1,000 req/month free tier)
 *   BRAVE_API_KEY      — Brave Search (2,000 req/month free)
 *   SERPAPI_API_KEY    — SerpAPI / Google (100 req/month free)
 *   PERPLEXITY_API_KEY — polite_search primary provider
 *   OPENROUTER_API_KEY — polite_search tertiary fallback (pay-per-token)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildCodeSearchQuery,
	extractDomain,
	formatCodeSearchReport,
	normalizeCodeSearchRequest,
} from "./code-search/helpers.js";
import { fetchContent } from "./content/extractor.js";
import { searchBrave } from "./providers/brave.js";
import { exaRateLimiter, searchExa, searchPoliteExa } from "./providers/exa.js";
import { searchPoliteGreedy } from "./providers/greedy.js";
import { searchPoliteOpenRouter } from "./providers/openrouter.js";
import { searchPolitePerplexity } from "./providers/perplexity.js";
import { fetchWithRetry } from "./providers/rate-limiter.js";
import { searchSerpApi } from "./providers/serpapi.js";
import { searchTavily } from "./providers/tavily.js";
import type { ProviderName, SearchProviderResult, SearchResult } from "./providers/types.js";

// ─── Public options ───────────────────────────────────────────────────────

export interface SearchOptions {
	/**
	 * Project root for greedy_search subprocess binary path resolution.
	 * Default: process.cwd()
	 */
	projectRoot?: string;
	/**
	 * Override for greedy_search binary path. Defaults to
	 * {projectRoot}/.pi/npm/node_modules/@apmantza/greedysearch-pi/bin/search.mjs
	 */
	greedySearchBin?: string;
	/**
	 * Optional usage tracking callback, invoked after each successful
	 * polite_search provider call. Fire-and-forget; exceptions are swallowed
	 * by the caller. Used by the app-layer shim to wire MPROV provider_usage_state.
	 */
	trackUsage?: (provider: string) => void;
}

// ─── Provider cascade ─────────────────────────────────────────────────────

const PROVIDERS: Array<{ name: ProviderName; isConfigured: () => boolean; fn: (q: string, o: any) => Promise<SearchResult[]> }> = [
	{ name: "tavily",  isConfigured: () => !!process.env.TAVILY_API_KEY,  fn: searchTavily },
	{ name: "exa",     isConfigured: () => !!process.env.EXA_API_KEY,     fn: searchExa    },
	{ name: "brave",   isConfigured: () => !!process.env.BRAVE_API_KEY,   fn: searchBrave  },
	{ name: "serpapi", isConfigured: () => !!process.env.SERPAPI_API_KEY, fn: searchSerpApi },
];

async function doSearch(
	query: string,
	opts: { maxResults: number; searchDepth: string; includeDomains?: string[]; excludeDomains?: string[]; forceProvider?: ProviderName },
): Promise<SearchProviderResult> {
	const candidates = opts.forceProvider
		? PROVIDERS.filter(p => p.name === opts.forceProvider)
		: PROVIDERS.filter(p => p.isConfigured());

	if (candidates.length === 0) {
		const configured = PROVIDERS.filter(p => p.isConfigured()).map(p => p.name);
		const msg = configured.length === 0
			? "No search provider configured. Set TAVILY_API_KEY, EXA_API_KEY, BRAVE_API_KEY, or SERPAPI_API_KEY."
			: `Provider '${opts.forceProvider}' not configured.`;
		throw new Error(msg);
	}

	const errors: string[] = [];
	for (const provider of candidates) {
		try {
			const results = await provider.fn(query, {
				maxResults: opts.maxResults,
				searchDepth: opts.searchDepth,
				includeDomains: opts.includeDomains,
				excludeDomains: opts.excludeDomains,
			});
			return { provider: provider.name, results };
		} catch (err) {
			errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	throw new Error(`All providers failed:\n${errors.join("\n")}`);
}

// ─── polite_search rate-limit state ────────────────────────────────────────

const politeCooldown = {
	lastCallAt: 0,
	callCount: 0,
	windowStart: 0,
};
const POLITE_COOLDOWN_MS = 3_000;   // 3s between calls
const POLITE_MAX_PER_MIN = 8;       // conservative: leave headroom vs provider limits

// ─── Extension entry point ────────────────────────────────────────────────

export function registerWebSearchTools(pi: ExtensionAPI, options?: SearchOptions): void {
	const projectRoot = options?.projectRoot ?? process.cwd();
	const greedySearchBin =
		options?.greedySearchBin ??
		join(projectRoot, ".pi/npm/node_modules/@apmantza/greedysearch-pi/bin/search.mjs");
	const trackUsage = options?.trackUsage;

	const safeTrack = (provider: string): void => {
		if (!trackUsage) return;
		try { trackUsage(provider); } catch { /* non-fatal */ }
	};

	// ── Tool: web_search ────────────────────────────────────────────────────
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: [
			"Search the web for information. Supports single query or batch queries (parallel).",
			"Returns ranked results with title, URL, snippet, and relevance score.",
			"Multi-provider with automatic fallback: Tavily → Exa → Brave → SerpAPI.",
			"Skips any provider not configured — set TAVILY_API_KEY, EXA_API_KEY, BRAVE_API_KEY, or SERPAPI_API_KEY.",
			"For extended research sessions use polite_search (when available) or greedy_search instead.",
		].join(" "),
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query" })),
			queries: Type.Optional(Type.Array(Type.String({ description: "Multiple queries to search in parallel (max 5)" }), { maxItems: 5 })),
			max_results: Type.Optional(Type.Number({ description: "Max results per query (default 5, max 10)", default: 5, maximum: 10 })),
			search_depth: Type.Optional(Type.String({ description: '"basic" for speed, "advanced" for thoroughness (Tavily only)', default: "basic" })),
			include_domains: Type.Optional(Type.Array(Type.String(), { description: "Only include results from these domains" })),
			exclude_domains: Type.Optional(Type.Array(Type.String(), { description: "Exclude results from these domains" })),
			provider: Type.Optional(Type.String({ description: 'Force a specific provider: "tavily" | "exa" | "brave" | "serpapi". Omit for auto-cascade.' })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const maxResults = Math.min(params.max_results ?? 5, 10);
			const searchDepth = params.search_depth ?? "basic";
			const forceProvider = params.provider as ProviderName | undefined;

			const formatResults = (provider: ProviderName, results: SearchResult[], queryLabel: string): string => {
				let text = `### "${queryLabel}" — ${results.length} results via ${provider}\n\n`;
				for (let i = 0; i < results.length; i++) {
					const r = results[i];
					text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n`;
					const meta: string[] = [];
					if (r.source) meta.push(`Source: ${r.source}`);
					if (r.relevanceScore !== undefined) meta.push(`Relevance: ${(r.relevanceScore * 100).toFixed(0)}%`);
					if (r.publishedDate) meta.push(`Date: ${r.publishedDate}`);
					if (meta.length) text += `   ${meta.join(" | ")}\n`;
					text += "\n";
				}
				return text;
			};

			// Batch mode
			if (params.queries && params.queries.length > 0) {
				const settled = await Promise.allSettled(
					params.queries.map(q => doSearch(q, { maxResults, searchDepth, includeDomains: params.include_domains, excludeDomains: params.exclude_domains, forceProvider })),
				);
				let text = `Searched ${params.queries.length} queries:\n\n`;
				for (let i = 0; i < params.queries.length; i++) {
					const s = settled[i];
					if (s.status === "fulfilled") {
						text += formatResults(s.value.provider, s.value.results, params.queries[i]);
					} else {
						text += `### "${params.queries[i]}" — ERROR\n${s.reason instanceof Error ? s.reason.message : String(s.reason)}\n\n`;
					}
				}
				return { details: {}, content: [{ type: "text", text }] };
			}

			// Single mode
			if (!params.query) {
				return { details: {}, content: [{ type: "text", text: "Error: provide `query` (string) or `queries` (array)." }], isError: true };
			}

			try {
				const { provider, results } = await doSearch(params.query, {
					maxResults, searchDepth,
					includeDomains: params.include_domains,
					excludeDomains: params.exclude_domains,
					forceProvider,
				});
				return { details: {}, content: [{ type: "text", text: formatResults(provider, results, params.query) }] };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { details: {}, content: [{ type: "text", text: `web_search failed: ${msg}` }], isError: true };
			}
		},
	});

	// ── Tool: polite_search ─────────────────────────────────────────────────
	pi.registerTool({
		name: "polite_search",
		label: "Polite Search",
		description: [
			"Rate-limited API-based search for extended research sessions. Designed as a CAPTCHA-safe alternative to browser automation.",
			"Cascade: Perplexity API → Exa /answer API → OpenRouter → greedy_search (local browser automation, requires Chrome).",
			"Built-in 3s cooldown and 8 calls/min cap. Returns synthesized answer with citations.",
			"For targeted structured queries use web_search instead.",
		].join(" "),
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			depth: Type.Optional(Type.String({ description: '"fast" | "standard" | "deep" — controls citation detail and follow-up suggestions', default: "standard" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const now = Date.now();

			// Reset window
			if (now - politeCooldown.windowStart >= 60_000) {
				politeCooldown.windowStart = now;
				politeCooldown.callCount = 0;
			}

			// Rate limit check
			if (politeCooldown.callCount >= POLITE_MAX_PER_MIN) {
				const resetIn = Math.ceil((politeCooldown.windowStart + 60_000 - now) / 1000);
				return {
					details: {},
					content: [{
						type: "text",
						text: `polite_search: rate limit reached (${POLITE_MAX_PER_MIN}/min). Try again in ${resetIn}s.\nFallback: use \`web_search\` for structured results.`,
					}],
					isError: true,
				};
			}

			// Cooldown check
			const timeSinceLast = now - politeCooldown.lastCallAt;
			if (politeCooldown.lastCallAt > 0 && timeSinceLast < POLITE_COOLDOWN_MS) {
				const waitMs = POLITE_COOLDOWN_MS - timeSinceLast;
				await new Promise(r => setTimeout(r, waitMs));
			}

			politeCooldown.lastCallAt = Date.now();
			politeCooldown.callCount += 1;

			// ── Provider cascade ────────────────────────────────────────────
			const depth = params.depth ?? "standard";
			const errors: string[] = [];
			let provider = "";
			let result = "";

			// Try Perplexity first
			try {
				const perplexityResult = await searchPolitePerplexity(params.query, depth);
				if (perplexityResult !== null) {
					provider = "Perplexity";
					result = perplexityResult;
					safeTrack("perplexity");
					return {
						details: {},
						content: [{
							type: "text",
							text: `**[polite_search via ${provider}]** depth: ${depth}\n\n${result}`,
						}],
					};
				}
				// null means PERPLEXITY_API_KEY not set, not an error — try next provider
			} catch (err) {
				errors.push(`Perplexity: ${err instanceof Error ? err.message : String(err)}`);
			}

			// Try Exa fallback
			try {
				result = await searchPoliteExa(params.query, depth);
				provider = "Exa";
				safeTrack("exa");
				return {
					details: {},
					content: [{
						type: "text",
						text: `**[polite_search via ${provider}]** depth: ${depth}\n\n${result}`,
					}],
				};
			} catch (err) {
				errors.push(`Exa: ${err instanceof Error ? err.message : String(err)}`);
			}

			// Try OpenRouter tertiary fallback
			try {
				const openRouterResult = await searchPoliteOpenRouter(params.query, depth);
				if (openRouterResult !== null) {
					provider = "OpenRouter/Perplexity";
					result = openRouterResult;
					return {
						details: {},
						content: [{
							type: "text",
							text: `**[polite_search via ${provider}]** depth: ${depth}\n\n${result}`,
						}],
					};
				}
				// null means OPENROUTER_API_KEY not set
			} catch (err) {
				errors.push(`OpenRouter: ${err instanceof Error ? err.message : String(err)}`);
			}

			// Try greedy_search (local browser automation) as last-resort zero-API-key fallback
			try {
				const greedyResult = searchPoliteGreedy(params.query, greedySearchBin);
				if (greedyResult !== null) {
					provider = "greedy_search (local browser)";
					return {
						details: {},
						content: [{
							type: "text",
							text: `**[polite_search via ${provider}]** depth: ${depth}\n\n${greedyResult}`,
						}],
					};
				}
				// null = not installed locally or Chrome not running
			} catch (err) {
				errors.push(`greedy_search: ${err instanceof Error ? err.message : String(err)}`);
			}

			// All providers failed or unavailable
			const localBinExists = existsSync(greedySearchBin);
			const configured: string[] = [];
			if (process.env.PERPLEXITY_API_KEY) configured.push("PERPLEXITY_API_KEY");
			if (process.env.EXA_API_KEY) configured.push("EXA_API_KEY");
			if (process.env.OPENROUTER_API_KEY) configured.push("OPENROUTER_API_KEY");
			if (localBinExists) configured.push("greedy_search (local, Chrome not running?)");

			let errorMsg = `polite_search failed: No providers available.\n\n`;
			if (configured.length === 0) {
				errorMsg += "**No providers configured.** Set one of: PERPLEXITY_API_KEY, EXA_API_KEY, OPENROUTER_API_KEY — or ensure Chrome is running for the local browser fallback.\n";
			} else {
				errorMsg += `**Tried:** ${configured.join(", ")}\n\n**Errors:**\n${errors.map(e => `- ${e}`).join("\n")}\n`;
			}
			errorMsg += `\n**Fallback:** Use \`web_search\` (Tavily/Exa/Brave/SerpAPI) for structured keyword results.`;

			return {
				details: {},
				content: [{ type: "text", text: errorMsg }],
				isError: true,
			};
		},
	});

	// ── Tool: web_extract ───────────────────────────────────────────────────
	pi.registerTool({
		name: "web_extract",
		label: "Web Extract",
		description: [
			"Extract the main text content from a web page URL.",
			"Uses Mozilla Readability for article extraction with automatic Jina fallback for poor results.",
			"Supports PDF extraction. Returns clean markdown.",
			"Use after web_search to read full content of promising results.",
		].join(" "),
		parameters: Type.Object({
			url: Type.String({ description: "URL of the web page to extract content from" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const result = await fetchContent(params.url, {
					qualityThreshold: 50,
					timeout: 15_000,
				});

				// Truncate if too long
				let content = result.content;
				const words = content.split(/\s+/);
				if (words.length > 8000) {
					content = words.slice(0, 8000).join(" ") + `\n\n[... truncated, total ${result.wordCount} words]`;
				}

				let text = "";
				if (result.title) text += `# ${result.title}\n\n`;
				text += `**URL:** ${params.url}\n`;
				if (result.author) text += `**Author:** ${result.author}\n`;
				if (result.publishedDate) text += `**Published:** ${result.publishedDate}\n`;
				text += `**Word count:** ${result.wordCount}\n`;
				text += `**Method:** ${result.method}${result.usedFallback ? " (fallback)" : ""}\n`;
				text += `\n---\n\n${content}`;

				return { details: {}, content: [{ type: "text", text }] };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					details: {},
					content: [{ type: "text", text: `Failed to extract ${params.url}: ${msg}` }],
					isError: true,
				};
			}
		},
	});

	// ── Tool: fetch_content ─────────────────────────────────────────────────
	pi.registerTool({
		name: "fetch_content",
		label: "Fetch Content",
		description: [
			"Advanced content extraction with detailed extraction path reporting.",
			"Supports HTML (via Readability), PDF (via unpdf), and Jina AI fallback.",
			"Returns markdown with quality metrics and extraction method used.",
			"Use when you need to know which extraction path was used or control quality threshold.",
		].join(" "),
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch and extract content from" }),
			quality_threshold: Type.Optional(Type.Number({
				description: "Quality threshold for fallback (0-100, default 50). Lower values are more aggressive with fallback.",
				minimum: 0,
				maximum: 100,
				default: 50,
			})),
			force_jina: Type.Optional(Type.Boolean({
				description: "Force Jina AI extraction even if primary method succeeds (default false)",
				default: false,
			})),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const result = await fetchContent(params.url, {
					qualityThreshold: params.quality_threshold ?? 50,
					forceJina: params.force_jina ?? false,
					timeout: 20_000,
				});

				// Build detailed response
				let text = `## Content Extraction Report\n\n`;
				text += `**URL:** ${result.url}\n`;
				text += `**Extraction Path:** ${result.method}${result.usedFallback ? " (fallback used)" : ""}\n`;
				text += `**Quality Score:** ${result.quality}/100\n`;
				text += `**Word Count:** ${result.wordCount}\n`;
				if (result.title) text += `**Title:** ${result.title}\n`;
				if (result.author) text += `**Author:** ${result.author}\n`;
				if (result.publishedDate) text += `**Published:** ${result.publishedDate}\n`;

				text += `\n---\n\n${result.content}`;

				return { details: {}, content: [{ type: "text", text }] };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					details: {},
					content: [{ type: "text", text: `fetch_content failed for ${params.url}: ${msg}` }],
					isError: true,
				};
			}
		},
	});

	// ── Tool: code_search ───────────────────────────────────────────────────
	pi.registerTool({
		name: "code_search",
		label: "Code Search",
		description: [
			"Search for code examples, API references, and implementation guidance.",
			"Uses Exa search tuned toward official documentation, GitHub examples, and debugging sources.",
			"Best for programming/library/API questions where concrete examples are more useful than generic search snippets.",
		].join(" "),
		parameters: Type.Object({
			query: Type.String({ description: "Programming question, API, library, or debugging topic to search for" }),
			maxTokens: Type.Optional(Type.Integer({
				minimum: 1000,
				maximum: 50000,
				description: "Maximum tokens of source context to return (default 5000)",
			})),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const apiKey = process.env.EXA_API_KEY;
				if (!apiKey) {
					return {
						details: {},
						content: [{
							type: "text",
							text: "code_search requires EXA_API_KEY for this first implementation. Configure EXA_API_KEY or use web_search as a fallback.",
						}],
						isError: true,
					};
				}

				const request = normalizeCodeSearchRequest(params.query, params.maxTokens);
				if (!request.query) {
					return {
						details: {},
						content: [{ type: "text", text: "code_search requires a non-empty query." }],
						isError: true,
					};
				}

				await exaRateLimiter();
				const resp = await fetchWithRetry("https://api.exa.ai/search", {
					method: "POST",
					headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
					body: JSON.stringify({
						query: buildCodeSearchQuery(request.query),
						type: "auto",
						numResults: 5,
						contents: { text: { maxCharacters: request.maxChars }, highlights: true },
					}),
					signal: AbortSignal.timeout(20_000),
				});
				if (!resp.ok) throw new Error(`Exa code search ${resp.status}: ${await resp.text()}`);

				const data = (await resp.json()) as {
					results?: Array<{ title?: string; url?: string; text?: string; publishedDate?: string }>;
				};
				const sources = (data.results ?? []).map((result, index) => ({
					title: result.title ?? `Source ${index + 1}`,
					url: result.url ?? "",
					snippet: (result.text ?? "").slice(0, 2000),
					domain: result.url ? extractDomain(result.url) : "",
					publishedDate: result.publishedDate,
				}));

				const text = formatCodeSearchReport({
					query: request.query,
					maxTokens: request.maxTokens,
					sources,
				});
				return { details: {}, content: [{ type: "text", text }] };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					details: {},
					content: [{ type: "text", text: `code_search failed: ${msg}` }],
					isError: true,
				};
			}
		},
	});

	// ── Tool: research_checkpoint ───────────────────────────────────────────
	// Retained as-is from pi-deep-research v0.1.6.

	const DEPTH_THRESHOLDS: Record<string, {
		minSearchRounds: number; maxSearchRounds: number;
		minSources: number; confidenceThreshold: number; minAnsweredRatio: number;
	}> = {
		quick:      { minSearchRounds: 1, maxSearchRounds: 3,  minSources: 3,  confidenceThreshold: 60, minAnsweredRatio: 0.6 },
		standard:   { minSearchRounds: 2, maxSearchRounds: 6,  minSources: 5,  confidenceThreshold: 75, minAnsweredRatio: 0.7 },
		deep:       { minSearchRounds: 3, maxSearchRounds: 10, minSources: 10, confidenceThreshold: 85, minAnsweredRatio: 0.8 },
		exhaustive: { minSearchRounds: 5, maxSearchRounds: 20, minSources: 15, confidenceThreshold: 95, minAnsweredRatio: 0.9 },
	};

	pi.registerTool({
		name: "research_checkpoint",
		label: "Research Checkpoint",
		description: [
			"MANDATORY after each search round during deep research.",
			"Submit current research state for evaluation.",
			"The tool will analyze your progress and return a VERDICT: CONTINUE (must search more) or PROCEED (may synthesize report).",
			"You MUST obey the verdict — if it says CONTINUE, you must do another search round before calling this again.",
			"Do NOT skip this tool or write the report without a PROCEED verdict.",
		].join(" "),
		parameters: Type.Object({
			depth: Type.String({ description: 'Research depth level: "quick", "standard", "deep", or "exhaustive"' }),
			round: Type.Number({ description: "Current search round number (1-indexed, increment after each search batch)" }),
			sub_questions: Type.Array(
				Type.Object({
					question: Type.String({ description: "The sub-question" }),
					answered: Type.Boolean({ description: "Whether this sub-question has been adequately answered" }),
					confidence: Type.Number({ description: "Confidence score 0-100 for this sub-question" }),
					source_count: Type.Number({ description: "Number of sources found for this sub-question" }),
					best_source_tier: Type.Number({ description: "Best source credibility tier (1=authoritative, 2=reliable, 3=community, 4=unverified)" }),
				}),
				{ description: "Status of each sub-question" },
			),
			total_sources: Type.Number({ description: "Total unique sources collected so far" }),
			contradictions: Type.Optional(Type.Array(Type.String(), { description: "List of contradictions found between sources" })),
			gaps: Type.Optional(Type.Array(Type.String(), { description: "Known information gaps that remain" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const thresholds = DEPTH_THRESHOLDS[params.depth] ?? DEPTH_THRESHOLDS.standard;
			const totalQuestions = params.sub_questions.length;
			const answeredCount = params.sub_questions.filter(q => q.answered).length;
			const answeredRatio = totalQuestions > 0 ? answeredCount / totalQuestions : 0;
			const avgConfidence = totalQuestions > 0
				? params.sub_questions.reduce((s, q) => s + q.confidence, 0) / totalQuestions : 0;
			const minConfidence = totalQuestions > 0
				? Math.min(...params.sub_questions.map(q => q.confidence)) : 0;
			const hasContradictions = (params.contradictions?.length ?? 0) > 0;
			const lowConfQ = params.sub_questions.filter(q => q.confidence < 40);
			const medConfQ = params.sub_questions.filter(q => q.confidence >= 40 && q.confidence < thresholds.confidenceThreshold);

			const issues: string[] = [];
			let verdict: "CONTINUE" | "PROCEED" = "PROCEED";

			if (params.round < thresholds.minSearchRounds) { verdict = "CONTINUE"; issues.push(`⛔ Min search rounds not met: ${params.round}/${thresholds.minSearchRounds}`); }
			if (params.total_sources < thresholds.minSources) { verdict = "CONTINUE"; issues.push(`⛔ Not enough sources: ${params.total_sources}/${thresholds.minSources}`); }
			if (answeredRatio < thresholds.minAnsweredRatio) { verdict = "CONTINUE"; issues.push(`⛔ Answered ratio too low: ${answeredCount}/${totalQuestions} (${(answeredRatio * 100).toFixed(0)}% < ${(thresholds.minAnsweredRatio * 100).toFixed(0)}%)`); }
			if (avgConfidence < thresholds.confidenceThreshold) { verdict = "CONTINUE"; issues.push(`⛔ Avg confidence too low: ${avgConfidence.toFixed(0)}% < ${thresholds.confidenceThreshold}%`); }
			if (lowConfQ.length > 0 && params.round < thresholds.maxSearchRounds) { verdict = "CONTINUE"; issues.push(`⛔ Low-confidence sub-questions (<40%): ${lowConfQ.map(q => `"${q.question}" (${q.confidence}%)`).join(", ")}`); }
			if (hasContradictions && params.round < thresholds.maxSearchRounds) { verdict = "CONTINUE"; issues.push(`⚠️ Unresolved contradictions (${params.contradictions!.length})`); }
			if (params.round >= thresholds.maxSearchRounds) {
				verdict = "PROCEED";
				if (issues.length > 0) issues.push(`⚠️ Max rounds reached (${thresholds.maxSearchRounds}). Proceeding; note remaining issues in report.`);
			}

			const bar = `${"█".repeat(Math.round(avgConfidence / 5))}${"░".repeat(20 - Math.round(avgConfidence / 5))}`;
			let text = `## Research Checkpoint — Round ${params.round}\n\n`;
			text += `**Depth:** ${params.depth} | **Verdict: ${verdict === "CONTINUE" ? "🔴 CONTINUE SEARCHING" : "🟢 PROCEED TO REPORT"}**\n\n`;
			text += `### Progress\n`;
			text += `- Search rounds: ${params.round} / ${thresholds.minSearchRounds}–${thresholds.maxSearchRounds}\n`;
			text += `- Sources: ${params.total_sources} / ${thresholds.minSources} minimum\n`;
			text += `- Sub-questions answered: ${answeredCount}/${totalQuestions} (${(answeredRatio * 100).toFixed(0)}%)\n`;
			text += `- Avg confidence: ${bar} ${avgConfidence.toFixed(0)}% (threshold: ${thresholds.confidenceThreshold}%)\n`;
			text += `- Min confidence: ${minConfidence.toFixed(0)}%\n`;

			text += `\n### Sub-question Status\n`;
			for (const q of params.sub_questions) {
				const icon = q.confidence >= thresholds.confidenceThreshold ? "✅" : q.confidence >= 40 ? "🟡" : "🔴";
				text += `${icon} [${q.confidence}%] ${q.question} — ${q.source_count} sources (Tier ${q.best_source_tier})\n`;
			}

			if (issues.length > 0) { text += `\n### Issues\n${issues.map(i => `${i}\n`).join("")}`; }
			if (params.contradictions?.length) { text += `\n### Contradictions\n${params.contradictions.map(c => `- ⚡ ${c}\n`).join("")}`; }
			if (params.gaps?.length) { text += `\n### Remaining Gaps\n${params.gaps.map(g => `- ❓ ${g}\n`).join("")}`; }

			if (verdict === "CONTINUE") {
				text += `\n### 📋 Next Actions Required\nYou MUST do another search round then call \`research_checkpoint\` again.\n`;
				if (lowConfQ.length > 0) { text += `\n**Priority (low confidence):**\n${lowConfQ.map(q => `- "${q.question}" — try different angles\n`).join("")}`; }
				if (medConfQ.length > 0) { text += `\n**Secondary (medium confidence):**\n${medConfQ.map(q => `- "${q.question}" (${q.confidence}%) — find corroborating sources\n`).join("")}`; }
				if (hasContradictions) text += `\n**Resolve contradictions** by searching for Tier 1 authoritative sources.\n`;
			} else {
				text += `\n### ✅ Ready to Synthesize\nAll criteria met. Proceed to Phase 4 — write the research report.\n`;
				if (params.gaps?.length) text += `Include ${params.gaps.length} gap(s) in the "Uncertainties & Gaps" section.\n`;
				if (hasContradictions) text += `Include ${params.contradictions!.length} contradiction(s) — present both sides.\n`;
			}

			return { details: {}, content: [{ type: "text", text }] };
		},
	});
}
