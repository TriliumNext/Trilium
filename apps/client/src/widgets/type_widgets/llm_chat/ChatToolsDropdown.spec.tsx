import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    triggerCommand: vi.fn(),
    /** Option values by name, as `useTriliumOption` and `options.getJson()` read them. */
    stored: {} as Record<string, string>,
    /** Every option write. */
    saved: [] as [ string, unknown ][]
}));

vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("../../../components/app_context.js", () => ({ default: { triggerCommand: mocks.triggerCommand } }));
vi.mock("../../../services/options.js", () => ({
    default: { getJson: (name: string) => JSON.parse(mocks.stored[name] ?? "null") }
}));
vi.mock("../../react/hooks.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks.js")>()),
    useTriliumOption: (name: string) => [
        mocks.stored[name] ?? "",
        async (value: unknown) => void mocks.saved.push([ name, value ])
    ]
}));

// Renders the toggle's face, class and tooltip, and the menu, without the popup machinery.
vi.mock("../../react/Dropdown.js", () => ({
    default: ({ text, title, buttonClassName, children }: {
        text?: ComponentChildren; title?: string; buttonClassName?: string; children: ComponentChildren;
    }) => (
        <div className="dropdown-stub">
            <button className={buttonClassName} title={title}>{text}</button>
            <div className="menu">{children}</div>
        </div>
    )
}));

import type { WebSearchState } from "../../../services/llm_providers.js";
import ChatToolsDropdown, { useChatWebSearch } from "./ChatToolsDropdown.js";

let host: HTMLElement | undefined;

afterEach(() => {
    if (host) {
        render(null, host);
        host.remove();
        host = undefined;
    }
    mocks.stored = {};
    mocks.saved = [];
    vi.clearAllMocks();
});

const TAVILY = { id: "s1", name: "Tavily", provider: "tavily" };

function renderMenu({ enableNoteTools = false, modelProvider, webSearch = { choice: "disabled", enableWebSearch: false } }: {
    enableNoteTools?: boolean;
    modelProvider?: string;
    webSearch?: WebSearchState;
} = {}) {
    const onNoteToolsChange = vi.fn();
    const onWebSearchChoose = vi.fn();
    host = document.body.appendChild(document.createElement("div"));
    const target = host;
    act(() => render(
        <ChatToolsDropdown
            enableNoteTools={enableNoteTools}
            onNoteToolsChange={onNoteToolsChange}
            modelProvider={modelProvider}
            webSearch={webSearch}
            searchProviders={[ TAVILY ]}
            onWebSearchChoose={onWebSearchChoose}
        />, target));

    const rows = [ ...target.querySelectorAll<HTMLElement>(".menu .dropdown-item") ];
    const row = (text: string) => {
        const found = rows.find((candidate) => candidate.textContent?.includes(text));
        expect(found).toBeDefined();
        return found;
    };
    const toggle = target.querySelector<HTMLButtonElement>(".dropdown-stub > button");
    return {
        toggle,
        isToggleOn: () => {
            const icon = toggle?.querySelector(".llm-chat-tools-icon");
            expect(icon).not.toBeNull();
            return icon?.classList.contains("llm-chat-tools-on");
        },
        row,
        /** The web search choices, by their text, that the menu marks as chosen. */
        marked: () => rows.filter((candidate) => candidate.getAttribute("aria-checked") === "true" || candidate.querySelector(".bx-check"))
            .map((candidate) => candidate.textContent),
        onNoteToolsChange,
        onWebSearchChoose
    };
}

const isOn = (row: HTMLElement | undefined) => row?.querySelector<HTMLInputElement>("input[type='checkbox']")?.checked;

