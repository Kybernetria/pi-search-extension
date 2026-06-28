import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureProtocolFabric, registerProtocolManifest } from "@kybernetria/pi-protocol";
import { registerWebSearchTools } from "./src/tools.js";
import { createHandlers } from "./protocol/handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_ID = "pi-search-extension";

export default function piSearchExtension(pi: ExtensionAPI): void {
  registerWebSearchTools(pi);
  registerProtocolNode();
}

function registerProtocolNode(): void {
  const manifest = JSON.parse(readFileSync(join(__dirname, "pi.protocol.json"), "utf8"));
  const fabric = ensureProtocolFabric();
  fabric.unregister(NODE_ID);
  registerProtocolManifest(fabric, { manifest, handlers: createHandlers() });
}
