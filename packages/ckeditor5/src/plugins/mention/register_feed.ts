import type { Editor } from "ckeditor5";

import type { TriliumMentionFeed } from "./types.js";

/**
 * Appends a feed to `mention.feeds`, creating the entry when the host application configured none.
 *
 * Call this from a plugin **constructor**, not from `init()`: {@link TriliumMentionUI} compiles the
 * configured feeds into trigger patterns in its own `init()`, and CKEditor runs every plugin
 * constructor before any `init()`, so the constructor is the only hook guaranteed to be early
 * enough regardless of the order the plugins appear in.
 *
 * A feed whose marker is already taken is dropped with a warning rather than registered twice — two
 * feeds sharing a marker would make {@link findMarkerMatch} pick whichever came first and silently
 * shadow the other.
 */
export function registerMentionFeed(editor: Editor, feed: TriliumMentionFeed): void {
    const feeds = (editor.config.get("mention.feeds") ?? []) as TriliumMentionFeed[];

    if (feeds.some((existing) => existing.marker === feed.marker)) {
        console.warn(`[trilium-mention] the "${feed.marker}" marker is already registered; ignoring the duplicate feed.`);
        return;
    }

    editor.config.set("mention.feeds", [ ...feeds, feed ]);
}
