import { type ClassicEditor, Essentials, getLabel, Paragraph, Undo, Widget } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { createTestEditor } from "../../../test/editor-kit.js";
import { registerTestCleanup } from "../../../test/globals-test-kit.js";
import LinkEmbed from "../link_embed/link_embed.js";
import { SIZE_ATTRIBUTES } from "../resizable_widgets/resizable_widgets.js";
import ContentEmbed, {
    BOX_SIZE_COMMAND_NAME,
    getCaption,
    POSITION_COMMAND_NAME,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_TITLE_COMMAND_NAME
} from "./content_embed.js";
import { createMediaEmbed, isVideoEmbed } from "./media_embed.js";

/** The width of a 16:9 video at Medium, 20em high. */
const VIDEO_MEDIUM_WIDTH = "35.6em";
const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const THUMBNAIL = "api/attachments/abc123/image/youtube-dQw4w9WgXcQ.jpg";
const FILE_URL = "https://example.com/media/clip.mp4";
const PREVIEW_ATTRIBUTES = `data-url="${VIDEO_URL}" data-embed-type="youtube"`
    + ` data-title="A video" data-image="${THUMBNAIL}"`;
/** A video saved before videos were embeds. */
const SAVED_PREVIEW = `<section class="link-embed" ${PREVIEW_ATTRIBUTES}>&nbsp;</section>`;
const OTHER_HOST = location.hostname === "localhost" ? "127.0.0.1" : "localhost";
/** A page of another site, which a click focuses with no focus event in this page. */
const PLAYER_URL = `${location.protocol}//${OTHER_HOST}:${location.port}/package.json`;

