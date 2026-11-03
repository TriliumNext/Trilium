import { type ClassicEditor, Essentials, getLabel, Paragraph, Undo, Widget } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { createTestEditor } from "../../../test/editor-kit.js";
import { registerTestCleanup } from "../../../test/globals-test-kit.js";
import LinkEmbed from "../link_embed/link_embed.js";
import { SIZE_ATTRIBUTES } from "../resizable_widgets/resizable_widgets.js";
import ContentEmbed, {
    BOX_SIZE_COMMAND_NAME,
    POSITION_COMMAND_NAME,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_TITLE_COMMAND_NAME
} from "./content_embed.js";
import { isVideoEmbed } from "./video_embed.js";

/** The width of a 16:9 video at Medium, 20em high. */
const VIDEO_MEDIUM_WIDTH = "35.6em";
const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const THUMBNAIL = "api/attachments/abc123/image/youtube-dQw4w9WgXcQ.jpg";
const PREVIEW_ATTRIBUTES = `data-url="${VIDEO_URL}" data-embed-type="youtube"`
    + ` data-title="A video" data-image="${THUMBNAIL}"`;
/** A video saved before videos were embeds. */
const SAVED_PREVIEW = `<section class="link-embed" ${PREVIEW_ATTRIBUTES}>&nbsp;</section>`;
const OTHER_HOST = location.hostname === "localhost" ? "127.0.0.1" : "localhost";
/** A page of another site, which a click focuses with no focus event in this page. */
const PLAYER_URL = `${location.protocol}//${OTHER_HOST}:${location.port}/package.json`;

