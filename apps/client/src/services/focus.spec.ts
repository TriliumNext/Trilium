import { afterEach, describe, expect, it, vi } from "vitest";
import $ from "jquery";

import { focusSavedElement, saveFocusedElement } from "./focus.js";

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("focus service", () => {
    it("does nothing (no focus change) when nothing was focused at save time", () => {
        // saveFocusedElement() always assigns a jQuery object: $(":focus") is an *empty* wrapped
        // set when nothing is focused (never null). So the early-return at the top of
        // focusSavedElement() is NOT hit here; execution falls through to .hasClass("ck") (false)
        // then .focus() on the empty set, which is a harmless no-op.
        const $body = $(document.body);
        ($body[0] as HTMLElement).focus();
        // happy-dom keeps focus on <body> by default; record the active element to prove it is unchanged.
        const before = document.activeElement;

        saveFocusedElement();

        // Spy on jQuery's focus to prove no real element receives focus via the empty-set branch.
        const focusProtoSpy = vi.spyOn($.fn, "focus");
        expect(() => focusSavedElement()).not.toThrow();
        // .focus() is invoked on the empty wrapped set (harmless), but the active element is unchanged.
        expect(focusProtoSpy).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(before);
    });

    it("returns early (engages the !$lastFocusedElement guard) once the saved element has been cleared", () => {
        // Save and restore a real element first; restoring sets $lastFocusedElement = null (line 28).
        const $input = $("<input type='text'>").appendTo(document.body);
        ($input[0] as HTMLInputElement).focus();
        saveFocusedElement();
        focusSavedElement();
        expect(document.activeElement).toBe($input[0]);

        // Now move focus away. A second focusSavedElement() hits the `if (!$lastFocusedElement) return;`
        // early-return branch and must NOT touch focus.
        const $other = $("<input type='text'>").appendTo(document.body);
        ($other[0] as HTMLInputElement).focus();
        expect(document.activeElement).toBe($other[0]);

        const focusProtoSpy = vi.spyOn($.fn, "focus");
        focusSavedElement();
        // Early return: no .focus() invoked at all and the active element is untouched.
        expect(focusProtoSpy).not.toHaveBeenCalled();
        expect(document.activeElement).toBe($other[0]);
    });

    it("restores focus to a plain saved element", () => {
        const $input = $("<input type='text'>").appendTo(document.body);
        const el = $input[0] as HTMLInputElement;
        el.focus();
        expect(document.activeElement).toBe(el);

        saveFocusedElement();

        // Move focus elsewhere, then restore it.
        const $other = $("<input type='text'>").appendTo(document.body);
        ($other[0] as HTMLInputElement).focus();
        expect(document.activeElement).toBe($other[0]);

        focusSavedElement();
        expect(document.activeElement).toBe(el);

        // After restoring, the saved element is cleared -> calling again is a no-op.
        ($other[0] as HTMLInputElement).focus();
        focusSavedElement();
        expect(document.activeElement).toBe($other[0]);
    });

    it("focuses the CKEditor instance when the saved element is a ck element", () => {
        const focusSpy = vi.fn();
        const editorInstance = { editing: { view: { focus: focusSpy } } };

        const $editable = $("<div class='ck-editor__editable'>").appendTo(document.body);
        // jQuery .prop() reads from the DOM property bag.
        $editable.prop("ckeditorInstance", editorInstance);
        // The focused element carries the "ck" class and lives inside the editable.
        const $ck = $("<div class='ck' tabindex='0'>").appendTo($editable);
        ($ck[0] as HTMLElement).focus();

        saveFocusedElement();
        focusSavedElement();

        expect(focusSpy).toHaveBeenCalledTimes(1);
        expect(focusSpy).toHaveBeenCalledWith();

        // The ck branch must also reset $lastFocusedElement to null (line 28). Move focus and call
        // again: with the saved element cleared, the early return engages and the editor is NOT
        // re-focused. If the ck branch failed to null the field, focusSpy would fire a second time.
        const $elsewhere = $("<input type='text'>").appendTo(document.body);
        ($elsewhere[0] as HTMLInputElement).focus();
        focusSavedElement();
        expect(focusSpy).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe($elsewhere[0]);
    });

    it("logs when the ck element has no resolvable CKEditor instance", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        // A ck element with no .ck-editor__editable ancestor -> editor lookup yields undefined.
        const $ck = $("<div class='ck' tabindex='0'>").appendTo(document.body);
        ($ck[0] as HTMLElement).focus();

        saveFocusedElement();
        focusSavedElement();

        expect(logSpy).toHaveBeenCalledWith("Could not find CKEditor instance to focus last element");
    });
});
