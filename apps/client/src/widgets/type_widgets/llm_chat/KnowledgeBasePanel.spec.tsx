import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const getNoteMock = vi.hoisted(() => vi.fn());
vi.mock("../../../services/froca.js", () => ({
    default: { getNote: getNoteMock }
}));

// Uninitialized i18n returns undefined; echo the key so labels are assertable.
vi.mock("../../../services/i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n.js")>()),
    t: (key: string) => key
}));

// The real autocomplete needs jQuery plumbing; capture its callback instead.
const autocompleteProps = vi.hoisted(() => ({ noteIdChanged: undefined as ((noteId: string) => void) | undefined }));
vi.mock("../../react/NoteAutocomplete.js", () => ({
    default: (props: { noteIdChanged: (noteId: string) => void }) => {
        autocompleteProps.noteIdChanged = props.noteIdChanged;
        return null;
    }
}));

import KnowledgeBasePanel from "./KnowledgeBasePanel.js";

describe("KnowledgeBasePanel", () => {
    let host: HTMLDivElement | undefined;

    async function mount(props: {
        sourceNoteIds: string[];
        onAddSource?: (noteId: string) => void;
        onRemoveSource?: (noteId: string) => void;
        disabled?: boolean;
    }) {
        host = document.createElement("div");
        document.body.appendChild(host);
        const target = host;
        await act(async () => {
            render(
                <KnowledgeBasePanel
                    sourceNoteIds={props.sourceNoteIds}
                    onAddSource={props.onAddSource ?? vi.fn()}
                    onRemoveSource={props.onRemoveSource ?? vi.fn()}
                    disabled={props.disabled}
                />,
                target
            );
        });
        await act(async () => {});
        return target;
    }

    afterEach(() => {
        if (host) {
            render(null, host);
            host.remove();
            host = undefined;
        }
        getNoteMock.mockReset();
        autocompleteProps.noteIdChanged = undefined;
    });

    it("renders a chip per source with the resolved note title", async () => {
        getNoteMock.mockImplementation(async (id: string) => ({ title: `Title of ${id}` }));

        const el = await mount({ sourceNoteIds: ["n1", "n2"] });

        const chips = [...el.querySelectorAll(".llm-chat-kb-chip-title")].map(c => c.textContent);
        expect(chips).toEqual(["Title of n1", "Title of n2"]);
    });

    it("falls back to the note id when the title cannot be resolved", async () => {
        getNoteMock.mockResolvedValue(null);
        const el = await mount({ sourceNoteIds: ["ghost"] });
        expect(el.querySelector(".llm-chat-kb-chip-title")?.textContent).toBe("ghost");
    });

    it("removes a source via its chip button", async () => {
        getNoteMock.mockResolvedValue({ title: "T" });
        const onRemoveSource = vi.fn();
        const el = await mount({ sourceNoteIds: ["n1"], onRemoveSource });

        await act(async () => {
            el.querySelector<HTMLButtonElement>(".llm-chat-kb-chip-remove")!.click();
        });
        expect(onRemoveSource).toHaveBeenCalledWith("n1");
    });

    it("disables the remove buttons while streaming", async () => {
        getNoteMock.mockResolvedValue({ title: "T" });
        const el = await mount({ sourceNoteIds: ["n1"], disabled: true });
        expect(el.querySelector<HTMLButtonElement>(".llm-chat-kb-chip-remove")!.disabled).toBe(true);
    });

    it("adds a source picked in the autocomplete and ignores empty picks", async () => {
        getNoteMock.mockResolvedValue({ title: "T" });
        const onAddSource = vi.fn();
        await mount({ sourceNoteIds: [], onAddSource });

        await act(async () => { autocompleteProps.noteIdChanged?.("picked"); });
        expect(onAddSource).toHaveBeenCalledWith("picked");

        onAddSource.mockClear();
        await act(async () => { autocompleteProps.noteIdChanged?.(""); });
        expect(onAddSource).not.toHaveBeenCalled();
    });
});
