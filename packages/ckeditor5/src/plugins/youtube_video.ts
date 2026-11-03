import youtubeIcon from "boxicons/svg/logos/bxl-youtube.svg?raw";
import { ButtonView, Command, ContextualBalloon, type Editor, ModelLiveRange, Plugin } from "ckeditor5";

import HostedBalloon from "../hosted_balloon.js";
import {
    createLinkPreview, getLinkEmbedHost, getPreviewAttributes
} from "./link_embed/link_embed_commands.js";
import LinkEmbedEditing from "./link_embed/link_embed_editing.js";

export const COMMAND_NAME = "youtubeVideo";

/**
 * The "YouTube video" button: asks for the address of a video, then inserts a player of it, the
 * link preview of the embed display mode, once its metadata and thumbnail are ready.
 */
export default class YouTubeVideoPlugin extends Plugin {

    static get requires() {
        return [ ContextualBalloon, LinkEmbedEditing ] as const;
    }

    static get pluginName() {
        return "YouTubeVideo" as const;
    }

    private prompt = new HostedBalloon(this.editor, "youtube-video-balloon");

    init() {
        const editor = this.editor;
        const t = editor.t;
        const command = new YouTubeVideoCommand(editor);

        editor.commands.add(COMMAND_NAME, command);

        editor.ui.componentFactory.add(COMMAND_NAME, (locale) => {
            const button = new ButtonView(locale);

            button.set({
                label: t("YouTube video"),
                icon: youtubeIcon,
                tooltip: true
            });
            button.bind("isEnabled").to(command, "isEnabled");
            this.listenTo(button, "execute", () => editor.execute(COMMAND_NAME));

            return button;
        });
    }

    override destroy() {
        this.prompt.hide();
        super.destroy();
    }

    /**
     * Opens the host's prompt for the address of a video in a balloon at the caret. A host that
     * shows the prompt its own way leaves the balloon empty, which closes it again.
     */
    showPrompt() {
        const editor = this.editor;

        this.prompt.show((container) => editor.config.get("youtubeVideo")?.showPrompt({
            container,
            onInsert: async (url) => {
                const isInserted = await insertVideo(editor, url);
                this.prompt.hide();
                if (isInserted) {
                    editor.editing.view.focus();
                }
            }
        }) ?? null);
    }
}

/**
 * Inserts a player of the YouTube video at `url` at the selection, once the video's metadata has
 * arrived, and selects it. Resolves to whether it inserted the video, which it does not once the
 * editor holds other content, such as another note, or is destroyed. Rejects, inserting nothing,
 * when the metadata cannot be read.
 */
async function insertVideo(editor: Editor, url: string) {
    const model = editor.model;
    const range = model.document.selection.getFirstRange();
    /* v8 ignore next 3 -- the command is enabled only with a selection */
    if (!range) {
        throw new Error("There is no selection to insert the video at.");
    }

    // Tracked while the metadata arrives, so that edits made meanwhile do not shift it.
    const place = ModelLiveRange.fromRange(range);
    let isReplaced = false;
    const onReplace = () => {
        isReplaced = true;
    };
    editor.data.on("set", onReplace);
    try {
        const metadata = await getLinkEmbedHost(editor).fetchMetadata(url);
        if (isReplaced || editor.state === "destroyed") {
            return false;
        }
        if (metadata.unresolved) {
            throw new Error("The metadata of the video could not be read.");
        }

        model.change((writer) => {
            const video = createLinkPreview(writer, "embed",
                getPreviewAttributes(editor, "embed", url, metadata));
            const isRemoved = place.root === model.document.graveyard;
            model.insertContent(video, isRemoved ? model.document.selection : place.toRange());
            writer.setSelection(video, "on");
        });
        return true;
    } finally {
        editor.data.off("set", onReplace);
        place.detach();
    }
}

/** Enabled wherever an embed can go, with a host to ask for the address. */
class YouTubeVideoCommand extends Command {

    override refresh() {
        const { model } = this.editor;
        const position = model.document.selection.getFirstPosition();

        this.isEnabled = !!this.editor.config.get("youtubeVideo")
            && !!position
            && !position.findAncestor("codeBlock")
            && model.schema.findAllowedParent(position, "contentEmbed") !== null;
    }

    override execute() {
        this.editor.plugins.get(YouTubeVideoPlugin).showPrompt();
    }
}

/** The request that the editor passes to the host's prompt for the address of a video. */
export interface YouTubeVideoRequest {
    /** The element to render the prompt into, which the editor owns and places at the caret. */
    container: HTMLElement;
    /**
     * Inserts a player of the YouTube video at `url` once its metadata and thumbnail are ready,
     * then closes the balloon. Inserts nothing once the editor holds other content or is
     * destroyed. Rejects, inserting nothing and leaving the balloon open, when they cannot be
     * loaded.
     */
    onInsert(url: string): Promise<void>;
}

declare module "ckeditor5" {
    interface EditorConfig {
        youtubeVideo?: {
            /**
             * Renders the prompt into `request.container`, and returns the function that removes
             * it. A host that shows the prompt somewhere else (a phone, which has no room for a
             * balloon) leaves the container alone and returns `null`.
             */
            showPrompt(request: YouTubeVideoRequest): (() => void) | null;
        };
    }
}
