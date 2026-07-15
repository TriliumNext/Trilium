import { Plugin } from "ckeditor5";
import type { AnnotationsUIs, Users } from "ckeditor5-premium-features";

/**
 * The user ID under which all local comments are authored. Trilium is a single-user application,
 * so a single fixed user is registered with the comments feature; the comment thread data persisted
 * by the client references this ID in `authorId`/`resolvedBy` fields.
 */
export const LOCAL_COMMENTS_USER_ID = "me";

/**
 * Trilium glue for the premium Comments feature.
 *
 * Loaded together with the premium plugins (see `loadPremiumPlugins()`), never on its own:
 * it assumes the `Users`, `CommentsRepository` and `AnnotationsUIs` plugins are present.
 *
 * - Registers the single local user and marks it as the current one — the comments UI cannot
 *   work without a defined user.
 * - Switches the annotations display to inline balloons, since Trilium's note layout does not
 *   provide a sidebar container element.
 */
export default class CommentsIntegration extends Plugin {
    static get pluginName() {
        return "CommentsIntegration" as const;
    }

    init() {
        const editor = this.editor;
        const users: Users = editor.plugins.get("Users");

        const userName = editor.config.get("commentsUserName") as string | undefined;
        users.addUser({
            id: LOCAL_COMMENTS_USER_ID,
            name: userName || "Me"
        });
        users.defineMe(LOCAL_COMMENTS_USER_ID);
    }

    afterInit() {
        // Runs after all plugins' init() so the annotation UIs are registered by now.
        const annotationsUIs: AnnotationsUIs = this.editor.plugins.get("AnnotationsUIs");
        annotationsUIs.switchTo("inline");
    }
}