describe("ChatToolsDropdown", () => {
    it("marks the toggle while note access or a usable web search is on", () => {
        const off = renderMenu();
        expect(off.toggle?.title).toBe("llm_chat.tools");
        // The compact combo box of the model picker, which draws the dropdown caret.
        expect(off.toggle?.classList.contains("llm-chat-model-select")).toBe(true);
        expect(off.isToggleOn()).toBe(false);
        expect(isOn(off.row("llm_chat.note_tools"))).toBe(false);

        expect(renderMenu({ enableNoteTools: true }).isToggleOn()).toBe(true);
        expect(renderMenu({ webSearch: { choice: "s1", enableWebSearch: true, webSearchProviderId: "s1" } }).isToggleOn()).toBe(true);
        // Chosen, but the model can't use it.
        expect(renderMenu({ webSearch: { choice: "builtin", enableWebSearch: false, builtInUnavailableKey: "no_builtin" } }).isToggleOn()).toBe(false);
    });

    it("marks the chosen web search source, and reports a pressed one or the note access switch", async () => {
        const menu = renderMenu({ enableNoteTools: true, webSearch: { choice: "s1", enableWebSearch: true, webSearchProviderId: "s1" } });
        expect(menu.marked()).toEqual([ "Tavily" ]);

        await act(async () => menu.row("llm_chat.web_search_builtin")?.click());
        expect(menu.onWebSearchChoose).toHaveBeenLastCalledWith("builtin");
        await act(async () => menu.row("llm_chat.web_search_disabled")?.click());
        expect(menu.onWebSearchChoose).toHaveBeenLastCalledWith("disabled");
        await act(async () => menu.row("llm_chat.note_tools")?.click());
        expect(menu.onNoteToolsChange).toHaveBeenCalledExactlyOnceWith(false);

        const manage = host?.querySelector<HTMLButtonElement>(".dropdown-header button.bx-cog");
        expect(manage).not.toBeNull();
        await act(async () => manage?.click());
        expect(mocks.triggerCommand).toHaveBeenCalledExactlyOnceWith("showOptions", { section: "_optionsLlm" });
    });

    it("gives every web search choice an icon, the model's own mark standing for its built-in search", () => {
        const icons = (menu: ReturnType<typeof renderMenu>) => [ "llm_chat.web_search_disabled", "llm_chat.web_search_builtin", "Tavily" ]
            .map((text) => menu.row(text)?.querySelector(".llm-chat-tools-choice-icon"));

        const [ disabled, builtIn, tavily ] = icons(renderMenu({ modelProvider: "anthropic" }));
        expect(disabled?.classList.contains("bx-block")).toBe(true);
        expect(builtIn?.classList.contains("masked-icon")).toBe(true);
        expect(tavily?.classList.contains("masked-icon")).toBe(true);

        // No model picked yet: nobody's mark to show.
        expect(icons(renderMenu())[1]?.classList.contains("bx-globe")).toBe(true);
    });

    it("keeps a choice the model can't use listed, disabled, with the reason on an info icon", async () => {
        const menu = renderMenu({ webSearch: {
            choice: "builtin", enableWebSearch: false,
            builtInUnavailableKey: "no_builtin", searchProviderUnavailableKey: "own_tools"
        } });

        const builtIn = menu.row("llm_chat.web_search_builtin");
        expect(builtIn?.classList.contains("disabled")).toBe(true);
        expect(builtIn?.querySelector(".bx-info-circle")?.getAttribute("title")).toBe("no_builtin");
        expect(builtIn?.querySelector(".description")).toBeNull();
        expect(menu.row("Tavily")?.querySelector(".bx-info-circle")?.getAttribute("title")).toBe("own_tools");

        await act(async () => menu.row("Tavily")?.click());
        expect(menu.onWebSearchChoose).not.toHaveBeenCalled();
    });
});

describe("useChatWebSearch", () => {
    const OPENAI = { id: "o1", name: "OpenAI", provider: "openai" };

    function mountHook(modelProvider: string | undefined) {
        const chat = { enableWebSearch: true, enableNoteTools: false, setEnableWebSearch: vi.fn() };
        const onChange = vi.fn();
        let result: ReturnType<typeof useChatWebSearch> | undefined;
        function Probe() {
            result = useChatWebSearch(chat, modelProvider, onChange);
            return null;
        }
        host = document.body.appendChild(document.createElement("div"));
        const target = host;
        const rerender = () => act(() => render(<Probe />, target));
        rerender();
        const current = () => {
            expect(result).toBeDefined();
            return result as ReturnType<typeof useChatWebSearch>;
        };
        return { chat, onChange, current, rerender };
    }

    it("resolves the chosen search provider for the model, and lists only the search providers", () => {
        mocks.stored = {
            llmProviders: JSON.stringify([ { ...OPENAI, selectedModels: [] }, { ...TAVILY, kind: "search" } ]),
            llmWebSearchProvider: "s1"
        };
        const { current, rerender } = mountHook("openai");

        expect(current().searchProviders).toEqual([ TAVILY ]);
        expect(current().webSearch).toMatchObject({ choice: "s1", enableWebSearch: true, webSearchProviderId: "s1" });

        // A search provider removed in the settings leaves the model's built-in search.
        mocks.stored.llmProviders = JSON.stringify([ OPENAI ]);
        rerender();
        expect(current().searchProviders).toEqual([]);
        expect(current().webSearch).toMatchObject({ choice: "builtin", enableWebSearch: true, webSearchProviderId: undefined });
    });

    it("turns web search on with the chosen source, which every chat shares, or off for this chat only", () => {
        const { chat, onChange, current } = mountHook(undefined);

        act(() => current().chooseWebSearch("s1"));
        act(() => current().chooseWebSearch("builtin"));
        expect(chat.setEnableWebSearch.mock.calls).toEqual([ [ true ], [ true ] ]);
        expect(mocks.saved).toEqual([ [ "llmWebSearchProvider", "s1" ], [ "llmWebSearchProvider", "" ] ]);

        act(() => current().chooseWebSearch("disabled"));
        expect(chat.setEnableWebSearch).toHaveBeenLastCalledWith(false);
        expect(mocks.saved).toHaveLength(2);
        expect(onChange).toHaveBeenCalledTimes(3);
    });
});
