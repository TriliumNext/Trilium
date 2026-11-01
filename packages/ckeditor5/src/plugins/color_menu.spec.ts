import {
    _setModelData as setModelData,
    ButtonView,
    type ClassicEditor,
    Essentials,
    FontBackgroundColor,
    FontColor,
    IconFontColor,
    Paragraph
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ColorMenu, { type ColorMenuHost, type ColorMenuRequest } from "./color_menu.js";

const PLUGINS = [Essentials, Paragraph, FontColor, FontBackgroundColor, ColorMenu];

describe("ColorMenu", () => {
    /** An editor whose host records what it is asked to show. */
    async function createEditor() {
        const requests: ColorMenuRequest[] = [];
        const host = {
            show: vi.fn((request: ColorMenuRequest) => {
                requests.push(request);
            }),
            hide: vi.fn(),
            destroy: vi.fn()
        } satisfies ColorMenuHost;
        const editor = await createTestEditor(PLUGINS, {
            toolbar: ["colorMenu"],
            colorMenu: { host: () => host }
        });
        const last = () => {
            const request = requests.at(-1);
            if (!request) throw new Error("The host was asked to show no menu.");
            return request;
        };
        return { editor, host, button: getButton(editor), last };
    }

    it("is not registered without a host", async () => {
        const editor = await createTestEditor(PLUGINS, {});
        expect(editor.ui.componentFactory.has("colorMenu")).toBe(false);
    });

    it("hands the host the colors at the selection, under the button", async () => {
        const { editor, host, button, last } = await createEditor();
        expect(button).toMatchObject({ label: "Color", icon: IconFontColor, tooltip: true });

        setModelData(editor.model, "<paragraph>[<$text fontColor=\"#e64d4d\">foo</$text>]</paragraph>");
        button.fire("execute");

        expect(host.show).toHaveBeenCalledTimes(1);
        expect(last()).toMatchObject({
            anchor: button.element,
            fontColor: "#e64d4d",
            fontBackgroundColor: null
        });
    });

    it("colors the selection, or removes its color, hiding the menu and focusing the text first", async () => {
        const { editor, host, button, last } = await createEditor();
        const focus = vi.spyOn(editor.editing.view, "focus");
        const order: string[] = [];
        host.hide.mockImplementation(() => order.push("hide"));
        editor.commands.get("fontBackgroundColor")?.on("execute", () => order.push("execute"));

        setModelData(editor.model, "<paragraph>[<$text fontColor=\"#e64d4d\">foo</$text>]</paragraph>");
        button.fire("execute");
        last().setColor("fontBackgroundColor", "#4de64d");

        expect(order).toStrictEqual(["hide", "execute"]);
        expect(focus).toHaveBeenCalled();
        expect(editor.getData()).toBe(
            "<p><span style=\"background-color:#4de64d;color:#e64d4d;\">foo</span></p>");

        button.fire("execute");
        last().setColor("fontColor", null);
        expect(editor.getData()).toBe("<p><span style=\"background-color:#4de64d;\">foo</span></p>");

        // The system's color picker can answer after a press elsewhere dismissed the menu.
        button.fire("execute");
        last().onClose(false);
        last().setColor("fontColor", "#4d4de6");
        expect(host.hide).toHaveBeenCalledTimes(2);
        expect(editor.getData()).toBe(
            "<p><span style=\"background-color:#4de64d;color:#4d4de6;\">foo</span></p>");
    });

    it("counts the menu's element as the editor's own while it is shown", async () => {
        const { editor, button, last } = await createEditor();
        button.fire("execute");

        const element = document.createElement("div");
        last().setElement(element);
        expect(editor.ui.focusTracker.elements).toContain(element);

        const next = document.createElement("div");
        last().setElement(next);
        expect(editor.ui.focusTracker.elements).not.toContain(element);
        expect(editor.ui.focusTracker.elements).toContain(next);

        last().setElement(null);
        expect(editor.ui.focusTracker.elements).not.toContain(next);
    });

    it("toggles from its button, and returns focus to it when closed with Escape", async () => {
        const { host, button, last } = await createEditor();
        const focus = vi.spyOn(button, "focus");

        button.fire("execute");
        button.fire("execute");
        expect(host.hide).toHaveBeenCalledTimes(1);
        expect(host.show).toHaveBeenCalledTimes(1);

        // A request already hidden no longer answers for the menu.
        last().onClose(true);
        expect(focus).not.toHaveBeenCalled();

        button.fire("execute");
        last().onClose(true);
        expect(focus).toHaveBeenCalledTimes(1);

        // Closed by a press elsewhere, the menu leaves focus where it is, and the button opens it again.
        button.fire("execute");
        last().onClose(false);
        expect(focus).toHaveBeenCalledTimes(1);
        button.fire("execute");
        expect(host.show).toHaveBeenCalledTimes(4);
    });

    it("gives the text the focus as its button closes a menu in the keyboard's place", async () => {
        const { editor, host, button } = await createEditor();
        const inPlaceOfKeyboard = vi.fn(() => false);
        Object.assign(host, { isInPlaceOfKeyboard: inPlaceOfKeyboard });
        const focusText = vi.spyOn(editor.editing.view, "focus");

        button.fire("execute");
        button.fire("execute");
        expect(host.hide).toHaveBeenCalledTimes(1);
        expect(focusText).not.toHaveBeenCalled();

        // The press that closes it brings the keyboard back, which a later focus would not.
        inPlaceOfKeyboard.mockReturnValue(true);
        button.fire("execute");
        button.fire("execute");
        expect(host.hide).toHaveBeenCalledTimes(2);
        expect(focusText).toHaveBeenCalledOnce();
    });

    it("is enabled while either color can be set, and destroys the host with the editor", async () => {
        const { editor, host, button } = await createEditor();
        expect(button.isEnabled).toBe(true);

        editor.enableReadOnlyMode("spec");
        expect(button.isEnabled).toBe(false);
        editor.disableReadOnlyMode("spec");

        button.fire("execute");
        await editor.destroy();
        expect(host.destroy).toHaveBeenCalled();
    });
});

function getButton(editor: ClassicEditor) {
    const item = editor.ui.view.toolbar.items.get(0);
    if (!(item instanceof ButtonView)) {
        throw new Error("The toolbar holds no color menu button.");
    }
    return item;
}
