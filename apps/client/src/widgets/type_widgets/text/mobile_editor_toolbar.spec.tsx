import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    isKeyboardPanelOpen, useClosedByToolbarTap, useEditorsFocused, useIsKeyboardPanelOpen,
    useKeyboardPanel, useShownToolbarElement
} from "./mobile_editor_toolbar";

describe("useEditorsFocused", () => {
    it("follows the focus trackers of both editors, and stops once unmounted", () => {
        const noteEditor = buildEditor();
        const nestedEditor = buildEditor();
        const seen: boolean[] = [];
        const host = document.createElement("div");
        function Harness({ nested }: { nested: CKTextEditor | null }) {
            seen.push(useEditorsFocused(noteEditor.editor, nested));
            return null;
        }

        act(() => render(<Harness nested={null} />, host));
        expect(seen.at(-1)).toBe(false);

        act(() => noteEditor.setFocused(true));
        expect(seen.at(-1)).toBe(true);
        act(() => noteEditor.setFocused(false));
        expect(seen.at(-1)).toBe(false);

        // The toolbar of a nested editor lies outside the editable of the note's editor.
        act(() => render(<Harness nested={nestedEditor.editor} />, host));
        act(() => nestedEditor.setFocused(true));
        expect(seen.at(-1)).toBe(true);

        // An editor focused before the hook subscribes counts from the start.
        act(() => render(null, host));
        act(() => render(<Harness nested={nestedEditor.editor} />, host));
        expect(seen.at(-1)).toBe(true);

        act(() => render(null, host));
        expect(noteEditor.listenerCount()).toBe(0);
        expect(nestedEditor.listenerCount()).toBe(0);
    });
});

