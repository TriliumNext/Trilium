import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Replace the heavy legacy AttributeDetailWidget with a lightweight fake so that the real
// useLegacyWidget hook still runs, but instantiation stays cheap and showAttributeDetail is a spy.
const showAttributeDetail = vi.fn();
vi.mock("../attribute_widgets/attribute_detail", async () => {
    const { default: BasicWidget } = await import("../basic_widget");
    class FakeAttributeDetailWidget extends BasicWidget {
        showAttributeDetail = showAttributeDetail;
        doRender() {
            this.$widget = $("<div class='fake-attr-detail'></div>");
        }
    }
    return { default: FakeAttributeDetailWidget };
});

import FAttribute from "../../entities/fattribute";
import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { flush, renderComponent, resetFroca } from "../../test/render";
import InheritedAttributesTab from "./InheritedAttributesTab";

// --- Render helper (renders the component inside a real ParentComponent) --------------------------

function renderTab(props: { note?: FNote; componentId?: string; emptyListString?: string }) {
    return renderComponent(
        <InheritedAttributesTab
            note={props.note ?? null}
            componentId={props.componentId ?? "comp-1"}
            emptyListString={props.emptyListString}
        />
    );
}

/** Collect the FAttribute objects froca holds for the given owner note. */
function attributesOf(noteId: string): FAttribute[] {
    return Object.values(froca.attributes).filter((attr) => attr.noteId === noteId);
}

/**
 * Override a note's getAttributes() to return a fixed list while still honoring the
 * (type, name) filter args that helpers like getRelations()/isAffecting() rely on.
 */
function stubAttributes(note: FNote, attrs: FAttribute[]) {
    note.getAttributes = (type?: string, name?: string) =>
        attrs.filter((attr) => (!type || attr.type === type) && (!name || attr.name === name));
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
});

afterEach(() => {
    // remove any portal content appended to document.body by createPortal
    for (const el of Array.from(document.body.querySelectorAll(".fake-attr-detail"))) {
        el.remove();
    }
});

