import {
    getLinkPreviewPlayer, getVideoAspectRatio, LINK_PREVIEW_DATA_ATTRIBUTES, type LinkPreviewData,
    readLinkPreviewData, readMediaEmbedBox, VIDEO_ASPECT_RATIO_PROPERTY
} from "@triliumnext/commons";
import {
    type Batch,
    type DowncastAttributeEvent,
    type DowncastConversionApi,
    type DowncastInsertEvent,
    type Editor,
    type ModelElement,
    type ModelWriter,
    Plugin,
    type UpcastConversionApi,
    type UpcastElementEvent
} from "ckeditor5";

import { SIZE_ATTRIBUTES } from "../resizable_widgets/resizable_widgets.js";
import { getPositionAttributes, getPositionOfView } from "./content_embed.js";

/** The height of a new video, in em, as high as a Resizable box starts. */
const VIDEO_DEFAULT_HEIGHT = 20;
/** The shape of the player of a video that stores none. */
const DEFAULT_ASPECT_RATIO = 16 / 9;

/** The fields of a link preview, which a media embed keeps as attributes of the same names. */
const PREVIEW_FIELDS = Object.keys(LINK_PREVIEW_DATA_ATTRIBUTES) as (keyof LinkPreviewData)[];

/** The video embeds created since the last change of the document, which get a thumbnail. */
const pendingThumbnails = new Set<ModelElement>();

/**
 * Embeds that play the media of a link preview: a YouTube video, or the video or audio file at its
 * URL. The embed keeps the fields of the preview as attributes, and is saved as the
 * `<section class="link-embed">` of the link preview, with its box size, title flag, position and
 * width, so that older versions show it as a link preview.
 *
 * The player renders through the host's `contentEmbed.loadMedia()`. A video file that a URL is
 * turned into gets the picture of one of its frames as its thumbnail, from the host's
 * `contentEmbed.captureVideoThumbnail()`, in the batch that inserted it.
 */
export default class ContentEmbedMedia extends Plugin {

    static get pluginName() {
        return "ContentEmbedMedia" as const;
    }

    init() {
        const editor = this.editor;

        editor.data.upcastDispatcher.on<UpcastElementEvent>(
            "element:section", (_evt, data, api) => upcast(data, api), { priority: "high" });
        editor.data.downcastDispatcher.on<DowncastInsertEvent<ModelElement>>(
            "insert:contentEmbed", (_evt, data, api) => downcastData(editor, data.item, api),
            { priority: "high" });
        editor.editing.downcastDispatcher.on<DowncastAttributeEvent<ModelElement>>(
            "attribute:aspectRatio:contentEmbed",
            (_evt, data, api) => updateShape(data.item, api));
        editor.editing.downcastDispatcher.on<DowncastAttributeEvent<ModelElement>>(
            "attribute:image:contentEmbed",
            (_evt, data, api) => this.reloadThumbnail(data.item, api));

        this.listenTo(editor.model.document, "change:data", (_evt, batch: Batch) => {
            for (const embed of pendingThumbnails) {
                void this.captureThumbnail(embed, batch);
            }
            pendingThumbnails.clear();
        });
    }

    afterInit() {
        this.editor.model.schema.extend("contentEmbed", { allowAttributes: PREVIEW_FIELDS });
    }

    /** Has the host render the player of `embed` into `wrapper`, in a box of `boxSize`. */
    load(
        embed: ModelElement,
        wrapper: HTMLElement,
        boxSize = embed.getAttribute("boxSize") as string | undefined
    ) {
        this.editor.config.get("contentEmbed")?.loadMedia?.(
            getMediaPreview(embed), wrapper, boxSize);
    }

    /**
     * Draws the player of `embed` again with its new thumbnail, unless it is playing. While the
     * embed is converted for the first time, it has no DOM, and its own render draws the player.
     */
    private reloadThumbnail(embed: ModelElement, api: DowncastConversionApi) {
        const viewElement = api.mapper.toViewElement(embed);
        const dom = viewElement && this.editor.editing.view.domConverter.mapViewToDom(viewElement);
        const wrapper = dom?.querySelector<HTMLElement>(":scope > .include-note-wrapper");
        const isPlaying = [ ...wrapper?.querySelectorAll("video, audio") ?? [] ]
            .some((media) => !(media as HTMLMediaElement).paused);
        if (wrapper && !isPlaying) {
            this.load(embed, wrapper);
        }
    }

