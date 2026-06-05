import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            let inst = Dropdown.instances.get(el);
            if (!inst) {
                inst = new Dropdown(el);
                Dropdown.instances.set(el, inst);
            }
            return inst;
        }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        show() {}
        hide() {}
    }
    return { Dropdown, Tooltip, Modal, default: { Dropdown, Tooltip, Modal } };
});

// The two modals pull in heavy editor bundles (codemirror / highlightjs) that we never need
// to render here (modals start hidden); stub them with trivial components.
vi.mock("../type_widgets/options/code_notes", () => ({ CodeMimeTypesList: () => null }));
vi.mock("../type_widgets/options/i18n", () => ({ ContentLanguagesList: () => null }));

vi.mock("../../services/math", () => ({ default: { render: vi.fn() } }));
vi.mock("../../services/protected_session", () => ({ default: { protectNote: vi.fn() } }));
vi.mock("../../services/branches", () => ({ default: { cloneNoteToParentNote: vi.fn(async () => undefined) } }));
vi.mock("../../services/sync", () => ({ default: { syncNow: vi.fn() } }));
vi.mock("../../services/dialog", () => ({
    default: { confirm: vi.fn(async () => true) },
    openDialog: vi.fn(async () => $("<div></div>"))
}));
vi.mock("../../services/toast", () => ({
    default: { showError: vi.fn(), showPersistent: vi.fn(), closePersistent: vi.fn() }
}));
vi.mock("../../services/experimental_features", () => ({ isExperimentalFeatureEnabled: vi.fn(() => false) }));

import attributes from "../../services/attributes";
import branches from "../../services/branches";
import dialog from "../../services/dialog";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import froca from "../../services/froca";
import options from "../../services/options";
import protected_session from "../../services/protected_session";
import server from "../../services/server";
import sync from "../../services/sync";
import { buildNote } from "../../test/easy-froca";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import Component from "../../components/component";
import ws from "../../services/ws";
import BasicPropertiesTab, {
    ContentLanguagesModal,
    NoteLanguageSelector,
    NoteTypeCodeNoteList,
    NoteTypeDropdownContent,
    NoteTypeOptionsModal,
    useLanguageSwitcher,
    useMimeTypes,
    useNoteBookmarkState,
    useShareState
} from "./BasicPropertiesTab";
import { flush, renderHook } from "../../test/render-hook";

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
const parent = new Component();

function renderInto(vnode: preact.ComponentChildren) {
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    act(() => render(
        <ParentComponent.Provider value={parent}>
            <NoteContextContext.Provider value={null}>
                {vnode}
            </NoteContextContext.Provider>
        </ParentComponent.Provider>,
        el
    ));
    return el;
}

/** Tear down a container rendered mid-test before rendering a fresh one. */
function teardown(el: HTMLElement) {
    act(() => { render(null, el); });
    container = undefined;
}

