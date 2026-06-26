/**
 * Shared types for search providers.
 */

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	source?: string;
	publishedDate?: string;
	relevanceScore?: number;
}

export type ProviderName = "tavily" | "exa" | "brave" | "serpapi";

export interface SearchProviderResult {
	provider: ProviderName;
	results: SearchResult[];
}
