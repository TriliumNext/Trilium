import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted alongside the mock factories, which can run before this file's top-level constants exist.
const mocks = vi.hoisted(() => ({
    // Hoisted rather than a plain const: app_context pulls the server service in at module scope, so the
    // factory below runs before this file's own top-level statements do.
    // Replacing the module also replaces the shared mock from test/setup.ts, so unrelated module-scope
    // loads have to be answered here too: keyboard_actions.ts filters the response as it imports.
    serverGet: vi.fn<(url: string) => Promise<unknown>>(async (url) => (url === "keyboard-actions" ? [] : {})),
    entitiesReloadedHandler: undefined as ((data: { loadResults: unknown }) => void) | undefined
}));
const serverGet = mocks.serverGet;

vi.mock("../../services/server", () => ({
    default: { get: (url: string) => mocks.serverGet(url) }
}));

// Fully mocked: the real hooks module imports half the app (app_context, keyboard actions) at module
// scope, and capturing the handler is what lets a test drive the entity-change path directly.
vi.mock("../react/hooks", () => ({
    useTriliumEvent: (_name: string, handler: (data: { loadResults: unknown }) => void) => {
        mocks.entitiesReloadedHandler = handler;
    }
}));

import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { useNoteMetadata } from "./NoteInfoTab";

/** A reload touching this note, which is what a deletion looks like to the hook. */
const NOTE_RELOADED = { loadResults: { isNoteReloaded: () => true, isNoteContentReloaded: () => false } };

function Probe({ note }: { note: FNote | null }) {
    useNoteMetadata(note);
    return <div />;
}

let container: HTMLDivElement | undefined;

/** Renders and flushes the mount effect, which is what issues the tab's first metadata request. */
async function renderProbe(note: FNote | null) {
    const target = container ?? document.body.appendChild(document.createElement("div"));
    container = target;
    await act(async () => {
        render(<Probe note={note} />, target);
    });
    return target;
}

function unmount() {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
}

afterEach(() => {
    unmount();
    mocks.entitiesReloadedHandler = undefined;
    serverGet.mockClear();
    vi.useRealTimers();
});

describe("useNoteMetadata", () => {
    it("asks the server for the metadata of a note that exists", async () => {
        const note = buildNote({ title: "Present" });

        await renderProbe(note);

        expect(serverGet).toHaveBeenCalledWith(`notes/${note.noteId}/metadata`);
    });

    it("does not ask about a note deleted while the debounced refresh was pending", async () => {
        vi.useFakeTimers();
        const note = buildNote({ title: "Doomed" });
        await renderProbe(note);
        serverGet.mockClear();

        // Deleting a note is itself an entity change for it, so the tab schedules a refresh — and only
        // then does the note leave froca. Ten seconds later the request would 404 (#10823 follow-up).
        mocks.entitiesReloadedHandler?.(NOTE_RELOADED);
        delete froca.notes[note.noteId];
        vi.advanceTimersByTime(10_000);

        expect(serverGet).not.toHaveBeenCalled();
    });

    it("drops a pending refresh when the tab goes away", async () => {
        vi.useFakeTimers();
        const note = buildNote({ title: "Closed" });
        await renderProbe(note);
        serverGet.mockClear();

        mocks.entitiesReloadedHandler?.(NOTE_RELOADED);
        unmount();
        vi.advanceTimersByTime(10_000);

        expect(serverGet).not.toHaveBeenCalled();
    });

    it("still refreshes a note that is merely modified", async () => {
        vi.useFakeTimers();
        const note = buildNote({ title: "Edited" });
        await renderProbe(note);
        serverGet.mockClear();

        mocks.entitiesReloadedHandler?.(NOTE_RELOADED);
        vi.advanceTimersByTime(10_000);

        expect(serverGet).toHaveBeenCalledWith(`notes/${note.noteId}/metadata`);
    });
});
