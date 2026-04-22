/**
 * MCP (Model Context Protocol) server for Trilium Notes.
 *
 * Exposes existing LLM tools via the MCP protocol so external AI agents
 * (e.g. Claude Desktop) can interact with Trilium.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import appInfo from "../app_info.js";
import cls from "../cls.js";
import { allToolRegistries } from "../llm/tools/index.js";
import type { ToolDefinition } from "../llm/tools/tool_registry.js";
import sql from "../sql.js";

/**
 * Register a tool definition on the MCP server.
 *
 * Write operations are wrapped in CLS + transaction context so that
 * Becca entity tracking works correctly.
 */
function registerTool(server: McpServer, name: string, def: ToolDefinition) {
    server.registerTool(name, {
        description: def.description,
        inputSchema: def.inputSchema
    }, (args: any): CallToolResult => {
        const result = cls.init(() => {
            cls.set("componentId", "mcp");

            return def.mutates
                ? sql.transactional(() => def.execute(args))
                : def.execute(args);
        });

        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    });
}

export function createMcpServer(): McpServer {
    const server = new McpServer({
        name: "trilium-notes",
        version: appInfo.appVersion
    });

    for (const registry of allToolRegistries) {
        for (const [name, def] of registry) {
            registerTool(server, name, def);
        }
    }

    return server;
}
