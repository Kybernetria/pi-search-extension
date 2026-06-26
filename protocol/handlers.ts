import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerWebSearchTools, type SearchOptions } from "../src/tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type ProtocolInvocationContext = { abortSignal?: AbortSignal };
type ProtocolHandler = (input: unknown, context?: ProtocolInvocationContext) => unknown | Promise<unknown>;

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

export interface CreateSearchProtocolHandlersOptions extends SearchOptions {}

export function createHandlers(options?: CreateSearchProtocolHandlersOptions): Record<ProtocolProvideName, ProtocolHandler> {
	const tools = buildToolMap(options);
	const handlers = {} as Record<ProtocolProvideName, ProtocolHandler>;

	for (const name of PROTOCOL_TOOL_NAMES) {
		handlers[name] = async (input: unknown, context?: ProtocolInvocationContext) => {
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

function buildToolMap(options?: CreateSearchProtocolHandlersOptions): Map<string, RegisteredTool> {
	const tools = new Map<string, RegisteredTool>();
	const target: ToolRegistryTarget = {
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
	};

	registerWebSearchTools(target as never, options);
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
