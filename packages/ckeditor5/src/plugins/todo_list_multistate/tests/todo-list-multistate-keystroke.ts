import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, keyCodes } from "ckeditor5";
import type { Command } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TodoListMultistateEditing from "../todo_list_multistate_editing.js";

function pressCtrlShiftEnter(editor: ClassicEditor) {
    return editor.keystrokes.press({
        keyCode: keyCodes.enter,
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        preventDefault: () => {},
        stopPropagation: () => {}
    } as Parameters<typeof editor.keystrokes.press>[0]);
}

describe("TodoListMultistateEditing Ctrl+Shift+Enter cycle", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let model: ClassicEditor["model"];
    let command: Command;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, TodoListMultistateEditing]
        });
        model = editor.model;
        command = editor.commands.get("setTaskState")!;
        setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">[]x</paragraph>");
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    it("walks the default cycle none -> doing -> done -> maybe -> cancelled -> none", () => {
        expect(command.value).toBe("none");

        pressCtrlShiftEnter(editor);
        expect(command.value).toBe("doing");

        pressCtrlShiftEnter(editor);
        expect(command.value).toBe("done");

        pressCtrlShiftEnter(editor);
        expect(command.value).toBe("maybe");

        pressCtrlShiftEnter(editor);
        expect(command.value).toBe("cancelled");

        pressCtrlShiftEnter(editor);
        expect(command.value).toBe("none");
    });

    it("is a no-op when the caret is not in a todo item", () => {
        setModelData(model, "<paragraph>[]x</paragraph>");
        pressCtrlShiftEnter(editor);
        expect(command.isEnabled).toBe(false);
        expect(command.value).toBe(null);
    });

    it("skips hidden states in the cycle", async () => {
        await editor.destroy();
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, TodoListMultistateEditing],
            taskStates: [
                { id: "_taskStateNone", name: "none", title: "None", markdownSymbol: " ", isCompleted: false, icon: "bx bx-checkbox" },
                { id: "_taskStateDoing", name: "doing", title: "Doing", markdownSymbol: "/", isCompleted: false, icon: "bx bx-loader" },
                { id: "_taskStateDone", name: "done", title: "Done", markdownSymbol: "x", isCompleted: true, icon: "bx bx-check" },
                { id: "_taskStateMaybe", name: "maybe", title: "Maybe", markdownSymbol: "?", isCompleted: false, icon: "bx bx-question-mark", isHidden: true }
            ]
        } as Parameters<typeof ClassicEditor.create>[1]);
        model = editor.model;
        command = editor.commands.get("setTaskState")!;
        setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">[]x</paragraph>");

        pressCtrlShiftEnter(editor);
        expect(command.value).toBe("doing");
        pressCtrlShiftEnter(editor);
        expect(command.value).toBe("done");
        // Hidden "maybe" is skipped; cycle wraps back to "none".
        pressCtrlShiftEnter(editor);
        expect(command.value).toBe("none");
    });
});
