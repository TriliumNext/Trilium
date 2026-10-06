// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { ParentComponent } from "../../react/react_utils";
import { EditableCode } from "./Code";

describe("EditableCode", () => {
    const parent = { registerHandler() {}, removeHandler() {}, componentId: "c" } as any;
    const markdown = { type: "code", mime: "text/x-markdown" } as const;
    const noteA = buildNote({ ...markdown, title: "A", content: "# Note A" });
    const noteB = buildNote({ ...markdown, title: "B", content: "# Note B" });

    function show(note: FNote, onContentChanged: (content: string) => void) {
        return (
            <ParentComponent.Provider value={parent}>
                <EditableCode
                    note={note} ntxId="ntx" parentComponent={parent}
                    noteContext={undefined} viewScope={undefined}
                    onContentChanged={onContentChanged}
                />
            </ParentComponent.Provider>
        );
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // jsdom has no layout, so every editor has a null `offsetParent` and counts as hidden.
    it("reports each note loaded into a hidden editor", async () => {
        const onContentChanged = vi.fn();

        let container: HTMLElement | undefined;
        await act(async () => { container = renderInto(show(noteA, onContentChanged)); });
        await vi.waitFor(() => expect(onContentChanged).toHaveBeenLastCalledWith("# Note A"));

        await act(async () => {
            if (container) render(show(noteB, onContentChanged), container);
        });
        await vi.waitFor(() => expect(onContentChanged).toHaveBeenLastCalledWith("# Note B"));
    });

    it("reports a load into a visible editor once", async () => {
        vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
        const onContentChanged = vi.fn();

        await act(async () => { renderInto(show(noteA, onContentChanged)); });
        await vi.waitFor(() => expect(onContentChanged).toHaveBeenCalledWith("# Note A"));
        expect(onContentChanged).toHaveBeenCalledTimes(1);
    });
});
