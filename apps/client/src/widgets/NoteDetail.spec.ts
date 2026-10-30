import { h, render } from "preact";
import { useContext } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import appContext, { type EventData } from "../components/app_context";
import Component from "../components/component";
import NoteContext from "../components/note_context";
import type FNote from "../entities/fnote";
import froca from "../services/froca";
import toast from "../services/toast";

// NoteDetail pulls in note_tree, which loads jquery.fancytree at import time and needs a `jQuery`
// global the test env doesn't provide. The pure function under test never touches the tree, so stub it.
vi.mock("./note_tree", () => ({ default: class {} }));

import {
    checkFillsPane, getExtendedWidgetType, NoteDetailWrapper, printInThisTab,
    shouldFocusOnNoteChange, useDeferredDetailFocus, useNoteInfo
} from "./NoteDetail";
import { useLegacyImperativeHandlers, useTriliumEvent } from "./react/hooks";
import {
    ContainerVisibilityContext, NoteContextContext, ParentComponent
} from "./react/react_utils";
import type { TypeWidgetProps } from "./type_widgets/type_widget";

const FAKE_NOTE_ID = "blob-stub-note";

describe("getExtendedWidgetType blob-stub routing", () => {
    afterEach(() => {
        delete froca.notes[FAKE_NOTE_ID];
    });

    /**
     * Builds a note and registers it in the froca cache: `getExtendedWidgetType` only fetches a blob
     * for notes still present there, so an unregistered note would skip the stub check entirely.
     */
    function fakeNote(overrides: Record<string, unknown> = {}): FNote {
        const note = {
            noteId: FAKE_NOTE_ID,
            type: "text",
            isProtected: false,
            isTriliumSqlite: () => false,
            isMarkdown: () => false,
            isIconPack: () => false,
            getBlob: async () => ({ isStubbed: false }),
            ...overrides
        } as unknown as FNote;
        froca.notes[FAKE_NOTE_ID] = note;
        return note;
    }

    function fakeContext(overrides: Record<string, unknown> = {}): NoteContext {
        return {
            viewScope: {},
            isReadOnly: async () => false,
            ...overrides
        } as unknown as NoteContext;
    }

    it("routes a note whose blob was withheld (stubbed) to the blobStub placeholder", async () => {
        const note = fakeNote({ getBlob: async () => ({ isStubbed: true }) });
        expect(await getExtendedWidgetType(note, fakeContext())).toBe("blobStub");
    });

    it("routes a normal text note to the editable text widget", async () => {
        expect(await getExtendedWidgetType(fakeNote(), fakeContext())).toBe("editableText");
    });

    it("does not fetch the blob for note types that are not blob-backed", async () => {
        const getBlob = vi.fn(async () => ({ isStubbed: true }));
        // A launcher resolves to "doc", which is not blob-backed, so the stub check must be skipped.
        const note = fakeNote({ type: "launcher", getBlob });
        expect(await getExtendedWidgetType(note, fakeContext())).toBe("doc");
        expect(getBlob).not.toHaveBeenCalled();
    });
});

describe("printInThisTab", () => {
    it("saves every open note before opening the print page in this tab", async () => {
        const steps: string[] = [];
        const originalTabManager = appContext.tabManager;
        appContext.tabManager = {
            getNoteContexts: () => [ { ntxId: "a" }, { ntxId: "b" }, { ntxId: null } ]
        } as unknown as typeof appContext.tabManager;
        const trigger = vi.spyOn(appContext, "triggerEvent")
            .mockImplementation(async (name, data) => {
                steps.push(`${name} ${JSON.stringify(data)}`);
            });
        const assign = vi.spyOn(window.location, "assign").mockImplementation((url) => {
            steps.push(`assign ${String(url)}`);
        });
        const originalListeners = appContext.beforeUnloadListeners;
        let saved = false;
        appContext.beforeUnloadListeners = [];
        appContext.addBeforeUnloadListener(() => saved);
        const component = { componentId: "editor", beforeUnloadEvent: () => true };
        appContext.addBeforeUnloadListener(component as never);
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        try {
            // A save that has not landed keeps the app open, with the usual message.
            await printInThisTab("root/abc");
            expect(steps).toEqual([ 'beforeNoteContextRemove {"ntxIds":["a","b"]}' ]);
            expect(showMessage).toHaveBeenCalledOnce();

            saved = true;
            steps.length = 0;
            await printInThisTab("root/abc");
            expect(steps).toEqual([
                'beforeNoteContextRemove {"ntxIds":["a","b"]}',
                "assign ?print&autoprint#root/abc"
            ]);
        } finally {
            trigger.mockRestore();
            assign.mockRestore();
            showMessage.mockRestore();
            appContext.tabManager = originalTabManager;
            appContext.beforeUnloadListeners = originalListeners;
        }
    });
});

