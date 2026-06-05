import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Controllable return value for useNoteContext (set per test before render).
const noteContextState: { current: Record<string, unknown> } = { current: {} };

vi.mock("../react/hooks", () => ({
    useNoteContext: () => noteContextState.current,
    useNoteProperty: (note: { mime?: string } | null | undefined, prop: string) =>
        note ? (note as Record<string, unknown>)[prop] : undefined
}));

// Stub the heavy NoteContextMenu: render its slot children so the target's JSX executes & mounts.
vi.mock("../ribbon/NoteActions", () => ({
    NoteContextMenu: ({ itemsAtStart, itemsNearNoteSettings }: {
        itemsAtStart?: unknown;
        itemsNearNoteSettings?: unknown;
    }) => (
        <div className="stub-context-menu">
            <div className="items-at-start">{itemsAtStart as never}</div>
            <div className="items-near-settings">{itemsNearNoteSettings as never}</div>
        </div>
    )
}));

vi.mock("../ribbon/NoteActionsCustom", () => ({
    default: () => <div className="stub-note-actions-custom" />
}));

vi.mock("../ribbon/SimilarNotesTab", () => ({
    default: () => <div className="stub-similar-notes" />
}));

// FormList stubs: clickable items so onClick handlers fire and disabled state is observable.
vi.mock("../react/FormList", () => ({
    FormListItem: ({ children, onClick, disabled, icon }: {
        children?: unknown;
        onClick?: (e: unknown) => void;
        disabled?: boolean;
        icon?: string;
    }) => (
        <button
            type="button"
            className="stub-form-list-item"
            data-icon={icon}
            disabled={disabled}
            onClick={onClick}
        >{children as never}</button>
    ),
    FormDropdownDivider: () => <hr className="stub-divider" />,
    FormDropdownSubmenu: ({ children, title }: { children?: unknown; title?: unknown }) => (
        <div className="stub-submenu"><span className="submenu-title">{title as never}</span>{children as never}</div>
    )
}));

vi.mock("../react/Modal", () => ({
    default: ({ children, className, show, onHidden }: {
        children?: unknown;
        className?: string;
        show?: boolean;
        onHidden?: () => void;
    }) =>
        show ? (
            <div className={`stub-modal ${className ?? ""}`}>
                <button type="button" className="stub-modal-close" onClick={() => onHidden?.()} />
                {children as never}
            </div>
        ) : null
}));

vi.mock("../react/ActionButton", () => ({
    default: ({ onClick, icon }: { onClick?: (e: unknown) => void; icon?: string }) => (
        <button type="button" className="stub-action-button" data-icon={icon} onClick={onClick} />
    )
}));

// Hooks/components from sibling modules that perform side effects or render heavy trees.
const sortedNotePathsState: { current: unknown[] | undefined } = { current: undefined };
const backlinkCountState: { current: number } = { current: 0 };

vi.mock("../ribbon/NotePathsTab", () => ({
    useSortedNotePaths: () => sortedNotePathsState.current,
    NotePathsWidget: () => <div className="stub-note-paths-widget" />
}));

vi.mock("../FloatingButtonsDefinitions", () => ({
    useBacklinkCount: () => backlinkCountState.current,
    BacklinksList: () => <div className="stub-backlinks-list" />
}));

const languageSwitcherState: { current: Record<string, unknown> } = {
    current: {
        locales: [],
        DEFAULT_LOCALE: { id: "", name: "Not set" },
        currentNoteLanguage: "",
        setCurrentNoteLanguage: vi.fn()
    }
};
const processedLocalesState: { current: unknown[] } = { current: [] };

vi.mock("../ribbon/BasicPropertiesTab", () => ({
    useLanguageSwitcher: () => languageSwitcherState.current,
    useMimeTypes: () => ({ enabledMimeTypes: [] }),
    NoteTypeCodeNoteList: ({ changeNoteType }: { changeNoteType: (type: string, mime: string) => void }) => (
        <button type="button" className="stub-code-note-list" onClick={() => changeNoteType("code", "text/x-python")} />
    )
}));

vi.mock("../type_widgets/options/components/LocaleSelector", () => ({
    useProcessedLocales: () => ({ activeLocale: undefined, processedLocales: processedLocalesState.current })
}));

vi.mock("../layout/StatusBar", () => ({
    getLocaleName: (locale: { name?: string } | null | undefined) => locale?.name ?? "",
    NoteInfoContent: () => <div className="stub-note-info-content" />
}));

