import { Locale } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static getInstance() { return null; }
        static getOrCreateInstance() { return new Dropdown(); }
        show() {}
        hide() {}
        update() {}
        dispose() {}
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

// Stub the real Dropdown component so its children render unconditionally (the production one only
// renders children when the bootstrap dropdown is "shown"). We keep enough structure to assert on.
vi.mock("../react/Dropdown", () => ({
    default: ({ children, text, icon, className, buttonClassName, dropdownContainerClassName, dropdownRef, onShown, onHidden }: any) => {
        if (dropdownRef) {
            dropdownRef.current = { show: () => onShown?.(), hide: () => onHidden?.() };
        }
        return (
            <div className={`mock-dropdown ${className ?? ""}`}>
                <button className={`mock-dropdown-button ${buttonClassName ?? ""}`}>
                    {icon && <span className="mock-icon">{icon}</span>}
                    <span className="mock-text">{text}</span>
                </button>
                <ul className={`mock-dropdown-menu ${dropdownContainerClassName ?? ""}`}>{children}</ul>
            </div>
        );
    }
}));

// Heavy cross-file children / hooks doing server I/O — provide controllable lightweight mocks.
const mockUseBacklinkCount = vi.fn((..._args: unknown[]): number => 0);
vi.mock("../FloatingButtonsDefinitions", () => ({
    useBacklinkCount: (...args: unknown[]) => mockUseBacklinkCount(...args),
    BacklinksList: () => <div className="mock-backlinks-list" />
}));

const mockUseAttachments = vi.fn((..._args: unknown[]): unknown[] => []);
vi.mock("../type_widgets/Attachment", () => ({
    useAttachments: (...args: unknown[]) => mockUseAttachments(...args)
}));

vi.mock("../ribbon/NoteInfoTab", () => ({
    useNoteMetadata: () => ({ metadata: { dateCreated: "2024-01-01T00:00:00Z", dateModified: "2024-02-02T00:00:00Z" } }),
    NoteSizeWidget: () => <div className="mock-note-size" />
}));

const mockUseSortedNotePaths = vi.fn((..._args: unknown[]): unknown[] => []);
vi.mock("../ribbon/NotePathsTab", () => ({
    useSortedNotePaths: (...args: unknown[]) => mockUseSortedNotePaths(...args),
    NotePathsWidget: () => <div className="mock-note-paths-widget" />
}));

const mockUseLanguageSwitcher = vi.fn();
const mockUseMimeTypes = vi.fn();
vi.mock("../ribbon/BasicPropertiesTab", () => ({
    useLanguageSwitcher: (...args: unknown[]) => mockUseLanguageSwitcher(...args),
    useMimeTypes: (...args: unknown[]) => mockUseMimeTypes(...args),
    NoteTypeCodeNoteList: ({ changeNoteType, setModalShown }: any) => (
        <div className="mock-code-note-list">
            <button className="mock-change-type" onClick={() => changeNoteType("code", "text/x-python")} />
            <button className="mock-open-modal" onClick={() => setModalShown?.(true)} />
        </div>
    ),
    NoteTypeOptionsModal: ({ modalShown }: any) => <div className="mock-note-type-modal" data-shown={String(!!modalShown)} />,
    ContentLanguagesModal: ({ modalShown }: any) => <div className="mock-content-languages-modal" data-shown={String(!!modalShown)} />
}));

const mockUseProcessedLocales = vi.fn();
vi.mock("../type_widgets/options/components/LocaleSelector", () => ({
    useProcessedLocales: (...args: unknown[]) => mockUseProcessedLocales(...args)
}));

vi.mock("./Breadcrumb", () => ({ default: () => <div className="mock-breadcrumb" /> }));
vi.mock("../ribbon/SimilarNotesTab", () => ({ default: () => <div className="mock-similar-notes" /> }));
vi.mock("../ribbon/InheritedAttributesTab", () => ({ default: () => <div className="mock-inherited-attributes" /> }));
vi.mock("../ribbon/AutoLinkAttributesTab", () => ({ default: () => <div className="mock-auto-link-attributes" /> }));
vi.mock("../ribbon/components/AttributeEditor", () => ({ default: () => <div className="mock-attribute-editor" /> }));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import noteAttributeCache from "../../services/note_attribute_cache";
import options from "../../services/options";
import server from "../../services/server";
import * as utils from "../../services/utils";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { makeLoadResults } from "../../test/render-hook";
import { ParentComponent } from "../react/react_utils";
import StatusBar, { getLocaleName, NoteInfoBadge, NoteInfoContent } from "./StatusBar";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | null = null;
let parent: Component | null = null;

