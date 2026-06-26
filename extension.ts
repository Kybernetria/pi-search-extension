/**
 * pi-search-extension — protocol-only entry point.
 *
 * Registers the pi-search-extension node on the protocol fabric so callers
 * can invoke provides (web_search, polite_search, web_extract,
 * fetch_content, code_search, research_checkpoint, deep_research)
 * through the shared protocol gateway instead of individual Pi tools.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHandlers } from "./protocol/handlers.js";

const _require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_ID = "pi-search-extension";

export default function piSearchExtension(pi: ExtensionAPI): void {
  registerDeepResearchCommand(pi);
  void registerProtocolNode();
}

function registerDeepResearchCommand(pi: ExtensionAPI): void {
  pi.registerCommand("deep-research", {
    description: "Start a structured deep-research workflow for a topic",
    handler: async (args, ctx) => {
      const topic = args.trim();
      if (!topic) {
        ctx.ui.notify("Usage: /deep-research <topic or question>", "warning");
        return;
      }

      pi.sendUserMessage(buildDeepResearchPrompt(topic));
    },
  });
}

function buildDeepResearchPrompt(topic: string): string {
  const instructions = readFileSync(join(__dirname, "skills/pi-deep-research/SKILL.md"), "utf8");
  return [
    "Use the following deep-research workflow instructions for this request.",
    "Do not treat this as a skill invocation; this is an explicit slash-command request.",
    "",
    instructions,
    "",
    "---",
    `Research request: ${topic}`,
  ].join("\n");
}

function registerProtocolNode(): void {
  try {
    const { ensureProtocolFabric, registerProtocolManifest } = _require("@kyvernitria/pi-protocol-minimal");
    const manifest = JSON.parse(readFileSync(join(__dirname, "pi.protocol.json"), "utf8"));
    const fabric = ensureProtocolFabric();
    fabric.unregister(NODE_ID);
    registerProtocolManifest(fabric, {
      manifest,
      handlers: createHandlers(),
    });
  } catch (error) {
    if (process.env.PI_SEARCH_PROTOCOL_DEBUG) {
      console.warn("pi-search-extension: protocol registration skipped", error);
    }
  }
}