const createNoteMock = vi.fn();
vi.mock("../../services/note_create", () => ({
    default: { createNote: (...args: unknown[]) => createNoteMock(...args) }
}));

import server from "../../services/server";
import MobileDetailMenu from "./mobile_detail_menu";

// --- Render helper -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderMenu() {
    container = document.createElement("div");
    document.body.appendChild(container);
    const target = container;
    act(() => { render(<MobileDetailMenu />, target); });
    return container;
}

function makeNote(overrides: Partial<FNote> = {}): FNote {
    return {
        noteId: "note1",
        type: "text",
        mime: "text/html",
        ...overrides
    } as unknown as FNote;
}

function makeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    const { subContexts, isMainContext, ...rest } = overrides;
    const subs = (subContexts as unknown[]) ?? [ {} ];
    return {
        notePath: "root/note1",
        viewScope: { viewMode: "default" },
        isMainContext: () => isMainContext ?? true,
        getMainContext: () => ({ getSubContexts: () => subs }),
        ...rest
    } as unknown as NoteContext;
}

function setContext(opts: {
    note?: FNote | null;
    noteContext?: NoteContext | null;
    ntxId?: string | null;
    viewScope?: Record<string, unknown>;
    hoistedNoteId?: string;
    parentComponent?: { triggerCommand: ReturnType<typeof vi.fn> };
} = {}) {
    noteContextState.current = {
        note: opts.note === undefined ? makeNote() : opts.note,
        noteContext: opts.noteContext === undefined ? makeNoteContext() : opts.noteContext,
        parentComponent: opts.parentComponent ?? { triggerCommand: vi.fn() },
        ntxId: opts.ntxId === undefined ? "ntx1" : opts.ntxId,
        viewScope: opts.viewScope ?? { viewMode: "default" },
        hoistedNoteId: opts.hoistedNoteId ?? "root"
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined) });
    sortedNotePathsState.current = undefined;
    backlinkCountState.current = 0;
    processedLocalesState.current = [];
    languageSwitcherState.current = {
        locales: [],
        DEFAULT_LOCALE: { id: "", name: "Not set" },
        currentNoteLanguage: "",
        setCurrentNoteLanguage: vi.fn()
    };
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

