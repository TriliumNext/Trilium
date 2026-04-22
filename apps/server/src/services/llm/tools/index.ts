/**
 * LLM tools that wrap existing Trilium services.
 * These reuse the same logic as ETAPI without any HTTP overhead.
 */

export { noteTools } from "./note_tools.js";
export { attributeTools } from "./attribute_tools.js";
export { attachmentTools } from "./attachment_tools.js";
export { hierarchyTools } from "./hierarchy_tools.js";
export { skillTools } from "../skills/index.js";
export type { ToolDefinition } from "./tool_registry.js";
export { ToolRegistry } from "./tool_registry.js";

import { noteTools } from "./note_tools.js";
import { attributeTools } from "./attribute_tools.js";
import { attachmentTools } from "./attachment_tools.js";
import { hierarchyTools } from "./hierarchy_tools.js";
import { skillTools } from "../skills/index.js";
import type { ToolRegistry } from "./tool_registry.js";

/** All tool registries, for consumers that need to iterate every tool (e.g. MCP). */
export const allToolRegistries: ToolRegistry[] = [
    noteTools,
    attributeTools,
    attachmentTools,
    hierarchyTools,
    skillTools
];
