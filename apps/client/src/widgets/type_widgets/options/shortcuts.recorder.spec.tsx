import { render, VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const { showPersistent, closePersistent } = vi.hoisted(() => ({
    showPersistent: vi.fn(),
    closePersistent: vi.fn()
}));

vi.mock("../../../services/toast", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../services/toast")>();
    return {
        ...actual,
        default: { ...actual.default, showPersistent, closePersistent }
    };
});

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useStaticTooltip: vi.fn()
}));

import { keyboardEventToShortcut, ShortcutRecorder } from "./shortcuts";

let container: HTMLDivElement | undefined;

async function renderInto(vnode: VNode) {
    const target = document.createElement("div");
    document.body.appendChild(target);
    container = target;
    await act(async () => {
        render(vnode, target);
    });
    return target;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    showPersistent.mockClear();
    closePersistent.mockClear();
});

async function keyDown(init: KeyboardEventInit) {
    await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true }));
    });
}

async function clickRecorder(root: HTMLElement) {
    const button = root.querySelector("button.shortcut-recorder");
    expect(button).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
        (button as HTMLButtonElement).click();
    });
    return button as HTMLButtonElement;
}

describe("ShortcutRecorder", () => {
    it("records a valid combination, ignoring lone modifiers, and reports it via onCapture", async () => {
        const onCapture = vi.fn();
        const root = await renderInto(<ShortcutRecorder onCapture={onCapture} />);

        // Starting recording surfaces the persistent toast.
        const button = await clickRecorder(root);
        expect(showPersistent).toHaveBeenCalledTimes(1);
        expect(button.className).toContain("recording");

        // A lone modifier keeps recording active and produces nothing.
        await keyDown({ key: "Control", code: "ControlLeft", ctrlKey: true });
        expect(onCapture).not.toHaveBeenCalled();
        expect(closePersistent).not.toHaveBeenCalled();

        // A bindable combination is captured and stops recording.
        const combo: KeyboardEventInit = { key: "k", code: "KeyK", ctrlKey: true };
        const expected = keyboardEventToShortcut(new KeyboardEvent("keydown", combo));
        expect(expected).toBeTruthy();

        await keyDown(combo);
        expect(onCapture).toHaveBeenCalledTimes(1);
        expect(onCapture).toHaveBeenCalledWith(expected);
        expect(closePersistent).toHaveBeenCalledTimes(1);
    });

    it("cancels on a bare Escape without capturing a shortcut", async () => {
        const onCapture = vi.fn();
        const root = await renderInto(<ShortcutRecorder onCapture={onCapture} />);

        await clickRecorder(root);
        expect(showPersistent).toHaveBeenCalledTimes(1);

        await keyDown({ key: "Escape", code: "Escape" });
        expect(onCapture).not.toHaveBeenCalled();
        expect(closePersistent).toHaveBeenCalledTimes(1);
    });
});