/** Lets `FocusTracker` report a blur, which it does a task later. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve));

describe("ContentEmbedMedia", () => {
    let editor: ClassicEditor;
    let loadMedia: ReturnType<typeof vi.fn>;
    let captureVideoThumbnail: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadMedia = vi.fn();
        captureVideoThumbnail = vi.fn(async () => null);
        editor = await createTestEditor([
            Essentials, Paragraph, Undo, Widget, ContentEmbed, LinkEmbed
        ], {
            contentEmbed: {
                loadMedia, captureVideoThumbnail, sanitizeHtml: (html: string) => html
            }
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

    function getCaptionOf(index: number) {
        const caption = getCaption(getBlock(index));
        if (!caption) {
            throw new Error(`Expected a caption on the block at ${index}.`);
        }
        return caption;
    }

    /** Inserts a paragraph and a video whose player is a frame of `src`, and returns the frame. */
    function insertPlayer(src: string) {
        loadMedia.mockImplementation((_preview: unknown, wrapper: HTMLElement) => {
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

    function getPlayer(index: number) {
        const player = editor.editing.view.getDomRoot()?.querySelectorAll("iframe")[index];
        if (!player) {
            throw new Error(`Expected the player at ${index}.`);
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
        expect(loadMedia).not.toHaveBeenCalled();
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
            "include-note", "media-embed", "video-embed", "box-size-full"
        ]));
        expect(figure.dataset).toMatchObject({ boxSize: "full", hideTitle: "true" });
        const view = editor.editing.mapper.toViewElement(getBlock());
        expect(view && getLabel(view)).toMatch(/^link embed widget\./);
        expect(loadMedia).toHaveBeenCalledExactlyOnceWith({
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

    it("follows the focus from player to player, which fires no event in this page", () => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout", "setInterval", "clearInterval" ] });
        registerTestCleanup(() => vi.useRealTimers());
        loadMedia.mockImplementation((_preview: unknown, wrapper: HTMLElement) => {
            wrapper.innerHTML = `<div class="include-note-content"><iframe></iframe></div>`;
        });
        editor.setData(`<p>Text</p>${SAVED_PREVIEW}${SAVED_PREVIEW}`);
        const outside = document.createElement("iframe");
        document.body.append(outside);
        registerTestCleanup(() => outside.remove());
        editor.editing.view.focus();
        const getSelected = () => editor.model.document.selection.getSelectedElement();

        const activeElement = vi.spyOn(document, "activeElement", "get")
            .mockReturnValue(getPlayer(0));
        registerTestCleanup(() => activeElement.mockRestore());
        window.dispatchEvent(new FocusEvent("blur"));
        expect(getSelected()).toBe(getBlock(1));

        activeElement.mockReturnValue(getPlayer(1));
        vi.advanceTimersByTime(200);
        expect(getSelected()).toBe(getBlock(2));
        expect(editor.ui.focusTracker.isFocused).toBe(true);

        // A frame outside the editor takes the focus, then none has it and the checks stop.
        activeElement.mockReturnValue(outside);
        vi.advanceTimersByTime(200);
        vi.advanceTimersToNextTimer();
        expect(getSelected()).toBe(getBlock(2));
        expect(editor.ui.focusTracker.isFocused).toBe(false);
        activeElement.mockReturnValue(null);
        vi.runAllTimers();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("has the Medium and Full sizes, a title, a position and a caption", () => {
        editor.setData(`<p>Text</p>${SAVED_PREVIEW}`);
        selectBlock(1);

        const commands = [
            BOX_SIZE_COMMAND_NAME, TOGGLE_TITLE_COMMAND_NAME, TOGGLE_CAPTION_COMMAND_NAME,
            POSITION_COMMAND_NAME
        ];
        expect(commands.map((name) => editor.commands.get(name)?.isEnabled))
            .toEqual([ true, true, true, true ]);
        const contentEmbed = editor.plugins.get(ContentEmbed);
        expect(contentEmbed.getBoxSizes(getFigure()))
            .toEqual([ { value: "medium", label: "Medium" }, { value: "full", label: "Full" } ]);
        expect(contentEmbed.getEmbedStateAt(getFigure())).toMatchObject({
            boxSize: "full", position: "center", isTitleSupported: true, isTitleShown: false,
            isTitleToggleable: true, isCaptionSupported: true, isCaptionToggleable: true,
            hasCaption: false, url: VIDEO_URL
        });

        editor.execute(TOGGLE_TITLE_COMMAND_NAME);
        expect(getFigure().hasAttribute("data-hide-title")).toBe(false);
        expect(editor.getData()).not.toContain("data-hide-title");

        editor.execute(POSITION_COMMAND_NAME, { value: "right" });
        expect(editor.getData()).toContain(` data-position="right"`);
    });

    it("keeps its player, and the video playing, when it changes size", () => {
        editor.setData(`<p>Text</p>${SAVED_PREVIEW}`);
        selectBlock(1);
        expect(loadMedia).toHaveBeenCalledOnce();

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "medium" });
        expect(getFigure().dataset.boxSize).toBe("medium");
        expect(getFigure().classList).toContain("box-size-medium");
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });
        expect(getFigure().classList).toContain("box-size-full");
        expect(loadMedia).toHaveBeenCalledOnce();
    });

    it("saves a caption in a figure around its section, which goes away with the caption", () => {
        editor.setData(`<p>Text</p>${SAVED_PREVIEW}`);
        selectBlock(1);
        editor.execute(TOGGLE_CAPTION_COMMAND_NAME, { focusCaptionOnShow: true });
        editor.model.change((writer) => writer.insertText("A caption", getCaptionOf(1), 0));

        const caption = getFigure().querySelector(":scope > .include-note-wrapper + figcaption");
        expect(caption?.textContent).toBe("A caption");
        const section = `<section class="link-embed" ${PREVIEW_ATTRIBUTES}`
            + ` data-box-size="full" data-hide-title="true">&nbsp;</section>`;
        expect(editor.getData()).toBe(`<p>Text</p><figure class="captioned-content-embed">`
            + `${section}<figcaption>A caption</figcaption></figure>`);

        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);
        expect(editor.getData()).toBe(`<p>Text</p>${section}`);
    });

    it("loads a caption saved in a figure around its section, and saves it the same way", () => {
        const saved = `<figure class="captioned-content-embed"><section class="link-embed"`
            + ` style="--include-note-width:30em;" ${PREVIEW_ATTRIBUTES} data-box-size="medium"`
            + ` data-position="wrap-right">&nbsp;</section><figcaption>A caption</figcaption>`
            + `</figure>`;
        editor.setData(`<p>Text</p>${saved}<p>After</p>`);

        const embed = getBlock(1);
        expect(isVideoEmbed(embed)).toBe(true);
        expect([ embed.getAttribute(SIZE_ATTRIBUTES.width), embed.getAttribute("position") ])
            .toEqual([ "30em", "wrap-right" ]);
        expect([ ...getCaptionOf(1).getChildren() ]
            .map((child) => child.is("$text") ? child.data : child.name)).toEqual([ "A caption" ]);
        expect(editor.model.document.getRoot()?.childCount).toBe(3);
        expect(editor.getData()).toBe(`<p>Text</p>${saved}<p>After</p>`);
    });

    it("keeps the caption of a figure whose content takes none as a paragraph after it", () => {
        editor.setData(`<figure class="captioned-content-embed"><section class="link-embed"`
            + ` data-url="https://example.com/" data-embed-type="opengraph">&nbsp;</section>`
            + `<figcaption>A caption</figcaption></figure>`);

        expect([ getBlock(0).name, getBlock(1).name ]).toEqual([ "linkEmbed", "paragraph" ]);
        expect(editor.getData()).toMatch(/<\/section><p>A caption<\/p>$/);
    });

    it("drops a figure around its section with no caption, and keeps one with no content", () => {
        editor.setData(`<figure class="captioned-content-embed">${SAVED_PREVIEW}</figure>`
            + `<figure class="captioned-content-embed"><figcaption>Text</figcaption></figure>`);

        expect([ isVideoEmbed(getBlock(0)), getBlock(0).childCount ]).toEqual([ true, 0 ]);
        expect(getBlock(1).name).toBe("paragraph");
        expect(editor.getData()).toBe(`<section class="link-embed" ${PREVIEW_ATTRIBUTES}`
            + ` data-box-size="full" data-hide-title="true">&nbsp;</section><p>Text</p>`);
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
        const vertical = `<section class="link-embed" ${PREVIEW_ATTRIBUTES} data-aspect-ratio="9/16">`
            + `&nbsp;</section>`;
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

    it("loads a video file and an audio file, the audio file at Small, its only size", () => {
        const saved = `<section class="link-embed" data-url="${FILE_URL}" data-embed-type="video"`
            + ` data-box-size="medium" data-hide-title="true">&nbsp;</section>`
            + `<section class="link-embed" data-url="https://example.com/a.mp3"`
            + ` data-embed-type="audio" data-box-size="small">&nbsp;</section>`;
        editor.setData(saved);

        const figures = [ ...editor.editing.view.getDomRoot()
            ?.querySelectorAll<HTMLElement>("figure.include-note") ?? [] ];
        expect(figures.map((figure) => [ ...figure.classList ]
            .filter((name) => name.endsWith("-embed"))))
            .toEqual([ [ "media-embed", "video-embed" ], [ "media-embed", "audio-embed" ] ]);
        expect(editor.plugins.get(ContentEmbed).getBoxSizes(figures[1]))
            .toEqual([ { value: "small", label: "Small" } ]);
        expect(loadMedia.mock.calls.map(([ preview ]) => preview.embedType))
            .toEqual([ "video", "audio" ]);
        expect(editor.getData()).toBe(saved);
        expect(captureVideoThumbnail).not.toHaveBeenCalled();
    });

    it("gives a video file made from a URL a thumbnail and a shape, in one undo step", async () => {
        let resolveCapture: (thumbnail: unknown) => void = () => {};
        captureVideoThumbnail.mockImplementation(() =>
            new Promise((resolve) => (resolveCapture = resolve)));
        editor.setData("<p>Text</p>");
        editor.model.change((writer) => {
            // As `getMetadataAttributes()` makes them, with each field the file has none for.
            const embed = createMediaEmbed(writer, {
                url: FILE_URL, embedType: "video", title: undefined, image: undefined,
                aspectRatio: undefined
            });
            writer.insert(embed, writer.createPositionAt(getBlock().root, "end"));
        });
        expect(captureVideoThumbnail)
            .toHaveBeenCalledExactlyOnceWith({ url: FILE_URL, embedType: "video" });
        expect(getBlock(1).getAttribute(SIZE_ATTRIBUTES.width)).toBe(VIDEO_MEDIUM_WIDTH);
        loadMedia.mockClear();

        resolveCapture({ image: THUMBNAIL, aspectRatio: "4/3" });
        await nextTask();

        const embed = getBlock(1);
        expect([ embed.getAttribute("image"), embed.getAttribute("aspectRatio") ])
            .toEqual([ THUMBNAIL, "4/3" ]);
        expect(embed.getAttribute(SIZE_ATTRIBUTES.width)).toBe("26.7em");
        expect(getFigure().style.getPropertyValue("--video-aspect-ratio")).toBe(String(4 / 3));
        expect(loadMedia).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ image: THUMBNAIL }), expect.any(HTMLElement));

        editor.execute("undo");
        expect(editor.getData()).toBe("<p>Text</p>");
    });

    it("keeps the shape a video stores, the width of a Full one, and a player that plays", async () => {
        const resolvers: ((thumbnail: unknown) => void)[] = [];
        captureVideoThumbnail.mockImplementation(() =>
            new Promise((resolve) => resolvers.push(resolve)));
        loadMedia.mockImplementation((_preview: unknown, wrapper: HTMLElement) => {
            const video = document.createElement("video");
            Object.defineProperty(video, "paused", { value: false });
            wrapper.replaceChildren(video);
        });
        editor.setData("<p>Text</p>");
        editor.model.change((writer) => {
            const root = getBlock().root;
            writer.insert(createMediaEmbed(writer,
                { url: FILE_URL, embedType: "video", aspectRatio: "4/3" }),
            writer.createPositionAt(root, "end"));
            writer.insert(createMediaEmbed(writer, { url: FILE_URL, embedType: "video" }),
                writer.createPositionAt(root, "end"));
        });
        selectBlock(2);
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });
        loadMedia.mockClear();

        for (const resolve of resolvers) {
            resolve({ image: THUMBNAIL, aspectRatio: "16/9" });
        }
        await nextTask();

        expect([ 1, 2 ].map((index) => [ "image", "aspectRatio", SIZE_ATTRIBUTES.width ]
            .map((name) => getBlock(index).getAttribute(name)))).toEqual([
            [ THUMBNAIL, "4/3", "26.7em" ],
            [ THUMBNAIL, "16/9", undefined ]
        ]);
        expect(loadMedia).not.toHaveBeenCalled();
    });

    it("sets nothing for a video whose frame cannot be read, or once the editor is gone", async () => {
        editor.setData("<p>Text</p>");
        const insert = () => editor.model.change((writer) => {
            const embed = createMediaEmbed(writer, { url: FILE_URL, embedType: "video" });
            writer.insert(embed, writer.createPositionAt(getBlock().root, "end"));
        });

        insert();
        await nextTask();
        expect(getBlock(1).hasAttribute("image")).toBe(false);

        captureVideoThumbnail.mockRejectedValueOnce(new Error("Offline"));
        insert();
        await nextTask();
        expect(getBlock(2).hasAttribute("image")).toBe(false);

        let resolveCapture: (thumbnail: unknown) => void = () => {};
        captureVideoThumbnail.mockImplementation(() =>
            new Promise((resolve) => (resolveCapture = resolve)));
        insert();
        await editor.destroy();
        resolveCapture({ image: THUMBNAIL });
        await nextTask();
        expect(captureVideoThumbnail).toHaveBeenCalledTimes(3);
    });

    it("names the caption of an audio file and of a video for screen readers", () => {
        editor.setData(`<figure class="captioned-content-embed"><section class="link-embed"`
            + ` data-url="https://example.com/a.mp3" data-embed-type="audio" data-box-size="small">`
            + `&nbsp;</section><figcaption>Song</figcaption></figure>`
            + `<figure class="captioned-content-embed">${SAVED_PREVIEW}`
            + `<figcaption>Video</figcaption></figure>`);

        const captions = editor.editing.view.getDomRoot()?.querySelectorAll("figcaption") ?? [];
        expect([ ...captions ].map((caption) => caption.getAttribute("aria-label")))
            .toEqual([ "Caption for the audio", "Caption for the video" ]);
    });

    it("drops the shape of a video that stores none it can read", () => {
        editor.setData(`<section class="link-embed" data-url="${FILE_URL}" data-embed-type="video"`
            + ` data-aspect-ratio="wide" data-box-size="medium">&nbsp;</section>`);

        expect(getBlock().getAttribute("aspectRatio")).toBe("wide");
        expect(getFigure().style.getPropertyValue("--video-aspect-ratio")).toBe("");
    });

    it("captures no thumbnail of audio, YouTube, a video with one, or once undone", async () => {
        editor.setData("<p>Text</p>");
        const insert = (attributes: Record<string, unknown>) => editor.model.change((writer) => {
            const embed = createMediaEmbed(writer, attributes);
            writer.insert(embed, writer.createPositionAt(getBlock().root, "end"));
        });

        insert({ url: "https://example.com/a.mp3", embedType: "audio" });
        insert({ url: VIDEO_URL, embedType: "youtube" });
        insert({ url: FILE_URL, embedType: "video", image: THUMBNAIL });
        // A video made but never inserted.
        editor.model.change((writer) => {
            createMediaEmbed(writer, { url: FILE_URL, embedType: "video" });
            writer.insertText("!", getBlock(), "end");
        });
        expect(captureVideoThumbnail).not.toHaveBeenCalled();

        captureVideoThumbnail.mockResolvedValue({ image: "api/attachments/x/image/x.jpg" });
        insert({ url: FILE_URL, embedType: "video" });
        editor.execute("undo");
        await nextTask();
        expect(captureVideoThumbnail).toHaveBeenCalledOnce();
        expect(editor.model.document.getRoot()?.childCount).toBe(4);
        expect(editor.getData()).not.toContain("api/attachments/x/");
    });
});
