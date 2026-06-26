/**
 * pi-search-extension — standalone web search tool suite for Pi.
 *
 * Public API:
 *   - registerWebSearchTools(pi, options?) — registers 6 tools on a Pi ExtensionAPI:
 *       web_search, polite_search, web_extract, fetch_content,
 *       code_search, research_checkpoint
 */

export { registerWebSearchTools } from "./tools.js";
export type { SearchOptions } from "./tools.js";

// Re-export content extractor types for consumers
export type { ExtractionResult, QualityMetrics } from "./content/extractor.js";

// Re-export code search types for consumers
export type {
	CodeSearchSource,
	NormalizedCodeSearchRequest,
} from "./code-search/helpers.js";