function renderInProviders(vnode: preact.ComponentChild, theParent = new Component()) {
    parent = theParent;
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    act(() => render(
        <ParentComponent.Provider value={theParent}>{vnode}</ParentComponent.Provider>,
        el
    ));
    return el;
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent?.handleEventInChildren as any)?.(name, data);
    });
}

function fakeNoteContext(note: ReturnType<typeof buildNote>, overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        note,
        notePath: `root/${note.noteId}`,
        hoistedNoteId: "root",
        viewScope: { viewMode: "default" },
        getCodeEditor: vi.fn(async () => null),
        ...overrides
    } as unknown as NoteContext;
}

const LOCALE_EN: Locale = { id: "en", name: "English" } as Locale;
const LOCALE_RTL: Locale = { id: "ar", name: "العربية", rtl: true } as Locale;

function setActiveContext(ctx: NoteContext | null) {
    Object.assign(appContext, { tabManager: { getActiveContext: () => ctx } });
}

function defaultLanguageSwitcher() {
    mockUseLanguageSwitcher.mockReturnValue({
        locales: [ LOCALE_EN ],
        DEFAULT_LOCALE: { id: "", name: "Not set" },
        currentNoteLanguage: "en",
        setCurrentNoteLanguage: vi.fn()
    });
    mockUseProcessedLocales.mockReturnValue({
        activeLocale: LOCALE_EN,
        processedLocales: [ LOCALE_EN ]
    });
    mockUseMimeTypes.mockReturnValue({ enabledMimeTypes: [], allMimeTypes: [] });
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    for (const key of Object.keys(noteAttributeCache.attributes)) delete noteAttributeCache.attributes[key];
    options.load({});
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    defaultLanguageSwitcher();
    mockUseBacklinkCount.mockReturnValue(0);
    mockUseAttachments.mockReturnValue([]);
    mockUseSortedNotePaths.mockReturnValue([]);
    setActiveContext(null);
});

afterEach(() => {
    if (container) { const el = container; act(() => render(null, el)); el.remove(); container = null; }
    vi.restoreAllMocks();
});

/** A non-hidden note: parented under `root` so `isHiddenCompletely()` returns false. */
function buildVisibleNote(def: Parameters<typeof buildNote>[0]) {
    buildNote({ id: "root", title: "Root", children: [ def ] });
    const id = def.id ?? "";
    return froca.notes[id];
}

// --- getLocaleName --------------------------------------------------------------------------------

describe("getLocaleName", () => {
    it("handles missing, idless, short, rtl and long locales", () => {
        expect(getLocaleName(null)).toBe("");
        expect(getLocaleName(undefined)).toBe("");
        expect(getLocaleName({ id: "", name: "X" } as Locale)).toBe("-");
        expect(getLocaleName({ id: "en", name: "Eng" } as Locale)).toBe("Eng");   // name.length <= 4
        expect(getLocaleName(LOCALE_RTL)).toBe("العربية");                          // rtl returns name
        expect(getLocaleName({ id: "en_us", name: "English" } as Locale)).toBe("EN-US"); // long → upper id
    });
});

// --- Top-level StatusBar --------------------------------------------------------------------------

