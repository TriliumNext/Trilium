import {
    getLinkPreviewVideoId, LINK_PREVIEW_DATA_ATTRIBUTES, type LinkPreviewData, readLinkPreviewData,
    readVideoEmbedBox
} from "@triliumnext/commons";
import {
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

/** The width of a Medium video: 20em high, as a Medium embed is. */
export const VIDEO_MEDIUM_WIDTH = "35.6em";

/** The fields of a link preview, which a video embed keeps as attributes of the same names. */
const PREVIEW_FIELDS = Object.keys(LINK_PREVIEW_DATA_ATTRIBUTES) as (keyof LinkPreviewData)[];

/**
 * Embeds that play the video of a link preview, such as a YouTube video. The embed keeps the fields
 * of the preview as attributes, and is saved as the `<section class="link-embed">` of the link
 * preview, with its box size, title flag, position and width, so that older versions show it as
 * a link preview.
 *
 * The player renders through the host's `contentEmbed.loadVideo()`.
 */
export default class ContentEmbedVideo extends Plugin {

    static get pluginName() {
        return "ContentEmbedVideo" as const;
    }

    init() {
        const editor = this.editor;

        editor.data.upcastDispatcher.on<UpcastElementEvent>(
            "element:section", (_evt, data, api) => upcast(data, api), { priority: "high" });
        editor.data.downcastDispatcher.on<DowncastInsertEvent<ModelElement>>(
            "insert:contentEmbed", (_evt, data, api) => downcastData(editor, data.item, api),
            { priority: "high" });
    }

    afterInit() {
        this.editor.model.schema.extend("contentEmbed", { allowAttributes: PREVIEW_FIELDS });
    }

    /** Has the host render the player of `embed` into `wrapper`. */
    load(embed: ModelElement, wrapper: HTMLElement) {
        this.editor.config.get("contentEmbed")?.loadVideo?.(getVideoPreview(embed), wrapper);
    }
}

/** Creates an embed that plays the video of the link preview with the fields `attributes`. */
export function createVideoEmbed(writer: ModelWriter, attributes: Record<string, unknown>) {
    return writer.createElement("contentEmbed", {
        ...attributes,
        boxSize: "medium",
        hideTitle: true,
        [SIZE_ATTRIBUTES.width]: VIDEO_MEDIUM_WIDTH
    });
}

/** Whether `embed` plays the video of a link preview. */
export function isVideoEmbed(embed: ModelElement) {
    return !!embed.getAttribute("url");
}

/** The link preview whose video `embed` plays. */
export function getVideoPreview(embed: ModelElement) {
    return Object.fromEntries(PREVIEW_FIELDS
        .filter((field) => embed.hasAttribute(field))
        .map((field) => [ field, embed.getAttribute(field) ])) as unknown as LinkPreviewData;
}

/** Turns the link preview of a video into an embed that plays it. Its content is dropped. */
function upcast(data: UpcastElementEvent["args"][0], api: UpcastConversionApi) {
    const section = data.viewItem;
    if (!section.hasClass("link-embed") || !api.consumable.test(section, { name: true })) {
        return;
    }

    const preview = readLinkPreviewData((name) => section.getAttribute(name));
    if (!preview || !getLinkPreviewVideoId(preview)) {
        return;
    }

    const fields = Object.entries(preview).filter(([ , value ]) => value);
    const { boxSize, isTitleHidden } = readVideoEmbedBox((name) => section.getAttribute(name));
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

/** Saves a video embed as the `<section>` of its link preview. */
function downcastData(editor: Editor, embed: ModelElement, api: DowncastConversionApi) {
    if (!isVideoEmbed(embed) || !api.consumable.consume(embed, "insert")) {
        return;
    }

    const preview = getVideoPreview(embed);
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

declare module "ckeditor5" {
    interface PluginsMap {
        [ContentEmbedVideo.pluginName]: ContentEmbedVideo;
    }
}
