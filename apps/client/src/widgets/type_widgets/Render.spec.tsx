import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const renderNote = vi.hoisted(() => vi.fn());

vi.mock("../../services/render", () => ({ default: { render: renderNote } }));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useNoteRelation: (_note: unknown, name: string) => name === "renderNote" ? [ {} ] : [],
    useTriliumEvent: () => {}
}));

import type FNote from "../../entities/fnote";
import * as reactUtils from "../react/react_utils";
import Render from "./Render";
import type { TypeWidgetProps } from "./type_widget";

const container = document.createElement("div");
document.body.appendChild(container);

afterEach(async () => {
    await act(async () => render(null, container));
    renderNote.mockClear();
});

describe("Render content", () => {
    it("aborts the previous render on note change and on unmount", async () => {
        const dispose = vi.spyOn(reactUtils, "disposeReactWidget");
        const first = { noteId: "first" } as FNote;
        const second = { noteId: "second" } as FNote;
        const props = (note: FNote) => ({ note, ntxId: "pane", noteContext: null }) as unknown as TypeWidgetProps;

        await act(async () => render(<Render {...props(first)} />, container));
        expect(renderNote).toHaveBeenCalledTimes(1);
        expect(renderNote.mock.calls[0][0]).toBe(first);
        const firstContainer = container.querySelector(".note-detail-render-content");
        const firstSignal = renderNote.mock.calls[0][3] as AbortSignal;
        expect(firstSignal.aborted).toBe(false);

        await act(async () => render(<Render {...props(second)} />, container));
        expect(firstSignal.aborted).toBe(true);
        expect(dispose).toHaveBeenCalledWith(firstContainer);
        expect(renderNote).toHaveBeenCalledTimes(2);
        const secondContainer = container.querySelector(".note-detail-render-content");
        const secondSignal = renderNote.mock.calls[1][3] as AbortSignal;
        expect(secondSignal.aborted).toBe(false);

        await act(async () => render(null, container));
        expect(secondSignal.aborted).toBe(true);
        expect(dispose).toHaveBeenCalledWith(secondContainer);
        dispose.mockRestore();
    });
});
