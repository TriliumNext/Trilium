import { _getViewData as getViewData, _setModelData as setModelData, ClassicEditor, Essentials, LinkEditing, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import ReferenceLink from "./referencelink.js";

describe("ReferenceLink", () => {
    let editor: ClassicEditor;
    let getReferenceLinkTitle: ReturnType<typeof vi.fn>;
    let getReferenceLinkTitleSync: ReturnType<typeof vi.fn>;
    let loadReferenceLinkTitle: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        getReferenceLinkTitle = vi.fn(async () => "Some title");
        getReferenceLinkTitleSync = vi.fn(() => "Some title");
        loadReferenceLinkTitle = vi.fn(async () => undefined);
        installGlobMock({
            getComponentByEl: () => ({ loadReferenceLinkTitle }),
            getReferenceLinkTitle,
            getReferenceLinkTitleSync
        });

        editor = await createTestEditor([Essentials, Paragraph, LinkEditing, ReferenceLink]);
    });

    it("loads the plugin, registers the schema and the command", () => {
        expect(editor.plugins.get(ReferenceLink)).toBeInstanceOf(ReferenceLink);
        expect(editor.commands.get("referenceLink")).toBeDefined();
        expect(editor.model.schema.isRegistered("reference")).toBe(true);
        expect(editor.model.schema.isInline("reference")).toBe(true);
        expect(editor.model.schema.isObject("reference")).toBe(true);
    });

    it("inserts a reference and warms the title cache when executed with a href", async () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        editor.execute("referenceLink", { href: "#root/noteAbc" });

        expect(getReferenceLinkTitle).toHaveBeenCalledWith("#root/noteAbc");

        // The element is only inserted from the async then-callback.
        await Promise.resolve();
        await Promise.resolve();

        const reference = findReference(editor);
        expect(reference).toBeDefined();
        expect(reference?.getAttribute("href")).toBe("#root/noteAbc");
    });

    it("does nothing when executed with an empty or whitespace-only href", async () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        editor.execute("referenceLink", { href: "   " });
        editor.execute("referenceLink", { href: "" });

        await Promise.resolve();
        await Promise.resolve();

        expect(getReferenceLinkTitle).not.toHaveBeenCalled();
        expect(findReference(editor)).toBeUndefined();
    });

    it("is enabled where text is allowed and disabled where it is not", () => {
        const command = editor.commands.get("referenceLink");

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(command?.isEnabled).toBe(true);

        // Disallow `reference` everywhere so the schema check in refresh() fails
        // while keeping a real, renderable selection container.
        editor.model.schema.addChildCheck((_context, def) => {
            if (def.name === "reference") {
                return false;
            }
        });

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        command?.refresh();
        expect(command?.isEnabled).toBe(false);
    });

    it("upcasts an <a class=\"reference-link\"> into a reference element", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">Some title</a></p>');

        const reference = findReference(editor);
        expect(reference).toBeDefined();
        expect(reference?.getAttribute("href")).toBe("#root/noteAbc");
    });

    it("renders the reference as an inline widget in the editing view and loads its title", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">Some title</a></p>');

        const view = getViewData(editor.editing.view);
        expect(view).toContain("reference-link");
        expect(view).toContain("ck-widget");

        // Force the UIElement's render callback to run so loadReferenceLinkTitle is invoked.
        const domRoot = editor.editing.view.getDomRoot();
        const anchor = domRoot?.querySelector("a.reference-link");
        expect(anchor).not.toBeNull();
        expect(loadReferenceLinkTitle).toHaveBeenCalledTimes(1);
        expect(loadReferenceLinkTitle.mock.calls[0]?.[1]).toBe("#root/noteAbc");
    });

    it("dataDowncasts a reference back to an anchor, resolving the title synchronously", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">old</a></p>');

        const data = editor.getData();

        expect(getReferenceLinkTitleSync).toHaveBeenCalledWith("#root/noteAbc");
        expect(data).toContain('class="reference-link"');
        expect(data).toContain('href="#root/noteAbc"');
        expect(data).toContain("Some title");
    });

    it("maps a view position inside the reference widget to a model position outside of it", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">Some title</a></p>');

        const reference = findReference(editor);
        expect(reference).toBeDefined();
        const referenceView = reference ? editor.editing.mapper.toViewElement(reference) : undefined;
        expect(referenceView).toBeDefined();
        if (!referenceView) {
            return;
        }

        // A position *inside* the reference widget must be remapped to a model position
        // outside the `reference` element (the predicate matches on the .reference-link class).
        const viewPosition = editor.editing.view.createPositionAt(referenceView, 0);
        const modelPosition = editor.editing.mapper.toModelPosition(viewPosition);

        expect(modelPosition.parent.is("element", "reference")).toBe(false);
    });

    it("suppresses the default link opener so reference links are not opened in a new tab", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">Some title</a></p>');

        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

        const anchor = document.createElement("a");
        anchor.setAttribute("href", "#root/noteAbc");

        editor.editing.view.document.fire("click", {
            domTarget: anchor,
            domEvent: { ctrlKey: true, metaKey: true },
            preventDefault: () => {}
        });

        // Our registered opener returns true, so the default window.open path is skipped.
        expect(openSpy).not.toHaveBeenCalled();

        openSpy.mockRestore();
    });
});

function findReference(editor: ClassicEditor) {
    const root = editor.model.document.getRoot();
    if (!root) {
        return undefined;
    }
    for (const item of editor.model.createRangeIn(root).getItems()) {
        if (item.is("element", "reference")) {
            return item;
        }
    }
    return undefined;
}