/** Open every Bootstrap dropdown so the lazily-rendered `{shown && children}` items mount. */
function openDropdowns(root: ParentNode) {
    act(() => {
        root.querySelectorAll<HTMLElement>(".dropdown").forEach((el) => {
            $(el).trigger("show.bs.dropdown");
        });
    });
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

beforeEach(() => {
    setOptions({ codeNotesMimeTypes: "[]", languages: "[]" });
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    // The Dropdown/FormListItem tooltips call the jQuery tooltip plugin, which isn't installed in happy-dom.
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

afterEach(() => {
    const el = container;
    if (el) {
        act(() => { render(null, el); });
        el.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Top-level component --------------------------------------------------------------------------

describe("BasicPropertiesTab", () => {
    it("renders all the property sub-widgets for a plain note", () => {
        const note = buildNote({ id: "plain", title: "Plain" });
        const root = renderInto(<BasicPropertiesTab note={note} hidden={false} componentId="c" activate={() => {}} />);

        const widget = root.querySelector(".basic-properties-widget");
        expect(widget).toBeTruthy();
        expect(root.querySelector(".note-type-container")).toBeTruthy();
        expect(root.querySelector(".protected-note-switch-container")).toBeTruthy();
        expect(root.querySelector(".editability-select-container")).toBeTruthy();
        expect(root.querySelector(".bookmark-switch-container")).toBeTruthy();
        expect(root.querySelector(".shared-switch-container")).toBeTruthy();
        expect(root.querySelector(".template-switch-container")).toBeTruthy();
        expect(root.querySelector(".note-language-container")).toBeTruthy();
        // Four FormToggle switches (protected, bookmark, shared, template).
        expect(root.querySelectorAll(".switch-widget").length).toBe(4);
    });

    it("tolerates a null note", () => {
        const root = renderInto(<BasicPropertiesTab note={null} hidden={false} componentId="c" activate={() => {}} />);
        expect(root.querySelector(".basic-properties-widget")).toBeTruthy();
    });
});

// --- Note type widget (dropdown + findTypeTitle) --------------------------------------------------

describe("NoteTypeWidget / findTypeTitle", () => {
    it("shows the note-type description element for a text note and keeps the dropdown enabled", () => {
        const note = buildNote({ id: "tn", title: "T", type: "text" });
        const root = renderInto(<BasicPropertiesTab note={note} hidden={false} componentId="c" activate={() => {}} />);
        // The trigger renders the type description element.
        expect(root.querySelector(".note-type-desc")).toBeTruthy();
        // Text is selectable → the dropdown trigger is enabled.
        expect(root.querySelector(".note-type-container button")?.hasAttribute("disabled")).toBe(false);
    });

    it("renders for a code note and disables the dropdown for static types", () => {
        const codeNote = buildNote({ id: "cn", title: "C", type: "code" });
        Object.assign(codeNote, { mime: "text/x-csrc" });
        const codeRoot = renderInto(<BasicPropertiesTab note={codeNote} hidden={false} componentId="c" activate={() => {}} />);
        expect(codeRoot.querySelector(".note-type-desc")).toBeTruthy();
        teardown(codeRoot); // tear down before next render

        // A static note type (search) disables the trigger button.
        const searchNote = buildNote({ id: "sn", title: "S", type: "search" });
        const searchRoot = renderInto(<BasicPropertiesTab note={searchNote} hidden={false} componentId="c" activate={() => {}} />);
        expect(searchRoot.querySelector(".note-type-container button")?.hasAttribute("disabled")).toBe(true);
    });

    it("falls back to the raw mime in findTypeTitle when the mime is unknown", () => {
        const codeNote = buildNote({ id: "cnx", title: "C", type: "code" });
        Object.assign(codeNote, { mime: "application/x-totally-unknown-mime" });
        const root = renderInto(<BasicPropertiesTab note={codeNote} hidden={false} componentId="c" activate={() => {}} />);
        // No matching mime entry → findTypeTitle returns the mime string verbatim.
        expect(root.querySelector(".note-type-desc")?.textContent).toContain("application/x-totally-unknown-mime");
    });
});

// --- NoteTypeDropdownContent ----------------------------------------------------------------------

describe("NoteTypeDropdownContent", () => {
    it("lists selectable types and marks the current one, including the code sublist", () => {
        const note = buildNote({ id: "ddn", title: "N", type: "text" });
        const setModalShown = vi.fn();
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="text" currentNoteMime="text/html" note={note} setModalShown={setModalShown} />
        );
        const items = root.querySelectorAll(".dropdown-item");
        expect(items.length).toBeGreaterThan(1);
        // The current type (text) is checked → it gets the bx-check icon.
        expect(root.querySelector(".dropdown-item .bx-check")).toBeTruthy();
        // The code-note sublist contributes a "configure code notes" entry with a cog icon.
        expect(root.querySelector(".dropdown-item .bx-cog")).toBeTruthy();
    });

    it("renders the disabled 'code' divider entry when noCodeNotes is false", () => {
        const note = buildNote({ id: "ddn2", title: "N", type: "text" });
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="text" currentNoteMime="text/html" note={note} setModalShown={vi.fn()} />
        );
        // The non-selectable "code" entry is rendered disabled with a divider above it.
        expect(root.querySelector(".dropdown-divider")).toBeTruthy();
        expect(root.querySelector(".dropdown-item.disabled")).toBeTruthy();
    });

    it("hides the code sublist and renders a selectable code item when noCodeNotes is true", () => {
        const note = buildNote({ id: "ddn3", title: "N", type: "text" });
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="text" currentNoteMime="text/html" note={note} setModalShown={vi.fn()} noCodeNotes />
        );
        // No configure-code-notes cog entry when noCodeNotes is on.
        expect(root.querySelector(".bx-cog")).toBeNull();
    });

    it("includes the experimental llmChat type only when the feature is enabled", () => {
        (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const note = buildNote({ id: "ddn4", title: "N", type: "text" });
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="text" currentNoteMime="text/html" note={note} setModalShown={vi.fn()} />
        );
        expect(root.querySelectorAll(".dropdown-item").length).toBeGreaterThan(1);
        expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith("llm");
    });
});

// --- changeNoteType behaviour (the dropdown onClick callback) --------------------------------------

describe("changeNoteType", () => {
    /** The first enabled, non-checked top-level type item (excludes the disabled code entry and the cog). */
    function getChangeableTypeItem(root: HTMLElement) {
        return Array.from(root.querySelectorAll<HTMLElement>(".dropdown-item"))
            .find((el) =>
                !el.classList.contains("disabled") &&
                !el.querySelector(".bx-check") &&
                !el.querySelector(".bx-cog")
            );
    }

    it("does nothing when the chosen type equals the current type and mime", () => {
        const note = buildNote({ id: "ct0", title: "N", type: "text", content: "hello" });
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="text" currentNoteMime="text/html" note={note} setModalShown={vi.fn()} />
        );
        // Click the already-selected "text" item → same type & mime, early return.
        const checked = root.querySelector<HTMLElement>(".dropdown-item .bx-check")?.closest(".dropdown-item") as HTMLElement | null;
        act(() => checked?.click());
        expect(server.put).not.toHaveBeenCalled();
    });

    it("changes the type without confirmation when there is no content", async () => {
        const note = buildNote({ id: "ct1", title: "N", type: "text", content: "" });
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="text" currentNoteMime="text/html" note={note} setModalShown={vi.fn()} />
        );
        const item = getChangeableTypeItem(root);
        await act(async () => { item?.click(); });
        await flush();
        expect(dialog.confirm).not.toHaveBeenCalled();
        expect(server.put).toHaveBeenCalledWith(expect.stringContaining("notes/ct1/type"), expect.objectContaining({}));
    });

    it("asks for confirmation when content exists and proceeds when accepted", async () => {
        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        const note = buildNote({ id: "ct2", title: "N", type: "text", content: "some content" });
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="text" currentNoteMime="text/html" note={note} setModalShown={vi.fn()} />
        );
        const item = getChangeableTypeItem(root);
        await act(async () => { item?.click(); });
        await flush();
        expect(dialog.confirm).toHaveBeenCalled();
        expect(server.put).toHaveBeenCalled();
    });

    it("aborts the change when the user declines the confirmation", async () => {
        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
        const note = buildNote({ id: "ct3", title: "N", type: "text", content: "some content" });
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="text" currentNoteMime="text/html" note={note} setModalShown={vi.fn()} />
        );
        const item = getChangeableTypeItem(root);
        await act(async () => { item?.click(); });
        await flush();
        expect(server.put).not.toHaveBeenCalled();
    });

    it("does nothing when there is no note", async () => {
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="text" currentNoteMime="text/html" note={null} setModalShown={vi.fn()} />
        );
        const item = getChangeableTypeItem(root);
        await act(async () => { item?.click(); });
        await flush();
        expect(server.put).not.toHaveBeenCalled();
    });

    it("changes only the mime without confirmation when the type stays the same", async () => {
        // Same type ("code") but a different mime → the content-confirmation block is skipped.
        const note = buildNote({ id: "ctm", title: "N", type: "code", content: "lots of code" });
        const root = renderInto(
            <NoteTypeDropdownContent currentNoteType="code" currentNoteMime="text/x-csrc" note={note} setModalShown={vi.fn()} noCodeNotes={false} />
        );
        // The code-sublist mime items are rendered last; pick the last clickable item (a code mime),
        // which triggers changeNoteType("code", mime) → same type, different mime, no confirm.
        const clickable = Array.from(root.querySelectorAll<HTMLElement>(".dropdown-item"))
            .filter((el) => !el.classList.contains("disabled") && !el.querySelector(".bx-cog"));
        const target = clickable[clickable.length - 1];
        await act(async () => { target?.click(); });
        await flush();
        expect(dialog.confirm).not.toHaveBeenCalled();
        expect(server.put).toHaveBeenCalledWith(expect.stringContaining("notes/ctm/type"), expect.objectContaining({ type: "code" }));
    });
});