describe("checkFillsPane", () => {
    it("lets the space usage page fill the pane, in its own view only", () => {
        const spaceUsage = { noteId: "_spaceUsage" } as unknown as NoteContext;
        const backendLog = { noteId: "_backendLog" } as unknown as NoteContext;
        expect(checkFillsPane(spaceUsage, "contentWidget")).toBe(true);
        expect(checkFillsPane(spaceUsage, "attachmentList")).toBe(false);
        expect(checkFillsPane(backendLog, "contentWidget")).toBe(false);
        expect(checkFillsPane(undefined, "contentWidget")).toBe(false);
    });
});

describe("useDeferredDetailFocus", () => {
    const replay = vi.fn();
    let request: ReturnType<typeof useDeferredDetailFocus> | undefined;
    const host = document.createElement("div");

    function Harness({ isReady }: { isReady: boolean }) {
        request = useDeferredDetailFocus(isReady, replay);
        return null;
    }
    const renderHarness = (isReady: boolean) => act(() => render(h(Harness, { isReady }), host));

    afterEach(() => {
        render(null, host);
        replay.mockReset();
    });

    it("holds a focus that arrives before the note's type widget shows, and replays it once", () => {
        renderHarness(false);
        request?.({ ntxId: "ntx-1" });
        expect(replay).not.toHaveBeenCalled();

        renderHarness(true);
        expect(replay).toHaveBeenCalledExactlyOnceWith({ ntxId: "ntx-1" });

        renderHarness(false);
        renderHarness(true);
        expect(replay).toHaveBeenCalledOnce();
    });

    it("leaves a focus that arrives once the widget shows to the widget itself", () => {
        renderHarness(true);
        request?.({ ntxId: "ntx-1" });
        renderHarness(false);
        renderHarness(true);
        expect(replay).not.toHaveBeenCalled();
    });
});

describe("useNoteInfo", () => {
    const host = document.createElement("div");

    function Harness() {
        useNoteInfo();
        return null;
    }

    afterEach(() => {
        render(null, host);
    });

    it("reloads on a type or MIME change of its own note only", async () => {
        const note = {
            noteId: "shown-note",
            type: "text",
            isProtected: false,
            isTriliumSqlite: () => false,
            isMarkdown: () => false,
            isIconPack: () => false
        } as unknown as FNote;
        const setContextData = vi.fn();
        const noteContext = {
            note,
            notePath: "root/shown-note",
            hoistedNoteId: "root",
            viewScope: {},
            isReadOnly: async () => false,
            setContextData
        } as unknown as NoteContext;
        const parentComponent = new Component();
        await act(async () => render(
            h(ParentComponent.Provider, { value: parentComponent },
                h(NoteContextContext.Provider, { value: noteContext }, h(Harness, {}))),
            host
        ));
        const loadStates = () => setContextData.mock.calls
            .map(([ key, { state } ]) => `${key}:${state}`);
        await vi.waitFor(() => expect(loadStates()).toEqual(
            [ "contentLoad:loading", "contentLoad:loaded" ]));
        setContextData.mockClear();

        const changeNoteType = (noteId: string) => act(async () => {
            await parentComponent.handleEventInChildren("noteTypeMimeChanged", { noteId });
        });

        // A `NoteDetail` that shows the changed note triggers the event for the whole app.
        await changeNoteType("other-note");
        expect(setContextData).not.toHaveBeenCalled();

        await changeNoteType("shown-note");
        await vi.waitFor(() => expect(loadStates()).toEqual(
            [ "contentLoad:loading", "contentLoad:loaded" ]));
    });
});

