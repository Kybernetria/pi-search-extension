/**
 * Pragmatic code-search helpers for SEARCH-4.
 *
 * This is intentionally smaller than pi-web-access's full MCP-backed code search.
 * It shapes Exa queries toward programming documentation/examples and formats
 * the resulting sources into a readable report.
 */

export interface CodeSearchSource {
  title: string;
  url: string;
  snippet: string;
  domain?: string;
  publishedDate?: string;
}

export interface NormalizedCodeSearchRequest {
  query: string;
  maxTokens: number;
  /** Approximate text budget to request from Exa search results. */
  maxChars: number;
}

export interface CodeSearchReportInput {
  query: string;
  maxTokens: number;
  sources: CodeSearchSource[];
}

export const DEFAULT_CODE_SEARCH_MAX_TOKENS = 5000;
export const MIN_CODE_SEARCH_MAX_TOKENS = 1000;
export const MAX_CODE_SEARCH_MAX_TOKENS = 50000;

export function normalizeCodeSearchRequest(
  query: string,
  maxTokens?: number,
): NormalizedCodeSearchRequest {
  const normalizedTokens = clampMaxTokens(maxTokens);
  return {
    query: query.trim(),
    maxTokens: normalizedTokens,
    maxChars: tokensToChars(normalizedTokens),
  };
}

export function clampMaxTokens(maxTokens?: number): number {
  if (!Number.isFinite(maxTokens)) return DEFAULT_CODE_SEARCH_MAX_TOKENS;
  const floored = Math.floor(maxTokens as number);
  return Math.max(MIN_CODE_SEARCH_MAX_TOKENS, Math.min(MAX_CODE_SEARCH_MAX_TOKENS, floored));
}

export function tokensToChars(maxTokens: number): number {
  return Math.max(4000, Math.min(20000, Math.floor(clampMaxTokens(maxTokens) * 4)));
}

export function buildCodeSearchQuery(query: string): string {
  const trimmed = query.trim();
  return [
    trimmed,
    "Prefer official documentation, GitHub examples, API references, and high-signal debugging discussions.",
    "Return concrete usage patterns, code snippets, caveats, and relevant source links.",
  ].join("\n\n");
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function truncateSnippet(text: string, maxChars = 500): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function formatCodeSearchReport(input: CodeSearchReportInput): string {
  const { query, maxTokens, sources } = input;
  const lines: string[] = [];
  lines.push("## Code Search Results");
  lines.push("");
  lines.push(`**Query:** ${query}`);
  lines.push(`**Max tokens:** ${maxTokens}`);
  lines.push(`**Sources:** ${sources.length}`);

  if (sources.length === 0) {
    lines.push("");
    lines.push("No results found.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("### Top Sources");

  for (const [index, source] of sources.entries()) {
    lines.push("");
    lines.push(`${index + 1}. **${source.title || "Untitled result"}**`);
    lines.push(`   - URL: ${source.url}`);
    if (source.domain) lines.push(`   - Domain: ${source.domain}`);
    if (source.publishedDate) lines.push(`   - Published: ${source.publishedDate}`);
    if (source.snippet) lines.push(`   - Snippet: ${truncateSnippet(source.snippet, 600)}`);
  }

  return lines.join("\n");
}