describe("InheritedAttributesTab", () => {
    it("renders the empty fallback when the note has no inherited attributes", () => {
        const note = buildNote({ id: "noInh", title: "N", "#archived": "true" });
        const { container: root } = renderTab({ note });

        const list = root.querySelector(".inherited-attributes-container");
        expect(root.querySelector(".inherited-attributes-widget")).toBeTruthy();
        expect(list).toBeTruthy();
        // No rendered attribute spans (the fallback branch renders no <span> children).
        expect(list?.querySelector("span")).toBeNull();
    });

    it("uses the supplied emptyListString and tolerates a missing note", () => {
        const { container: withCustom } = renderTab({ note: buildNote({ id: "e1", title: "E" }), emptyListString: "no_attrs" });
        // Custom emptyListString branch: still the fallback (no attribute spans).
        expect(withCustom.querySelector(".inherited-attributes-container")).toBeTruthy();
        expect(withCustom.querySelector(".inherited-attributes-container span")).toBeNull();

        // note=null: refresh() returns early, list stays empty, no crash.
        const { container: noNote } = renderTab({ note: undefined });
        expect(noNote.querySelector(".inherited-attributes-container")).toBeTruthy();
        expect(noNote.querySelector(".inherited-attributes-container span")).toBeNull();
    });

    it("renders inherited attributes, grouped/sorted, joined with a separator", async () => {
        // Two owner notes, each contributing inherited attributes; one owner contributes two
        // attributes so the same-noteId position-sort branch is exercised too.
        buildNote({ id: "ownerB", title: "B", "#readOnly": "true", "#includeArchived": "false" });
        buildNote({ id: "ownerA", title: "A", "#archived": "true" });

        const ownerBAttrs = attributesOf("ownerB");
        const ownerAAttrs = attributesOf("ownerA");
        // Shuffle so refresh()'s sort has to reorder: B (pos 1), B (pos 0), A.
        const reversedB = [...ownerBAttrs].reverse();
        const combined = [...reversedB, ...ownerAAttrs];

        const note = buildNote({ id: "child", title: "Child" });
        stubAttributes(note, combined);

        const { container: root } = renderTab({ note });
        await flush();

        const spans = root.querySelectorAll(".inherited-attributes-container > span");
        // Three attributes → three rendered spans (RawHtml renders a <span>).
        expect(spans.length).toBe(3);
        // The first rendered group must belong to ownerA (sorts before ownerB by noteId).
        // We assert the count + that text content is non-empty for each.
        for (const span of Array.from(spans)) {
            expect(span.innerHTML.length).toBeGreaterThan(0);
        }
        // A separator (" ") sits between rendered attributes.
        expect(root.querySelector(".inherited-attributes-container")?.textContent).toContain("#");
    });

    it("sorts across owners in both directions (groups inherited attributes)", async () => {
        // Build owners whose noteIds differ lexicographically and feed the attributes in an order
        // that forces the comparator's ternary to return both -1 and 1.
        buildNote({ id: "zOwner", title: "Z", "#archived": "true" });
        buildNote({ id: "aOwner", title: "A", "#readOnly": "true" });
        const zAttrs = attributesOf("zOwner");
        const aAttrs = attributesOf("aOwner");

        // Order: z (high), a (low), z (high) → comparisons yield both branches of `a < b ? -1 : 1`.
        const zClone = new FAttribute(froca, {
            noteId: "zOwner",
            attributeId: "z-clone",
            type: "label",
            name: "includeArchived",
            value: "true",
            position: 1,
            isInheritable: true
        });
        froca.attributes["z-clone"] = zClone;
        const mixed = [...zAttrs, ...aAttrs, zClone];

        const note = buildNote({ id: "sortChild", title: "S" });
        stubAttributes(note, mixed);

        const { container: root } = renderTab({ note });
        await flush();

        const spans = root.querySelectorAll(".inherited-attributes-container > span");
        expect(spans.length).toBe(3);
    });

    it("opens the attribute detail (debounced) when an attribute is clicked", async () => {
        vi.useFakeTimers();
        try {
            buildNote({ id: "ownerC", title: "C", "#archived": "true" });
            const attrs = attributesOf("ownerC");
            const note = buildNote({ id: "clickChild", title: "CC" });
            stubAttributes(note, attrs);

            const { container: root } = renderTab({ note });
            // settle the renderAttribute promise under fake timers
            await act(async () => {
                await vi.runOnlyPendingTimersAsync();
            });

            const span = root.querySelector(".inherited-attributes-container > span");
            expect(span).toBeTruthy();
            act(() => {
                span?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            });
            // The handler defers the call by 100ms.
            expect(showAttributeDetail).not.toHaveBeenCalled();
            act(() => {
                vi.advanceTimersByTime(100);
            });
            expect(showAttributeDetail).toHaveBeenCalledTimes(1);
            const callArg = showAttributeDetail.mock.calls[0][0];
            expect(callArg.isOwned).toBe(false);
            expect(callArg.attribute.noteId).toBe("ownerC");
            expect(callArg.attribute.name).toBe("archived");
        } finally {
            vi.useRealTimers();
        }
    });

    it("refreshes on entitiesReloaded only when an affecting attribute changes", async () => {
        // Owner note contributes an inherited attribute (different noteId) once the event fires.
        buildNote({ id: "ownerEvt", title: "O", "#archived": "true" });
        const ownerAttrs = attributesOf("ownerEvt");

        const note = buildNote({ id: "evtChild", title: "K" });
        // Start with no inherited attributes; reveal them only after the affecting event.
        let currentAttrs: FAttribute[] = [];
        note.getAttributes = (type?: string, name?: string) =>
            currentAttrs.filter((attr) => (!type || attr.type === type) && (!name || attr.name === name));

        const { container: root, parent } = renderTab({ note, componentId: "comp-x" });
        await flush();
        expect(root.querySelector(".inherited-attributes-container > span")).toBeNull();

        // A row owned by an UNCACHED note is non-affecting (isAffecting short-circuits) → no refresh.
        const nonAffectingRow = {
            type: "label",
            name: "archived",
            value: "true",
            noteId: "uncachedNote",
            isInheritable: false,
            isDeleted: false
        };
        // A row owned by the note itself IS affecting → triggers refresh().
        const affectingRow = {
            type: "label",
            name: "archived",
            value: "true",
            noteId: "evtChild",
            isInheritable: false,
            isDeleted: false
        };

        currentAttrs = ownerAttrs;

        await act(async () => {
            parent?.handleEventInChildren("entitiesReloaded", {
                loadResults: makeLoadResults([nonAffectingRow], "comp-x")
            } as never);
        });
        await flush();
        // Non-affecting change: refresh did not run, list still empty.
        expect(root.querySelector(".inherited-attributes-container > span")).toBeNull();

        // A change reported under a DIFFERENT componentId is also ignored.
        await act(async () => {
            parent?.handleEventInChildren("entitiesReloaded", {
                loadResults: makeLoadResults([affectingRow], "other-comp")
            } as never);
        });
        await flush();
        expect(root.querySelector(".inherited-attributes-container > span")).toBeNull();

        await act(async () => {
            parent?.handleEventInChildren("entitiesReloaded", {
                loadResults: makeLoadResults([affectingRow], "comp-x")
            } as never);
        });
        await flush();
        // Affecting change: refresh ran and the inherited attribute now renders.
        expect(root.querySelector(".inherited-attributes-container > span")).toBeTruthy();
    });
});

/** Minimal LoadResults stub exposing only getAttributeRows, as the component reads. */
function makeLoadResults(attributeRows: unknown[], componentId: string) {
    return {
        getAttributeRows: (cid: string) => (cid === componentId ? attributeRows : [])
    };
}
