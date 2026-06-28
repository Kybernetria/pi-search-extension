/**
 * Protocol handlers for pi-search-extension.
 *
 * Uses lazy dynamic imports for implementation modules so the extension loads
 * without error even when node_modules are not installed.
 * Dependencies are only resolved when a provide is actually invoked.
 */


type ProtocolInvocationContext = { abortSignal?: AbortSignal };
type ProtocolHandler = (input: unknown, context?: ProtocolInvocationContext) => unknown | Promise<unknown>;

const PROTOCOL_TOOL_NAMES = [
	"web_search",
	"fetch_content",
	"get_cached_content",
] as const;

const PROTOCOL_PROVIDE_NAMES = [
	...PROTOCOL_TOOL_NAMES,
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

	// Keep protocol output compact. The protocol UI already shows the returned
	// object, so echoing both `content` and `details` makes search results noisy.
	// Tools should put human output in text; details are available only when the
	// tool intentionally returns meaningful structured data and the caller asks
	// through direct tool APIs rather than this compact protocol surface.
	return {
		ok: !result.isError,
		isError: !!result.isError,
		text,
	};
}

