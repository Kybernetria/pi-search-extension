import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface CachedContentRecord {
	id: string;
	url: string;
	title?: string;
	content: string;
	method?: string;
	quality?: number;
	wordCount?: number;
	createdAt: string;
}

const CACHE_DIR = process.env.PI_SEARCH_CACHE_DIR || join(process.cwd(), ".pi-search-cache");
const CONTENT_DIR = join(CACHE_DIR, "content");
const INDEX_FILE = join(CACHE_DIR, "index.json");

type CacheIndex = { byUrl: Record<string, string> };

function ensureCache(): void {
	mkdirSync(CONTENT_DIR, { recursive: true });
	if (!existsSync(INDEX_FILE)) writeFileSync(INDEX_FILE, JSON.stringify({ byUrl: {} }, null, 2));
}

function readIndex(): CacheIndex {
	ensureCache();
	try { return JSON.parse(readFileSync(INDEX_FILE, "utf8")) as CacheIndex; }
	catch { return { byUrl: {} }; }
}

function writeIndex(index: CacheIndex): void {
	ensureCache();
	writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

export function contentIdForUrl(url: string): string {
	return `content_${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

export function putCachedContent(input: Omit<CachedContentRecord, "id" | "createdAt"> & { id?: string }): CachedContentRecord {
	ensureCache();
	const id = input.id || contentIdForUrl(input.url);
	const record: CachedContentRecord = { ...input, id, createdAt: new Date().toISOString() };
	writeFileSync(join(CONTENT_DIR, `${id}.json`), JSON.stringify(record, null, 2));
	const index = readIndex();
	index.byUrl[input.url] = id;
	writeIndex(index);
	return record;
}

export function getCachedContent(args: { id?: string; url?: string }): CachedContentRecord | null {
	ensureCache();
	const id = args.id || (args.url ? readIndex().byUrl[args.url] : undefined);
	if (!id) return null;
	const path = join(CONTENT_DIR, `${id}.json`);
	if (!existsSync(path)) return null;
	try { return JSON.parse(readFileSync(path, "utf8")) as CachedContentRecord; }
	catch { return null; }
}

export function sliceContent(content: string, start = 0, maxChars = 20_000): { text: string; start: number; end: number; fullLength: number } {
	const safeStart = Math.max(0, Math.min(start, content.length));
	const safeMax = Math.max(1, Math.min(maxChars, 100_000));
	const end = Math.min(content.length, safeStart + safeMax);
	return { text: content.slice(safeStart, end), start: safeStart, end, fullLength: content.length };
}
