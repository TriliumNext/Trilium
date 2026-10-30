// @vitest-environment happy-dom
import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppPayload, HostedApp } from "./app_host.js";
import mountEditView, { type EditView, type EditViewOptions, type ShareEditGlobals } from "./edit_view.js";

const mocks = vi.hoisted(() => ({
    eventHandlers: new Map<string, (data: unknown) => void>(),
    put: vi.fn(),
    getHeaders: vi.fn(),
    getComponentByEl: vi.fn(),
    getReferenceLinkTitle: vi.fn(),
    getReferenceLinkTitleSync: vi.fn(),
    getNoteFromCache: vi.fn(),
    triggerCommand: vi.fn(),
    widget: vi.fn(() => <p className="widget">Editor</p>),
    beforeUnloadListeners: [] as unknown[],
    addBeforeUnloadListener: vi.fn(),
    viewModule: undefined as unknown,
    hostProps: {} as Record<string, unknown>
}));

vi.mock("@triliumnext/client/src/stylesheets/ckeditor-theme.css", () => ({}));
vi.mock("@triliumnext/client/src/widgets/type_widgets/text/EditableText.css", () => ({}));
vi.mock("@triliumnext/client/src/components/app_context.js", () => ({
    default: {
        getComponentByEl: mocks.getComponentByEl,
        addBeforeUnloadListener: mocks.addBeforeUnloadListener,
        get beforeUnloadListeners() {
            return mocks.beforeUnloadListeners;
        },
        set beforeUnloadListeners(listeners: unknown[]) {
            mocks.beforeUnloadListeners = listeners;
        }
    }
}));
vi.mock("@triliumnext/client/src/components/component.js", () => ({
    default: class Component { triggerCommand = mocks.triggerCommand; }
}));
vi.mock("@triliumnext/client/src/services/froca.js", () => ({
    default: { getNoteFromCache: mocks.getNoteFromCache }
}));
vi.mock("@triliumnext/client/src/services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("@triliumnext/client/src/services/link.js", () => ({
    default: {
        getReferenceLinkTitle: mocks.getReferenceLinkTitle,
        getReferenceLinkTitleSync: mocks.getReferenceLinkTitleSync
    }
}));
vi.mock("@triliumnext/client/src/services/server.js", () => ({
    default: { putWithSilentRefusal: mocks.put, getHeaders: mocks.getHeaders }
}));
vi.mock("@triliumnext/client/src/services/utils.js", () => ({
    default: { isDesktop: () => true, isMobile: () => false },
    randomString: () => "component-id"
}));
vi.mock("@triliumnext/client/src/widgets/note_types.js", () => ({
    TYPE_MAPPINGS: {
        editableText: {
            view: async () => mocks.viewModule ?? { default: mocks.widget },
            className: "note-detail-editable-text"
        }
    }
}));
vi.mock("@triliumnext/client/src/widgets/react/hooks.js", () => ({
    useTriliumEvent: (name: string, handler: (data: unknown) => void) => {
        mocks.eventHandlers.set(name, handler);
    }
}));
vi.mock("@triliumnext/client/src/widgets/react/Alert.js", () => ({
    default: ({ className, children }: { className: string; children: ComponentChildren }) =>
        <div className={`alert ${className}`}>{children}</div>
}));
vi.mock("@triliumnext/client/src/widgets/react/Button.js", () => ({
    default: ({ text, onClick }: { text: string; onClick(): void }) =>
        <button type="button" onClick={onClick}>{text}</button>
}));
vi.mock("./app_host.js", () => ({
    default: (props: { noteId: string; payload: AppPayload; component: unknown; children(app: HostedApp): ComponentChildren }) => {
        mocks.hostProps = props;
        return props.children({ note: { noteId: props.noteId } } as HostedApp);
    }
}));