/** Lets `FocusTracker` report a blur, which it does a task later. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve));

describe("ContentEmbedVideo", () => {
    let editor: ClassicEditor;
    let loadVideo: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadVideo = vi.fn();
        editor = await createTestEditor([
            Essentials, Paragraph, Undo, Widget, ContentEmbed, LinkEmbed
        ], {
            contentEmbed: { loadVideo, sanitizeHtml: (html: string) => html }
        });
    });

    function getBlock(index = 0) {
        const block = editor.model.document.getRoot()?.getChild(index);
        if (!block?.is("element")) {
            throw new Error(`Expected a block at ${index}.`);
        }
        return block;
    }

    function getFigure() {
        const figure = editor.editing.view.getDomRoot()?.querySelector("figure.include-note");
        if (!(figure instanceof HTMLElement)) {
            throw new Error("Expected the figure of the embed.");
        }
        return figure;
    }

    function selectBlock(index: number) {
        editor.model.change((writer) => writer.setSelection(getBlock(index), "on"));
    }

    /** Inserts a paragraph and a video whose player is a frame of `src`, and returns the frame. */
    function insertPlayer(src: string) {
        loadVideo.mockImplementation((_preview: unknown, wrapper: HTMLElement) => {
            wrapper.innerHTML = `<div class="include-note-content">`
                + `<iframe src="${src}"></iframe></div>`;
        });
        editor.setData(`<p>Text</p>${SAVED_PREVIEW}`);
        const player = getFigure().querySelector("iframe");
        if (!player) {
            throw new Error("Expected the player.");
        }
        return player;
    }

    it("loads the link preview of a video as a Full untitled embed, and saves its box", () => {
        editor.setData(SAVED_PREVIEW);

        const embed = getBlock();
        expect(embed.name).toBe("contentEmbed");
        expect(isVideoEmbed(embed)).toBe(true);
        expect(Object.fromEntries(embed.getAttributes())).toEqual({
            url: VIDEO_URL,
            embedType: "youtube",
            title: "A video",
            image: THUMBNAIL,
            boxSize: "full",
            hideTitle: true
        });
        expect(editor.getData()).toBe(`<section class="link-embed" ${PREVIEW_ATTRIBUTES}`
            + ` data-box-size="full" data-hide-title="true">&nbsp;</section>`);
    });

    it("leaves a card, and an embed type without a video, to the link preview", () => {
        editor.setData(
            `<section class="link-embed" data-url="${VIDEO_URL}" data-embed-type="opengraph">`
            + `</section><section class="link-embed" data-url="https://example.com/"`
            + ` data-embed-type="youtube"></section>`
            + `<section class="link-embed" data-url="${VIDEO_URL}"></section>`
            + `<section class="link-embed" data-embed-type="youtube"></section>`
        );

        expect([ 0, 1, 2, 3 ].map((index) => getBlock(index).name))
            .toEqual([ "linkEmbed", "linkEmbed", "linkEmbed", "linkEmbed" ]);
    });

    it("makes no embed of a section of an embed kind, or where the schema allows none", () => {
        editor.setData(`<section class="link-embed" data-trilium-embed="later"`
            + ` data-url="${VIDEO_URL}" data-embed-type="youtube"></section>`);
        expect(getBlock().name).toBe("unknownContentEmbed");

        editor.model.schema.addChildCheck((_context, definition) =>
            definition.name === "contentEmbed" ? false : undefined);
        editor.setData(SAVED_PREVIEW);
        expect(getBlock().name).toBe("linkEmbed");
        expect(loadVideo).not.toHaveBeenCalled();
    });

    it("keeps the box, the position and the width on the section, and drops what it holds", () => {
        const attributes = `class="link-embed" style="--include-note-width:30em;"`
            + ` data-url="${VIDEO_URL}" data-embed-type="youtube" data-aspect-ratio="9/16"`
            + ` data-box-size="medium" data-position="wrap-left"`;
        editor.setData(`<section ${attributes}><a href="${VIDEO_URL}">A video</a></section>`);

        const embed = getBlock();
        expect(embed.getAttribute("aspectRatio")).toBe("9/16");
        expect(embed.getAttribute("boxSize")).toBe("medium");
        expect(embed.getAttribute("hideTitle")).toBeUndefined();
        expect(embed.getAttribute("position")).toBe("wrap-left");
        expect(embed.getAttribute(SIZE_ATTRIBUTES.width)).toBe("30em");
        expect(embed.childCount).toBe(0);
        expect(editor.getData()).toBe(`<section ${attributes}>&nbsp;</section>`);
    });

    it("has the host render the player in an embed of its box", () => {
        editor.setData(SAVED_PREVIEW);

        const figure = getFigure();
        expect([ ...figure.classList ]).toEqual(expect.arrayContaining([
            "include-note", "video-embed", "box-size-full"
        ]));
        expect(figure.dataset).toMatchObject({ boxSize: "full", hideTitle: "true" });
        const view = editor.editing.mapper.toViewElement(getBlock());
        expect(view && getLabel(view)).toMatch(/^link embed widget\./);
        expect(loadVideo).toHaveBeenCalledExactlyOnceWith({
            url: VIDEO_URL,
            embedType: "youtube",
            title: "A video",
            image: THUMBNAIL
        }, figure.querySelector(":scope > .include-note-wrapper"));
    });

    it("is selected, and keeps the editor focused, after a click in its player", async () => {
        const player = insertPlayer(PLAYER_URL);
        await new Promise((resolve) => player.addEventListener("load", resolve, { once: true }));
        editor.editing.view.focus();

        await userEvent.click(player);
        await nextTask();
        expect(document.activeElement).toBe(player);
        expect(editor.model.document.selection.getSelectedElement()).toBe(getBlock(1));
        expect(editor.ui.focusTracker.isFocused).toBe(true);
        expect(editor.editing.view.getDomRoot()?.classList.contains("ck-focused")).toBe(true);

        // The focus leaves the player for the page outside the editor.
        const input = document.createElement("input");
        document.body.append(input);
        registerTestCleanup(() => input.remove());
        await userEvent.click(input);
        await nextTask();
        expect(editor.ui.focusTracker.isFocused).toBe(false);
    });

    it("is selected when its player becomes the focused element after the window blurs", async () => {
        const player = insertPlayer("about:blank");
        editor.editing.view.focus();

        // The order of Firefox.
        const activeElement = vi.spyOn(document, "activeElement", "get")
            .mockReturnValue(document.body);
        registerTestCleanup(() => activeElement.mockRestore());
        window.dispatchEvent(new FocusEvent("blur"));
        activeElement.mockReturnValue(player);
        await nextTask();
        expect(editor.model.document.selection.getSelectedElement()).toBe(getBlock(1));
    });

    it("has the Medium and Full sizes, a title, a position and no caption", () => {
        editor.setData(`<p>Text</p>${SAVED_PREVIEW}`);
        selectBlock(1);

        const commands = [
            BOX_SIZE_COMMAND_NAME, TOGGLE_TITLE_COMMAND_NAME, TOGGLE_CAPTION_COMMAND_NAME,
            POSITION_COMMAND_NAME
        ];
        expect(commands.map((name) => editor.commands.get(name)?.isEnabled))
            .toEqual([ true, true, false, true ]);
        const contentEmbed = editor.plugins.get(ContentEmbed);
        expect(contentEmbed.getBoxSizes(getFigure()))
            .toEqual([ { value: "medium", label: "Medium" }, { value: "full", label: "Full" } ]);
        expect(contentEmbed.getEmbedStateAt(getFigure())).toMatchObject({
            boxSize: "full", position: "center", isTitleSupported: true, isTitleShown: false,
            isTitleToggleable: true, isCaptionSupported: false, url: VIDEO_URL
        });

        editor.execute(TOGGLE_TITLE_COMMAND_NAME);
        expect(getFigure().hasAttribute("data-hide-title")).toBe(false);
        expect(editor.getData()).not.toContain("data-hide-title");

        editor.execute(POSITION_COMMAND_NAME, { value: "right" });
        expect(editor.getData()).toContain(` data-position="right"`);
    });

    it("is resized in width at Medium, which a box size sets to its own width", () => {
        editor.setData(`<p>Text</p>${SAVED_PREVIEW}`);
        selectBlock(1);
        const classes = () => [ ...getFigure().classList ];
        expect(classes()).not.toContain("ck-widget_resizable");

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "medium" });
        expect(getBlock(1).getAttribute(SIZE_ATTRIBUTES.width)).toBe(VIDEO_MEDIUM_WIDTH);
        expect(classes()).toEqual(expect.arrayContaining([
            "ck-widget_resizable", "ck-widget_fixed-height"
        ]));

        editor.model.change((writer) => {
            writer.setAttribute(SIZE_ATTRIBUTES.width, "20em", getBlock(1));
        });
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "medium" });
        expect(getBlock(1).getAttribute(SIZE_ATTRIBUTES.width)).toBe(VIDEO_MEDIUM_WIDTH);

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });
        expect(getBlock(1).hasAttribute(SIZE_ATTRIBUTES.width)).toBe(false);
        expect(classes()).not.toContain("ck-widget_resizable");
    });

    it("has the shape of its video, and at Medium the width of that shape 20em high", () => {
        const vertical = SAVED_PREVIEW.replace(">", ` data-aspect-ratio="9/16">`);
        editor.setData(`<p>Text</p>${SAVED_PREVIEW}${vertical}`);
        const figures = editor.editing.view.getDomRoot()
            ?.querySelectorAll<HTMLElement>("figure.include-note") ?? [];
        expect([ ...figures ].map((figure) => figure.style.getPropertyValue("--video-aspect-ratio")))
            .toEqual([ "", "0.5625" ]);

        selectBlock(2);
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "medium" });
        expect(getBlock(2).getAttribute(SIZE_ATTRIBUTES.width)).toBe("11.3em");
    });

    it("takes a new width from its corner at Medium, its only handle", () => {
        const capture = vi.spyOn(Element.prototype, "setPointerCapture")
            .mockImplementation(() => {});
        registerTestCleanup(() => capture.mockRestore());
        editor.setData(`<p>Text</p>${SAVED_PREVIEW}`);
        selectBlock(1);
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "medium" });
        const getHandle = (name: string) => {
            const handle = getFigure().querySelector(`.ck-widget__resize-handle_${name}`);
            if (!handle) {
                throw new Error(`Expected the ${name} handle.`);
            }
            return handle;
        };
        const drag = (handle: Element, x: number, y: number) => {
            handle.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
                clientX: 300, clientY: 300
            }));
            window.dispatchEvent(new PointerEvent("pointermove", {
                pointerId: 1, clientX: x, clientY: y
            }));
            window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
        };

        expect([ "width", "height", "corner" ]
            .map((name) => getComputedStyle(getHandle(name)).display))
            .toEqual([ "none", "none", "block" ]);
        drag(getHandle("height"), 300, 400);
        expect(getBlock(1).getAttribute(SIZE_ATTRIBUTES.width)).toBe(VIDEO_MEDIUM_WIDTH);

        drag(getHandle("corner"), 260, 360);
        const width = getBlock(1).getAttribute(SIZE_ATTRIBUTES.width);
        expect(width).toMatch(/^\d+(\.\d+)?em$/);
        expect(width).not.toBe(VIDEO_MEDIUM_WIDTH);
        expect(getBlock(1).hasAttribute(SIZE_ATTRIBUTES.height)).toBe(false);
    });
});
