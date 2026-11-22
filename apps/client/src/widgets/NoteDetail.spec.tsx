import { render } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../components/component";
import type NoteContext from "../components/note_context";
import type FNote from "../entities/fnote";
import { buildNote } from "../test/easy-froca";
import NoteDetail, { NoteDetailWrapper } from "./NoteDetail";
import type { ExtendedNoteType } from "./note_types";
import { NoteContextContext, ParentComponent } from "./react/react_utils";
import type { TypeWidgetProps } from "./type_widgets/type_widget";

// The type widgets render nothing, so no editor loads.
vi.mock("./note_types", async (importOriginal) => {
    const original = await importOriginal<typeof import("./note_types")>();
    const mappings = Object.entries(original.TYPE_MAPPINGS)
        .map(([ type, mapping ]) => [ type, { ...mapping, view: () => () => null } ]);
    return { ...original, TYPE_MAPPINGS: Object.fromEntries(mappings) };
});

describe("NoteDetail", () => {
    it("marks the scroller while it shows a type laid out in flow with an end margin", async () => {
        const scroller = document.body.appendChild(document.createElement("div"));
        const parentComponent = new Component();
        const noteContext = {
            ntxId: "ntx-margin",
            hoistedNoteId: "root",
            viewScope: {},
            note: fakeNote("text"),
            notePath: "root/text",
            isReadOnly: async () => false,
            hasNoteList: () => false,
            isActive: () => false,
            isCommandTarget: () => false,
            getContextData: () => undefined,
            setContextData: () => {}
        };
        await act(async () => render(
            <ParentComponent.Provider value={parentComponent}>
                <NoteContextContext.Provider value={noteContext as unknown as NoteContext}>
                    <NoteDetail />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>,
            scroller
        ));
        const showNote = async (note: FNote | null) => {
            noteContext.note = note;
            noteContext.notePath = note ? `root/${note.noteId}` : "";
            await act(async () => {
                await parentComponent.handleEventInChildren("noteSwitched", {
                    noteContext: noteContext as unknown as NoteContext,
                    notePath: noteContext.notePath
                });
            });
        };
        const hasEndMargin = () => scroller.classList.contains("detail-has-end-margin");

        await vi.waitFor(() => expect(hasEndMargin()).toBe(true));
        await showNote(fakeNote("render"));
        await vi.waitFor(() => expect(hasEndMargin()).toBe(false));
        await showNote(fakeNote("text"));
        await vi.waitFor(() => expect(hasEndMargin()).toBe(true));
        // A code note fills the pane, and an empty tab shows no note.
        await showNote(fakeNote("code"));
        await vi.waitFor(() => expect(hasEndMargin()).toBe(false));
        await showNote(fakeNote("book"));
        await vi.waitFor(() => expect(hasEndMargin()).toBe(true));
        // A book with no children fills the pane to center its message.
        await showNote(fakeNote("book", false));
        await vi.waitFor(() => expect(hasEndMargin()).toBe(false));
        await showNote(null);
        await vi.waitFor(() => expect(scroller.querySelector(".note-detail-empty")).not.toBeNull());
        expect(hasEndMargin()).toBe(false);

        await act(async () => render(null, scroller));
        scroller.remove();
    });

    /** A note that is not in froca, so that its type is resolved without fetching its blob. */
    function fakeNote(type: string, hasChildren = true) {
        return {
            noteId: `${type}-note-${hasChildren}`,
            type,
            mime: "text/html",
            isProtected: false,
            isTriliumSqlite: () => false,
            isMarkdown: () => false,
            isIconPack: () => false,
            hasChildren: () => hasChildren,
            getLabelValue: () => null,
            getOwnedLabelValue: () => null
        } as unknown as FNote;
    }
});

describe("NoteDetailWrapper", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("reports the note shown only after its widget has started loading the content", async () => {
        const { calls, noteContext } = recordContextData();
        const first = buildNote({ title: "First", type: "text" });
        const second = buildNote({ title: "Second", type: "text" });

        await mountWrapper(first, noteContext);
        expect(calls).toEqual([ "contentLoad:loading", `typeWidgetNote:${first.noteId}` ]);

        // A cached widget receives the next note one render later; until then nothing is reported
        // for it, so a note list cannot start ahead of the widget's own content.
        calls.length = 0;
        await mountWrapper(second, noteContext);
        expect(calls).toEqual([ "contentLoad:loading", `typeWidgetNote:${second.noteId}` ]);
    });

    it("waits for a widget that draws its content later to say it is shown", async () => {
        const { calls, noteContext } = recordContextData();
        const note = buildNote({ title: "Editable", type: "text" });

        await mountWrapper(note, noteContext, { type: "editableText" });
        expect(calls).toEqual([ "contentLoad:loading" ]);

        await act(async () => shownCallbacks.at(-1)?.());
        expect(calls).toEqual([ "contentLoad:loading", `typeWidgetNote:${note.noteId}` ]);

        // Another type takes over for a child note, then the same note comes back: the editor
        // kept its content while hidden, so it has nothing to draw and nothing to report.
        const child = buildNote({ title: "Child", type: "file" });
        await mountWrapper(child, noteContext, { type: "editableText", isVisible: false });
        calls.length = 0;
        await mountWrapper(note, noteContext, { type: "editableText" });
        expect(calls).toEqual([ `typeWidgetNote:${note.noteId}` ]);
    });

    it("reports nothing from a widget kept mounted for another note type", async () => {
        const { calls, noteContext } = recordContextData();

        await mountWrapper(buildNote({ title: "Hidden", type: "text" }), noteContext, { isVisible: false });
        await mountWrapper(buildNote({ title: "Hidden editor", type: "text" }), noteContext,
            { type: "editableText", isVisible: false });
        await act(async () => shownCallbacks.at(-1)?.());
        expect(calls.filter((call) => call.startsWith("typeWidgetNote"))).toEqual([]);
    });

    async function mountWrapper(note: FNote, noteContext: NoteContext,
        { type = "readOnlyText", isVisible = true }: { type?: ExtendedNoteType; isVisible?: boolean } = {}) {
        if (!container) {
            container = document.createElement("div");
            document.body.appendChild(container);
        }
        const mountPoint = container;
        const props = { note, noteContext, ntxId: "ntx-1", parentComponent: new Component() } as unknown as TypeWidgetProps;
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <NoteDetailWrapper Element={LoadingWidget} type={type} isVisible={isVisible}
                        isFullHeight={false} props={props} />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        // Passive effects run after paint.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
        });
    }
});

/** The `onContentShown` callbacks the widgets were given, latest last. */
const shownCallbacks: (() => void)[] = [];

/** Starts loading the note's content from an effect, as `useNoteBlob()` does. */
function LoadingWidget({ note, noteContext, onContentShown }: TypeWidgetProps) {
    if (onContentShown) shownCallbacks.push(onContentShown);
    useEffect(() => {
        noteContext?.setContextData("contentLoad", { state: "loading", retry: () => {} });
    }, [ note.noteId ]);
    return <div />;
}

function recordContextData() {
    const calls: string[] = [];
    const noteContext = {
        setContextData(key: string, value: { state?: string; noteId?: string }) {
            calls.push(`${key}:${value.state ?? value.noteId}`);
        }
    } as unknown as NoteContext;
    return { calls, noteContext };
}
