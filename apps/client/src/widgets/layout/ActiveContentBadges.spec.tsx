import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

// `Dropdown` (used by `BadgeWithDropdown`) and `Badge` instantiate bootstrap `Dropdown`/`Tooltip` in
// effects; stub them so the component renders under happy-dom.
vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            let inst = Dropdown.instances.get(el);
            if (!inst) { inst = new Dropdown(el); Dropdown.instances.set(el, inst); }
            return inst;
        }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

// Keep the real utils (so `isElectron` still reads `window.electronApi`) but stub the help opener so
// clicking docs items doesn't try to open a real split (which would touch appContext/froca loaders).
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    openInAppHelpFromUrl: vi.fn()
}));

import { NoteType } from "@triliumnext/commons";

import Component from "../../components/component";
import attributes from "../../services/attributes";
import { isElectron, openInAppHelpFromUrl } from "../../services/utils";
import { buildNote } from "../../test/easy-froca";
import { fakeNoteContext, makeLoadResults, renderComponent, resetFroca } from "../../test/render";
import { ActiveContentBadges } from "./ActiveContentBadges";

// --- Harness --------------------------------------------------------------------------------------

let parent: Component;

function renderBadges(note: ReturnType<typeof buildNote> | null) {
    const noteContext = fakeNoteContext({
        note,
        notePath: note ? `root/${note.noteId}` : "root"
    });
    return renderComponent(<ActiveContentBadges />, { parent, noteContext }).container;
}

/** Open every dropdown so its (conditionally rendered) children mount into the DOM. */
function openDropdowns(root: HTMLElement) {
    act(() => {
        for (const dd of Array.from(root.querySelectorAll(".dropdown"))) {
            $(dd).trigger("show.bs.dropdown");
        }
    });
}

/** Click the first dropdown item whose leading icon matches the given icon class. */
function clickItemByIcon(root: HTMLElement, iconClass: string) {
    const selector = `.tn-icon.${iconClass.split(" ").join(".")}`;
    const item = Array.from(root.querySelectorAll<HTMLElement>(".dropdown-item"))
        .find(li => li.querySelector(selector));
    expect(item).toBeTruthy();
    act(() => { item?.click(); });
}

function fire(name: string, data: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    act(() => { (parent.handleEventInChildren as any)(name, data); });
}

function codeNote(def: Parameters<typeof buildNote>[0], mime: string) {
    const note = buildNote({ ...def, type: "code" as NoteType });
    Object.assign(note, { mime });
    return note;
}

