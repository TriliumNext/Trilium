import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import AutoLinkAttributesTab from "./AutoLinkAttributesTab";

// --- Rendering harness -----------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

/** Renders the tab inside a real ParentComponent so `useTriliumEvent` registers against `parent`. */
function renderTab(props: { note: ReturnType<typeof buildNote> | null | undefined; componentId: string }) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    container = el;
    const cmp = new Component();
    parent = cmp;
    act(() => render((
        <ParentComponent.Provider value={cmp}>
            <AutoLinkAttributesTab note={props.note} componentId={props.componentId} />
        </ParentComponent.Provider>
    ), el));
    return el;
}

/** Synchronously dispatch a Trilium event through the parent to the registered hook handler. */
function fireEvent(name: string, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent?.handleEventInChildren as any)(name, data);
    });
}

/** Settle the async `AutoLinkAttribute` render (renderAutoLink → froca → setHtml). */
async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function makeLoadResults(attributeRows: unknown[]) {
    return {
        getAttributeRows: () => attributeRows,
        getBranchRows: () => [],
        getOptionNames: () => [],
        isNoteReloaded: () => false,
        isNoteContentReloaded: () => false,
        getEntityRow: () => undefined
    };
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    parent = undefined;
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("AutoLinkAttributesTab", () => {
    it("renders nothing when the note has no auto-link attributes", () => {
        const note = buildNote({ id: "plain", title: "Plain", "#archived": "true" });
        const root = renderTab({ note, componentId: "comp-1" });
        expect(root.querySelector(".auto-link-attributes-widget")).toBeNull();
        expect(root.textContent).toBe("");
    });

    it("renders nothing when the note is null/undefined (refresh early-returns)", () => {
        const root = renderTab({ note: null, componentId: "comp-null" });
        expect(root.querySelector(".auto-link-attributes-widget")).toBeNull();

        const root2 = renderTab({ note: undefined, componentId: "comp-undef" });
        expect(root2.querySelector(".auto-link-attributes-widget")).toBeNull();
    });

    it("renders a relation auto-link with a reference link to the target note", async () => {
        buildNote({ id: "target1", title: "My <Target>" });
        const note = buildNote({ id: "src1", title: "Source", "~internalLink": "target1" });
        const root = renderTab({ note, componentId: "comp-rel" });
        await flush();

        expect(root.querySelector(".auto-link-attributes-widget")).not.toBeNull();
        const link = root.querySelector("a.reference-link");
        expect(link).not.toBeNull();
        expect(link?.getAttribute("href")).toBe("#root/target1");
        // The title is HTML-escaped, so the angle brackets are not real elements.
        expect(link?.textContent).toBe("My <Target>");
        expect(root.textContent).toContain("~internalLink=");
    });

    it("renders a label auto-link (internalBookmark) with escaped name/value", async () => {
        const note = buildNote({ id: "src2", title: "Source", "#internalBookmark": "a&b<c>" });
        const root = renderTab({ note, componentId: "comp-lbl" });
        await flush();

        expect(root.querySelector(".auto-link-attributes-widget")).not.toBeNull();
        // Label branch produces "#name=value" with the value HTML-escaped.
        const span = root.querySelector(".auto-link-attributes-container span");
        expect(span).not.toBeNull();
        expect(span?.textContent).toBe("#internalBookmark=a&b<c>");
        // No reference link for the label branch.
        expect(root.querySelector("a.reference-link")).toBeNull();
    });

    it("renders an empty link when the relation target note is missing", async () => {
        const note = buildNote({ id: "src3", title: "Source", "~imageLink": "missingTarget" });
        // Make froca.getNote resolve to null/undefined for the missing target.
        vi.spyOn(froca, "getNote").mockResolvedValue(undefined as never);
        const root = renderTab({ note, componentId: "comp-missing" });
        await flush();

        // The widget still shows (there is an auto-link attribute), but the inner html is empty.
        expect(root.querySelector(".auto-link-attributes-widget")).not.toBeNull();
        const span = root.querySelector(".auto-link-attributes-container span");
        expect(span?.innerHTML).toBe("");
    });

    it("joins multiple auto-link attributes with a space separator", async () => {
        buildNote({ id: "tA", title: "A" });
        buildNote({ id: "tB", title: "B" });
        const note = buildNote({
            id: "multi",
            title: "Multi",
            "~internalLink": "tA",
            "~includeNoteLink": "tB"
        });
        const root = renderTab({ note, componentId: "comp-multi" });
        await flush();

        const spans = root.querySelectorAll(".auto-link-attributes-container span");
        expect(spans.length).toBe(2);
        const links = root.querySelectorAll("a.reference-link");
        expect(links.length).toBe(2);
        // joinElements inserts a " " between the two spans.
        expect(root.querySelector(".auto-link-attributes-container")?.textContent).toContain(" ");
    });

    it("refreshes when an affecting attribute change arrives via entitiesReloaded", async () => {
        buildNote({ id: "erTarget", title: "ER Target" });
        const note = buildNote({ id: "erNote", title: "ER" });
        const root = renderTab({ note, componentId: "comp-er" });
        // No auto-link attributes yet → nothing rendered.
        expect(root.querySelector(".auto-link-attributes-widget")).toBeNull();

        // Add an auto-link relation to the note and notify with an affecting attribute row.
        buildNote({ id: "erNote", title: "ER", "~internalLink": "erTarget" });
        fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults([
                { type: "relation", name: "internalLink", value: "erTarget", noteId: "erNote", isDeleted: false, isInheritable: false }
            ])
        });
        await flush();

        expect(root.querySelector(".auto-link-attributes-widget")).not.toBeNull();
        expect(root.querySelector("a.reference-link")?.getAttribute("href")).toBe("#root/erTarget");
    });

    it("ignores entitiesReloaded changes that do not affect the note", async () => {
        // The owner of the changed attribute is a different, unrelated cached note.
        buildNote({ id: "otherOwner", title: "Other" });
        buildNote({ id: "naTarget", title: "Target" });
        const note = buildNote({ id: "naNote", title: "NA" });
        const root = renderTab({ note, componentId: "comp-na" });
        await flush();
        // No auto-link attributes → nothing rendered.
        expect(root.querySelector(".auto-link-attributes-widget")).toBeNull();

        // Now add an auto-link relation to the note, but signal a change owned by an unrelated
        // note → isAffecting is false → refresh does NOT run → still nothing rendered.
        buildNote({ id: "naNote", title: "NA", "~internalLink": "naTarget" });
        fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults([
                { type: "relation", name: "internalLink", value: "x", noteId: "otherOwner", isDeleted: false, isInheritable: false }
            ])
        });
        await flush();
        expect(root.querySelector(".auto-link-attributes-widget")).toBeNull();
    });
});
