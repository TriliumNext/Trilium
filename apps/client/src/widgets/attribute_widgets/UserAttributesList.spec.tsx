import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";

import Component from "../../components/component";
import { buildNote } from "../../test/easy-froca";
import { makeLoadResults, renderComponent, resetFroca } from "../../test/render";
import UserAttributesDisplay from "./UserAttributesList";

// --- Render harness ------------------------------------------------------------------------------

let parent: Component;

function render(vnode: preact.ComponentChild): HTMLElement {
    return renderComponent(vnode, { parent }).container;
}

function fireTriliumEvent(name: string, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent.handleEventInChildren as any)(name, data);
    });
}

beforeEach(() => {
    parent = new Component();
    resetFroca();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("UserAttributesDisplay - empty states", () => {
    it("renders nothing when the note has no promoted attribute definitions", () => {
        const note = buildNote({ id: "n-empty", title: "Empty", "#archived": "true" });
        const el = render(<UserAttributesDisplay note={note} />);
        expect(el.querySelector(".user-attributes")).toBeNull();
    });

    it("renders nothing when a definition exists but has no matching value label", () => {
        // Definition present, but no actual `myColor` label value -> result is empty.
        const note = buildNote({ id: "n-def-only", title: "DefOnly", "#label:myColor": "promoted,color" });
        const el = render(<UserAttributesDisplay note={note} />);
        expect(el.querySelector(".user-attributes")).toBeNull();
    });

    it("skips labels and relations whose value is empty", () => {
        const note = buildNote({
            id: "n-empty-vals",
            title: "EmptyVals",
            "#label:emptyLabel": "promoted,text",
            "#emptyLabel": "",
            "#relation:emptyRel": "promoted",
            "~emptyRel": ""
        });
        const el = render(<UserAttributesDisplay note={note} />);
        // Both values are empty strings so nothing is pushed -> the container is not rendered.
        expect(el.querySelector(".user-attributes")).toBeNull();
    });
});

describe("UserAttributesDisplay - label types", () => {
    it("renders a text label with friendly name and value", () => {
        const note = buildNote({
            id: "n-text",
            title: "Text",
            "#label:myText": "promoted,text",
            "#myText": "hello"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        const attr = el.querySelector(".user-attribute");
        expect(attr?.className).toContain("type-label");
        expect(attr?.className).toContain("text");
        expect(attr?.querySelector("strong")?.textContent).toBe("myText:");
        expect(attr?.textContent).toContain("hello");
    });

    it("uses the promoted alias as the friendly name when present", () => {
        const note = buildNote({
            id: "n-alias",
            title: "Alias",
            "#label:internalName": "promoted,text,alias=Display Name",
            "#internalName": "value"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        expect(el.querySelector(".user-attribute strong")?.textContent).toBe("Display Name:");
    });

    it("formats a number label with the configured precision", () => {
        const note = buildNote({
            id: "n-num",
            title: "Num",
            "#label:myNum": "promoted,number,precision=2",
            "#myNum": "3.14159"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        expect(el.querySelector(".user-attribute")?.textContent).toContain("3.14");
    });

    it("leaves a number label unformatted when value is not a number", () => {
        const note = buildNote({
            id: "n-num-nan",
            title: "NumNaN",
            "#label:myNum": "promoted,number,precision=2",
            "#myNum": "not-a-number"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        expect(el.querySelector(".user-attribute")?.textContent).toContain("not-a-number");
    });

    it("leaves a number label unformatted when precision is absent", () => {
        const note = buildNote({
            id: "n-num-noprec",
            title: "NumNoPrec",
            "#label:myNum": "promoted,number",
            "#myNum": "5.5"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        expect(el.querySelector(".user-attribute")?.textContent).toContain("5.5");
    });

    it("renders a date label and a datetime label", () => {
        const note = buildNote({
            id: "n-date",
            title: "Date",
            "#label:theDate": "promoted,date",
            "#theDate": "2024-01-15",
            "#label:theDateTime": "promoted,datetime",
            "#theDateTime": "2024-01-15T10:30:00"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        const attrs = el.querySelectorAll(".user-attribute");
        expect(attrs.length).toBe(2);
        // Date strong labels are present and there is a formatted value following.
        expect(attrs[0]?.querySelector("strong")?.textContent).toBe("theDate:");
        expect(attrs[1]?.querySelector("strong")?.textContent).toBe("theDateTime:");
        expect((attrs[0]?.textContent ?? "").length).toBeGreaterThan("theDate:".length);
        expect((attrs[1]?.textContent ?? "").length).toBeGreaterThan("theDateTime:".length);
    });

    it("renders a time label", () => {
        const note = buildNote({
            id: "n-time",
            title: "Time",
            "#label:theTime": "promoted,time",
            "#theTime": "13:45:00"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        const attr = el.querySelector(".user-attribute");
        expect(attr?.querySelector("strong")?.textContent).toBe("theTime:");
        expect((attr?.textContent ?? "").length).toBeGreaterThan("theTime:".length);
    });

    it("renders a checked and an unchecked boolean label", () => {
        const note = buildNote({
            id: "n-bool",
            title: "Bool",
            "#label:flagOn": "promoted,boolean",
            "#flagOn": "true",
            "#label:flagOff": "promoted,boolean",
            "#flagOff": "false"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        const attrs = el.querySelectorAll(".user-attribute");
        expect(attrs.length).toBe(2);
        expect(attrs[0]?.querySelector("span.bx-check-square")).not.toBeNull();
        expect(attrs[0]?.querySelector("strong")?.textContent).toBe("flagOn");
        expect(attrs[1]?.querySelector("span.bx-square")).not.toBeNull();
        expect(attrs[1]?.querySelector("strong")?.textContent).toBe("flagOff");
    });

    it("renders a url label as an anchor that stops propagation on click", () => {
        const note = buildNote({
            id: "n-url",
            title: "Url",
            "#label:myUrl": "promoted,url",
            "#myUrl": "https://example.com"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        const anchor = el.querySelector("a");
        expect(anchor?.getAttribute("href")).toBe("https://example.com");
        expect(anchor?.getAttribute("target")).toBe("_blank");
        expect(anchor?.textContent).toBe("myUrl");

        const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
        let propagationStopped = false;
        const originalStop = evt.stopPropagation.bind(evt);
        evt.stopPropagation = () => {
            propagationStopped = true;
            originalStop();
        };
        anchor?.dispatchEvent(evt);
        expect(propagationStopped).toBe(true);
    });

    it("renders a color label with background and computed text color styles", () => {
        const note = buildNote({
            id: "n-color",
            title: "Color",
            "#label:myColor": "promoted,color",
            "#myColor": "#ffffff"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        const attr = el.querySelector<HTMLElement>(".user-attribute");
        expect(attr?.textContent).toBe("myColor");
        expect(attr?.style.backgroundColor).not.toBe("");
        // A white background yields black readable text.
        expect(attr?.style.color).toBe("#000");
    });
});

describe("UserAttributesDisplay - relations & ignore list", () => {
    it("renders a relation label using a NoteLink to the target note", async () => {
        buildNote({ id: "target-note", title: "Target Note" });
        const note = buildNote({
            id: "n-rel",
            title: "Rel",
            "#relation:myRel": "promoted",
            "~myRel": "target-note"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        const attr = el.querySelector(".user-attribute");
        expect(attr?.className).toContain("type-relation");
        expect(attr?.querySelector("strong")?.textContent).toBe("myRel:");
        // NoteLink resolves asynchronously; ensure the container span exists.
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(attr?.querySelector("span")).not.toBeNull();
    });

    it("omits attributes whose name is in the ignored list", () => {
        const note = buildNote({
            id: "n-ignore",
            title: "Ignore",
            "#label:keepMe": "promoted,text",
            "#keepMe": "kept",
            "#label:dropMe": "promoted,text",
            "#dropMe": "dropped"
        });
        const el = render(<UserAttributesDisplay note={note} ignoredAttributes={["dropMe"]} />);
        const attrs = el.querySelectorAll(".user-attribute");
        expect(attrs.length).toBe(1);
        expect(attrs[0]?.textContent).toContain("kept");
        expect(attrs[0]?.textContent).not.toContain("dropped");
    });
});

describe("UserAttributesDisplay - reactivity", () => {
    it("re-computes attributes when an affecting entitiesReloaded event fires", () => {
        const note = buildNote({
            id: "n-react",
            title: "React",
            "#label:myText": "promoted,text",
            "#myText": "before"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        expect(el.querySelector(".user-attribute")?.textContent).toContain("before");

        // Mutate the underlying value, then fire an event whose row owner is the cached note.
        const valueAttr = note.getLabels("myText")[0];
        if (valueAttr) {
            valueAttr.value = "after";
        }
        fireTriliumEvent("entitiesReloaded", { loadResults: makeLoadResults({ attributeRows: [
            { type: "label", name: "myText", value: "after", noteId: "n-react", isDeleted: false }
        ] }) });
        expect(el.querySelector(".user-attribute")?.textContent).toContain("after");
    });

    it("does not re-render when the entitiesReloaded event does not affect the note", () => {
        const note = buildNote({
            id: "n-noreact",
            title: "NoReact",
            "#label:myText": "promoted,text",
            "#myText": "stable"
        });
        const el = render(<UserAttributesDisplay note={note} />);
        expect(el.querySelector(".user-attribute")?.textContent).toContain("stable");

        // Row owned by an unrelated, uncached note id -> isAffecting returns false.
        fireTriliumEvent("entitiesReloaded", { loadResults: makeLoadResults({ attributeRows: [
            { type: "label", name: "myText", value: "changed", noteId: "some-other-note", isDeleted: false }
        ] }) });
        expect(el.querySelector(".user-attribute")?.textContent).toContain("stable");
    });
});