    /**
     * Sets the thumbnail that the host captures of the video of `embed`, and its shape when it
     * stores none, in `batch`, unless the embed has left the document by then. A video
     * still at the default width gets the width of that shape.
     */
    private async captureThumbnail(embed: ModelElement, batch: Batch) {
        const editor = this.editor;
        const model = editor.model;
        const isInDocument = () => embed.root.document === model.document
            && embed.root !== model.document.graveyard;
        if (!isInDocument()) {
            return;
        }

        const thumbnail = await editor.config.get("contentEmbed")
            ?.captureVideoThumbnail?.(getMediaPreview(embed)).catch(() => null);
        if (!thumbnail || editor.state === "destroyed" || !isInDocument()) {
            return;
        }

        model.enqueueChange(batch, (writer) => {
            writer.setAttribute("image", thumbnail.image, embed);
            const { aspectRatio } = thumbnail;
            if (aspectRatio && !embed.hasAttribute("aspectRatio")) {
                writer.setAttribute("aspectRatio", aspectRatio, embed);
                if (embed.getAttribute("boxSize") === "resizable"
                    && embed.getAttribute(SIZE_ATTRIBUTES.width) === getVideoDefaultWidth({})) {
                    writer.setAttribute(
                        SIZE_ATTRIBUTES.width, getVideoDefaultWidth({ aspectRatio }), embed);
                }
            }
        });
    }
}

/**
 * Creates an untitled embed that plays the media of the link preview with the fields
 * `attributes`: a video Resizable at its default width, an audio file Compact. A video file
 * without a thumbnail gets one.
 */
export function createMediaEmbed(writer: ModelWriter, attributes: Record<string, unknown>) {
    const isAudio = attributes.embedType === "audio";
    // An attribute set to `undefined` still exists, and an operation cannot add it again.
    const fields = Object.entries(attributes).filter(([ , value ]) => value != null);
    const embed = writer.createElement("contentEmbed", {
        ...Object.fromEntries(fields),
        hideTitle: true,
        ...(isAudio
            ? { boxSize: "compact" }
            : {
                boxSize: "resizable",
                [SIZE_ATTRIBUTES.width]:
                    getVideoDefaultWidth(attributes as Partial<LinkPreviewData>)
            })
    });
    if (attributes.embedType === "video" && !attributes.image) {
        pendingThumbnails.add(embed);
    }
    return embed;
}

/**
 * Creates an embed that plays the media of the link preview with the fields `attributes`, to
 * replace the media embed `embed`. It keeps the other attributes and the caption of `embed`. Media
 * of another kind gets the size of a new embed, and a video at the default width gets the default
 * width of the new video.
 */
export function createChangedMediaEmbed(
    writer: ModelWriter, embed: ModelElement, attributes: Record<string, unknown>
) {
    const replacement = createMediaEmbed(writer, attributes);
    const kept: Record<string, unknown> = Object.fromEntries([ ...embed.getAttributes() ]
        .filter(([ key ]) => !PREVIEW_FIELDS.includes(key as keyof LinkPreviewData)));
    const width = SIZE_ATTRIBUTES.width;

    writer.removeAttribute("hideTitle", replacement);
    if (isAudioEmbed(embed) !== isAudioEmbed(replacement)) {
        delete kept.boxSize;
        delete kept[width];
    } else if (kept[width] === getVideoDefaultWidth(getMediaPreview(embed))) {
        delete kept[width];
    } else {
        writer.removeAttribute(width, replacement);
    }
    writer.setAttributes(kept, replacement);

    for (const child of embed.getChildren()) {
        writer.append(writer.cloneElement(child as ModelElement), replacement);
    }
    return replacement;
}

/** The width of a new video of `preview`: 20em high, in the shape of the video. */
export function getVideoDefaultWidth(preview: Pick<LinkPreviewData, "aspectRatio">) {
    const aspectRatio = getVideoAspectRatio(preview) ?? DEFAULT_ASPECT_RATIO;
    return `${Math.round(VIDEO_DEFAULT_HEIGHT * aspectRatio * 10) / 10}em`;
}