describe("NoteDetailWrapper", () => {
    const host = document.createElement("div");
    const received: string[] = [];
    let typeWidgetParent: Component | null = null;
    let typeWidgetProps: TypeWidgetProps | null = null;
    let hostComponent = new Component();
    const addLinkToText = vi.fn();
    const imperativeHandlers = { addLinkToTextCommand: addLinkToText };

    function TypeWidget(props: TypeWidgetProps) {
        typeWidgetParent = useContext(ParentComponent);
        typeWidgetProps = props;
        useLegacyImperativeHandlers(imperativeHandlers);
        useTriliumEvent("findInText", () => received.push("findInText"));
        useTriliumEvent("executeWithCodeEditor", () => received.push("executeWithCodeEditor"));
        useTriliumEvent("entitiesReloaded", () => received.push("entitiesReloaded"));
        useTriliumEvent("noteSwitched", () => received.push("noteSwitched"));
        useTriliumEvent("sqlQueryResults", () => received.push("sqlQueryResults"));
        return h("div", {}, h("p", { className: "type-widget-content" }));
    }

    function renderWrapper(isVisible: boolean, containerVisible = true) {
        const wrapper = h(NoteDetailWrapper, {
            Element: TypeWidget, type: "editableText", isVisible, isFullHeight: false,
            props: { parentComponent: hostComponent } as TypeWidgetProps
        });
        act(() => render(
            h(ParentComponent.Provider, { value: hostComponent },
                h(ContainerVisibilityContext.Provider, { value: containerVisible }, wrapper)),
            host
        ));
    }

    async function dispatchAll() {
        await hostComponent.handleEventInChildren("findInText", {});
        await hostComponent.handleEventInChildren("executeWithCodeEditor",
            { ntxId: "ntx", resolve: () => {} } as unknown as EventData<"executeWithCodeEditor">);
        await hostComponent.handleEventInChildren("entitiesReloaded",
            {} as EventData<"entitiesReloaded">);
        await hostComponent.handleEventInChildren("noteSwitched", {} as EventData<"noteSwitched">);
        await hostComponent.handleEventInChildren("sqlQueryResults",
            {} as EventData<"sqlQueryResults">);
    }

    afterEach(() => {
        render(null, host);
        received.length = 0;
        typeWidgetParent = null;
        typeWidgetProps = null;
        hostComponent = new Component();
        addLinkToText.mockReset();
    });

    it("sends requests only to the displayed type widget, and syncs a hidden one", async () => {
        renderWrapper(false);
        await dispatchAll();
        expect(received).toEqual([ "entitiesReloaded", "noteSwitched", "sqlQueryResults" ]);

        received.length = 0;
        renderWrapper(true, false);
        await dispatchAll();
        expect(received).toEqual([ "entitiesReloaded", "noteSwitched", "sqlQueryResults" ]);

        received.length = 0;
        renderWrapper(true);
        await dispatchAll();
        expect(received).toEqual(
            [ "findInText", "executeWithCodeEditor", "entitiesReloaded", "noteSwitched",
                "sqlQueryResults" ]);
    });

    it("gives the type widget a parent that saves and commands as the host", () => {
        const triggerCommand = vi.spyOn(hostComponent, "triggerCommand");
        renderWrapper(true);

        const parent = typeWidgetParent;
        if (!parent) throw new Error("The type widget did not render.");
        expect(parent).not.toBe(hostComponent);
        expect(parent.componentId).toBe(hostComponent.componentId);
        expect(hostComponent.children).toContain(parent);

        parent.triggerCommand("hoistNote", { noteId: "root" });
        expect(triggerCommand).toHaveBeenCalledWith("hoistNote", { noteId: "root" });

        render(null, host);
        expect(hostComponent.children).not.toContain(parent);
    });

    it("lets the DOM and the widget's props reach the handlers the type widget installs", () => {
        renderWrapper(true);
        const parent = typeWidgetParent;
        const content = host.querySelector<HTMLElement>(".type-widget-content");
        if (!parent || !content) throw new Error("The type widget did not render.");

        // The text editor finds its host this way, e.g. for reference link titles.
        expect(appContext.getComponentByEl(content)).toBe(parent);
        expect(typeWidgetProps?.parentComponent).toBe(parent);

        // Keyboard shortcuts trigger their command on `props.parentComponent`.
        typeWidgetProps?.parentComponent?.triggerCommand("addLinkToText", {});
        expect(addLinkToText).toHaveBeenCalledOnce();
    });
});

describe("shouldFocusOnNoteChange", () => {
    it("focuses the editor of a note opened elsewhere, but not on a phone, nor while the tree or the split has focus", () => {
        const split = document.createElement("div");
        const title = document.createElement("input");
        split.append(title);
        const treeTitle = document.createElement("span");
        treeTitle.className = "fancytree-title";
        const elsewhere = document.createElement("button");

        expect(shouldFocusOnNoteChange(elsewhere, split, false)).toBe(true);
        expect(shouldFocusOnNoteChange(elsewhere, split, true)).toBe(false);
        expect(shouldFocusOnNoteChange(treeTitle, split, false)).toBe(false);
        expect(shouldFocusOnNoteChange(title, split, false)).toBe(false);
    });
});