describe("MobileDetailMenu", () => {
    it("renders the context menu when a note is present, with backlinks/note-paths disabled by default", () => {
        setContext();
        const el = renderMenu();
        expect(el.querySelector(".stub-context-menu")).toBeTruthy();
        // No close-pane ActionButton in the note branch.
        expect(el.querySelector(".items-at-start .stub-action-button")).toBeNull();

        const items = el.querySelectorAll<HTMLButtonElement>(".items-at-start .stub-form-list-item");
        const backlinks = items[0];
        const notePaths = items[1];
        // backlinksCount === 0 → disabled; sortedNotePaths undefined → length 0 <= 1 → disabled.
        expect(backlinks?.disabled).toBe(true);
        expect(notePaths?.disabled).toBe(true);
    });

    it("renders the standalone close button when there is no note", () => {
        setContext({ note: null });
        const el = renderMenu();
        expect(el.querySelector(".stub-context-menu")).toBeNull();
        const btn = el.querySelector<HTMLButtonElement>(".stub-action-button");
        expect(btn?.getAttribute("data-icon")).toBe("bx bx-x");
    });

    it("closePane triggers closeThisNoteSplit via requestAnimationFrame (note-less branch)", () => {
        const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 1; });
        const triggerCommand = vi.fn();
        setContext({ note: null, parentComponent: { triggerCommand } });
        const el = renderMenu();
        act(() => el.querySelector<HTMLButtonElement>(".stub-action-button")?.click());
        expect(triggerCommand).toHaveBeenCalledWith("closeThisNoteSplit", { ntxId: "ntx1" });
        rafSpy.mockRestore();
    });

    it("opens and closes the backlinks modal when enabled", () => {
        backlinkCountState.current = 3;
        setContext();
        const el = renderMenu();
        const backlinksItem = el.querySelector<HTMLButtonElement>(".items-at-start .stub-form-list-item");
        expect(backlinksItem?.disabled).toBe(false);

        act(() => backlinksItem?.click());
        const modal = document.body.querySelector(".backlinks-modal");
        expect(modal).toBeTruthy();
        expect(modal?.querySelector(".stub-backlinks-list")).toBeTruthy();
    });

    it("opens the note-paths modal and renders the widget when there are multiple paths", () => {
        sortedNotePathsState.current = [ { notePath: "a" }, { notePath: "b" } ];
        setContext();
        const el = renderMenu();
        const notePathsItem = el.querySelectorAll<HTMLButtonElement>(".items-at-start .stub-form-list-item")[1];
        expect(notePathsItem?.disabled).toBe(false);

        act(() => notePathsItem?.click());
        const modal = document.body.querySelector(".note-paths-modal");
        expect(modal?.querySelector(".stub-note-paths-widget")).toBeTruthy();
    });

    it("insert-child-note triggers note_create when a notePath exists", () => {
        setContext({ noteContext: makeNoteContext({ notePath: "root/note1" }) });
        const el = renderMenu();
        const insertItem = el.querySelector<HTMLButtonElement>(".items-at-start .stub-form-list-item[data-icon='bx bx-plus']");
        act(() => insertItem?.click());
        expect(createNoteMock).toHaveBeenCalledWith("root/note1");
    });

    it("does not call note_create when there is no notePath", () => {
        setContext({ noteContext: makeNoteContext({ notePath: null }) });
        const el = renderMenu();
        const insertItem = el.querySelector<HTMLButtonElement>(".items-at-start .stub-form-list-item[data-icon='bx bx-plus']");
        act(() => insertItem?.click());
        expect(createNoteMock).not.toHaveBeenCalled();
    });

    it("shows the new-split item when there are fewer than two sub-contexts and fires it", () => {
        const hide = vi.fn();
        const triggerCommand = vi.fn();
        setContext({
            noteContext: makeNoteContext({ subContexts: [ {} ] }),
            parentComponent: { triggerCommand }
        });
        const el = renderMenu();
        const splitItem = el.querySelector<HTMLButtonElement>(".items-at-start .stub-form-list-item[data-icon='bx bx-dock-right']");
        expect(splitItem).toBeTruthy();
        const stop = vi.fn();
        // The handler stops propagation, hides the dropdown ref, and triggers a command.
        act(() => { splitItem?.dispatchEvent(Object.assign(new MouseEvent("click", { bubbles: true }), { stopPropagation: stop })); });
        expect(triggerCommand).toHaveBeenCalledWith("openNewNoteSplit", { ntxId: "ntx1" });
        void hide;
    });

    it("hides the new-split item when there are two or more sub-contexts", () => {
        setContext({ noteContext: makeNoteContext({ subContexts: [ {}, {} ] }) });
        const el = renderMenu();
        expect(el.querySelector(".items-at-start .stub-form-list-item[data-icon='bx bx-dock-right']")).toBeNull();
    });

    it("shows the close-pane item when not in the main context and fires closePane", () => {
        const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 1; });
        const triggerCommand = vi.fn();
        setContext({
            noteContext: makeNoteContext({ isMainContext: false }),
            parentComponent: { triggerCommand }
        });
        const el = renderMenu();
        const closeItem = el.querySelector<HTMLButtonElement>(".items-at-start .stub-form-list-item[data-icon='bx bx-x']");
        expect(closeItem).toBeTruthy();
        act(() => closeItem?.click());
        expect(triggerCommand).toHaveBeenCalledWith("closeThisNoteSplit", { ntxId: "ntx1" });
        rafSpy.mockRestore();
    });

    it("hides the close-pane item when in the main context", () => {
        setContext({ noteContext: makeNoteContext({ isMainContext: true }) });
        const el = renderMenu();
        expect(el.querySelector(".items-at-start .stub-form-list-item[data-icon='bx bx-x']")).toBeNull();
    });

    it("renders NoteActionsCustom only when both noteContext and ntxId are present", () => {
        setContext();
        expect(renderMenu().querySelector(".stub-note-actions-custom")).toBeTruthy();
    });

    it("omits NoteActionsCustom when ntxId is missing", () => {
        setContext({ ntxId: null });
        expect(renderMenu().querySelector(".stub-note-actions-custom")).toBeNull();
    });

    it("renders the content-language selector for text notes and switches language", () => {
        const setCurrentNoteLanguage = vi.fn();
        languageSwitcherState.current = {
            locales: [],
            DEFAULT_LOCALE: { id: "", name: "Not set" },
            currentNoteLanguage: "en",
            setCurrentNoteLanguage
        };
        processedLocalesState.current = [
            { id: "en", name: "English", rtl: false },
            "---",
            { id: "fr", name: "French", rtl: false }
        ];
        setContext({ note: makeNote({ type: "text" }) });
        const el = renderMenu();
        const submenu = el.querySelector(".items-near-settings .stub-submenu");
        expect(submenu).toBeTruthy();
        // Two locale items + one divider rendered inside the submenu.
        const localeItems = submenu?.querySelectorAll(".stub-form-list-item");
        expect(localeItems?.length).toBe(2);
        expect(submenu?.querySelector(".stub-divider")).toBeTruthy();

        act(() => { localeItems?.[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(setCurrentNoteLanguage).toHaveBeenCalledWith("en");
    });

    it("renders the code-note switcher entry for code notes and changes the note type", () => {
        setContext({ note: makeNote({ type: "code", noteId: "codeNote" }) });
        const el = renderMenu();
        const codeItem = el.querySelector<HTMLButtonElement>(".items-near-settings .stub-form-list-item[data-icon='bx bx-code']");
        expect(codeItem).toBeTruthy();

        act(() => codeItem?.click());
        const modal = document.body.querySelector(".code-note-switcher-modal");
        expect(modal).toBeTruthy();
        act(() => modal?.querySelector<HTMLButtonElement>(".stub-code-note-list")?.click());
        expect(server.put).toHaveBeenCalledWith("notes/codeNote/type", { type: "code", mime: "text/x-python" });
    });

    it("opens the note-info and similar-notes modals", () => {
        setContext();
        const el = renderMenu();
        const settingsItems = el.querySelectorAll<HTMLButtonElement>(".items-near-settings .stub-form-list-item");
        const infoItem = el.querySelector<HTMLButtonElement>(".items-near-settings .stub-form-list-item[data-icon='bx bx-info-circle']");
        const similarItem = el.querySelector<HTMLButtonElement>(".items-near-settings .stub-form-list-item[data-icon='bx bx-bar-chart']");
        expect(settingsItems.length).toBeGreaterThanOrEqual(2);

        act(() => infoItem?.click());
        expect(document.body.querySelector(".note-info-modal .stub-note-info-content")).toBeTruthy();

        act(() => similarItem?.click());
        expect(document.body.querySelector(".similar-notes-modal .stub-similar-notes")).toBeTruthy();
    });

    it("falls back to an empty sub-context list when the note context is absent", () => {
        // note present but noteContext null exercises the `?? []` fallback on subContexts.
        setContext({ noteContext: null });
        const el = renderMenu();
        expect(el.querySelector(".stub-context-menu")).toBeTruthy();
        // subContexts length 0 (< 2) → the new-split item is shown.
        expect(el.querySelector(".items-at-start .stub-form-list-item[data-icon='bx bx-dock-right']")).toBeTruthy();
        // noteContext null → NoteActionsCustom omitted.
        expect(el.querySelector(".stub-note-actions-custom")).toBeNull();
    });

    it("defaults the content language to the default locale id when none is set", () => {
        languageSwitcherState.current = {
            locales: [],
            DEFAULT_LOCALE: { id: "", name: "Not set" },
            currentNoteLanguage: undefined,
            setCurrentNoteLanguage: vi.fn()
        };
        processedLocalesState.current = [ { id: "de", name: "German", rtl: false } ];
        setContext({ note: makeNote({ type: "text" }) });
        const el = renderMenu();
        expect(el.querySelector(".items-near-settings .stub-submenu")).toBeTruthy();
    });

    it("closes every modal via its onHidden callback", () => {
        backlinkCountState.current = 1;
        sortedNotePathsState.current = [ { notePath: "a" }, { notePath: "b" } ];
        setContext({ note: makeNote({ type: "code", noteId: "codeNote" }) });
        const el = renderMenu();

        const openAndClose = (selector: string, modalClass: string) => {
            act(() => el.querySelector<HTMLButtonElement>(selector)?.click());
            const modal = document.body.querySelector(`.${modalClass}`);
            expect(modal).toBeTruthy();
            act(() => modal?.querySelector<HTMLButtonElement>(".stub-modal-close")?.click());
            expect(document.body.querySelector(`.${modalClass}`)).toBeNull();
        };

        openAndClose(".items-at-start .stub-form-list-item[data-icon='bx bx-link']", "backlinks-modal");
        openAndClose(".items-at-start .stub-form-list-item[data-icon='bx bx-directions']", "note-paths-modal");
        openAndClose(".items-near-settings .stub-form-list-item[data-icon='bx bx-info-circle']", "note-info-modal");
        openAndClose(".items-near-settings .stub-form-list-item[data-icon='bx bx-bar-chart']", "similar-notes-modal");
        openAndClose(".items-near-settings .stub-form-list-item[data-icon='bx bx-code']", "code-note-switcher-modal");
    });
});
