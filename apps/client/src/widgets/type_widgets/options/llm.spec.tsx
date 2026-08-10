import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string>,
    standalone: false,
    // Routed by URL: the page under test asks for network addresses, while modules pulled in
    // alongside it (keyboard actions) expect a list from the same service.
    get: vi.fn(async (url: string) => (url === "network-addresses" ? { addresses: [], reachableOnNetwork: false } : []))
}));

// `isStandalone` is a const in the target, read here through a getter so a scenario can flip which
// kind of client we are pretending to be. Partial-mock, so the rest of utils stays real.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    get isStandalone() {
        return mocks.standalone;
    }
}));

// i18next is never initialised for these tests and answers `undefined` until it is, which would
// make every assertion about a description true of any string at all.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [ mocks.stored[name] ?? "", () => {} ],
    useTriliumOptionBool: (name: string) => [ mocks.stored[name] === "true", () => {} ]
}));

// The request the card makes: the LAN addresses the endpoint is reachable on. Standalone serves
// no such route, so whether it is asked for at all is part of what is under test.
vi.mock("../../../services/server", () => ({ default: { get: mocks.get } }));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));
// Carries a bootstrap modal into the tree, and the MCP card below it is what is being read here.
vi.mock("./llm/AddProviderModal", () => ({ default: () => null, PROVIDER_TYPES: [] }));

import LlmSettings, { buildMcpClientConfig, buildMcpClientCommand } from "./llm";

const URL = "http://192.168.1.10:8080/mcp";
const TOKEN = "your-etapi-token";

let host: HTMLElement;

beforeEach(() => {
    mocks.standalone = false;
    mocks.stored = { aiEnabled: "true", mcpEnabled: "true" };
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

function open() {
    void act(() => {
        render(<LlmSettings />, host);
    });
}

/** The MCP switch, plus the sentence under it — which is where the reason has to appear. */
function mcpRow() {
    // The row names its input `mcp-enabled-<random>`, so match on the stable prefix.
    const toggle = host.querySelector<HTMLInputElement>("input.switch-toggle[id^='mcp-enabled-']");
    const row = toggle?.closest(".option-row");
    return {
        toggle,
        description: row?.querySelector(".option-row-description")?.textContent,
        // Only rendered while MCP is actually serving: the endpoint list and the paste-in config.
        endpointsShown: !!host.querySelector(".mcp-endpoint-list")
    };
}

describe("the MCP card in standalone", () => {
    it("offers the endpoint where Trilium listens on one", () => {
        open();

        const { toggle, description, endpointsShown } = mcpRow();
        expect(toggle?.disabled).toBe(false);
        expect(description).toBe("llm.mcp_enabled_description");
        expect(endpointsShown).toBe(true);
        expect(mocks.get).toHaveBeenCalledWith("network-addresses");
    });

    it("keeps the card but disables it, saying why, where there is no address to hand out", () => {
        mocks.standalone = true;
        open();

        const { toggle, description, endpointsShown } = mcpRow();
        // Disabled and stated, rather than dropped from the page: the feature exists,
        // it is this build that cannot serve it.
        expect(toggle).not.toBeNull();
        expect(toggle?.disabled).toBe(true);
        expect(description).toBe("llm.mcp_unavailable_standalone");

        // A database restored from a desktop instance carries mcpEnabled=true along with
        // it (the option is unsynced, not absent), so the stored value must not bring the
        // endpoints back — nor make the page ask for network addresses, a route this
        // build's in-page server does not serve.
        expect(toggle?.checked).toBe(false);
        expect(endpointsShown).toBe(false);
        expect(mocks.get).not.toHaveBeenCalledWith("network-addresses");
    });
});

describe("MCP client configuration samples", () => {
    it("emits a config clients can paste verbatim", () => {
        const parsed = JSON.parse(buildMcpClientConfig(URL, TOKEN));

        expect(parsed).toEqual({
            mcpServers: {
                trilium: {
                    // `http` rather than the spec's `streamable-http`: Claude Code accepts
                    // both, but Cursor/VS Code only understand `http`.
                    type: "http",
                    url: URL,
                    headers: { Authorization: `Bearer ${TOKEN}` }
                }
            }
        });
        // Two-space indented so it reads as a config file rather than one long line.
        expect(buildMcpClientConfig(URL, TOKEN)).toContain('\n  "mcpServers"');
    });

    it("emits a CLI command carrying the same endpoint and header", () => {
        const command = buildMcpClientCommand(URL, TOKEN);

        expect(command).toContain(`--transport http trilium ${URL}`);
        expect(command).toContain(`--header "Authorization: Bearer ${TOKEN}"`);
        // Backslash-continued so it survives being copied into a shell as one command.
        expect(command).toContain("\\\n");
    });
});
