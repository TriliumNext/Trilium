import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    stored: {} as Record<string, string>,
    /** Every option write, which is where the provider list is kept. */
    saved: [] as [ string, string ][],
    confirm: vi.fn(async () => true),
    standalone: false,
    // Routed by URL: the page under test asks for network addresses, while modules pulled in
    // alongside it (keyboard actions) expect a list from the same service.
    /** What the server says about the interfaces it is bound to. */
    network: { addresses: [] as string[], reachableOnNetwork: false },
    get: vi.fn(async (url: string) => (url === "network-addresses" ? mocks.network : []))
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
    useTriliumOption: (name: string) => [
        mocks.stored[name] ?? "",
        (value: string) => void mocks.saved.push([ name, value ])
    ],
    useTriliumOptionBool: (name: string) => [ mocks.stored[name] === "true", () => {} ]
}));

vi.mock("../../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));

// The request the card makes: the LAN addresses the endpoint is reachable on. Standalone serves
// no such route, so whether it is asked for at all is part of what is under test.
vi.mock("../../../services/server", () => ({ default: { get: mocks.get } }));

// Stubbed for the note context it would otherwise need, but its second row is rendered: the page's
// master switch lives there now.
vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ below }: { below?: preact.ComponentChildren }) => <div className="header-stub">{below}</div>
}));
// Carries a bootstrap modal into the tree, and the MCP card below it is what is being read here.
vi.mock("./llm/AddProviderModal", () => ({ default: () => null, PROVIDER_TYPES: [] }));

import LlmSettings, { buildMcpClientConfig, buildMcpClientCommand } from "./llm";

const URL = "http://192.168.1.10:8080/mcp";
const TOKEN = "your-etapi-token";

let host: HTMLElement;

