/**
 * Protocol handlers for pi-search-extension.
 *
 * Uses lazy dynamic imports for implementation modules so the extension loads
 * without error even when node_modules are not installed.
 * Dependencies are only resolved when a provide is actually invoked.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type ProtocolInvocationContext = { abortSignal?: AbortSignal };
type ProtocolHandler = (input: unknown, context?: ProtocolInvocationContext) => unknown | Promise<unknown>;

const PROTOCOL_TOOL_NAMES = [
	"web_search",
	"polite_search",
	"web_extract",
	"fetch_content",
	"code_search",
	"research_checkpoint",
] as const;

const PROTOCOL_PROVIDE_NAMES = [
	...PROTOCOL_TOOL_NAMES,
	"deep_research",
] as const;

type ProtocolToolName = (typeof PROTOCOL_TOOL_NAMES)[number];
type ProtocolProvideName = (typeof PROTOCOL_PROVIDE_NAMES)[number];

export interface CreateSearchProtocolHandlersOptions {}

export function createHandlers(options?: CreateSearchProtocolHandlersOptions): Record<ProtocolProvideName, ProtocolHandler> {
	const handlers = {} as Record<ProtocolProvideName, ProtocolHandler>;

	for (const name of PROTOCOL_TOOL_NAMES) {
		handlers[name] = async (input: unknown, context?: ProtocolInvocationContext) => {
			// Lazily build the tool map only on first invocation
			const tools = await getToolMap();
			const tool = tools.get(name);
			if (!tool) throw new Error(`pi-search-extension protocol tool not registered: ${name}`);

			const result = await tool.execute(`protocol:${name}`, input ?? {}, context?.abortSignal, undefined, {
				protocol: true,
			});
			return normalizeToolResult(result);
		};
	}

	handlers.deep_research = async (input: unknown) => createDeepResearchProtocolResponse(input);

	return handlers;
}

/**
 * Lazily builds and caches the tool map. The actual tool registration
 * (which pulls in heavy search provider deps) happens on first provide call.
 */
let toolMapPromise: Promise<Map<string, RegisteredTool>> | undefined;

async function getToolMap(): Promise<Map<string, RegisteredTool>> {
	if (!toolMapPromise) {
		toolMapPromise = buildToolMap();
	}
	return toolMapPromise;
}

type PiToolResult = {
	details?: Record<string, unknown>;
	content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
	isError?: boolean;
	[key: string]: unknown;
};

type RegisteredTool = {
	name: string;
	execute: (
		toolCallId: string,
		params: any,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	) => Promise<PiToolResult> | PiToolResult;
};

type ToolRegistryTarget = {
	registerTool(tool: RegisteredTool): void;
};

async function buildToolMap(): Promise<Map<string, RegisteredTool>> {
	const tools = new Map<string, RegisteredTool>();
	const target: ToolRegistryTarget = {
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
	};

	// Dynamic import defers loading of tools.ts (and its heavy provider deps)
	// until the first protocol provide call.
	const { registerWebSearchTools } = await import("../src/tools.js");
	registerWebSearchTools(target as never);
	return tools;
}

function normalizeToolResult(result: PiToolResult): Record<string, unknown> {
	const content = Array.isArray(result.content) ? result.content : [];
	const text = content
		.map(part => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
		.filter(Boolean)
		.join("\n\n");

	return {
		ok: !result.isError,
		isError: !!result.isError,
		text,
		content,
		details: result.details ?? {},
	};
}

function createDeepResearchProtocolResponse(input: unknown): Record<string, unknown> {
	const topic = extractDeepResearchTopic(input);
	const instructions = readFileSync(join(__dirname, "../skills/pi-deep-research/SKILL.md"), "utf8");
	const prompt = [
		"Use the following deep-research workflow instructions for this request.",
		"This protocol provide returns the workflow prompt; caller agents should run it with the registered search/checkpoint provides.",
		"",
		instructions,
		"",
		"---",
		`Research request: ${topic}`,
	].join("\n");

	return {
		ok: true,
		text: prompt,
		prompt,
		topic,
		toolProvides: [...PROTOCOL_TOOL_NAMES],
	};
}

function extractDeepResearchTopic(input: unknown): string {
	if (typeof input === "string") return input;
	if (input && typeof input === "object") {
		const obj = input as Record<string, unknown>;
		if (typeof obj.topic === "string") return obj.topic;
		if (typeof obj.query === "string") return obj.query;
		if (typeof obj.request === "string") return obj.request;
	}
	return "unspecified research topic";
}
