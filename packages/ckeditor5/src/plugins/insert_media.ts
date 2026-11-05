import { getLinkPreviewPlayer } from "@triliumnext/commons";
import mediaIcon from "boxicons/svg/regular/bx-movie-play.svg?raw";
import { ButtonView, Command, ContextualBalloon, type Editor, ModelLiveRange, Plugin } from "ckeditor5";

import HostedBalloon from "../hosted_balloon.js";
import {
    createLinkPreview, getLinkEmbedHost, getPreviewAttributes
} from "./link_embed/link_embed_commands.js";
import LinkEmbedEditing from "./link_embed/link_embed_editing.js";

export const COMMAND_NAME = "insertMedia";

/**
 * The "Audio/video embed" button: asks for the address of a YouTube video or of an audio or video
 * file, then inserts a player of it, the link preview of the embed display mode, once its metadata
 * is ready.
 */
export default class InsertMediaPlugin extends Plugin {

    static get requires() {
        return [ ContextualBalloon, LinkEmbedEditing ] as const;
    }

    static get pluginName() {
        return "InsertMedia" as const;
    }

    private prompt = new HostedBalloon(this.editor, "insert-media-balloon");

    init() {
        const editor = this.editor;
        const t = editor.t;
        const command = new InsertMediaCommand(editor);

        editor.commands.add(COMMAND_NAME, command);

        editor.ui.componentFactory.add(COMMAND_NAME, (locale) => {
            const button = new ButtonView(locale);

            button.set({
                label: t("Audio/video embed"),
                icon: mediaIcon,
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
     * Opens the host's prompt for the address of the media in a balloon at the caret. A host that
     * shows the prompt its own way leaves the balloon empty, which closes it again.
     */
    showPrompt() {
        const editor = this.editor;

        this.prompt.show((container) => editor.config.get("insertMedia")?.showPrompt({
            container,
            onInsert: async (url) => {
                const isInserted = await insertMedia(editor, url);
                this.prompt.hide();
                if (isInserted) {
                    editor.editing.view.focus();
                }
            }
        }) ?? null);
    }
}

/**
 * Inserts a player of the media at `url` at the selection, once its metadata has arrived, and
 * selects it. Resolves to whether it inserted the player, which it does not once the editor holds
 * other content, such as another note, or is destroyed. Rejects, inserting nothing, when the
 * metadata cannot be read or names nothing that a player plays.
 */
async function insertMedia(editor: Editor, url: string) {
    const model = editor.model;
    const range = model.document.selection.getFirstRange();
    /* v8 ignore next 3 -- the command is enabled only with a selection */
    if (!range) {
        throw new Error("There is no selection to insert the media at.");
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
            throw new Error("The metadata of the media could not be read.");
        }

        const attributes = getPreviewAttributes(editor, "embedLink", url, metadata);
        const { embedType } = attributes as { embedType?: string };
        if (!getLinkPreviewPlayer({ url: metadata.url, embedType })) {
            throw new Error("The address is not that of a YouTube video, an audio or a video file.");
        }

        model.change((writer) => {
            const player = createLinkPreview(writer, "embedLink", attributes);
            const isRemoved = place.root === model.document.graveyard;
            model.insertContent(player, isRemoved ? model.document.selection : place.toRange());
            writer.setSelection(player, "on");
        });
        return true;
    } finally {
        editor.data.off("set", onReplace);
        place.detach();
    }
}

/** Enabled wherever an embed can go, with a host to ask for the address. */
class InsertMediaCommand extends Command {

    override refresh() {
        const { model } = this.editor;
        const position = model.document.selection.getFirstPosition();

        this.isEnabled = !!this.editor.config.get("insertMedia")
            && !!position
            && !position.findAncestor("codeBlock")
            && model.schema.findAllowedParent(position, "contentEmbed") !== null;
    }

    override execute() {
        this.editor.plugins.get(InsertMediaPlugin).showPrompt();
    }
}

/** The request that the editor passes to the host's prompt for the address of the media. */
export interface InsertMediaRequest {
    /** The element to render the prompt into, which the editor owns and places at the caret. */
    container: HTMLElement;
    /**
     * Inserts a player of the media at `url` once its metadata is ready, then closes the balloon.
     * Inserts nothing once the editor holds other content or is destroyed. Rejects, inserting
     * nothing and leaving the balloon open, when the media cannot be loaded.
     */
    onInsert(url: string): Promise<void>;
}

declare module "ckeditor5" {
    interface EditorConfig {
        insertMedia?: {
            /**
             * Renders the prompt into `request.container`, and returns the function that removes
             * it. A host that shows the prompt somewhere else (a phone, which has no room for a
             * balloon) leaves the container alone and returns `null`.
             */
            showPrompt(request: InsertMediaRequest): (() => void) | null;
        };
    }
}
