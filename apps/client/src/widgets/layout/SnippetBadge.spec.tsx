import type { MimeType } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The Badge uses useStaticTooltip → bootstrap Tooltip; stub it so happy-dom doesn't choke.
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
    return { Tooltip, default: { Tooltip } };
});

// Control the available mime types deterministically rather than depending on the real dict.
const mimeTypesList: MimeType[] = [
    { title: "CSS", mime: "text/css", icon: "bx bxs-file-css", enabled: true },
    { title: "JavaScript", mime: "application/javascript", enabled: true } // no icon → fallback path
];
vi.mock("../../services/mime_types", () => ({
    default: { getMimeTypes: () => mimeTypesList }
}));

import type NoteContext from "../../components/note_context";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import noteAttributeCache from "../../services/note_attribute_cache";
import { buildNote } from "../../test/easy-froca";
import { makeLoadResults } from "../../test/render-hook";
import Component from "../../components/component";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import { SnippetBadge } from "./SnippetBadge";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderBadge(noteContext: NoteContext | null) {
    const target = document.createElement("div");
    document.body.appendChild(target);
    container = target;
    const parentComponent = new Component();
    parent = parentComponent;
    act(() => render((
        <ParentComponent.Provider value={parentComponent}>
            <NoteContextContext.Provider value={noteContext}>
                <SnippetBadge />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    ), target));
    return target;
}

function fireEntitiesReloaded(loadResults: ReturnType<typeof makeLoadResults>) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent?.handleEventInChildren as any)?.("entitiesReloaded", { loadResults });
    });
}

/** Builds a minimal NoteContext carrying the given note (only the fields the hook reads). */
function ctxWithNote(note: ReturnType<typeof buildNote> | null): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: note ? `root/${note.noteId}` : "root",
        viewScope: { viewMode: "default" },
        note
    } as unknown as NoteContext;
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    for (const key of Object.keys(noteAttributeCache.attributes)) delete noteAttributeCache.attributes[key];
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) { render(null, container); container.remove(); container = undefined; }
    parent = undefined;
    vi.restoreAllMocks();
});

describe("SnippetBadge", () => {
    it("renders nothing when there is no note", () => {
        const root = renderBadge(null);
        expect(root.querySelector(".snippet-badge")).toBeNull();
    });

    it("renders nothing when the note is not a snippet", () => {
        const note = buildNote({ id: "plain", title: "Plain", type: "text" });
        const root = renderBadge(ctxWithNote(note));
        expect(root.querySelector(".snippet-badge")).toBeNull();
    });

    it("renders a Text badge for a rich-text snippet (textSnippet label)", () => {
        const note = buildNote({ id: "txt", title: "T", type: "text", "#textSnippet": "" });
        const badge = renderBadge(ctxWithNote(note)).querySelector(".snippet-badge");
        expect(badge).not.toBeNull();
        // The text-snippet icon is bx-align-left; assert the icon class is present in the badge.
        expect(badge?.querySelector(".bx-align-left")).not.toBeNull();
    });

    it("renders a Text badge for a text note carrying the generic snippet label", () => {
        const note = buildNote({ id: "txt2", title: "T2", type: "text", "#snippet": "" });
        const badge = renderBadge(ctxWithNote(note)).querySelector(".snippet-badge");
        expect(badge?.querySelector(".bx-align-left")).not.toBeNull();
    });

    it("renders a Code badge for a code snippet with an unrecognized mime", () => {
        const note = buildNote({ id: "codeUnknown", title: "C", type: "code", "#snippet": "" });
        note.mime = "application/x-not-in-dict";
        const badge = renderBadge(ctxWithNote(note)).querySelector(".snippet-badge");
        expect(badge?.querySelector(".bx-code")).not.toBeNull();
    });

    it("renders a Code badge for a plain-text code snippet", () => {
        const note = buildNote({ id: "codePlain", title: "C", type: "code", "#snippet": "" });
        note.mime = "text/plain";
        const badge = renderBadge(ctxWithNote(note)).querySelector(".snippet-badge");
        expect(badge?.querySelector(".bx-code")).not.toBeNull();
    });

    it("renders a language-specific badge with the mime's icon", () => {
        const note = buildNote({ id: "css", title: "C", type: "code", "#snippet": "" });
        note.mime = "text/css";
        const badge = renderBadge(ctxWithNote(note)).querySelector(".snippet-badge");
        // The recognized-mime branch uses the mime's own icon (bxs-file-css for CSS).
        expect(badge?.querySelector(".bxs-file-css")).not.toBeNull();
    });

    it("falls back to the code icon when the recognized mime has no icon", () => {
        const note = buildNote({ id: "js", title: "J", type: "code", "#snippet": "" });
        note.mime = "application/javascript";
        const badge = renderBadge(ctxWithNote(note)).querySelector(".snippet-badge");
        // Recognized mime but no icon → falls back to the generic code icon.
        expect(badge?.querySelector(".bx-code")).not.toBeNull();
    });

    it("refreshes when an affecting attribute change is reloaded", () => {
        const note = buildNote({ id: "react", title: "R", type: "code", "#snippet": "" });
        note.mime = "text/css";
        const root = renderBadge(ctxWithNote(note));
        expect(root.querySelector(".snippet-badge")).not.toBeNull();

        // Simulate the snippet label being removed, then fire an affecting reload.
        noteAttributeCache.attributes["react"] = [];
        const spy = vi.spyOn(attributes, "isAffecting").mockReturnValue(true);
        fireEntitiesReloaded(makeLoadResults({
            attributeRows: [ { type: "label", name: "snippet", value: "", noteId: "react", isDeleted: true } ]
        }));
        expect(spy).toHaveBeenCalled();
        // The note no longer has the snippet label → badge disappears.
        expect(root.querySelector(".snippet-badge")).toBeNull();
    });

    it("ignores non-affecting attribute reloads", () => {
        const note = buildNote({ id: "ignore", title: "I", type: "code", "#snippet": "" });
        note.mime = "text/css";
        const root = renderBadge(ctxWithNote(note));
        expect(root.querySelector(".snippet-badge")).not.toBeNull();

        vi.spyOn(attributes, "isAffecting").mockReturnValue(false);
        fireEntitiesReloaded(makeLoadResults({
            attributeRows: [ { type: "label", name: "snippet", value: "", noteId: "other", isDeleted: false } ]
        }));
        // Badge unchanged because nothing affecting was reloaded.
        expect(root.querySelector(".snippet-badge")).not.toBeNull();
    });
});