describe("useKeyboardPanel", () => {
    afterEach(() => {
        vi.useRealTimers();
        document.getElementById("root-widget")?.remove();
        document.querySelector(".ck-editor__editable")?.remove();
    });

    it("takes the keyboard's place while mounted, for a menu opened over it", async () => {
        const root = document.createElement("div");
        root.id = "root-widget";
        document.body.append(root);
        const isMarked = isKeyboardPanelOpen;
        const seen: ReturnType<typeof useKeyboardPanel>[] = [];
        const host = document.createElement("div");
        function Harness({ enabled }: { enabled: boolean }) {
            seen.push(useKeyboardPanel(enabled));
            return null;
        }

        // Without a keyboard, the menu takes a place of its own height.
        act(() => render(<Harness enabled />, host));
        expect(seen.at(-1)).toMatchObject({ isPanel: true, isOwnHeight: true });
        expect(isMarked()).toBe(true);
        await act(async () => render(null, host));
        await endPress();
        expect(isMarked()).toBe(false);

        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Harness enabled={false} />, host));
        expect(seen.at(-1)?.isPanel).toBe(false);
        expect(isMarked()).toBe(false);
        act(() => render(null, host));

        act(() => render(<Harness enabled />, host));
        expect(seen.at(-1)).toMatchObject({ isPanel: true, isOwnHeight: false });
        expect(isMarked()).toBe(true);

        // The keyboard closes as the menu takes focus, and the menu keeps its place.
        root.classList.remove("virtual-keyboard-opened");
        act(() => render(<Harness enabled />, host));
        expect(seen.at(-1)?.isPanel).toBe(true);
        expect(isMarked()).toBe(true);

        await act(async () => render(null, host));
        await endPress();
        expect(isMarked()).toBe(false);
    });

    it("sizes the place by the menu with no keyboard, giving it back as the menu closes", async () => {
        const { editable, host } = buildPanelFixture();
        document.body.style.setProperty("--tn-keyboard-height", "300px");
        document.body.style.setProperty("--mobile-toolbar-gap", "6px");
        const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(240);
        function Menu() {
            const { measureRef } = useKeyboardPanel(true);
            return <div ref={measureRef} />;
        }

        const placeHeight = () => document.body.style.getPropertyValue("--tn-keyboard-place-height");

        // The menu rises by the toolbar's gap above the place, to meet the toolbar. The keyboard's
        // own height stays, for the stylesheet to cap the menu at.
        act(() => render(<Menu />, host));
        expect(isKeyboardPanelOpen()).toBe(true);
        expect(placeHeight()).toBe("234px");
        expect(document.body.style.getPropertyValue("--tn-keyboard-height")).toBe("300px");
        document.body.style.removeProperty("--mobile-toolbar-gap");

        // An entry that runs focuses the text, and no keyboard comes up to take the place over.
        await act(async () => {
            render(null, host);
            editable.focus();
        });
        expect(isKeyboardPanelOpen()).toBe(false);
        expect(placeHeight()).toBe("");
        expect(document.body.style.getPropertyValue("--tn-keyboard-height")).toBe("300px");
        height.mockRestore();
        document.body.style.removeProperty("--tn-keyboard-height");
    });

    it("keeps the place for a keyboard that comes back, until it is up", async () => {
        const { root, editable, host, Harness, seen } = buildPanelFixture();

        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Harness />, host));
        root.classList.remove("virtual-keyboard-opened");

        // An entry that runs, or the menu's own button, focuses the text as the menu closes.
        await act(async () => {
            render(null, host);
            editable.focus();
        });
        expect(isKeyboardPanelOpen()).toBe(true);

        // A menu opened while the keyboard is on its way takes the place over.
        act(() => render(<Harness />, host));
        expect(seen.at(-1)?.isPanel).toBe(true);
        await act(async () => render(null, host));
        expect(isKeyboardPanelOpen()).toBe(true);

        root.classList.add("virtual-keyboard-opened");
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve));
        });
        expect(isKeyboardPanelOpen()).toBe(false);
    });

    it("keeps the place through the press that closes a menu, for the menu it opens", async () => {
        const { root, host, Harness, seen } = buildPanelFixture();

        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Harness />, host));
        expect(seen.at(-1)?.replacesPanel).toBe(false);
        root.classList.remove("virtual-keyboard-opened");

        // A press on another button of the toolbar closes the menu as it starts, and its click
        // opens the button's own menu; the button must not move from under it in between.
        await act(async () => render(null, host));
        expect(isKeyboardPanelOpen()).toBe(true);
        await act(async () => {
            window.dispatchEvent(new MouseEvent("click"));
            render(<Harness />, host);
            await new Promise((resolve) => setTimeout(resolve));
        });
        expect(seen.at(-1)?.isPanel).toBe(true);
        // It shows at once, in the place the closed one leaves.
        expect(seen.at(-1)?.replacesPanel).toBe(true);
        expect(isKeyboardPanelOpen()).toBe(true);

        await act(async () => render(null, host));
        await endPress();
        expect(isKeyboardPanelOpen()).toBe(false);
    });

    it("keeps the editor counted as focused while a closed panel holds the place", async () => {
        const { root, host, Harness } = buildPanelFixture();
        const editor = buildEditor();
        const focused: boolean[] = [];
        const focusHost = document.createElement("div");
        function Focus() {
            focused.push(useEditorsFocused(editor.editor, null));
            return null;
        }
        act(() => render(<Focus />, focusHost));
        act(() => editor.setFocused(true));

        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Harness />, host));
        root.classList.remove("virtual-keyboard-opened");

        // The press that closes the panel blurs the editor until its click focuses the toolbar.
        await act(async () => {
            render(null, host);
            editor.setFocused(false);
        });
        expect(focused.at(-1)).toBe(true);

        await endPress();
        expect(isKeyboardPanelOpen()).toBe(false);
        expect(focused.at(-1)).toBe(false);

        // An editor that had no focus as the place was taken does not gain it.
        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Harness />, host));
        expect(focused.at(-1)).toBe(false);
        await act(async () => render(null, host));
        await endPress();
        act(() => render(null, focusHost));
    });

    it("tells whether a panel holds the place, until it is given back", async () => {
        const { root, host, Harness } = buildPanelFixture();
        const seen: boolean[] = [];
        const probeHost = document.createElement("div");
        function Probe() {
            seen.push(useIsKeyboardPanelOpen());
            return null;
        }
        act(() => render(<Probe />, probeHost));
        expect(seen.at(-1)).toBe(false);

        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Harness />, host));
        expect(seen.at(-1)).toBe(true);
        root.classList.remove("virtual-keyboard-opened");

        // The press on the X closes the menu as it starts, and its click still finds it open.
        await act(async () => render(null, host));
        expect(seen.at(-1)).toBe(true);
        await endPress();
        expect(seen.at(-1)).toBe(false);
        act(() => render(null, probeHost));
    });

    it("gives the place up after its press when focus goes elsewhere, or after 1s", async () => {
        const { root, editable, host, Harness } = buildPanelFixture();

        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Harness />, host));
        root.classList.remove("virtual-keyboard-opened");
        await act(async () => render(null, host));
        expect(isKeyboardPanelOpen()).toBe(true);
        await endPress();
        expect(isKeyboardPanelOpen()).toBe(false);

        // A press with no click, as one that scrolls.
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Harness />, host));
        root.classList.remove("virtual-keyboard-opened");
        await act(async () => render(null, host));
        expect(isKeyboardPanelOpen()).toBe(true);
        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(isKeyboardPanelOpen()).toBe(false);

        // A keyboard that never comes back, as with a hardware keyboard.
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Harness />, host));
        root.classList.remove("virtual-keyboard-opened");
        await act(async () => {
            render(null, host);
            editable.focus();
        });
        expect(isKeyboardPanelOpen()).toBe(true);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(isKeyboardPanelOpen()).toBe(false);
    });

    it("gives the place to the keyboard a tap on another toolbar button brings up", async () => {
        const { root, editable, host } = buildPanelFixture();
        const row = document.createElement("div");
        row.className = "classic-toolbar-island";
        row.innerHTML = `<div class="classic-toolbar-widget"><button class="anchor"></button><button class="bold"></button></div>`;
        document.body.append(row);
        const anchor = row.querySelector<HTMLElement>(".anchor");
        const bold = row.querySelector<HTMLElement>(".bold");
        if (!anchor || !bold) throw new Error("toolbar fixture is missing a button");
        function Menu() {
            useKeyboardPanel(true);
            useClosedByToolbarTap(anchor as HTMLElement, () => render(null, host));
            return null;
        }

        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        root.classList.add("virtual-keyboard-opened");
        act(() => render(<Menu />, host));
        root.classList.remove("virtual-keyboard-opened");

        // The tap's click closes the menu in a capture listener. A browser drains the microtasks
        // after each listener of a user's click, so the button's own listener, which focuses the
        // text, runs after them.
        await act(async () => bold.click());
        expect(isKeyboardPanelOpen()).toBe(true);
        editable.focus();

        // The keyboard comes up well within `PRESS_TIMEOUT`, and the place goes with it.
        act(() => {
            vi.advanceTimersByTime(1);
        });
        root.classList.add("virtual-keyboard-opened");
        await act(async () => {});
        expect(isKeyboardPanelOpen()).toBe(false);
        row.remove();
    });
});

