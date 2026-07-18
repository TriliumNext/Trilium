import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above the module-under-test import) ---

// Capture every (name, config, callback) passed to registerTool.
interface Registered {
    name: string;
    config: any;
    callback: (args: any) => any;
}
const registered: Registered[] = [];

class FakeMcpServer {
    constructor(public info: any) {}
    registerTool(name: string, config: any, callback: (args: any) => any) {
        registered.push({ name, config, callback });
        return { name };
    }
}

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({ McpServer: FakeMcpServer }));

const mockSql = { transactional: vi.fn((cb: () => unknown) => cb()) };
vi.mock("../sql.js", () => ({ default: mockSql }));

const clsCalls: { init: number; set: Array<[string, unknown]> } = { init: 0, set: [] };
const mockCls = {
    init: vi.fn((cb: () => unknown) => {
        clsCalls.init++;
        return cb();
    }),
    set: vi.fn((key: string, value: unknown) => clsCalls.set.push([key, value]))
};

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        cls: mockCls,
        app_info: { ...actual.app_info, appVersion: "9.9.9-test" }
    };
});

// Two tools: one read-only, one mutating, so both branches of the ternary run.
const readExecute = vi.fn(() => ({ ok: "read" }));
const mutateExecute = vi.fn(() => ({ ok: "mutate" }));

const readRegistry: any = [
    ["read_tool", { description: "r", inputSchema: {}, execute: readExecute }]
];
const mutateRegistry: any = [
    ["mutate_tool", { description: "m", inputSchema: {}, mutates: true, execute: mutateExecute }]
];

vi.mock("../llm/tools/index.js", () => ({
    allToolRegistries: [readRegistry, mutateRegistry]
}));

const { createMcpServer } = await import("./mcp_server.js");

beforeEach(() => {
    registered.length = 0;
    clsCalls.init = 0;
    clsCalls.set.length = 0;
    vi.clearAllMocks();
    mockSql.transactional.mockImplementation((cb: () => unknown) => cb());
});

afterEach(() => vi.restoreAllMocks());

describe("createMcpServer", () => {
    it("registers every tool from all registries", () => {
        const server = createMcpServer();

        expect(server).toBeInstanceOf(FakeMcpServer);
        expect((server as any).info).toMatchObject({ name: "trilium-notes", version: "9.9.9-test" });
        expect(registered.map((r) => r.name)).toEqual(["read_tool", "mutate_tool"]);
    });

    it("runs a read-only tool inside CLS without a transaction", () => {
        createMcpServer();
        const read = registered.find((r) => r.name === "read_tool")!;

        const result = read.callback({ foo: 1 });

        expect(readExecute).toHaveBeenCalledWith({ foo: 1 });
        expect(mockSql.transactional).not.toHaveBeenCalled();
        expect(mockCls.set).toHaveBeenCalledWith("componentId", "mcp");
        expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify({ ok: "read" }) }] });
    });

    it("runs a mutating tool inside CLS + a transaction", () => {
        createMcpServer();
        const mutate = registered.find((r) => r.name === "mutate_tool")!;

        const result = mutate.callback({ bar: 2 });

        expect(mutateExecute).toHaveBeenCalledWith({ bar: 2 });
        expect(mockSql.transactional).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify({ ok: "mutate" }) }] });
    });
});
