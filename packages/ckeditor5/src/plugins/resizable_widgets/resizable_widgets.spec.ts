import {
    _getModelData as getModelData,
    type ClassicEditor,
    Essentials,
    Paragraph,
    Plugin,
    Undo,
    WidgetToolbarRepository
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cdp, userEvent } from "vitest/browser";

import { createTestEditor } from "../../../test/editor-kit.js";
import { TestBoxPlugin } from "../../../test/fixture-plugins.js";
import { registerTestCleanup } from "../../../test/globals-test-kit.js";
import ResizableWidgets, { type ResizableWidgetConfig } from "./resizable_widgets.js";

const STYLES = `
    .ck.ck-editor__editable { width: 400px; padding: 0; font-size: 10px; }
    .test-box { width: var(--test-width, auto); }
    .test-box-content { height: var(--test-height, 50px); }
    .test-rtl .test-box { direction: rtl; }
    .test-centered .test-box { margin-inline: auto; }
    .test-scroller .ck.ck-editor__main { height: 150px; overflow-y: auto; }
    .test-scroller .ck.ck-editor__editable { height: 1000px; }
`;

const RESIZED = "<div class=\"test-box\" style=\"--test-height:8em;--test-width:30em;\">"
    + "&nbsp;</div>";

describe("ResizableWidgets", () => {
    let editor: ClassicEditor;
    let capture: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        const style = document.createElement("style");
        style.textContent = STYLES;
        document.head.append(style);
        capture = vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
        registerTestCleanup(() => {
            style.remove();
            capture.mockRestore();
            document.body.classList.remove("test-rtl", "test-scroller", "test-centered");
        });
    });

    async function createEditor(
        config: Partial<ResizableWidgetConfig> = {},
        extraPlugins: Array<typeof Plugin> = []
    ) {
        class ResizableTestBox extends Plugin {
            static get requires() {
                return [ TestBoxPlugin, ResizableWidgets ];
            }

            init() {
                const { conversion, model, plugins } = this.editor;
                model.schema.extend("testBox", { allowAttributes: "kind" });
                conversion.for("editingDowncast").add((dispatcher) => {
                    dispatcher.on("insert:testBox", (_evt, data, { mapper, writer }) => {
                        const box = mapper.toViewElement(data.item);
                        if (box) {
                            const content = writer.createUIElement("div", {
                                class: "test-box-content"
                            });
                            writer.insert(writer.createPositionAt(box, 0), content);
                        }
                    });
                });
                plugins.get(ResizableWidgets).register("testBox", {
                    propertyPrefix: "--test",
                    isWidthResizable: true,
                    isHeightResizable: true,
                    heightTarget: ".test-box-content",
                    ...config
                });
            }
        }

        editor = await createTestEditor([
            Essentials, Paragraph, Undo, ResizableTestBox, ...extraPlugins
        ]);
        return editor;
    }

    function getBox() {
        const box = editor.editing.view.getDomRoot()?.querySelector<HTMLElement>(".test-box");
        if (!box) {
            throw new Error("Expected a rendered box.");
        }
        return box;
    }

    function getHandle(name: string) {
        const handle = getBox().querySelector(`.ck-widget__resize-handle_${name}`);
        if (!handle) {
            throw new Error(`Expected the ${name} handle.`);
        }
        return handle;
    }

    function getSize() {
        return getModelData(editor.model, { withoutSelection: true });
    }

    it("loads and saves a size in em, and ignores one in other units", async () => {
        await createEditor();
        editor.setData(RESIZED);
        expect(getSize()).toBe("<testBox customHeight=\"8em\" customWidth=\"30em\"></testBox>");
        expect(editor.getData()).toBe(RESIZED);

        editor.setData("<div class=\"test-box\" style=\"--test-width:300px;\"></div>");
        expect(getSize()).toBe("<testBox></testBox>");
    });

    it("draws a handle for each axis, and a corner for both", async () => {
        const getHandles = () => [ ...getBox().querySelectorAll(".ck-widget__resize-handle") ]
            .map((handle) => handle.className.replace("ck-widget__resize-handle ", ""));

        for (const [ config, handles ] of [
            [ { isHeightResizable: false }, [ "ck-widget__resize-handle_width" ] ],
            [ { isWidthResizable: false }, [ "ck-widget__resize-handle_height" ] ],
            [ {}, [
                "ck-widget__resize-handle_width",
                "ck-widget__resize-handle_height",
                "ck-widget__resize-handle_corner"
            ] ]
        ] as const) {
            await createEditor(config);
            editor.setData("<div class=\"test-box\"></div>");
            expect(getHandles()).toEqual(handles);
        }
        expect(getBox().classList.contains("ck-widget_resizable")).toBe(true);
    });

    it("shows the handles of a selected widget in a focused editor only", async () => {
        await createEditor();
        editor.setData("<p>text</p><div class=\"test-box\"></div>");
        const handles = getBox().querySelector(".ck-widget__resize-handles");
        const box = editor.model.document.getRoot()?.getChild(1);
        if (!handles || !box) {
            throw new Error("Expected the handles of a box.");
        }
        const getDisplay = () => getComputedStyle(handles).display;
        const getGrip = (name: string) => getComputedStyle(getHandle(name), "::after").content;

        await userEvent.hover(getBox());
        expect(getDisplay()).toBe("none");

        editor.model.change((writer) => writer.setSelection(box, "on"));
        expect(getBox().classList.contains("ck-widget_selected")).toBe(true);
        expect(getDisplay()).toBe("none");

        editor.editing.view.focus();
        await expect.poll(getDisplay).toBe("block");
        expect([ getGrip("width"), getGrip("height"), getGrip("corner") ])
            .toEqual([ "none", "none", "\"\"" ]);

        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        await expect.poll(getDisplay).toBe("none");
    });

    it("shows grips on the edges too on a touch screen", async () => {
        const session = cdp() as { send(method: string, params: object): Promise<unknown> };
        await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
        registerTestCleanup(async () => {
            await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
        });
        expect(matchMedia("(pointer: coarse)").matches).toBe(true);

        await createEditor();
        editor.setData("<div class=\"test-box\"></div>");
        const getGrip = (name: string) => getComputedStyle(getHandle(name), "::after").content;

        expect([ getGrip("width"), getGrip("height"), getGrip("corner") ])
            .toEqual([ "\"\"", "\"\"", "\"\"" ]);
    });

    it("sizes the handles for touch whenever there is a touch screen, primary or not", () => {
        const sheet = [ ...document.styleSheets ].find((candidate) => [ ...candidate.cssRules ]
            .some((rule) => rule instanceof CSSStyleRule
                && rule.selectorText === ".ck .ck-widget__resize-handle"));
        const conditions: string[] = [];
        const visit = (rules: CSSRuleList) => {
            for (const rule of rules) {
                if (rule instanceof CSSMediaRule) {
                    conditions.push(rule.conditionText);
                }
                if ("cssRules" in rule) {
                    visit(rule.cssRules as CSSRuleList);
                }
            }
        };
        visit(sheet?.cssRules ?? ([] as unknown as CSSRuleList));

        // The hit size and the grips of the edges, for a laptop whose mouse is primary too.
        expect(conditions).toEqual([ "(any-pointer: coarse)", "(any-pointer: coarse)" ]);
    });

    it("marks a widget resizable while isResizable allows it", async () => {
        await createEditor({ isResizable: (element) => element.getAttribute("kind") !== "fixed" });
        editor.setData("<div class=\"test-box\"></div><p>text</p>");
        const root = editor.model.document.getRoot();
        const box = root?.getChild(0);
        if (!box?.is("element")) {
            throw new Error("Expected a box.");
        }
        expect(getBox().classList.contains("ck-widget_resizable")).toBe(true);

        editor.model.change((writer) => writer.setAttribute("kind", "fixed", box));
        expect(getBox().classList.contains("ck-widget_resizable")).toBe(false);

        const paragraph = root?.getChild(1);
        if (!paragraph?.is("element")) {
            throw new Error("Expected a paragraph.");
        }
        editor.model.change((writer) => writer.setAttribute("kind", "fixed", paragraph));
        editor.model.change((writer) => writer.removeAttribute("kind", box));
        expect(getBox().classList.contains("ck-widget_resizable")).toBe(true);
    });

    it("resizes from the corner, previewing in the view and saving in one undo step", async () => {
        await createEditor();
        editor.setData("<p>text</p><div class=\"test-box\"></div>");
        const box = getBox();

        press(getHandle("corner"));
        expect(capture).toHaveBeenCalledWith(1);
        expect(editor.model.document.selection.getSelectedElement()?.name).toBe("testBox");

        move(101, 301);
        expect(box.classList.contains("ck-widget_resizing")).toBe(false);
        move(0, 330);
        await nextFrame();
        expect(box.classList.contains("ck-widget_resizing")).toBe(true);
        expect([ box.style.getPropertyValue("--test-width"), box.offsetWidth ])
            .toEqual([ "30em", 300 ]);
        expect(box.style.getPropertyValue("--test-height")).toBe("8em");
        expect(getSize()).toBe("<paragraph>text</paragraph><testBox></testBox>");

        release();
        expect(box.classList.contains("ck-widget_resizing")).toBe(false);
        expect(getSize()).toBe("<paragraph>text</paragraph>"
            + "<testBox customHeight=\"8em\" customWidth=\"30em\"></testBox>");

        editor.execute("undo");
        expect(getSize()).toBe("<paragraph>text</paragraph><testBox></testBox>");
        expect(box.getAttribute("style")).toBeNull();
    });

    it("makes the width full at the container's, and keeps the smallest size", async () => {
        await createEditor({ minHeight: 3 });
        editor.setData(RESIZED);

        press(getHandle("width"));
        move(200, 300);
        release();
        press(getHandle("height"));
        move(100, 100);
        release();

        expect(getSize()).toBe("<testBox customHeight=\"3em\"></testBox>");
        expect(getBox().offsetWidth).toBe(400);
    });

    it("narrows the width towards the right in a right-to-left widget", async () => {
        document.body.classList.add("test-rtl");
        await createEditor();
        editor.setData("<div class=\"test-box\"></div>");

        press(getHandle("width"));
        move(150, 300);
        release();

        expect(getSize()).toBe("<testBox customWidth=\"35em\"></testBox>");
    });

    it("keeps the dragged edge of a centered widget under the pointer", async () => {
        document.body.classList.add("test-centered");
        await createEditor({ isCentered: true });
        editor.setData("<div class=\"test-box\"></div>");
        const { left, right } = getBox().getBoundingClientRect();

        press(getHandle("width"));
        move(50, 300);
        const resized = getBox().getBoundingClientRect();
        expect([ resized.left - left, resized.right - right ]).toEqual([ 50, -50 ]);
        release();

        expect(getSize()).toBe("<testBox customWidth=\"30em\"></testBox>");
    });

    it("cancels on Escape, pointercancel or lost capture, and ignores other pointers", async () => {
        await createEditor();
        editor.setData(RESIZED);
        const box = getBox();

        press(getHandle("width"));
        move(150, 300);
        move(300, 300, 2);
        window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2 }));
        expect(box.style.getPropertyValue("--test-width")).toBe("35em");
        const other = new KeyboardEvent("keydown", { key: "a", cancelable: true });
        window.dispatchEvent(other);
        const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
        window.dispatchEvent(escape);
        expect([ other.defaultPrevented, escape.defaultPrevented ]).toEqual([ false, true ]);
        expect(box.style.getPropertyValue("--test-width")).toBe("30em");
        expect(box.classList.contains("ck-widget_resizing")).toBe(false);

        press(getHandle("width"));
        move(150, 300);
        window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 2 }));
        expect(box.style.getPropertyValue("--test-width")).toBe("35em");
        window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
        release();
        expect(box.style.getPropertyValue("--test-width")).toBe("30em");
        expect(editor.getData()).toBe(RESIZED);

        // The handle loses the pointer when it leaves the page, as when the editor closes.
        const handle = getHandle("width");
        const loseCapture = (pointerId: number) => handle.dispatchEvent(
            new PointerEvent("lostpointercapture", { bubbles: true, pointerId })
        );
        press(handle);
        move(150, 300);
        loseCapture(2);
        expect(box.style.getPropertyValue("--test-width")).toBe("35em");
        loseCapture(1);
        expect(box.style.getPropertyValue("--test-width")).toBe("30em");
        release();
        expect(editor.getData()).toBe(RESIZED);
    });

    it("cancels a resize when another pointer starts one", async () => {
        await createEditor({}, [ WidgetToolbarRepository ]);
        editor.setData(RESIZED);
        const box = getBox();
        const toolbars = editor.plugins.get(WidgetToolbarRepository);
        const getWidth = () => box.style.getPropertyValue("--test-width");
        const pressPen = () => press(getHandle("width"), { pointerId: 2, pointerType: "pen" });

        press(getHandle("width"));
        move(150, 300);
        expect([ getWidth(), toolbars.isEnabled ]).toEqual([ "35em", false ]);

        // A tap of the pen ends the drag of the mouse as Escape does.
        pressPen();
        window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2 }));
        expect([ getWidth(), toolbars.isEnabled ]).toEqual([ "30em", true ]);
        move(250, 300);
        expect(getWidth()).toBe("30em");

        pressPen();
        move(120, 300, 2);
        window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2 }));
        expect(getSize()).toContain("customWidth=\"32em\"");
    });

    it("stops resizing once the editor is destroyed", async () => {
        await createEditor();
        editor.setData("<div class=\"test-box\"></div>");
        press(getHandle("corner"));
        move(150, 350);
        await nextFrame();

        const { editing, model } = editor;
        await editor.destroy();
        const changes = [ vi.spyOn(editing.view, "change"), vi.spyOn(model, "change") ];
        move(200, 400);
        await nextFrame();
        release();
        expect(changes.map((change) => change.mock.calls.length)).toEqual([ 0, 0 ]);
    });

    it("resets the size of a handle on a double tap", async () => {
        await createEditor();
        editor.setData(RESIZED);

        tap(getHandle("width"));
        tap(getHandle("height"));
        tap(getHandle("width"));
        expect(editor.getData()).toBe(RESIZED);

        tap(getHandle("width"));
        expect(getSize()).toBe("<testBox customHeight=\"8em\"></testBox>");
        tap(getHandle("height"));
        tap(getHandle("height"));
        expect(getSize()).toBe("<testBox></testBox>");

        editor.setData(RESIZED);
        tap(getHandle("corner"));
        tap(getHandle("corner"));
        expect(getSize()).toBe("<testBox></testBox>");
    });

    it("resizes the height of the widget itself without a height target", async () => {
        await createEditor({ heightTarget: undefined });
        editor.setData("<div class=\"test-box\"></div>");
        const height = parseFloat(getComputedStyle(getBox()).height) + 30;

        press(getHandle("height"));
        move(100, 330);
        release();

        expect(getSize()).toBe(`<testBox customHeight="${Math.round(height) / 10}em"></testBox>`);
    });

    it("ignores a press it cannot resize from", async () => {
        await createEditor();
        editor.setData(RESIZED);
        const box = getBox();
        const isResizing = () => box.classList.contains("ck-widget_resizing");

        for (const init of [ { button: 2 }, { isPrimary: false } ]) {
            press(getHandle("corner"), init);
            move(200, 400);
            expect(isResizing()).toBe(false);
        }

        editor.enableReadOnlyMode("test");
        press(getHandle("corner"));
        move(200, 400);
        expect(isResizing()).toBe(false);
        editor.disableReadOnlyMode("test");

        const content = box.querySelector(".test-box-content");
        content?.setAttribute("class", "loading");
        press(getHandle("height"));
        move(200, 400);
        expect(isResizing()).toBe(false);
        content?.setAttribute("class", "test-box-content");
        content?.setAttribute("hidden", "");
        press(getHandle("height"));
        move(200, 400);
        expect(isResizing()).toBe(false);
        press(getHandle("corner"));
        move(150, 400);
        release();
        expect(getSize()).toBe("<testBox customHeight=\"8em\" customWidth=\"35em\"></testBox>");

        const handle = getHandle("corner");
        handle.parentElement?.remove();
        press(handle);
        expect(capture).toHaveBeenCalledTimes(1);
    });

    it("scrolls its container near the edges while the height changes", async () => {
        document.body.classList.add("test-scroller");
        await createEditor();
        editor.setData("<div class=\"test-box\"></div>");
        const scroller = getBox().closest(".ck-editor__main");
        if (!scroller) {
            throw new Error("Expected the scroll container.");
        }
        const { top, bottom } = scroller.getBoundingClientRect();
        const startY = top + 60;

        press(getHandle("height"), {}, 100, startY);
        await nextFrame();
        move(100, bottom - 5);
        await nextFrame();
        await nextFrame();
        const scrolled = scroller.scrollTop;
        expect(scrolled).toBeGreaterThan(0);

        move(100, top + 30);
        await nextFrame();
        expect(scroller.scrollTop).toBeLessThan(scrolled);

        const height = 50 + (top + 30 - startY) + scroller.scrollTop;
        release();
        expect(getSize()).toBe(`<testBox customHeight="${Math.round(height) / 10}em"></testBox>`);
    });

    it("hides the widget toolbar while resizing", async () => {
        await createEditor({}, [ WidgetToolbarRepository ]);
        editor.setData("<div class=\"test-box\"></div>");
        const toolbars = editor.plugins.get(WidgetToolbarRepository);

        press(getHandle("width"));
        move(150, 300);
        expect(toolbars.isEnabled).toBe(false);
        release();
        expect(toolbars.isEnabled).toBe(true);
    });

    it("saves nothing for a widget removed while it was resized", async () => {
        await createEditor();
        editor.setData("<div class=\"test-box\"></div>");

        press(getHandle("width"));
        move(150, 300);
        editor.setData("<p>text</p>");
        release();

        expect(editor.getData()).toBe("<p>text</p>");
    });
});

function press(target: Element, init: PointerEventInit = {}, clientX = 100, clientY = 300) {
    target.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        clientX,
        clientY,
        ...init
    }));
}

function move(clientX: number, clientY: number, pointerId = 1) {
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId, clientX, clientY }));
}

function release() {
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
}

function tap(target: Element) {
    press(target);
    move(101, 300);
    release();
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}
