/**
 * pi-search-extension — protocol-only entry point.
 *
 * Registers the pi-search-extension node on the protocol fabric so callers
 * can invoke provides through the shared protocol gateway.
 *
 * Bootstraps @kyvernitria/pi-protocol-minimal if not already available,
 * installing it into ~/.pi/agent/node_modules/ so ALL future extensions
 * find it without duplication.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHandlers } from "./protocol/handlers.js";

const _require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_ID = "pi-search-extension";

function ensureProtocolMinimal(): void {
  try {
    _require.resolve("@kyvernitria/pi-protocol-minimal");
  } catch {
    const targetDir = join(homedir(), ".pi", "agent", "node_modules", "@kyvernitria");
    const source = join(homedir(), "Applications", "pi", "pi-protocol", "packages", "pi-protocol-minimal");
    if (existsSync(source)) {
      mkdirSync(targetDir, { recursive: true });
      symlinkSync(source, join(targetDir, "pi-protocol-minimal"), "dir");
    } else {
      const { execSync } = _require("node:child_process");
      mkdirSync(targetDir, { recursive: true });
      execSync("npm install @kyvernitria/pi-protocol-minimal", { cwd: join(homedir(), ".pi", "agent"), stdio: "pipe" });
    }
  }
}

export default function piSearchExtension(pi: ExtensionAPI): void {
  ensureProtocolMinimal();
  registerDeepResearchCommand(pi);
  registerProtocolNode();
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
  const { ensureProtocolFabric, registerProtocolManifest } = _require("@kyvernitria/pi-protocol-minimal");
  const manifest = JSON.parse(readFileSync(join(__dirname, "pi.protocol.json"), "utf8"));
  const fabric = ensureProtocolFabric();
  fabric.unregister(NODE_ID);
  registerProtocolManifest(fabric, {
    manifest,
    handlers: createHandlers(),
  });
}
