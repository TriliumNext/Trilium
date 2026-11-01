import youtubeIcon from "boxicons/svg/logos/bxl-youtube.svg?raw";
import { ButtonView, Command, ContextualBalloon, Plugin } from "ckeditor5";

import HostedBalloon from "../hosted_balloon.js";
import { LINK_EMBED_COMMAND } from "./link_embed/link_embed_commands.js";
import LinkEmbedEditing from "./link_embed/link_embed_editing.js";

export const COMMAND_NAME = "youtubeVideo";

/**
 * The "YouTube video" button: asks for the address of a video, then inserts a link preview of it
 * in the embed display mode.
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
            onInsert: (url) => {
                this.prompt.hide();
                editor.editing.view.focus();
                void editor.execute(LINK_EMBED_COMMAND, { url, mode: "embed" });
            }
        }) ?? null);
    }
}

/** Enabled wherever a block link preview can go, with a host to ask for the address. */
class YouTubeVideoCommand extends Command {

    override refresh() {
        const { model } = this.editor;
        const position = model.document.selection.getFirstPosition();

        this.isEnabled = !!this.editor.config.get("youtubeVideo")
            && !!position
            && !position.findAncestor("codeBlock")
            && model.schema.findAllowedParent(position, "linkEmbed") !== null;
    }

    override execute() {
        this.editor.plugins.get(YouTubeVideoPlugin).showPrompt();
    }
}

/** The request that the editor passes to the host's prompt for the address of a video. */
export interface YouTubeVideoRequest {
    /** The element to render the prompt into, which the editor owns and places at the caret. */
    container: HTMLElement;
    /** Closes the balloon and inserts a player of the YouTube video at `url`. */
    onInsert(url: string): void;
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
