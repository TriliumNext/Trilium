import { render, type RefObject } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommandNames } from "../../../components/app_context";
import contextMenu, { type ContextMenuOptions, type MenuItem } from "../../../menus/context_menu";
import {
    type ContentEmbedMenu, ContentEmbedMenus, type ContentEmbedMenusOptions, useContentEmbedMenus
} from "./content_embed_menus";
import { getContentEmbedTools } from "./content_embed_tools";

const LANGUAGE: ContentEmbedMenu = {
    id: "language",
    title: "Change language",
    text: "Python",
    items: [ { title: "Python" } ],
    filterable: true
};
const WIDTH: ContentEmbedMenu = { id: "width", title: "Change width", text: "4", items: [] };
const WRAP_ITEM: MenuItem<CommandNames> = { title: "Word wrap", items: [] };

const elements: HTMLElement[] = [];

afterEach(() => {
    for (const element of elements) {
        act(() => render(null, element));
        element.remove();
    }
    elements.length = 0;
    vi.restoreAllMocks();
});

describe("ContentEmbedMenus", () => {
    it("shows a button for each menu, and notifies only when a button changes", () => {
        const menus = new ContentEmbedMenus({ current: null });
        const listener = vi.fn();
        const unsubscribe = menus.subscribe(listener);

        menus.setMenus([ LANGUAGE, WIDTH ]);
        expect(menus.hasEditableFlag).toBe(true);
        expect(menus.getTools()).toEqual([
            {
                id: "language", label: "Change language", text: "Python", opensMenu: true,
                isOn: false, group: "menus"
            },
            {
                id: "width", label: "Change width", text: "4", opensMenu: true,
                isOn: false, group: "menus"
            }
        ]);
        expect(listener).toHaveBeenCalledOnce();

        menus.setMenus([ { ...LANGUAGE, items: [] }, WIDTH ]);
        expect(listener).toHaveBeenCalledOnce();
        menus.setMenus([ LANGUAGE, { ...WIDTH, text: "2" } ]);
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        menus.setMenus([ LANGUAGE ]);
        expect(listener).toHaveBeenCalledTimes(2);
        menus.execute();
    });

    it("opens a menu below its button, and keeps the text editor around the embed focused", () => {
        const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
        const focusTracker = { add: vi.fn(), remove: vi.fn() };
        const { root } = buildEmbed({ ui: { focusTracker } });
        const menus = new ContentEmbedMenus({ current: root });
        menus.setMenus([ LANGUAGE, WIDTH ]);
        const anchor = buildAnchor(10, 20);

        menus.openMenu("language", anchor);
        menus.openMenu("missing", anchor);
        expect(show).toHaveBeenCalledOnce();
        const options = getShownOptions(show);
        expect(options).toMatchObject({
            x: 10 + window.scrollX, y: 20 + window.scrollY, items: LANGUAGE.items, filterable: true
        });

        const container = document.createElement("div");
        options.onShow?.(container);
        expect(focusTracker.add).toHaveBeenCalledWith(container);
        expect(menus.getTools().map((tool) => tool.isOn)).toEqual([ true, false ]);

        options.onHide?.();
        expect(focusTracker.remove).toHaveBeenCalledWith(container);
        expect(menus.getTools().map((tool) => tool.isOn)).toEqual([ false, false ]);
        options.selectMenuItemHandler({ title: "Python" }, new MouseEvent("click"));

        // An embed outside a text editor, as in a read-only note, has no focus to keep.
        const outside = new ContentEmbedMenus({ current: document.createElement("div") });
        outside.setMenus([ WIDTH ]);
        outside.openMenu("width", anchor);
        const outsideOptions = getShownOptions(show, 1);
        outsideOptions.onShow?.(container);
        outsideOptions.onHide?.();
        expect(focusTracker.add).toHaveBeenCalledOnce();
    });

    it("lets the press on the button of the open menu close it, and that of another open it", () => {
        const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
        const dismissed = vi.spyOn(contextMenu, "dismissedByLastPress", "get");
        const menus = new ContentEmbedMenus({ current: null });
        menus.setMenus([ LANGUAGE, WIDTH ]);
        const anchor = buildAnchor(0, 0);

        dismissed.mockReturnValue(false);
        menus.openMenu("language", anchor);
        // The press outside the menu closes it before the button runs.
        getShownOptions(show).onHide?.();
        dismissed.mockReturnValue(true);
        menus.openMenu("language", anchor);
        expect(show).toHaveBeenCalledOnce();

        menus.openMenu("width", anchor);
        expect(show).toHaveBeenCalledTimes(2);
        dismissed.mockReturnValue(false);
        menus.openMenu("language", anchor);
        expect(show).toHaveBeenCalledTimes(3);
    });
});

