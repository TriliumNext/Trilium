import { CKEditorError, ClassicEditor, EditorWatchdog } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CustomWatchdog from "./custom_watchdog.js";

/**
 * Creates a minimal CKEditorError-shaped object for use as a test double.
 * The method under test only reads `.message`, so a plain Error with the right
 * message and a cast is sufficient.
 */
function makeCKEditorError(message: string): CKEditorError {
    const err = new Error(message) as unknown as CKEditorError;
    return err;
}

describe("CustomWatchdog", () => {
    let watchdog: CustomWatchdog;

    beforeEach(() => {
        // Pass null as the Editor class — the watchdog can be instantiated without
        // creating an actual editor instance, which is all we need here.
        watchdog = new CustomWatchdog(null);
    });

    describe("_isErrorComingFromThisItem", () => {
        it("returns false when the error message contains the first ignored pattern", () => {
            const error = makeCKEditorError(
                "TypeError: Cannot read properties of null (reading 'parent')"
            );
            expect(watchdog._isErrorComingFromThisItem(error)).toBe(false);
        });

        it("returns false when the error message contains the second ignored pattern", () => {
            const error = makeCKEditorError(
                "Uncaught model-nodelist-offset-out-of-bounds error"
            );
            expect(watchdog._isErrorComingFromThisItem(error)).toBe(false);
        });

        it("returns false for error message that exactly equals the first ignored string", () => {
            const error = makeCKEditorError(
                "TypeError: Cannot read properties of null (reading 'parent')"
            );
            expect(watchdog._isErrorComingFromThisItem(error)).toBe(false);
        });

        it("delegates to super._isErrorComingFromThisItem when the error is not ignored", () => {
            const unrelatedError = makeCKEditorError("Some unrelated editor error");

            // Spy on the prototype of the *parent* class so we can observe the super call
            // and control the return value.
            const superSpy = vi
                .spyOn(EditorWatchdog.prototype, "_isErrorComingFromThisItem")
                .mockReturnValue(true);

            const result = watchdog._isErrorComingFromThisItem(unrelatedError);

            expect(superSpy).toHaveBeenCalledWith(unrelatedError);
            expect(result).toBe(true);

            superSpy.mockRestore();
        });

        it("propagates the super return value of false when the error is not ignored", () => {
            const unrelatedError = makeCKEditorError("Another unrelated error");

            const superSpy = vi
                .spyOn(EditorWatchdog.prototype, "_isErrorComingFromThisItem")
                .mockReturnValue(false);

            const result = watchdog._isErrorComingFromThisItem(unrelatedError);

            expect(superSpy).toHaveBeenCalledWith(unrelatedError);
            expect(result).toBe(false);

            superSpy.mockRestore();
        });

        it("does NOT call super when the first ignored pattern matches (short-circuits)", () => {
            const error = makeCKEditorError(
                "TypeError: Cannot read properties of null (reading 'parent') — stack ..."
            );

            const superSpy = vi.spyOn(
                EditorWatchdog.prototype,
                "_isErrorComingFromThisItem"
            );

            const result = watchdog._isErrorComingFromThisItem(error);

            expect(result).toBe(false);
            expect(superSpy).not.toHaveBeenCalled();

            superSpy.mockRestore();
        });

        it("does NOT call super when the second ignored pattern matches (short-circuits)", () => {
            const error = makeCKEditorError("model-nodelist-offset-out-of-bounds");

            const superSpy = vi.spyOn(
                EditorWatchdog.prototype,
                "_isErrorComingFromThisItem"
            );

            const result = watchdog._isErrorComingFromThisItem(error);

            expect(result).toBe(false);
            expect(superSpy).not.toHaveBeenCalled();

            superSpy.mockRestore();
        });
    });

    describe("class identity", () => {
        it("is an instance of EditorWatchdog", () => {
            expect(watchdog).toBeInstanceOf(EditorWatchdog);
        });

        it("can be constructed with a real Editor class", () => {
            const watchdogWithEditor = new CustomWatchdog(ClassicEditor);
            expect(watchdogWithEditor).toBeInstanceOf(CustomWatchdog);
        });
    });
});
