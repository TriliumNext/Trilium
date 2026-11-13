import { render } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import Component from "../components/component";
import type NoteContext from "../components/note_context";
import type FNote from "../entities/fnote";
import { buildNote } from "../test/easy-froca";
import { NoteDetailWrapper } from "./NoteDetail";
import { ParentComponent } from "./react/react_utils";
import type { TypeWidgetProps } from "./type_widgets/type_widget";

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

        await mountWrapper(first, noteContext, true);
        expect(calls).toEqual([ "contentLoad:loading", `typeWidgetNote:${first.noteId}` ]);

        // A cached widget receives the next note one render later; until then nothing is reported
        // for it, so a note list cannot start ahead of the widget's own content.
        calls.length = 0;
        await mountWrapper(second, noteContext, true);
        expect(calls).toEqual([ "contentLoad:loading", `typeWidgetNote:${second.noteId}` ]);
    });

    it("reports nothing from a widget kept mounted for another note type", async () => {
        const { calls, noteContext } = recordContextData();

        await mountWrapper(buildNote({ title: "Hidden", type: "text" }), noteContext, false);
        expect(calls.filter((call) => call.startsWith("typeWidgetNote"))).toEqual([]);
    });

    async function mountWrapper(note: FNote, noteContext: NoteContext, isVisible: boolean) {
        if (!container) {
            container = document.createElement("div");
            document.body.appendChild(container);
        }
        const mountPoint = container;
        const props = { note, noteContext, ntxId: "ntx-1", parentComponent: new Component() } as unknown as TypeWidgetProps;
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <NoteDetailWrapper Element={LoadingWidget} type="editableText" isVisible={isVisible}
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

/** Starts loading the note's content from an effect, as `useNoteBlob()` does. */
function LoadingWidget({ note, noteContext }: TypeWidgetProps) {
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