describe("mountEditView", () => {
    let container: HTMLElement;
    let title: HTMLElement;
    let reload: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("glob", { isShare: true });
        reload = vi.fn();
        vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
        document.body.innerHTML = `<h1 id="title"> Old title </h1><div id="container"></div>`;
        container = document.getElementById("container") as HTMLElement;
        title = document.getElementById("title") as HTMLElement;
        mocks.put.mockResolvedValue({});
        mocks.getNoteFromCache.mockReturnValue({ noteId: "note" });
        mocks.viewModule = undefined;
    });

    afterEach(() => {
        act(() => render(null, container));
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it("installs the app's globals for the share's API and mounts the editor, editable", async () => {
        await act(async () => { await mountEditView(container, buildOptions()); });

        const glob = window.glob as Record<string, unknown>;
        expect(glob).toMatchObject({
            baseApiUrl: "api/",
            csrfToken: "csrf",
            csrfRefreshUrl: "api/edit/session?noteId=note",
            componentId: "component-id",
            getHeaders: mocks.getHeaders,
            shareEdit: expect.objectContaining({ version: "blob1", attachments: true })
        });
        expect(glob.isDesktop).toBeTypeOf("function");
        expect(glob.froca).toBe(glob.treeCache);
        const getComponentByEl = glob.getComponentByEl as (el: unknown) => unknown;
        expect(getComponentByEl("el")).toBe(mocks.hostProps.component);
        expect(mocks.getComponentByEl).toHaveBeenCalledWith("el");
        mocks.getComponentByEl.mockReturnValueOnce("widget");
        expect(getComponentByEl("el")).toBe("widget");
        (glob.getReferenceLinkTitle as (href: string) => void)("#root/x");
        (glob.getReferenceLinkTitleSync as (href: string, stored?: string) => void)("#root/x", "T");
        expect(mocks.getReferenceLinkTitle).toHaveBeenCalledWith("#root/x");
        expect(mocks.getReferenceLinkTitleSync).toHaveBeenCalledWith("#root/x", "T");
        expect((glob.getActiveContextNote as () => unknown)()).toEqual({ noteId: "note" });
        mocks.getNoteFromCache.mockReturnValue(undefined);
        expect((glob.getActiveContextNote as () => unknown)()).toBeNull();

        expect(mocks.hostProps).toMatchObject({ noteId: "note", readOnly: false });
        expect(container.querySelector(".note-detail-editable-text > p.widget")).not.toBeNull();
        expect(mocks.widget).toHaveBeenCalledWith(expect.objectContaining({
            note: { noteId: "note" }, isVisible: true, parentComponent: mocks.hostProps.component
        }), expect.anything());
        expect(container.querySelector(".share-edit-status")?.textContent).toBe("share_edit.status_saved");
    });

    it("shows its state in the slot the page provides instead of above the editor", async () => {
        const slot = document.createElement("span");
        document.body.append(slot);
        await act(async () => { await mountEditView(container, { ...buildOptions(), statusContainer: slot }); });

        expect(slot.querySelector(".share-edit-status")?.textContent).toBe("share_edit.status_saved");
        expect(container.querySelector(".share-edit-status")).toBeNull();
    });

    it("takes a widget module that is the component itself", async () => {
        mocks.viewModule = () => <p className="bare">Bare</p>;
        await act(async () => { await mountEditView(container, buildOptions()); });
        expect(container.querySelector(".note-detail-editable-text > p.bare")).not.toBeNull();
    });

    it("places the decoupled editor's toolbar above the editor once the editor reports itself", async () => {
        await act(async () => { await mountEditView(container, buildOptions()); });
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        const refreshed = mocks.eventHandlers.get("textEditorRefreshed");

        refreshed?.({ ntxId: null, editor: { ui: { view: { toolbar: { element: toolbar } } } } });
        expect(container.querySelector(".share-edit-toolbar > .ck-toolbar")).toBe(toolbar);

        refreshed?.({ ntxId: null, editor: { ui: { view: {} } } });
        expect(container.querySelector(".share-edit-toolbar")?.childElementCount).toBe(0);
    });

    it("places the toolbar in the slot the page provides instead of above the editor", async () => {
        const slot = document.createElement("div");
        document.body.append(slot);
        await act(async () => { await mountEditView(container, { ...buildOptions(), toolbarContainer: slot }); });
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";

        mocks.eventHandlers.get("textEditorRefreshed")?.({ ntxId: null, editor: { ui: { view: { toolbar: { element: toolbar } } } } });
        expect(slot.querySelector(".share-edit-toolbar > .ck-toolbar")).toBe(toolbar);
        expect(container.querySelector(".share-edit-toolbar")).toBeNull();
    });

    it("shows the editor's state and keeps a conflict up until the visitor settles it", async () => {
        await act(async () => { await mountEditView(container, buildOptions()); });
        const shareEdit = (window.glob as unknown as { shareEdit: ShareEditGlobals }).shareEdit;
        const status = () => container.querySelector(".share-edit-status")?.textContent;
        const retry = vi.fn();

        act(() => shareEdit?.onSaveState("saving"));
        expect(status()).toBe("share_edit.status_saving");

        // Nothing is sent again until the visitor chooses, so the state does not promise a retry.
        act(() => shareEdit?.onConflict({ blobId: "newer" }, retry));
        expect(status()).toBe("share_edit.status_not_saved");
        expect(container.querySelector(".share-edit-conflict")).not.toBeNull();
        act(() => shareEdit?.onSaveState("saved"));
        expect(container.querySelector(".share-edit-conflict")).not.toBeNull();

        const buttons = [ ...container.querySelectorAll<HTMLButtonElement>(".share-edit-conflict button") ];
        act(() => buttons[1]?.click());
        expect(retry).toHaveBeenCalled();
        expect(container.querySelector(".share-edit-conflict")).toBeNull();
        expect(status()).toBe("share_edit.status_unsaved");

        // Reloading drops the visitor's version, so the page no longer asks to wait for its save.
        mocks.beforeUnloadListeners = [ () => false ];
        act(() => shareEdit?.onConflict({ blobId: "newest" }, retry));
        act(() => buttons[0]?.click());
        act(() => container.querySelector<HTMLButtonElement>(".share-edit-conflict button")?.click());
        expect(reload).toHaveBeenCalled();
        expect(mocks.beforeUnloadListeners).toEqual([]);
    });

    it("lets the page go once the title and note are saved, with no conflict open", async () => {
        let view: EditView | undefined;
        await act(async () => { view = await mountEditView(container, buildOptions()); });
        const shareEdit = (window.glob as unknown as { shareEdit: ShareEditGlobals }).shareEdit;
        expect(await view?.stop()).toBe(true);

        act(() => shareEdit.onSaveState("error"));
        expect(await view?.stop()).toBe(false);
        act(() => shareEdit.onSaveState("saved"));
        act(() => shareEdit.onConflict({ blobId: "newer" }, vi.fn()));
        expect(await view?.stop()).toBe(false);
    });

    it("holds the note while its access is lost, and resumes with the new token", async () => {
        const onLocked = vi.fn();
        let view: EditView | undefined;
        const options = { ...buildOptions(), onLocked };
        await act(async () => { view = await mountEditView(container, options); });
        const glob = window.glob as unknown as { csrfToken: string; shareEdit: ShareEditGlobals };
        const status = () => container.querySelector(".share-edit-status")?.textContent;
        const resume = vi.fn();

        act(() => glob.shareEdit.onLocked(resume));
        act(() => glob.shareEdit.onLocked(vi.fn()));
        // The page asks for the password once, however many saves were refused meanwhile.
        expect(onLocked).toHaveBeenCalledTimes(1);
        expect(status()).toBe("share_edit.status_not_saved");
        expect(await view?.stop()).toBe(false);

        act(() => view?.resume("csrf2"));
        expect(glob.csrfToken).toBe("csrf2");
        expect(resume).toHaveBeenCalledTimes(1);
        expect(status()).toBe("share_edit.status_saved");
        expect(await view?.stop()).toBe(true);
    });

    it("asks for access again for a refused title, and sends it on resuming", async () => {
        const onLocked = vi.fn();
        let view: EditView | undefined;
        const options = { ...buildOptions(), onLocked };
        await act(async () => { view = await mountEditView(container, options); });
        mocks.put.mockRejectedValueOnce(JSON.stringify({ locked: true }));

        title.textContent = "Renamed";
        title.dispatchEvent(new Event("blur"));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(onLocked).toHaveBeenCalledTimes(1);

        act(() => view?.resume("csrf2"));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(mocks.put).toHaveBeenCalledTimes(2);
        expect(mocks.put).toHaveBeenLastCalledWith("notes/note/title", { title: "Renamed" });
    });

    it("logs out once the note's saves keep failing for over a minute, none stored", async () => {
        const options = { ...buildOptions(), onSavesFailing: vi.fn() };
        await act(async () => { await mountEditView(container, options); });
        const shareEdit = (window.glob as unknown as { shareEdit: ShareEditGlobals }).shareEdit;
        mocks.beforeUnloadListeners = [ () => false ];

        act(() => shareEdit.onSaveState("error"));
        vi.advanceTimersByTime(60_000);
        act(() => shareEdit.onSaveState("saving"));
        act(() => shareEdit.onSaveState("error"));
        expect(options.onSavesFailing).not.toHaveBeenCalled();

        // A stored save starts the minute again.
        act(() => shareEdit.onSaveState("saved"));
        vi.advanceTimersByTime(1);
        act(() => shareEdit.onSaveState("error"));
        vi.advanceTimersByTime(60_000);
        act(() => shareEdit.onSaveState("error"));
        expect(options.onSavesFailing).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        act(() => shareEdit.onSaveState("error"));
        expect(options.onSavesFailing).toHaveBeenCalledTimes(1);
        // Leaving still asks to stay until the page lets go, right before it leaves.
        expect(mocks.beforeUnloadListeners).toHaveLength(1);
        const [ [ release ] ] = options.onSavesFailing.mock.calls as [ [ () => void ] ];
        release();
        expect(mocks.beforeUnloadListeners).toEqual([]);
        act(() => shareEdit.onSaveState("error"));
        expect(options.onSavesFailing).toHaveBeenCalledTimes(1);
    });

    it("sends a refused title again, and logs out once it keeps failing", async () => {
        const options = { ...buildOptions(), onSavesFailing: vi.fn() };
        await act(async () => { await mountEditView(container, options); });
        const shareEdit = (window.glob as unknown as { shareEdit: ShareEditGlobals }).shareEdit;
        const offline = new Error("offline");
        const wait = async (ms: number) => {
            await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
        };

        mocks.put.mockRejectedValueOnce(offline);
        title.textContent = "Renamed";
        title.dispatchEvent(new Event("blur"));
        await wait(0);
        await wait(4_999);
        expect(mocks.put).toHaveBeenCalledTimes(1);
        await wait(1);
        expect(mocks.put).toHaveBeenCalledTimes(2);
        // Once stored, the title is not sent again.
        await wait(60_000);
        expect(mocks.put).toHaveBeenCalledTimes(2);

        mocks.put.mockRejectedValue(offline);
        title.textContent = "Again";
        title.dispatchEvent(new Event("blur"));
        await wait(60_000);
        // The note's stored saves leave the title's failures counting.
        act(() => shareEdit.onSaveState("saved"));
        expect(options.onSavesFailing).not.toHaveBeenCalled();
        await wait(5_000);
        expect(options.onSavesFailing).toHaveBeenCalledTimes(1);
        expect(mocks.put).toHaveBeenLastCalledWith("notes/note/title", { title: "Again" });
    });

    it("holds the page while a title is not stored yet, and sends it", async () => {
        await act(async () => { await mountEditView(container, buildOptions()); });
        const [ [ isSaved ] ] = mocks.addBeforeUnloadListener.mock.calls as [ [ () => boolean ] ];
        expect(isSaved()).toBe(true);

        let store: () => void = () => {};
        mocks.put.mockReturnValueOnce(new Promise<void>((resolve) => {
            store = resolve;
        }));
        title.textContent = "Renamed";
        expect(isSaved()).toBe(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(mocks.put).toHaveBeenCalledWith("notes/note/title", { title: "Renamed" });
        // Still being sent.
        expect(isSaved()).toBe(false);
        store();
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(isSaved()).toBe(true);
        expect(mocks.put).toHaveBeenCalledTimes(1);

        // An empty title is never sent, so it holds nothing.
        title.textContent = " ";
        expect(isSaved()).toBe(true);
    });

    it("keeps a title the server did not store, and sends it again", async () => {
        let view: EditView | undefined;
        await act(async () => { view = await mountEditView(container, buildOptions()); });
        const offline = new Error("offline");
        mocks.put.mockRejectedValueOnce(offline).mockRejectedValueOnce(offline);

        title.textContent = "Renamed";
        title.dispatchEvent(new Event("blur"));
        // Stopping sends the title again, which the server refuses once more.
        expect(await view?.stop()).toBe(false);
        title.dispatchEvent(new Event("blur"));
        expect(await view?.stop()).toBe(true);
        expect(mocks.put).toHaveBeenCalledTimes(3);
        expect(mocks.put).toHaveBeenLastCalledWith("notes/note/title", { title: "Renamed" });
    });

    it("waits for a title still being sent before it lets the page go", async () => {
        let view: EditView | undefined;
        await act(async () => { view = await mountEditView(container, buildOptions()); });
        let store: () => void = () => {};
        mocks.put.mockReturnValueOnce(new Promise<void>((resolve) => {
            store = resolve;
        }));

        title.textContent = "Renamed";
        title.dispatchEvent(new Event("blur"));
        let left: boolean | undefined;
        const leaving = view?.stop().then((value) => {
            left = value;
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(left).toBeUndefined();
        store();
        await leaving;
        expect(left).toBe(true);
        expect(mocks.put).toHaveBeenCalledTimes(1);
    });

    it("saves the title once typing pauses, on blur, and before stopping", async () => {
        let view: EditView | undefined;
        await act(async () => { view = await mountEditView(container, buildOptions()); });
        expect(title.contentEditable).toBe("true");

        title.textContent = " Renamed ";
        title.dispatchEvent(new Event("input"));
        expect(mocks.put).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(mocks.put).toHaveBeenCalledWith("notes/note/title", { title: "Renamed" });

        // The same title again, or an empty one, is not sent.
        title.dispatchEvent(new Event("blur"));
        title.textContent = "";
        title.dispatchEvent(new Event("blur"));
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(mocks.put).toHaveBeenCalledTimes(1);

        title.textContent = "Final";
        title.dispatchEvent(new Event("input"));
        await view?.stop();
        expect(mocks.put).toHaveBeenLastCalledWith("notes/note/title", { title: "Final" });
        expect(mocks.triggerCommand).toHaveBeenCalledWith("saveNoteDetailNow");
    });

    it("moves from the title into the editor on Enter, leaving a composition alone", async () => {
        await act(async () => { await mountEditView(container, buildOptions()); });
        const editable = document.createElement("div");
        editable.className = "ck-editor__editable";
        editable.tabIndex = 0;
        container.append(editable);
        const focus = vi.spyOn(editable, "focus");

        const composing = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
        Object.defineProperty(composing, "isComposing", { value: true });
        title.dispatchEvent(composing);
        expect(composing.defaultPrevented).toBe(false);

        const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
        title.dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(true);
        expect(focus).toHaveBeenCalled();
    });

    function buildOptions(): EditViewOptions {
        return {
            noteId: "note",
            title,
            payload: { notes: [ { noteId: "note" } ], branches: [], attributes: [], links: {}, options: {} } as unknown as AppPayload,
            csrfToken: "csrf",
            version: "blob1",
            attachments: true,
            onSavesFailing: vi.fn()
        };
    }
});