/** The style that gives the view of `embed` the shape of its video, when it stores one. */
export function getMediaShapeAttributes(embed: ModelElement): Record<string, string> {
    const aspectRatio = isVideoEmbed(embed) ? getVideoAspectRatio(getMediaPreview(embed)) : null;
    return aspectRatio ? { style: `${VIDEO_ASPECT_RATIO_PROPERTY}:${aspectRatio}` } : {};
}

/** Whether `embed` plays the media of a link preview. */
export function isMediaEmbed(embed: ModelElement) {
    return !!embed.getAttribute("url");
}

/** Whether `embed` plays an audio file. */
export function isAudioEmbed(embed: ModelElement) {
    return isMediaEmbed(embed) && embed.getAttribute("embedType") === "audio";
}

/** Whether `embed` plays a video, which gives the embed its shape. */
export function isVideoEmbed(embed: ModelElement) {
    return isMediaEmbed(embed) && !isAudioEmbed(embed);
}

/** The link preview whose media `embed` plays. */
export function getMediaPreview(embed: ModelElement) {
    return Object.fromEntries(PREVIEW_FIELDS
        .filter((field) => embed.hasAttribute(field))
        .map((field) => [ field, embed.getAttribute(field) ])) as unknown as LinkPreviewData;
}

/** Turns the link preview of media into an embed that plays it. Its content is dropped. */
function upcast(data: UpcastElementEvent["args"][0], api: UpcastConversionApi) {
    const section = data.viewItem;
    if (!section.hasClass("link-embed") || !api.consumable.test(section, { name: true })) {
        return;
    }

    const preview = readLinkPreviewData((name) => section.getAttribute(name));
    const player = preview && getLinkPreviewPlayer(preview);
    if (!preview || !player) {
        return;
    }

    const fields = Object.entries(preview).filter(([ , value ]) => value);
    const { boxSize, isTitleHidden } =
        readMediaEmbedBox((name) => section.getAttribute(name), player);
    const embed = api.writer.createElement("contentEmbed", {
        ...Object.fromEntries(fields),
        boxSize,
        ...(isTitleHidden ? { hideTitle: true } : {}),
        ...getPositionOfView(section)
    });
    if (!api.safeInsert(embed, data.modelCursor)) {
        return;
    }

    api.consumable.consume(section, { name: true });
    api.updateConversionResult(embed, data);
}

/** Saves a media embed as the `<section>` of its link preview. */
function downcastData(editor: Editor, embed: ModelElement, api: DowncastConversionApi) {
    if (!isMediaEmbed(embed) || !api.consumable.consume(embed, "insert")) {
        return;
    }

    const preview = getMediaPreview(embed);
    const dataAttributes = PREVIEW_FIELDS
        .filter((field) => preview[field])
        .map((field) => [ LINK_PREVIEW_DATA_ATTRIBUTES[field], String(preview[field]) ]);
    const { writer, mapper } = api;
    const section = writer.createContainerElement("section", {
        class: "link-embed",
        ...Object.fromEntries(dataAttributes),
        "data-box-size": embed.getAttribute("boxSize") as string,
        ...(embed.getAttribute("hideTitle") ? { "data-hide-title": "true" } : {}),
        ...getPositionAttributes(embed)
    });
    writer.insert(mapper.toViewPosition(editor.model.createPositionBefore(embed)), section);
    // `ResizableWidgets` writes the width on the `<section>` through this mapping.
    mapper.bindElements(embed, section);
}

/** Gives the view of `embed` the shape of its video, as `getMediaShapeAttributes()` does. */
function updateShape(embed: ModelElement, api: DowncastConversionApi) {
    const viewElement = api.mapper.toViewElement(embed);
    const aspectRatio = getVideoAspectRatio(getMediaPreview(embed));
    /* v8 ignore next 3 -- converted after the embed itself, so always mapped */
    if (!viewElement) {
        return;
    }

    if (aspectRatio) {
        api.writer.setStyle(VIDEO_ASPECT_RATIO_PROPERTY, String(aspectRatio), viewElement);
    } else {
        api.writer.removeStyle(VIDEO_ASPECT_RATIO_PROPERTY, viewElement);
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ContentEmbedMedia.pluginName]: ContentEmbedMedia;
    }
}
