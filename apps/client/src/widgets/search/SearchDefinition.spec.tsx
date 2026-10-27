import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FAttribute from "../../entities/fattribute";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import bulk_action from "../../services/bulk_action";
import search from "../../services/search";
import server from "../../services/server";
import toast from "../../services/toast";
import { renderInto } from "../../test/render";
import { ActionDefinition } from "../bulk_actions/abstract_bulk_action";
import DeleteNoteBulkAction from "../bulk_actions/note/delete_note";
import SearchDefinition from "./SearchDefinition";

// Echoes the key, so a spec can find a button by its label.
vi.mock("../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/i18n")>()),
    t: (key: string) => key
}));

// Stands in for the CodeMirror editor, which loads on demand and is covered by its own spec.
let editorProps: { onChange(value: string): void, onEnter(): void } | undefined;
vi.mock("./SearchStringEditor", () => ({
    default: (props: { onChange(value: string): void, onEnter(): void }) => {
        editorProps = props;
        return <input />;
    }
}));

let resolveSetLabel: (() => void) | undefined;

beforeEach(() => {
    editorProps = undefined;
    resolveSetLabel = undefined;
    vi.spyOn(attributes, "setLabel").mockImplementation(() => new Promise<void>((resolve) => {
        resolveSetLabel = resolve;
    }));
    vi.spyOn(search, "runSearchNote").mockResolvedValue({ error: undefined });
    vi.spyOn(server, "post").mockResolvedValue(undefined);
    vi.spyOn(bulk_action, "parseActions").mockReturnValue([]);
    vi.spyOn(toast, "showMessage").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the search definition", () => {
    it("lays each parameter and bulk action out as a segment of the card", () => {
        vi.spyOn(bulk_action, "parseActions").mockReturnValue([
            new DeleteNoteBulkAction({ attributeId: "action1" } as FAttribute, {} as ActionDefinition)
        ]);
        const container = renderDefinition([ "searchString", "fastSearch" ]);
        const segments = [
            ...container.querySelectorAll(".search-definition-widget > .tn-card > .tn-card-body > *")
        ];

        expect(segments.map((segment) => segment.matches(".tn-card-section")))
            .toStrictEqual([ true, true, true, true ]);
        expect(segments[0]?.matches(".search-option.searchString")).toBe(true);
        expect(segments[1]?.matches(".search-option.fastSearch")).toBe(true);
        expect(segments[2]?.matches(".bulk-action")).toBe(true);
        expect(segments[3]?.matches(".search-definition-actions")).toBe(true);
        expect(segments[3]?.querySelector(".search-definition-add")).not.toBeNull();
        expect(segments[3]?.querySelector(".tn-split-button")).not.toBeNull();
    });

    it("shows a search error as a segment under the search string", async () => {
        vi.spyOn(search, "runSearchNote").mockResolvedValue({ error: "Unexpected token" });
        const container = renderDefinition();

        act(() => editorProps?.onEnter());
        await settle();

        const error = container.querySelector(
            ".search-option.searchString + .tn-card-section.search-definition-error");
        expect(error?.textContent).toContain("Unexpected token");
    });

    it("describes an option that configures nothing instead of offering help", () => {
        const container = renderDefinition([ "searchString", "fastSearch", "debug" ]);

        for (const [ name, text ] of [
            [ "fastSearch", "fast_search.description" ],
            [ "debug", "debug.debug_info" ]
        ]) {
            const row = container.querySelector(`.search-option.${name}`);
            expect(row?.querySelector(".search-option-description")?.textContent).toContain(text);
            expect(row?.querySelector(".help-dropdown")).toBeNull();
        }

        expect(container.querySelector(".search-option.searchString .help-dropdown")).not.toBeNull();
    });

    it("offers the unused options and the bulk actions from the same menu", async () => {
        const container = renderDefinition();
        const toggle = container.querySelector<HTMLButtonElement>(".search-definition-add button");
        await act(async () => toggle?.click());

        const menu = document.querySelector(".action-add-menu");
        expect(menu?.textContent).toContain("limit.limit");
        expect(menu?.querySelector(".dropdown-header")?.textContent).toBe("bulk_actions.bulk_actions");

        const groups = [ ...menu?.querySelectorAll(".dropdown-submenu") ?? [] ]
            .map((row) => row.textContent?.trim());
        expect(groups).toEqual([
            "bulk_actions.labels", "bulk_actions.relations", "bulk_actions.notes", "bulk_actions.other"
        ]);
    });

    it.each([
        [ "search", "search_definition.search_button", () => search.runSearchNote ],
        [ "search & execute", "search_definition.search_execute", () => server.post ]
    ])("saves a search string still being typed before the %s button runs it", async (_, label, getRequest) => {
        const container = renderDefinition();

        act(() => editorProps?.onChange("#book #year"));
        const button = await findAction(container, label);
        expect(button).toBeDefined();
        act(() => button?.click());
        await settle();

        expect(attributes.setLabel).toHaveBeenCalledWith("search1", "searchString", "#book #year");
        // The search must not reach the server before the label it reads is saved.
        expect(getRequest()).not.toHaveBeenCalled();

        resolveSetLabel?.();
        await settle();

        expect(getRequest()).toHaveBeenCalledTimes(1);
    });

    it("saves the search string before Enter runs it", async () => {
        renderDefinition();

        act(() => editorProps?.onChange("#book #year"));
        act(() => editorProps?.onEnter());
        await settle();

        expect(attributes.setLabel).toHaveBeenCalledWith("search1", "searchString", "#book #year");
        expect(search.runSearchNote).not.toHaveBeenCalled();

        resolveSetLabel?.();
        await settle();

        expect(search.runSearchNote).toHaveBeenCalledTimes(1);
    });
});

function renderDefinition(labels = [ "searchString" ]) {
    const note = {
        noteId: "search1",
        title: "search1",
        getLabelValue: (name: string) => (name === "searchString" ? "#book" : null),
        getAttribute: (type: string, name: string) =>
            (type === "label" && labels.includes(name) ? {} : undefined),
        getAttributes: () => [],
        isHiddenCompletely: () => false
    } as unknown as FNote;

    let container: HTMLDivElement | undefined;
    act(() => {
        container = renderInto(<SearchDefinition note={note} ntxId="ntx1" />);
    });
    if (!container) {
        throw new Error("The search definition did not render.");
    }
    return container;
}

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

/** The button named `label`, opening the split button's menu when it is one of the actions there. */
async function findAction(container: HTMLElement, label: string) {
    const button = [ ...container.querySelectorAll("button") ].find((b) => b.textContent?.includes(label));
    if (button) {
        return button;
    }

    const toggle = container.querySelector<HTMLButtonElement>(".dropdown-toggle-split");
    await act(async () => toggle?.click());
    return [ ...document.querySelectorAll<HTMLElement>(".dropdown-item") ]
        .find((item) => item.textContent?.includes(label));
}