beforeEach(() => {
    parent = new Component();
    // `useStaticTooltip` (via Badge) calls jQuery's bootstrap `$el.tooltip(...)`; provide a no-op plugin.
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    resetFroca();
    vi.clearAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("ActiveContentBadges", () => {
    it("renders nothing without a note or for a note with no active content", () => {
        expect(renderBadges(null).querySelector(".active-content-badge")).toBeNull();

        const plain = buildNote({ id: "plain", title: "Plain", type: "text" as NoteType });
        expect(renderBadges(plain).querySelector(".active-content-badge")).toBeNull();
    });

    it("renders an enabled render-note badge (relation present, no toggle)", () => {
        buildNote({ id: "renderTarget", title: "RT" });
        const note = buildNote({ id: "renderNote1", title: "R", type: "render" as NoteType, "~renderNote": "renderTarget" });
        const root = renderBadges(note);

        const badge = root.querySelector(".active-content-badge");
        expect(badge).not.toBeNull();
        // hasRelation → enabled; render notes are not toggleable so no toggle is shown and no "disabled" class.
        expect(badge?.classList.contains("disabled")).toBe(false);
        expect(root.querySelector(".switch-widget")).toBeNull();
    });

    it("renders a render-note badge without the relation (no toggle, not disabled-styled)", () => {
        const note = buildNote({ id: "renderNote2", title: "R", type: "render" as NoteType });
        const root = renderBadges(note);
        // canToggleEnabled is false, so even though isEnabled is false there is no "disabled" class.
        expect(root.querySelector(".active-content-badge")?.classList.contains("disabled")).toBe(false);
        expect(root.querySelector(".switch-widget")).toBeNull();
    });

    it("renders a web-view badge driven by the webViewSrc label", () => {
        const note = buildNote({ id: "webView1", title: "W", type: "webView" as NoteType, "#webViewSrc": "https://x" });
        const root = renderBadges(note);
        expect(root.querySelector(".active-content-badge")).not.toBeNull();
        expect(root.querySelector(".switch-widget")).toBeNull();
    });

    it("renders a backend-script badge with a toggle and the run/execute options", () => {
        const note = codeNote({ id: "backend1", title: "B", "#run": "backendStartup" }, "application/javascript;env=backend");
        const root = renderBadges(note);

        // run label → enabled + toggleable → toggle shown.
        const toggleInput = root.querySelector(".switch-widget input.switch-toggle");
        expect(toggleInput).not.toBeNull();
        expect((toggleInput as HTMLInputElement | null)?.checked).toBe(true);

        openDropdowns(root);
        // Backend script exposes additional options (execute now + run combobox) inside its dropdown.
        expect(root.querySelectorAll(".dropdown-item, li").length).toBeGreaterThan(0);
    });

    it("backend script is toggleable but disabled when the label is disabled:run", () => {
        const note = codeNote({ id: "backend2", title: "B", "#disabled:run": "daily" }, "application/javascript;env=backend");
        const root = renderBadges(note);

        const toggleInput = root.querySelector(".switch-widget input.switch-toggle") as HTMLInputElement | null;
        expect(toggleInput).not.toBeNull();
        expect(toggleInput?.checked).toBe(false);
        expect(root.querySelector(".active-content-badge")?.classList.contains("disabled")).toBe(true);
    });

    it("fires the toggle onChange and toggles every dangerous active-content attribute", () => {
        const note = codeNote({ id: "backend3", title: "B", "#run": "hourly" }, "application/javascript;env=backend");
        const toggle = vi.spyOn(attributes, "toggleDangerousAttribute").mockResolvedValue(undefined);
        const root = renderBadges(note);

        const toggleInput = root.querySelector(".switch-widget input.switch-toggle") as HTMLInputElement | null;
        expect(toggleInput).not.toBeNull();
        act(() => { toggleInput?.dispatchEvent(new Event("input", { bubbles: true })); });
        expect(toggle).toHaveBeenCalledWith(note, "label", "run", false);
    });

    it("renders a frontend-script badge (widget label) with the change-to-widget options", () => {
        const note = codeNote({ id: "frontend1", title: "F", "#run": "frontendStartup" }, "application/javascript;env=frontend");
        const root = renderBadges(note);
        expect(root.querySelector(".switch-widget")).not.toBeNull();
        openDropdowns(root);
        expect(root.querySelectorAll("li").length).toBeGreaterThan(0);
    });

    it("renders an appTheme code note as a toggleable theme badge", () => {
        const note = codeNote({ id: "theme1", title: "T", "#appTheme": "next" }, "text/css");
        const root = renderBadges(note);
        // appTheme is part of activeContentLabels → enabled + toggleable.
        expect(root.querySelector(".switch-widget")).not.toBeNull();
        expect(root.querySelector(".active-content-badge")?.classList.contains("disabled")).toBe(false);
        openDropdowns(root);
        expect(root.querySelectorAll("li").length).toBeGreaterThan(0);
    });

    it("renders a code note flagged only with disabled:appTheme (code branch, not toggled on)", () => {
        const note = codeNote({ id: "theme2", title: "T", "#disabled:appTheme": "next" }, "text/css");
        const root = renderBadges(note);
        expect(root.querySelector(".switch-widget")).not.toBeNull();
        expect(root.querySelector(".active-content-badge")?.classList.contains("disabled")).toBe(true);
    });

    it("activeContentLabels override: iconPack label yields a toggleable enabled badge", () => {
        const note = buildNote({ id: "icon1", title: "I", "#iconPack": "true" });
        const root = renderBadges(note);
        expect(root.querySelector(".active-content-badge")).not.toBeNull();
        expect(root.querySelector(".switch-widget")).not.toBeNull();
        expect(root.querySelector(".active-content-badge")?.classList.contains("disabled")).toBe(false);
    });

    it("activeContentLabels override: disabled:appCss yields a disabled toggleable badge", () => {
        const note = buildNote({ id: "css1", title: "C", "#disabled:appCss": "true" });
        const root = renderBadges(note);
        expect(root.querySelector(".switch-widget")).not.toBeNull();
        expect(root.querySelector(".active-content-badge")?.classList.contains("disabled")).toBe(true);
    });

    it("renders the api/electron docs items in the dropdown for a frontend script", () => {
        // isElectron() checks for `window.electronApi`; emulate an Electron runtime.
        expect(isElectron()).toBe(false);
        Object.assign(window, { electronApi: {} });
        expect(isElectron()).toBe(true);
        try {
            const note = codeNote({ id: "frontend2", title: "F", "#run": "frontendStartup" }, "application/javascript;env=frontend");
            const root = renderBadges(note);
            openDropdowns(root);
            // The docs/help/api list items render; assert there are several list items.
            expect(root.querySelectorAll("li").length).toBeGreaterThan(1);
        } finally {
            delete (window as unknown as Record<string, unknown>).electronApi;
        }
    });

    it("refreshes the badge when an affecting attribute change is reloaded", () => {
        const note = buildNote({ id: "refresh1", title: "R" });
        const root = renderBadges(note);
        expect(root.querySelector(".active-content-badge")).toBeNull();

        // Rebuild the same note id with an appCss label so hasLabel("appCss") becomes true after refresh.
        const newNote = buildNote({ id: "refresh1", title: "R", "#appCss": "true" });
        expect(newNote.hasLabel("appCss")).toBe(true);

        fire("entitiesReloaded", {
            loadResults: makeLoadResults({ attributeRows: [
                { type: "label", name: "appCss", value: "true", noteId: "refresh1", isDeleted: false }
            ] })
        });
        expect(root.querySelector(".active-content-badge")).not.toBeNull();
    });

    it("clicking the docs and execute-now items triggers their handlers (backend script)", () => {
        const note = codeNote({ id: "backendClick", title: "B", "#run": "daily" }, "application/javascript;env=backend");
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined as never);
        const root = renderBadges(note);
        openDropdowns(root);

        // Execute-now button (additionalOptions[0]) → triggerCommand("runActiveNote").
        clickItemByIcon(root, "bx-play");
        expect(triggerCommand).toHaveBeenCalledWith("runActiveNote");

        // Help/docs item.
        clickItemByIcon(root, "bx-help-circle");
        // API docs item (backend script defines apiDocsPage).
        clickItemByIcon(root, "bx-book-content");
        expect(openInAppHelpFromUrl).toHaveBeenCalledTimes(2);
    });

    it("clicking the electron api docs item opens it when running under Electron", () => {
        Object.assign(window, { electronApi: {} });
        try {
            const note = codeNote({ id: "frontendClick", title: "F", "#run": "frontendStartup" }, "application/javascript;env=frontend");
            const root = renderBadges(note);
            openDropdowns(root);
            clickItemByIcon(root, "bx-window-alt");
            expect(openInAppHelpFromUrl).toHaveBeenCalled();
        } finally {
            delete (window as unknown as Record<string, unknown>).electronApi;
        }
    });

    it("frontend-script 'change to widget' option sets the widget label", () => {
        const note = codeNote({ id: "toWidget", title: "F", "#run": "frontendStartup" }, "application/javascript;env=frontend");
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined as never);
        const root = renderBadges(note);
        openDropdowns(root);
        clickItemByIcon(root, "bxs-widget");
        expect(setLabel).toHaveBeenCalledWith("toWidget", "widget");
    });

    it("widget 'change to frontend script' option removes widget + disabled:widget labels", () => {
        const note = codeNote({ id: "toFrontend", title: "W", "#widget": "true" }, "application/javascript;env=frontend");
        const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(undefined as never);
        const root = renderBadges(note);
        // Widget label wins via activeContentLabels → type becomes "widget".
        openDropdowns(root);
        clickItemByIcon(root, "bx-window");
        expect(removeLabel).toHaveBeenCalledWith(note, "widget");
        expect(removeLabel).toHaveBeenCalledWith(note, "disabled:widget");
    });

    it("ignores entitiesReloaded changes that do not affect the note", () => {
        const note = buildNote({ id: "refresh2", title: "R", "#appCss": "true" });
        const root = renderBadges(note);
        expect(root.querySelector(".active-content-badge")).not.toBeNull();

        // Attribute on an unrelated, non-cached note → isAffecting returns false → no refresh/no throw.
        fire("entitiesReloaded", {
            loadResults: makeLoadResults({ attributeRows: [
                { type: "label", name: "appCss", value: "x", noteId: "someOtherUncached", isDeleted: false }
            ] })
        });
        expect(root.querySelector(".active-content-badge")).not.toBeNull();
    });
});
