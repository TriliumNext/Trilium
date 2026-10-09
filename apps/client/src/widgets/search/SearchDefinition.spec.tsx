import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import bulk_action from "../../services/bulk_action";
import search from "../../services/search";
import server from "../../services/server";
import toast from "../../services/toast";
import { renderInto } from "../../test/render";
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
    it.each([
        [ "search", "search_definition.search_button", () => search.runSearchNote ],
        [ "search & execute", "search_definition.search_execute", () => server.post ]
    ])("saves a search string still being typed before the %s button runs it", async (_, label, getRequest) => {
        const container = renderDefinition();

        act(() => editorProps?.onChange("#book #year"));
        const button = [ ...container.querySelectorAll("button") ].find((b) => b.textContent?.includes(label));
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

function renderDefinition() {
    const note = {
        noteId: "search1",
        title: "search1",
        getLabelValue: (name: string) => (name === "searchString" ? "#book" : null),
        getAttribute: (type: string, name: string) =>
            (type === "label" && name === "searchString" ? {} : undefined),
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
