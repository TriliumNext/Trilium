import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => ({
    setLabel: vi.fn(),
    removeAttributeById: vi.fn()
}));

vi.mock("../../../services/attributes", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../services/attributes")>();
    return {
        ...actual,
        default: {
            ...actual.default,
            setLabel: (...args: unknown[]) => writes.setLabel(...args),
            removeAttributeById: (...args: unknown[]) => writes.removeAttributeById(...args)
        }
    };
});

import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import ListExpandControls from "./ListExpandControls";

async function click(button: HTMLElement | null | undefined) {
    await act(async () => {
        button?.click();
        await Promise.resolve();
    });
}

describe("ListExpandControls", () => {
    beforeEach(() => vi.clearAllMocks());

    it("collapses the collection's own expanded label, leaving an inherited one alone", async () => {
        const parent = buildNote({
            title: "Parent",
            "#expanded(inheritable)": "3",
            children: [ { id: "collection", title: "Collection", "#expanded": "2" } ]
        });
        const collection = froca.getNoteFromCache("collection");
        const inherited = parent.getOwnedLabels("expanded")[0];
        const owned = collection?.getOwnedLabels("expanded")[0];
        if (!collection || !owned) throw new Error("collection fixture missing");

        const container = renderInto(<ListExpandControls note={collection} />);
        await click(container.querySelector<HTMLElement>(".list-expand-controls > .icon-action"));

        expect(writes.removeAttributeById).toHaveBeenCalledTimes(1);
        expect(writes.removeAttributeById).toHaveBeenCalledWith("collection", owned.attributeId);
        expect(writes.removeAttributeById).not.toHaveBeenCalledWith("collection", inherited.attributeId);
    });

    it("expands the direct children from the main button", async () => {
        const collection = buildNote({ title: "Collection" });

        const container = renderInto(<ListExpandControls note={collection} />);
        await click(container.querySelector<HTMLElement>(".list-expand-split > .icon-action"));

        expect(writes.setLabel).toHaveBeenCalledWith(collection.noteId, "expanded", "");
    });

    it("offers every depth from the split's menu, and sets the one picked", async () => {
        const collection = buildNote({ title: "Collection" });

        const container = renderInto(<ListExpandControls note={collection} />);
        await click(container.querySelector<HTMLElement>(".list-expand-split .dropdown button"));

        const items = await vi.waitFor(() => {
            const found = [ ...document.querySelectorAll<HTMLElement>(".tn-popup li.dropdown-item") ];
            expect(found).toHaveLength(6);
            return found;
        });

        await click(items.at(-1));

        expect(writes.setLabel).toHaveBeenCalledWith(collection.noteId, "expanded", "all");
    });
});