describe("useContentEmbedMenus", () => {
    it("adds the buttons to the toolbar of the embed while mounted, and follows the menus", () => {
        const { figure, root } = buildEmbed();

        act(() => render(<Harness menus={[ LANGUAGE ]} root={root} />, root));
        const tools = getContentEmbedTools(figure);
        expect(tools?.hasEditableFlag).toBe(true);
        expect(tools?.getTools().map((tool) => tool.text)).toEqual([ "Python" ]);

        expect(tools?.getMenuItems?.()).toEqual([]);

        act(() => render(
            <Harness menus={[ LANGUAGE, WIDTH ]} menuItems={[ WRAP_ITEM ]} root={root} />, root
        ));
        expect(getContentEmbedTools(figure)).toBe(tools);
        expect(tools?.getTools().map((tool) => tool.text)).toEqual([ "Python", "4" ]);
        expect(tools?.getMenuItems?.()).toEqual([ WRAP_ITEM ]);

        act(() => render(null, root));
        expect(getContentEmbedTools(figure)).toBeNull();

        // Content not in an embed yet adds no buttons.
        act(() => render(<Harness menus={[ LANGUAGE ]} />, root));
        expect(getContentEmbedTools(figure)).toBeNull();
    });

    it("offers its options, with another provider once the Editable flag changes", () => {
        const { figure, root } = buildEmbed();
        const icon = "<svg></svg>";

        act(() => render(
            <Harness
                menus={[]} root={root} options={{ hasEditableFlag: false, boxSizeIcon: icon }}
            />, root
        ));
        const readOnly = getContentEmbedTools(figure);
        expect([ readOnly?.hasEditableFlag, readOnly?.boxSizeIcon ]).toEqual([ false, icon ]);
        expect(readOnly?.getTools()).toEqual([]);

        act(() => render(
            <Harness menus={[ LANGUAGE ]} root={root} options={{ boxSizeIcon: icon }} />, root
        ));
        const editable = getContentEmbedTools(figure);
        expect(editable).not.toBe(readOnly);
        expect([ editable?.hasEditableFlag, editable?.boxSizeIcon ]).toEqual([ true, icon ]);
        expect(editable?.getTools().map((tool) => tool.text)).toEqual([ "Python" ]);

        act(() => render(
            <Harness menus={[ LANGUAGE ]} root={root} options={{ boxSizeIcon: icon }} />, root
        ));
        expect(getContentEmbedTools(figure)).toBe(editable);
    });
});

interface HarnessProps {
    menus: ContentEmbedMenu[];
    menuItems?: MenuItem<CommandNames>[];
    options?: ContentEmbedMenusOptions;
    root?: HTMLElement;
}

/** Mounts `useContentEmbedMenus()` with a ref to `root`, or to nothing while `root` is unset. */
function Harness({ menus, menuItems, options, root }: HarnessProps) {
    const rootRef: RefObject<HTMLElement | null> = useRef(root ?? null);
    useContentEmbedMenus(rootRef, menus, menuItems, options);
    return null;
}

/** An embed in the editable root of a text editor, if `editor` is given, and its content box. */
function buildEmbed(editor?: unknown) {
    const editable = document.createElement("div");
    editable.className = "ck-editor__editable";
    Object.assign(editable, { ckeditorInstance: editor });
    const figure = document.createElement("figure");
    figure.className = "include-note";
    const root = document.createElement("div");
    figure.append(root);
    editable.append(figure);
    document.body.append(editable);
    elements.push(root, editable);
    return { figure, root };
}

function buildAnchor(left: number, bottom: number) {
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({ left, bottom }) as DOMRect;
    return anchor;
}

function getShownOptions(show: { mock: { calls: unknown[][] } }, index = 0) {
    return show.mock.calls[index]?.[0] as ContextMenuOptions<unknown>;
}