/** Ends the press that closed a menu with its click, and lets what the click runs settle. */
async function endPress() {
    await act(async () => {
        window.dispatchEvent(new MouseEvent("click"));
        await new Promise((resolve) => setTimeout(resolve));
    });
}

function buildPanelFixture() {
    const root = document.createElement("div");
    root.id = "root-widget";
    const editable = document.createElement("div");
    editable.className = "ck-editor__editable";
    editable.tabIndex = 0;
    document.body.append(root, editable);
    const seen: ReturnType<typeof useKeyboardPanel>[] = [];
    const host = document.createElement("div");
    function Harness() {
        seen.push(useKeyboardPanel(true));
        return null;
    }
    return { root, editable, host, Harness, seen };
}

describe("useShownToolbarElement", () => {
    it("shows the editor's toolbar, and the text formatting one while that is active", () => {
        const main = document.createElement("div");
        const formatting = document.createElement("div");
        const listeners = new Set<() => void>();
        const plugin = {
            isActive: false,
            toolbarView: { element: formatting },
            on: (_event: string, listener: () => void) => listeners.add(listener),
            off: (_event: string, listener: () => void) => listeners.delete(listener)
        };
        const setActive = (isActive: boolean) => {
            plugin.isActive = isActive;
            for (const listener of listeners) listener();
        };
        const withPlugin = {
            ui: { view: { toolbar: { element: main } } },
            plugins: { has: () => true, get: () => plugin }
        } as unknown as CKTextEditor;
        const withoutPlugin = {
            ui: { view: { toolbar: { element: main } } },
            plugins: { has: () => false }
        } as unknown as CKTextEditor;

        const seen: (HTMLElement | undefined)[] = [];
        const host = document.createElement("div");
        function Harness({ editor }: { editor: CKTextEditor | undefined }) {
            seen.push(useShownToolbarElement(editor));
            return null;
        }

        act(() => render(<Harness editor={undefined} />, host));
        expect(seen.at(-1)).toBeUndefined();

        act(() => render(<Harness editor={withPlugin} />, host));
        expect(seen.at(-1)).toBe(main);
        act(() => setActive(true));
        expect(seen.at(-1)).toBe(formatting);
        act(() => setActive(false));
        expect(seen.at(-1)).toBe(main);

        // An editor whose formatting toolbar was left active shows it from the start.
        act(() => setActive(true));
        act(() => render(<Harness editor={withoutPlugin} />, host));
        expect(seen.at(-1)).toBe(main);
        act(() => render(<Harness editor={withPlugin} />, host));
        expect(seen.at(-1)).toBe(formatting);

        act(() => render(null, host));
        expect(listeners.size).toBe(0);
    });

    it("shows the context toolbar while it is active, over the text formatting one", () => {
        const main = document.createElement("div");
        const formatting = fakeSwappedToolbar();
        const context = fakeSwappedToolbar();
        const plugins: Record<string, unknown> = { TextFormattingToolbar: formatting.plugin, ContextToolbar: context.plugin };
        const editor = {
            ui: { view: { toolbar: { element: main } } },
            plugins: { has: (name: string) => name in plugins, get: (name: string) => plugins[name] }
        } as unknown as CKTextEditor;

        const seen: (HTMLElement | undefined)[] = [];
        const host = document.createElement("div");
        function Harness() {
            seen.push(useShownToolbarElement(editor));
            return null;
        }

        act(() => render(<Harness />, host));
        act(() => context.setActive(true));
        expect(seen.at(-1)).toBe(context.element);
        act(() => formatting.setActive(true));
        expect(seen.at(-1)).toBe(context.element);
        act(() => context.setActive(false));
        expect(seen.at(-1)).toBe(formatting.element);
        act(() => formatting.setActive(false));
        expect(seen.at(-1)).toBe(main);

        act(() => render(null, host));
        expect(context.listenerCount()).toBe(0);
    });
});

/** A plugin that swaps its toolbar in for the editor's own, as `TextFormattingToolbar` does. */
function fakeSwappedToolbar() {
    const element = document.createElement("div");
    const listeners = new Set<() => void>();
    const plugin = {
        isActive: false,
        toolbarView: { element },
        on: (_event: string, listener: () => void) => listeners.add(listener),
        off: (_event: string, listener: () => void) => listeners.delete(listener)
    };
    return {
        plugin,
        element,
        setActive(isActive: boolean) {
            plugin.isActive = isActive;
            for (const listener of listeners) listener();
        },
        listenerCount: () => listeners.size
    };
}

function buildEditor() {
    const listeners = new Set<() => void>();
    const focusTracker = {
        isFocused: false,
        on: (_event: string, listener: () => void) => listeners.add(listener),
        off: (_event: string, listener: () => void) => listeners.delete(listener)
    };
    return {
        editor: { ui: { focusTracker } } as unknown as CKTextEditor,
        setFocused(isFocused: boolean) {
            focusTracker.isFocused = isFocused;
            for (const listener of listeners) {
                listener();
            }
        },
        listenerCount: () => listeners.size
    };
}