describe("StatusBar", () => {
    it("renders empty container when there is no active note context", () => {
        const el = renderInProviders(<StatusBar />);
        const statusBar = el.querySelector(".status-bar");
        expect(statusBar).toBeTruthy();
        expect(el.querySelector(".mock-breadcrumb")).toBeNull();
        expect(el.querySelector(".actions-row")).toBeNull();
    });

    it("renders the full action row for a visible text note", () => {
        const note = buildVisibleNote({ id: "tn1", title: "Text", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);

        expect(el.querySelector(".mock-breadcrumb")).toBeTruthy();
        expect(el.querySelector(".actions-row")).toBeTruthy();
        expect(el.querySelector(".attributes-button")).toBeTruthy();
        // text note → language switcher is rendered (its modal portals to document.body).
        expect(document.querySelector(".mock-content-languages-modal")).toBeTruthy();
        // visible note → note paths dropdown present.
        expect(el.querySelector(".dropdown-note-paths")).toBeTruthy();
    });

    it("omits note paths for a hidden note", () => {
        const note = buildNote({ id: "hidden1", title: "Hidden", type: "text" });
        expect(note.isHiddenCompletely()).toBe(true);
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);
        expect(el.querySelector(".actions-row")).toBeTruthy();
        expect(el.querySelector(".dropdown-note-paths")).toBeNull();
    });

    it("toggles the attributes pane open/closed via the attributes button", () => {
        const note = buildVisibleNote({ id: "attrNote", title: "Attr", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);

        expect(el.querySelector(".status-bar.status-bar-panel-open")).toBeNull();
        const attrButton = el.querySelector(".attributes-button");
        expect(attrButton).toBeTruthy();
        act(() => (attrButton as HTMLElement).click());
        expect(el.querySelector(".status-bar.status-bar-panel-open")).toBeTruthy();
        // The bottom panel for attributes becomes visible (hidden-ext class removed).
        const attrPanel = el.querySelector(".attribute-list");
        expect(attrPanel?.classList.contains("hidden-ext")).toBe(false);
    });
});

// --- LanguageSwitcher -----------------------------------------------------------------------------

describe("LanguageSwitcher", () => {
    it("renders locale items, a divider, and config/help actions", () => {
        mockUseProcessedLocales.mockReturnValue({
            activeLocale: LOCALE_RTL,
            processedLocales: [ LOCALE_EN, "---", LOCALE_RTL ]
        });
        const setCurrentNoteLanguage = vi.fn();
        mockUseLanguageSwitcher.mockReturnValue({
            locales: [ LOCALE_EN, LOCALE_RTL ],
            DEFAULT_LOCALE: { id: "", name: "Not set" },
            currentNoteLanguage: "ar",
            setCurrentNoteLanguage
        });
        const openHelp = vi.spyOn(utils, "openInAppHelpFromUrl").mockResolvedValue(undefined);

        const note = buildVisibleNote({ id: "langNote", title: "Lang", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);

        // The globe dropdown + its menu items.
        const items = Array.from(el.querySelectorAll(".dropdown-item"));
        expect(items.length).toBeGreaterThan(0);

        // Click the first locale item → setCurrentNoteLanguage with the locale id.
        const localeItem = items.find(i => i.textContent?.includes("English"));
        act(() => (localeItem as HTMLElement).click());
        expect(setCurrentNoteLanguage).toHaveBeenCalledWith("en");

        // The help item opens the in-app help page.
        const helpItem = items.find(i => i.querySelector(".bx-help-circle"));
        act(() => (helpItem as HTMLElement).click());
        expect(openHelp).toHaveBeenCalledWith("veGu4faJErEM");

        // The config item flips the modal flag.
        const configItem = items.find(i => i.querySelector(".bx-cog"));
        act(() => (configItem as HTMLElement).click());
        const modal = document.querySelector(".mock-content-languages-modal");
        expect(modal?.getAttribute("data-shown")).toBe("true");
    });

    it("does not render the language dropdown for non-text notes", () => {
        mockUseMimeTypes.mockReturnValue({ enabledMimeTypes: [], allMimeTypes: [] });
        const note = buildVisibleNote({ id: "imgNote", title: "Img", type: "image" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);
        // The content languages modal portal still mounts but the globe dropdown does not.
        expect(el.querySelector(".bx-globe")).toBeNull();
    });

    it("falls back to the default locale id when the note has no language label", () => {
        // Covers the `currentNoteLanguage ?? DEFAULT_LOCALE.id` fallback branch.
        mockUseLanguageSwitcher.mockReturnValue({
            locales: [ LOCALE_EN ],
            DEFAULT_LOCALE: { id: "", name: "Not set" },
            currentNoteLanguage: null,
            setCurrentNoteLanguage: vi.fn()
        });
        mockUseProcessedLocales.mockReturnValue({ activeLocale: undefined, processedLocales: [ LOCALE_EN ] });
        const note = buildVisibleNote({ id: "noLangNote", title: "NL", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);
        // activeLocale undefined → getLocaleName returns "" and the dropdown still renders.
        expect(el.querySelector(".bx-globe")).toBeTruthy();
        // useProcessedLocales was invoked with the default locale id as the third argument.
        expect(mockUseProcessedLocales).toHaveBeenCalledWith([ LOCALE_EN ], { id: "", name: "Not set" }, "");
    });
});

// --- CodeNoteSwitcher & TabWidthSwitcher (code notes) ---------------------------------------------

describe("code note switchers", () => {
    function renderCodeNote(extraLabels: Record<`#${string}`, string> = {}) {
        mockUseMimeTypes.mockReturnValue({
            enabledMimeTypes: [ { mime: "text/x-python", title: "Python", enabled: true } ],
            allMimeTypes: [ { mime: "text/javascript", title: "JavaScript", icon: "bx bx-code", enabled: true } ]
        });
        const note = buildVisibleNote({ id: "codeNote", title: "Code", type: "code", ...extraLabels });
        const editor = { getText: vi.fn(() => "    a"), setText: vi.fn() };
        const noteContext = fakeNoteContext(note, { getCodeEditor: vi.fn(async () => editor) });
        setActiveContext(noteContext);
        const el = renderInProviders(<StatusBar />);
        return { el, note, editor, noteContext };
    }

    it("changes the note type and opens the code-options modal", async () => {
        const { el } = renderCodeNote();
        const changeBtn = el.querySelector(".mock-change-type");
        await act(async () => { (changeBtn as HTMLElement).click(); });
        expect(server.put).toHaveBeenCalledWith("notes/codeNote/type", { type: "code", mime: "text/x-python" });

        const openBtn = el.querySelector(".mock-open-modal");
        act(() => (openBtn as HTMLElement).click());
        expect(document.querySelector(".mock-note-type-modal")?.getAttribute("data-shown")).toBe("true");
    });

    it("renders tab-width style/display/reindent items and writes overrides on click", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const { el, editor } = renderCodeNote();

        // No overrides: 2 style items + 6 display width items + 6 reindent-spaces + 1 reindent-tabs = 15.
        const items = Array.from(el.querySelectorAll(".dropdown-item"));
        expect(items.length).toBe(15);

        // items[0] = "spaces" style → setNoteUseTabs(false); items[1] = "tabs" style → setNoteUseTabs(true).
        act(() => (items[0] as HTMLElement).click());
        act(() => (items[1] as HTMLElement).click());
        // items[2..7] = display widths → setNoteTabWidth(size).
        act(() => (items[2] as HTMLElement).click());
        expect(setLabel).toHaveBeenCalled();

        // items[8..13] = reindent-as-spaces → reindentTo(false, size); items[14] = reindent-as-tabs.
        await act(async () => { (items[8] as HTMLElement).click(); });
        await act(async () => { (items[14] as HTMLElement).click(); });
        expect(editor.getText).toHaveBeenCalled();
    });

    it("clears overrides and reindents when overrides are present", async () => {
        vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockImplementation(() => undefined as never);
        const { el, editor } = renderCodeNote({ "#tabWidth": "2", "#indentWithTabs": "false" });

        // With overrides present, both "use default" clear items render (bx-x icon):
        // the style clear (line 500) and the width clear (line 518).
        const clearItems = Array.from(el.querySelectorAll(".dropdown-item")).filter(i => i.querySelector(".bx-x"));
        expect(clearItems.length).toBeGreaterThanOrEqual(2);
        act(() => (clearItems[0] as HTMLElement).click());   // clear style override → removeOwnedLabelByName
        act(() => (clearItems[1] as HTMLElement).click());   // clear width override → setNoteTabWidth(null)
        expect(removeLabel).toHaveBeenCalled();
        // Clicking the last reindent item (reindent-as-tabs) triggers the editor read.
        const reindentItems = Array.from(el.querySelectorAll(".dropdown-item"));
        const target = reindentItems[reindentItems.length - 1];
        await act(async () => { (target as HTMLElement).click(); });
        expect(editor.getText).toHaveBeenCalled();
    });

    it("derives the effective width/style from global options when no note override exists", () => {
        // Covers the `globalTabWidth` and `globalUseTabs` branches plus the tabs status-text path.
        options.load({ codeNoteTabWidth: "8", codeNoteIndentWithTabs: "true" } as Record<string, string>);
        const { el } = renderCodeNote();
        // Tabs mode + global width → the tabs status text branch and the tab-width dropdown render.
        expect(el.querySelectorAll(".dropdown-item").length).toBeGreaterThanOrEqual(15);
    });

    it("shows the 'default = tabs' label when a style override is present over a tabs global", () => {
        // globalUseTabs true (line 502 true branch) with a note style override present.
        options.load({ codeNoteIndentWithTabs: "true", codeNoteTabWidth: "3" } as Record<string, string>);
        vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const { el } = renderCodeNote({ "#indentWithTabs": "false", "#tabWidth": "2" });
        const clearItems = Array.from(el.querySelectorAll(".dropdown-item")).filter(i => i.querySelector(".bx-x"));
        expect(clearItems.length).toBeGreaterThanOrEqual(2);
    });

    it("renders the tabs status text when the note indents with tabs", () => {
        // noteUseTabs true → effectiveUseTabs true → the tabs status-text branch (line 476 truthy).
        const { el, note } = renderCodeNote({ "#indentWithTabs": "true" });
        // Sanity check: the note label is readable via the froca cache.
        expect(note.getLabelValue("indentWithTabs")).toBe("true");
        // The tab-width dropdown still renders its full set of items.
        expect(el.querySelectorAll(".dropdown-item").length).toBeGreaterThanOrEqual(15);
    });

    it("returns early from reindent when there is no editor", async () => {
        const note = buildVisibleNote({ id: "noEdNote", title: "NoEd", type: "code" });
        mockUseMimeTypes.mockReturnValue({ enabledMimeTypes: [], allMimeTypes: [] });
        const noteContext = fakeNoteContext(note, { getCodeEditor: vi.fn(async () => null) });
        setActiveContext(noteContext);
        const el = renderInProviders(<StatusBar />);
        const items = Array.from(el.querySelectorAll(".dropdown-item"));
        // A reindent item click resolves the editor (null) and returns early without throwing.
        await act(async () => { (items[items.length - 1] as HTMLElement).click(); });
        expect(noteContext.getCodeEditor).toHaveBeenCalled();
    });

    it("does not rewrite the editor when reindenting yields identical text", async () => {
        mockUseMimeTypes.mockReturnValue({ enabledMimeTypes: [], allMimeTypes: [] });
        const note = buildVisibleNote({ id: "sameEdNote", title: "Same", type: "code" });
        // No leading whitespace → convertIndentation is a no-op, so setText is never called (line 469 false).
        const editor = { getText: vi.fn(() => "noindent"), setText: vi.fn() };
        const noteContext = fakeNoteContext(note, { getCodeEditor: vi.fn(async () => editor) });
        setActiveContext(noteContext);
        const el = renderInProviders(<StatusBar />);
        const items = Array.from(el.querySelectorAll(".dropdown-item"));
        await act(async () => { (items[items.length - 1] as HTMLElement).click(); });
        expect(editor.getText).toHaveBeenCalled();
        expect(editor.setText).not.toHaveBeenCalled();
    });
});

// --- AttachmentCount & BacklinksBadge -------------------------------------------------------------

describe("count badges", () => {
    it("shows the attachment button when there are attachments and fires the command", () => {
        mockUseAttachments.mockReturnValue([ { attachmentId: "a1" }, { attachmentId: "a2" } ]);
        const note = buildVisibleNote({ id: "attCntNote", title: "A", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const triggerCommand = vi.fn();
        const theParent = new Component();
        Object.assign(theParent, { triggerCommand });
        const el = renderInProviders(<StatusBar />, theParent);

        const attBtn = el.querySelector(".attachment-count-button");
        expect(attBtn).toBeTruthy();
        act(() => (attBtn as HTMLElement).click());
        expect(triggerCommand).toHaveBeenCalledWith("showAttachments");
    });

    it("shows backlinks badge only when count > 0", () => {
        mockUseBacklinkCount.mockReturnValue(3);
        const note = buildVisibleNote({ id: "blNote", title: "B", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);
        expect(el.querySelector(".backlinks-badge")).toBeTruthy();
        expect(el.querySelector(".mock-backlinks-list")).toBeTruthy();
    });

    it("hides backlinks badge when count is 0", () => {
        mockUseBacklinkCount.mockReturnValue(0);
        const note = buildVisibleNote({ id: "blNote0", title: "B0", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);
        expect(el.querySelector(".backlinks-badge")).toBeNull();
    });
});

// --- AttributesButton entity reload ---------------------------------------------------------------

describe("AttributesButton", () => {
    it("recomputes count on entitiesReloaded affecting the note", () => {
        const note = buildVisibleNote({ id: "abNote", title: "AB", type: "text", "#archived": "true" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);
        expect(el.querySelector(".attributes-button")).toBeTruthy();

        // Affecting row → triggers a recount (covers the isAffecting branch).
        fireEvent("entitiesReloaded", { loadResults: makeLoadResults({
            attributeRows: [ { type: "label", name: "archived", value: "false", noteId: "abNote", isDeleted: false } ]
        }) });
        // Unrelated row (no matching note) → ignored.
        fireEvent("entitiesReloaded", { loadResults: makeLoadResults({
            attributeRows: [ { type: "label", name: "color", value: "x", noteId: "nomatch", isDeleted: false } ]
        }) });
        expect(el.querySelector(".attributes-button")).toBeTruthy();
    });
});

// --- NoteInfoBadge / NoteInfoContent --------------------------------------------------------------

describe("NoteInfoBadge & NoteInfoContent", () => {
    function infoContext(note: ReturnType<typeof buildNote>, overrides: Record<string, unknown> = {}) {
        return {
            note,
            notePath: `root/${note.noteId}`,
            noteContext: fakeNoteContext(note),
            viewScope: { viewMode: "default" as const },
            hoistedNoteId: "root",
            similarNotesShown: false,
            setSimilarNotesShown: vi.fn(),
            ...overrides
        };
    }

    it("renders the info dropdown for a note and reveals content when shown", () => {
        const note = buildVisibleNote({ id: "infoNote", title: "Info", type: "text" });
        const setSimilarNotesShown = vi.fn();
        const ctx = infoContext(note, { setSimilarNotesShown });
        const el = renderInProviders(<NoteInfoBadge {...ctx} />);

        // The mocked dropdown sets dropdownRef.current via onShown/onHidden but content only renders
        // after dropdownShown becomes true; drive the keyboard event to call show().
        fireEvent("toggleRibbonTabNoteInfo", {});
        const content = el.querySelector(".note-info-content");
        expect(content).toBeTruthy();
        expect(el.querySelector("code")?.textContent).toBe("infoNote");

        // The "show similar notes" link hides the dropdown and flips the flag.
        const link = el.querySelector("a.tn-link");
        act(() => (link as HTMLElement).click());
        expect(setSimilarNotesShown).toHaveBeenCalledWith(true);
    });

    it("toggles similar-notes via keyboard shortcut", () => {
        const note = buildVisibleNote({ id: "infoNote2", title: "Info2", type: "text" });
        const setSimilarNotesShown = vi.fn();
        const ctx = infoContext(note, { similarNotesShown: true, setSimilarNotesShown });
        renderInProviders(<NoteInfoBadge {...ctx} />);
        fireEvent("toggleRibbonTabSimilarNotes", {});
        expect(setSimilarNotesShown).toHaveBeenCalledWith(false);
    });

    it("NoteInfoContent renders file name, mime, type icon and size", () => {
        const note = buildVisibleNote({
            id: "fileNote", title: "F", type: "file", "#originalFileName": "doc.pdf"
        });
        Object.assign(note, { mime: "application/pdf" });
        const el = renderInProviders(<NoteInfoContent note={note} noteType="file" setSimilarNotesShown={undefined} />);
        const lis = Array.from(el.querySelectorAll("li"));
        expect(lis.length).toBeGreaterThanOrEqual(5);
        expect(el.querySelector("code")?.textContent).toBe("fileNote");
        // No setSimilarNotesShown → no link button.
        expect(el.querySelector("a.tn-link")).toBeNull();
    });
});

// --- SimilarNotesPane / AttributesPane keyboard shortcuts -----------------------------------------

describe("panes & shortcuts", () => {
    it("opens the similar-notes pane through the info badge link and entity context", () => {
        const note = buildVisibleNote({ id: "simNote", title: "S", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);

        // Show the note info dropdown, then click "show similar notes".
        fireEvent("toggleRibbonTabNoteInfo", {});
        const link = el.querySelector(".note-info-content a.tn-link");
        act(() => (link as HTMLElement).click());
        expect(el.querySelector(".similar-notes-pane")).toBeTruthy();
        expect(el.querySelector(".mock-similar-notes")).toBeTruthy();
    });

    it("opens the attributes pane via addNewLabel and closes it via the close button", () => {
        const note = buildVisibleNote({ id: "apNote", title: "AP", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);

        fireEvent("addNewLabel", {});
        expect(el.querySelector(".status-bar.status-bar-panel-open")).toBeTruthy();

        // Toggle off via the shortcut.
        fireEvent("toggleRibbonTabOwnedAttributes", {});
        expect(el.querySelector(".status-bar.status-bar-panel-open")).toBeNull();

        // Re-open and use the help + close buttons in the bottom panel header.
        fireEvent("addNewRelation", {});
        const openHelp = vi.spyOn(utils, "openInAppHelpFromUrl").mockResolvedValue(undefined);
        const helpButton = el.querySelector(".attribute-list .bx-question-mark");
        act(() => (helpButton as HTMLElement).click());
        expect(openHelp).toHaveBeenCalledWith("zEY4DaJG4YT5");

        const closeButton = el.querySelector(".attribute-list .bx-x");
        act(() => (closeButton as HTMLElement).click());
        expect(el.querySelector(".status-bar.status-bar-panel-open")).toBeNull();
    });

    it("renders the auto-link attributes section in dev mode", () => {
        const glob = window.glob as unknown as Record<string, unknown>;
        const previous = glob.isDev;
        glob.isDev = true;
        try {
            const note = buildVisibleNote({ id: "devNote", title: "Dev", type: "text" });
            setActiveContext(fakeNoteContext(note));
            const el = renderInProviders(<StatusBar />);
            fireEvent("addNewLabel", {});
            expect(el.querySelector(".mock-auto-link-attributes")).toBeTruthy();
        } finally {
            glob.isDev = previous;
        }
    });

    it("dispatches the attribute editor imperative commands", () => {
        const note = buildVisibleNote({ id: "aeNote", title: "AE", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const theParent = new Component();
        renderInProviders(<StatusBar />, theParent);
        // These are registered onto the parent via useLegacyImperativeHandlers; api.current is null
        // (the AttributeEditor is mocked), so each handler short-circuits without throwing.
        const handlers = theParent as unknown as Record<string, () => void>;
        act(() => {
            handlers.saveAttributesCommand?.();
            handlers.reloadAttributesCommand?.();
            (handlers.updateAttributeListCommand as unknown as (a: { attributes: unknown[] }) => void)?.({ attributes: [] });
        });
        expect(typeof handlers.saveAttributesCommand).toBe("function");
    });
});

// --- NotePaths keyboard shortcut ------------------------------------------------------------------

describe("NotePaths", () => {
    it("renders the path dropdown and responds to the keyboard shortcut", () => {
        mockUseSortedNotePaths.mockReturnValue([ { notePath: "root/np" } ]);
        const note = buildVisibleNote({ id: "np", title: "NP", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);
        expect(el.querySelector(".dropdown-note-paths")).toBeTruthy();
        expect(el.querySelector(".mock-note-paths-widget")).toBeTruthy();
        expect(() => fireEvent("toggleRibbonTabNotePaths", {})).not.toThrow();
    });

    it("defaults the count to 0 when there are no sorted paths", () => {
        // mockUseSortedNotePaths returns undefined → covers the `sortedNotePaths?.length ?? 0` branch.
        mockUseSortedNotePaths.mockReturnValue(undefined as unknown as unknown[]);
        const note = buildVisibleNote({ id: "np0", title: "NP0", type: "text" });
        setActiveContext(fakeNoteContext(note));
        const el = renderInProviders(<StatusBar />);
        expect(el.querySelector(".dropdown-note-paths")).toBeTruthy();
    });
});
