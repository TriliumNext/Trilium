import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createNote, login } from "./utils.js";
import config from "../../src/services/config.js";
import becca from "../../src/becca/becca.js";
import optionService from "../../src/services/options.js";
import cls from "../../src/services/cls.js";

let app: Application;
let token: string;

const USER = "etapi";
const MCP_ACCEPT = "application/json, text/event-stream";

/** Builds a JSON-RPC 2.0 request body for MCP. */
function jsonRpc(method: string, params?: Record<string, unknown>, id: number = 1) {
    return { jsonrpc: "2.0", id, method, params };
}

/** Parses the JSON-RPC response from an SSE response text. */
function parseSseResponse(text: string) {
    const dataLine = text.split("\n").find(line => line.startsWith("data: "));
    if (!dataLine) {
        throw new Error(`No SSE data line found in response: ${text}`);
    }
    return JSON.parse(dataLine.slice("data: ".length));
}

function mcpPost(app: Application) {
    return supertest(app)
        .post("/mcp")
        .set("Accept", MCP_ACCEPT)
        .set("Content-Type", "application/json");
}

function setOption(name: Parameters<typeof optionService.setOption>[0], value: string) {
    cls.init(() => optionService.setOption(name, value));
}

describe("mcp", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
    });

    describe("option gate", () => {
        it("rejects requests when mcpEnabled is false", async () => {
            setOption("mcpEnabled", "false");

            const response = await mcpPost(app)
                .send(jsonRpc("initialize"))
                .expect(403);

            expect(response.body.error).toContain("disabled");
        });

        it("rejects requests when mcpEnabled option does not exist", async () => {
            const saved = becca.options["mcpEnabled"];
            delete becca.options["mcpEnabled"];

            try {
                const response = await mcpPost(app)
                    .send(jsonRpc("initialize"))
                    .expect(403);

                expect(response.body.error).toContain("disabled");
            } finally {
                becca.options["mcpEnabled"] = saved;
            }
        });

        it("accepts requests when mcpEnabled is true", async () => {
            setOption("mcpEnabled", "true");

            const response = await mcpPost(app)
                .send(jsonRpc("initialize", {
                    protocolVersion: "2025-03-26",
                    capabilities: {},
                    clientInfo: { name: "test", version: "1.0.0" }
                }));

            expect(response.status).not.toBe(403);
        });
    });

    describe("protocol", () => {
        beforeAll(() => {
            setOption("mcpEnabled", "true");
        });

        it("initializes and returns server capabilities", async () => {
            const response = await mcpPost(app)
                .send(jsonRpc("initialize", {
                    protocolVersion: "2025-03-26",
                    capabilities: {},
                    clientInfo: { name: "test", version: "1.0.0" }
                }))
                .expect(200);

            const body = parseSseResponse(response.text);
            expect(body.result.serverInfo.name).toBe("trilium-notes");
            expect(body.result.capabilities.tools).toBeDefined();
        });

        it("lists available tools", async () => {
            const response = await mcpPost(app)
                .send(jsonRpc("tools/list"))
                .expect(200);

            const body = parseSseResponse(response.text);
            const toolNames: string[] = body.result.tools.map((t: { name: string }) => t.name);
            expect(toolNames).toContain("search_notes");
            expect(toolNames).toContain("get_note");
            expect(toolNames).toContain("get_note_content");
            expect(toolNames).toContain("create_note");
            expect(toolNames).not.toContain("get_current_note");
        });
    });

    describe("tools", () => {
        let noteId: string;

        beforeAll(async () => {
            setOption("mcpEnabled", "true");
            noteId = await createNote(app, token, "MCP test note content");
        });

        it("searches for notes", async () => {
            const response = await mcpPost(app)
                .send(jsonRpc("tools/call", {
                    name: "search_notes",
                    arguments: { query: "MCP test note content" }
                }))
                .expect(200);

            const body = parseSseResponse(response.text);
            expect(body.result).toBeDefined();
            const content = body.result.content;
            expect(content.length).toBeGreaterThan(0);
            expect(content[0].text).toContain(noteId);
        });

        it("gets note metadata by ID", async () => {
            const response = await mcpPost(app)
                .send(jsonRpc("tools/call", {
                    name: "get_note",
                    arguments: { noteId }
                }))
                .expect(200);

            const body = parseSseResponse(response.text);
            expect(body.result).toBeDefined();
            const parsed = JSON.parse(body.result.content[0].text);
            expect(parsed.noteId).toBe(noteId);
            expect(parsed.type).toBeDefined();
            expect(parsed.attributes).toBeDefined();
        });

        it("reads note content by ID", async () => {
            const response = await mcpPost(app)
                .send(jsonRpc("tools/call", {
                    name: "get_note_content",
                    arguments: { noteId }
                }))
                .expect(200);

            const body = parseSseResponse(response.text);
            expect(body.result).toBeDefined();
            const parsed = JSON.parse(body.result.content[0].text);
            expect(parsed.noteId).toBe(noteId);
            expect(parsed.content).toContain("MCP test note content");
        });
    });
});
