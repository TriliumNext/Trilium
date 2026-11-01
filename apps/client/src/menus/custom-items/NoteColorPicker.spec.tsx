import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `isMobile()` is read at render time inside the picker's custom colour cell; mock the module so
// the note-bound tests don't depend on the device detection.
const isMobileMock = vi.fn(() => false);
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => isMobileMock()
}));

const setLabelMock = vi.fn();
const removeOwnedLabelByNameMock = vi.fn();
vi.mock("../../services/attributes", () => ({
    default: {
        setLabel: (...args: unknown[]) => setLabelMock(...args),
        removeOwnedLabelByName: (...args: unknown[]) => removeOwnedLabelByNameMock(...args)
    }
}));

import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { DEFAULT_COLOR_PALETTE } from "../../widgets/react/ColorPicker";
import NoteColorPicker from "./NoteColorPicker";

/** Renders and lets the mount effects (froca lookup, colour sync) settle. */
async function renderNotePicker(note: Parameters<typeof NoteColorPicker>[0]["note"]) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(<NoteColorPicker note={note} />);
        // The note may be resolved through froca asynchronously; yield to the macrotask queue so
        // that promise chain settles and the follow-up `setNote` / colour-sync effects are
        // flushed within this same act() block.
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // act() only flushes the mount effect on its way out, so a lookup that resolves after that
    // point updates the state too late for the block above. Give it a second flush, otherwise
    // whether the picker is settled depends on how warm the module graph happens to be.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (!container) throw new Error("render produced no container");
    return container;
}

function cells(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>(".color-cell"));
}

function presetCells(container: HTMLElement) {
    return cells(container).filter((cell) =>
        !cell.classList.contains("color-cell-reset") && !cell.classList.contains("custom-color-cell"));
}

function resetCell(container: HTMLElement) {
    return container.querySelector<HTMLElement>(".color-cell-reset");
}

describe("NoteColorPicker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isMobileMock.mockReturnValue(false);
    });

    it("renders nothing when no note is given", () => {
        expect(renderInto(<NoteColorPicker note={null} />).innerHTML).toBe("");
    });

    it("keeps the class the themes style the context-menu picker with", async () => {
        const container = await renderNotePicker(buildNote({ title: "Classy" }));

        expect(container.querySelector(".color-picker.note-color-picker")).not.toBeNull();
    });

    it("renders the note's current colour as the selected preset", async () => {
        const note = buildNote({ title: "Coloured", "#color": DEFAULT_COLOR_PALETTE[1] });

        const container = await renderNotePicker(note);

        const selected = presetCells(container).filter((cell) => cell.classList.contains("selected"));
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[1]);
    });

    it("resolves a note passed by ID through froca and enables the picker", async () => {
        const note = buildNote({ title: "By id", "#color": DEFAULT_COLOR_PALETTE[3] });
        const getNote = vi.spyOn(froca, "getNote");

        const container = await renderNotePicker(note.noteId);

        expect(getNote).toHaveBeenCalledWith(note.noteId, true);
        // Once resolved the cells are no longer disabled.
        expect(cells(container).some((cell) => cell.classList.contains("disabled-color-cell"))).toBe(false);
        const selected = presetCells(container).filter((cell) => cell.classList.contains("selected"));
        expect(selected[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[3]);
        getNote.mockRestore();
    });

    it("stays disabled when the note ID cannot be resolved", async () => {
        const getNote = vi.spyOn(froca, "getNote").mockResolvedValue(null as never);

        const container = await renderNotePicker("missing");

        expect(cells(container).every((cell) => cell.classList.contains("disabled-color-cell"))).toBe(true);
        getNote.mockRestore();
    });

    it("writes the picked colour to the note's colour label", async () => {
        const note = buildNote({ title: "Writable" });

        const container = await renderNotePicker(note);

        presetCells(container)[4].click();

        expect(setLabelMock).toHaveBeenCalledWith(note.noteId, "color", DEFAULT_COLOR_PALETTE[4]);
        expect(removeOwnedLabelByNameMock).not.toHaveBeenCalled();
    });

    it("picks up a note that arrives after the first render", async () => {
        // A parent that mounts with `note={null}` while it loads and supplies the note afterwards
        // must end up with an enabled picker: the note-resolving effect has to re-run on the prop
        // change rather than only on mount.
        const note = buildNote({ title: "Late arrival", "#color": DEFAULT_COLOR_PALETTE[2] });
        let container: HTMLElement | undefined;

        await act(async () => {
            container = renderInto(<NoteColorPicker note={null} />);
        });
        expect(container?.innerHTML).toBe("");

        // Re-render into the same container so Preact updates the existing component instance
        // (a fresh `renderInto` would mount a brand new one and hide the bug).
        await act(async () => {
            if (container) {
                render(<NoteColorPicker note={note} />, container);
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        if (!container) throw new Error("render produced no container");

        expect(cells(container).some((cell) => cell.classList.contains("disabled-color-cell"))).toBe(false);
        const selected = presetCells(container).filter((cell) => cell.classList.contains("selected"));
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[2]);
    });

    it("removes the colour label when the colour is cleared", async () => {
        const note = buildNote({ title: "Clearable", "#color": DEFAULT_COLOR_PALETTE[0] });

        const container = await renderNotePicker(note);

        resetCell(container)?.click();

        expect(removeOwnedLabelByNameMock).toHaveBeenCalledWith(note, "color");
        expect(setLabelMock).not.toHaveBeenCalled();
    });
});