beforeEach(() => {
    mocks.standalone = false;
    mocks.stored = { aiEnabled: "true", mcpEnabled: "true" };
    mocks.saved = [];
    mocks.network = { addresses: [], reachableOnNetwork: false };
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
    // The option names its input `mcp-enabled-<random>`, so match on the stable prefix.
    const toggle = host.querySelector<HTMLInputElement>("input.switch-toggle[id^='mcp-enabled-']");
    const row = toggle?.closest(".tn-card-option");
    return {
        toggle,
        description: row?.querySelector(".tn-card-option-description")?.textContent,
        // Only rendered while MCP is actually serving: the endpoint list and the paste-in config.
        endpointsShown: !!host.querySelector(".mcp-endpoint-list")
    };
}

describe("the AI master switch", () => {
    it("is a named row in the page header, so what it turns on is stated rather than left to a tooltip", () => {
        open();

        const toggle = host.querySelector<HTMLInputElement>("input.switch-toggle[id^='ai-enabled-']");
        expect(toggle).not.toBeNull();
        // It governs the page rather than any one card, so it stands in the header rather than
        // in a card of its own above the ones it turns on.
        expect(toggle?.closest(".header-stub")).not.toBeNull();

        // Bound to the switch, not merely text near it — the switch's accessible name. The label
        // carries the sentence too, so the name itself is read from the text leading it.
        const row = toggle?.closest(".tn-card-option");
        expect(row?.querySelector("label")?.getAttribute("for")).toBe(toggle?.id);
        expect(row?.querySelector("label")?.firstChild?.textContent).toBe("llm.enabled");
        expect(row?.querySelector(".tn-card-option-description")?.textContent).toBe("llm.enabled_description");
    });

    it("stays on the page when off, so the way back on is where the settings were", () => {
        mocks.stored = { aiEnabled: "false", mcpEnabled: "true" };
        open();

        expect(host.querySelector("input.switch-toggle[id^='ai-enabled-']")).not.toBeNull();
        // Everything it governs is gone, and nothing stands in for it: the switch is the page.
        expect(host.querySelector("input.switch-toggle[id^='mcp-enabled-']")).toBeNull();
        expect(host.querySelector(".no-items")).toBeNull();
    });
});

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

describe("the addresses MCP is reachable on", () => {
    const groups = () => [ ...host.querySelectorAll(".mcp-endpoint-group") ];
    const urls = () => [ ...host.querySelectorAll<HTMLInputElement>(".mcp-endpoint-list input") ].map((box) => box.value);

    /** Opens the page and lets the address lookup settle. */
    async function openAndSettle() {
        open();
        await act(async () => {});
    }

    it("offers the address on this device, whatever the machine is bound to", async () => {
        await openAndSettle();

        expect(groups()).toHaveLength(1);
        expect(urls()[0]).toMatch(/\/mcp$/);
    });

    it("says so plainly when nothing outside this machine could reach it", async () => {
        await openAndSettle();

        // Every LAN address would refuse the connection on a loopback-only binding.
        expect(host.querySelector(".mcp-endpoint-note")).not.toBeNull();
    });

    it("adds the addresses on the network once it is actually bound to one", async () => {
        mocks.network = {
            addresses: [ "http://192.168.1.10:8080", "http://10.0.0.5:8080" ],
            reachableOnNetwork: true
        };
        await openAndSettle();

        expect(groups()).toHaveLength(2);
        expect(urls()).toContain("http://192.168.1.10:8080/mcp");
        // Nothing to explain once there is something to hand out.
        expect(host.querySelector(".mcp-endpoint-note")).toBeNull();
    });

    it("does not offer the same address twice under two headings", async () => {
        mocks.network = { addresses: [ `${window.location.protocol}//${window.location.host}` ], reachableOnNetwork: true };
        await openAndSettle();

        // The one it is already offering as "this device" is left out of the network list.
        expect(new Set(urls()).size).toBe(urls().length);
    });
});

describe("the configured providers", () => {
    const providers = () => [ ...host.querySelectorAll(".tn-card-option") ]
        .filter((option) => option.querySelector(".llm-provider-name"));

    function withProviders(configured: { id: string; name: string; provider: string; apiKey: string; selectedModels?: unknown[] }[]) {
        mocks.stored = { ...mocks.stored, llmProviders: JSON.stringify(configured) };
    }

    it("says there are none rather than showing an empty card", () => {
        open();

        expect(host.querySelector(".no-items")).not.toBeNull();
        expect(providers()).toHaveLength(0);
    });

    it("survives a stored list that is not readable, rather than taking the page down with it", () => {
        mocks.stored = { ...mocks.stored, llmProviders: "{ not json" };
        open();

        expect(host.querySelector(".no-items")).not.toBeNull();
    });

    it("gives each provider a segment, named, and says how many models it was given", () => {
        withProviders([
            { id: "a", name: "My OpenAI", provider: "openai", apiKey: "sk", selectedModels: [ {}, {} ] },
            { id: "b", name: "Local", provider: "ollama", apiKey: "" }
        ]);
        open();

        expect(providers()).toHaveLength(2);
        expect(providers()[0].querySelector(".llm-provider-name")?.textContent).toContain("My OpenAI");
        // With no models chosen there is no count to give, so the kind of provider is said instead.
        expect(providers()[1].querySelector(".tn-card-option-description")?.textContent).toBeTruthy();
    });

    it("marks only the destructive action, and drops the one provider it was pressed on", async () => {
        withProviders([
            { id: "a", name: "First", provider: "openai", apiKey: "sk" },
            { id: "b", name: "Second", provider: "openai", apiKey: "sk" }
        ]);
        open();

        const [ edit, remove ] = [ ...providers()[0].querySelectorAll("button") ];
        expect(edit.className).not.toContain("destructive-action-icon");
        expect(remove.className).toContain("destructive-action-icon");

        await act(async () => remove.click());
        const written = mocks.saved.find(([ name ]) => name === "llmProviders");
        expect(JSON.parse(written?.[1] ?? "[]").map((provider: { id: string }) => provider.id)).toEqual([ "b" ]);
    });

    it("asks first, and keeps the provider when the answer is no", async () => {
        withProviders([ { id: "a", name: "First", provider: "openai", apiKey: "sk" } ]);
        mocks.confirm.mockResolvedValueOnce(false);
        open();

        const remove = [ ...providers()[0].querySelectorAll("button") ][1];
        await act(async () => remove.click());

        expect(mocks.saved.some(([ name ]) => name === "llmProviders")).toBe(false);
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