// --- NoteTypeCodeNoteList -------------------------------------------------------------------------

describe("NoteTypeCodeNoteList", () => {
    it("renders mime entries, marks the current mime, and triggers changeNoteType on click", () => {
        const changeNoteType = vi.fn();
        const mimeTypes = [
            { title: "JavaScript", mime: "application/javascript", enabled: true },
            { title: "Python", mime: "text/x-python", enabled: true }
        ];
        const root = renderInto(
            <NoteTypeCodeNoteList currentMimeType="text/x-python" mimeTypes={mimeTypes} changeNoteType={changeNoteType} setModalShown={vi.fn()} />
        );
        const items = root.querySelectorAll(".dropdown-item");
        // Two mime items + the cog "configure" entry.
        expect(items.length).toBe(3);
        // The current mime (python) is checked.
        expect(root.querySelector(".dropdown-item .bx-check")).toBeTruthy();

        const jsItem = Array.from(items).find((el) => el.textContent?.includes("JavaScript")) as HTMLElement | undefined;
        act(() => jsItem?.click());
        expect(changeNoteType).toHaveBeenCalledWith("code", "application/javascript");
    });

    it("opens the options modal when the configure item is clicked", () => {
        const setModalShown = vi.fn();
        const root = renderInto(
            <NoteTypeCodeNoteList mimeTypes={[]} changeNoteType={vi.fn()} setModalShown={setModalShown} />
        );
        const cog = root.querySelector<HTMLElement>(".bx-cog")?.closest(".dropdown-item") as HTMLElement | null;
        act(() => cog?.click());
        expect(setModalShown).toHaveBeenCalledWith(true);
    });

    it("omits the configure entry when setModalShown is not provided", () => {
        const root = renderInto(
            <NoteTypeCodeNoteList mimeTypes={[{ title: "C", mime: "text/x-csrc", enabled: true }]} changeNoteType={vi.fn()} />
        );
        expect(root.querySelector(".bx-cog")).toBeNull();
        expect(root.querySelectorAll(".dropdown-item").length).toBe(1);
    });
});

// --- Modals ---------------------------------------------------------------------------------------

describe("modals", () => {
    it("NoteTypeOptionsModal renders its modal structure and toggles closed on hide", () => {
        const setModalShown = vi.fn();
        const root = renderInto(<NoteTypeOptionsModal modalShown={true} setModalShown={setModalShown} />);
        const modal = root.querySelector<HTMLElement>(".code-mime-types-modal");
        expect(modal).toBeTruthy();
        // Bootstrap fires hidden.bs.modal when the modal closes → onHidden → setModalShown(false).
        act(() => { modal?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        expect(setModalShown).toHaveBeenCalledWith(false);
    });

    it("ContentLanguagesModal renders its modal structure and toggles closed on hide", () => {
        const setModalShown = vi.fn();
        const root = renderInto(<ContentLanguagesModal modalShown={true} setModalShown={setModalShown} />);
        const modal = root.querySelector<HTMLElement>(".content-languages-modal");
        expect(modal).toBeTruthy();
        act(() => { modal?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        expect(setModalShown).toHaveBeenCalledWith(false);
    });
});

// --- ProtectedNoteSwitch --------------------------------------------------------------------------

describe("ProtectedNoteSwitch", () => {
    it("toggles protection via protected_session", () => {
        const note = buildNote({ id: "ps", title: "P" });
        const root = renderInto(<BasicPropertiesTab note={note} hidden={false} componentId="c" activate={() => {}} />);
        const input = root.querySelector<HTMLInputElement>(".protected-note-switch-container input");
        expect(input).toBeTruthy();
        act(() => { input?.dispatchEvent(new Event("input", { bubbles: true })); });
        expect(protected_session.protectNote).toHaveBeenCalledWith("ps", true, false);
    });
});

// --- EditabilitySelect ----------------------------------------------------------------------------

describe("EditabilitySelect", () => {
    it("defaults to auto and writes both editability labels when a new value is chosen", () => {
        // useNoteLabelBoolean's setter goes through setBooleanWithInheritance.
        const setBool = vi.spyOn(attributes, "setBooleanWithInheritance").mockImplementation(() => undefined as never);
        const note = buildNote({ id: "ed", title: "E" });
        const root = renderInto(<BasicPropertiesTab note={note} hidden={false} componentId="c" activate={() => {}} />);
        openDropdowns(root);

        const items = root.querySelectorAll<HTMLElement>(".editability-dropdown .dropdown-item");
        expect(items.length).toBe(3);

        // Pick "read only" (the second option) → setReadOnly(true) + setAutoReadOnlyDisabled(false).
        act(() => items[1]?.click());
        expect(setBool).toHaveBeenCalledWith(note, "readOnly", true);
        expect(setBool).toHaveBeenCalledWith(note, "autoReadOnlyDisabled", false);

        // Pick "always editable" (the third option) → setAutoReadOnlyDisabled(true).
        setBool.mockClear();
        act(() => items[2]?.click());
        expect(setBool).toHaveBeenCalledWith(note, "readOnly", false);
        expect(setBool).toHaveBeenCalledWith(note, "autoReadOnlyDisabled", true);
    });

    it("marks the readOnly option as selected as the current value", () => {
        const note = buildNote({ id: "edro", title: "E", "#readOnly": "true" });
        const root = renderInto(<BasicPropertiesTab note={note} hidden={false} componentId="c" activate={() => {}} />);
        openDropdowns(root);
        // The currently-selected option carries the `selected` class and the check icon.
        const selected = root.querySelector(".editability-dropdown .dropdown-item.selected");
        expect(selected).toBeTruthy();
        expect(selected?.querySelector(".bx-check")).toBeTruthy();
    });

    it("marks the always-editable option as selected when autoReadOnlyDisabled is set", () => {
        const note = buildNote({ id: "edae", title: "E", "#autoReadOnlyDisabled": "true" });
        const root = renderInto(<BasicPropertiesTab note={note} hidden={false} componentId="c" activate={() => {}} />);
        openDropdowns(root);
        const selected = root.querySelectorAll(".editability-dropdown .dropdown-item.selected");
        expect(selected.length).toBe(1);
    });
});

// --- BookmarkSwitch + useNoteBookmarkState --------------------------------------------------------

describe("BookmarkSwitch / useNoteBookmarkState", () => {
    it("disables the toggle for root and _hidden", () => {
        const root = buildNote({ id: "root", title: "Root" });
        const dom = renderInto(<BasicPropertiesTab note={root} hidden={false} componentId="c" activate={() => {}} />);
        const input = dom.querySelector<HTMLInputElement>(".bookmark-switch-container input");
        expect(input?.disabled).toBe(true);
    });

    it("reports bookmarked state and toggles via the server", async () => {
        Object.assign(server, { put: vi.fn(async () => ({ success: true })) });
        buildNote({ id: "_lbBookmarks", title: "Bookmarks", children: [ { id: "bm", title: "Bookmarked" } ] });
        const note = froca.notes["bm"];
        const h = renderHook(() => useNoteBookmarkState(note));
        // The note is parented under _lbBookmarks → bookmarked.
        expect(h.result.current[0]).toBe(true);

        await act(async () => { await h.result.current[1](false); });
        expect(server.put).toHaveBeenCalledWith(expect.stringContaining("toggle-in-parent/_lbBookmarks/false"));
    });

    it("reports not-bookmarked, surfaces server errors, and ignores a missing note", async () => {
        const note = buildNote({ id: "nb", title: "NotBookmarked" });
        Object.assign(server, { put: vi.fn(async () => ({ success: false, message: "nope" })) });
        const h = renderHook(() => useNoteBookmarkState(note));
        expect(h.result.current[0]).toBe(false);

        const toast = (await import("../../services/toast")).default;
        await act(async () => { await h.result.current[1](true); });
        expect(toast.showError).toHaveBeenCalledWith("nope");

        const none = renderHook(() => useNoteBookmarkState(null));
        await act(async () => { await none.result.current[1](true); });
    });

    it("refreshes when an entitiesReloaded event touches the note's branches", () => {
        buildNote({ id: "_lbBookmarks", title: "BM", children: [ { id: "bm2", title: "B" } ] });
        const note = froca.notes["bm2"];
        const h = renderHook(() => useNoteBookmarkState(note));
        expect(h.result.current[0]).toBe(true);
        // A matching branch row triggers refreshState (still bookmarked).
        h.fireEvent("entitiesReloaded", { loadResults: { getBranchRows: () => [ { noteId: "bm2" } ] } });
        expect(h.result.current[0]).toBe(true);
        // Unrelated branch rows are ignored.
        h.fireEvent("entitiesReloaded", { loadResults: { getBranchRows: () => [ { noteId: "other" } ] } });
        expect(h.result.current[0]).toBe(true);
    });
});

// --- SharedSwitch + useShareState -----------------------------------------------------------------

describe("SharedSwitch / useShareState", () => {
    it("disables the toggle for reserved note ids and _options notes", () => {
        const shareNote = buildNote({ id: "_share", title: "Share" });
        const dom = renderInto(<BasicPropertiesTab note={shareNote} hidden={false} componentId="c" activate={() => {}} />);
        expect(dom.querySelector<HTMLInputElement>(".shared-switch-container input")?.disabled).toBe(true);
        teardown(dom);

        const optNote = buildNote({ id: "_optionsFoo", title: "Opt" });
        const dom2 = renderInto(<BasicPropertiesTab note={optNote} hidden={false} componentId="c" activate={() => {}} />);
        expect(dom2.querySelector<HTMLInputElement>(".shared-switch-container input")?.disabled).toBe(true);
    });

    it("reports shared when the note is under _share and clones when enabling", async () => {
        buildNote({ id: "_share", title: "Share", children: [ { id: "shared1", title: "S" } ] });
        const note = froca.notes["shared1"];
        const h = renderHook(() => useShareState(note));
        expect(h.result.current[0]).toBe(true);

        await act(async () => { await h.result.current[1](true); });
        expect(branches.cloneNoteToParentNote).toHaveBeenCalledWith("shared1", "_share");
        expect(sync.syncNow).toHaveBeenCalledWith(true);
    });

    it("unshares directly when the note has multiple parents", async () => {
        buildNote({ id: "_share", title: "Share", children: [ { id: "multi", title: "M" } ] });
        buildNote({ id: "otherParent", title: "Other", children: [ { id: "multi2", title: "M2" } ] });
        // Make a single note with two parents: under _share and under otherParent.
        const note = froca.notes["multi"];
        const otherParent = froca.notes["otherParent"];
        const branchId = "otherParent_multi";
        const FBranch = (await import("../../entities/fbranch")).default;
        const branch = new FBranch(froca, { branchId, noteId: "multi", parentNoteId: "otherParent", notePosition: 0, fromSearchNote: false });
        froca.branches[branchId] = branch;
        note.addParent("otherParent", branchId, false);
        otherParent.addChild("multi", branchId, false);

        const h = renderHook(() => useShareState(note));
        expect(h.result.current[0]).toBe(true);
        await act(async () => { await h.result.current[1](false); });
        // Two parents → no confirmation, removes the share branch directly.
        expect(dialog.confirm).not.toHaveBeenCalled();
        expect(server.remove).toHaveBeenCalledWith(expect.stringContaining("branches/_share_multi"));
        expect(sync.syncNow).toHaveBeenCalled();
    });

    it("asks for confirmation before unsharing a single-parent note and aborts on decline", async () => {
        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
        buildNote({ id: "_share", title: "Share", children: [ { id: "single", title: "X" } ] });
        const note = froca.notes["single"];
        const h = renderHook(() => useShareState(note));
        await act(async () => { await h.result.current[1](false); });
        expect(dialog.confirm).toHaveBeenCalled();
        expect(server.remove).not.toHaveBeenCalled();
    });

    it("returns early when the shared note has no direct _share branch", async () => {
        (dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        // _share → intermediate → deep: `deep` is shared (ancestor _share) but its single parent
        // is `intermediate`, so there is no direct _share parent branch to remove.
        buildNote({
            id: "_share", title: "Share",
            children: [ { id: "intermediate", title: "I", children: [ { id: "deep", title: "D" } ] } ]
        });
        const note = froca.notes["deep"];
        const h = renderHook(() => useShareState(note));
        expect(h.result.current[0]).toBe(true);
        await act(async () => { await h.result.current[1](false); });
        expect(dialog.confirm).toHaveBeenCalled();
        // No direct _share branch → early return, nothing removed and no sync.
        expect(server.remove).not.toHaveBeenCalled();
        expect(sync.syncNow).not.toHaveBeenCalled();
    });

    it("ignores the toggle when there is no note and refreshes on branch events", async () => {
        const none = renderHook(() => useShareState(null));
        await act(async () => { await none.result.current[1](true); });
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();

        const note = buildNote({ id: "se", title: "SE" });
        const h = renderHook(() => useShareState(note));
        expect(h.result.current[0]).toBe(false);
        h.fireEvent("entitiesReloaded", { loadResults: { getBranchRows: () => [ { noteId: "se" } ] } });
        h.fireEvent("entitiesReloaded", { loadResults: { getBranchRows: () => [ { noteId: "nomatch" } ] } });
        expect(h.result.current[0]).toBe(false);
    });
});

// --- TemplateSwitch -------------------------------------------------------------------------------

describe("TemplateSwitch", () => {
    it("toggles the template label and is disabled for _options notes", () => {
        const setBool = vi.spyOn(attributes, "setBooleanWithInheritance").mockImplementation(() => undefined as never);
        const note = buildNote({ id: "tmpl", title: "T" });
        const root = renderInto(<BasicPropertiesTab note={note} hidden={false} componentId="c" activate={() => {}} />);
        const input = root.querySelector<HTMLInputElement>(".template-switch-container input");
        expect(input?.disabled).toBe(false);
        act(() => { input?.dispatchEvent(new Event("input", { bubbles: true })); });
        expect(setBool).toHaveBeenCalledWith(note, "template", true);
        teardown(root);

        const optNote = buildNote({ id: "_optionsBar", title: "Opt" });
        const dom2 = renderInto(<BasicPropertiesTab note={optNote} hidden={false} componentId="c" activate={() => {}} />);
        expect(dom2.querySelector<HTMLInputElement>(".template-switch-container input")?.disabled).toBe(true);
    });
});

// --- NoteLanguageSwitch / NoteLanguageSelector / useLanguageSwitcher -------------------------------

describe("NoteLanguageSwitch", () => {
    it("renders the language selector and a help button", () => {
        const note = buildNote({ id: "lang", title: "L" });
        const root = renderInto(<BasicPropertiesTab note={note} hidden={false} componentId="c" activate={() => {}} />);
        expect(root.querySelector(".note-language-container")).toBeTruthy();
        expect(root.querySelector(".note-language-container .bx-help-circle")).toBeTruthy();
    });

    it("NoteLanguageSelector renders the configure-languages entry and opens the modal", () => {
        const note = buildNote({ id: "lang2", title: "L2" });
        const root = renderInto(<NoteLanguageSelector note={note} />);
        openDropdowns(root);
        const cog = root.querySelector<HTMLElement>(".bx-cog")?.closest(".dropdown-item") as HTMLElement | null;
        expect(cog).toBeTruthy();
        // The portaled modal exists in the DOM but its dialog body is hidden until shown.
        expect(document.querySelector(".content-languages-modal")).toBeTruthy();
        expect(document.querySelector(".content-languages-modal .modal-dialog")).toBeNull();
        act(() => cog?.click());
        // Clicking switches modalShown → the modal dialog body renders.
        expect(document.querySelector(".content-languages-modal .modal-dialog")).toBeTruthy();
    });
});

// --- Hooks: useMimeTypes / useLanguageSwitcher ----------------------------------------------------

describe("useMimeTypes", () => {
    it("returns enabled and all mime types from the options", () => {
        setOptions({ codeNotesMimeTypes: JSON.stringify([ "text/x-csrc" ]) });
        const h = renderHook(() => useMimeTypes());
        expect(Array.isArray(h.result.current.allMimeTypes)).toBe(true);
        expect(h.result.current.allMimeTypes.length).toBeGreaterThan(0);
        // enabledMimeTypes is a subset of allMimeTypes.
        expect(h.result.current.enabledMimeTypes.length).toBeLessThanOrEqual(h.result.current.allMimeTypes.length);
    });
});

describe("useLanguageSwitcher", () => {
    it("parses the enabled languages option and exposes the default locale", () => {
        setOptions({ languages: JSON.stringify([ "en" ]) });
        const note = buildNote({ id: "lsw", title: "L", "#language": "en" });
        const h = renderHook(() => useLanguageSwitcher(note));
        expect(h.result.current.DEFAULT_LOCALE.id).toBe("");
        expect(Array.isArray(h.result.current.locales)).toBe(true);
        expect(h.result.current.currentNoteLanguage).toBe("en");
    });

    it("falls back to an empty list when languages is unset", () => {
        setOptions({}); // no languages option → useTriliumOption returns undefined → JSON.parse fallback "[]"
        const h = renderHook(() => useLanguageSwitcher(undefined));
        expect(Array.isArray(h.result.current.locales)).toBe(true);
    });
});
