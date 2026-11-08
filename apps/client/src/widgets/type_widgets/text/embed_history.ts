import type { CKTextEditor } from "@triliumnext/ckeditor5";
import type { HostHistory, SharedHistory } from "@triliumnext/codemirror";

import type DrawingHistory from "../canvas/drawing_history";

/** The undo and redo commands of the text editor. */
export type HistoryCommand = "undo" | "redo";

/** The undo stack of the text note, as the content of its embeds reaches it. */
export interface EmbedHostHistory extends HostHistory {
    /** Whether the text note has a change to undo, or to redo. */
    isEnabled(name: HistoryCommand): boolean;
    /** Calls `listener` when `isEnabled()` changes, until the returned call. */
    subscribe(listener: () => void): () => void;
}

/** The undo history of a note, an attachment or an inline source that a text note embeds. */
export interface ContentHistory {
    /** The undo stack of the text note. */
    readonly host: EmbedHostHistory;
    /** Saves the content while no editor shows it. */
    readonly write: (text: string) => void;
    /** The history of the code editors of the content, which the first of them creates. */
    shared?: SharedHistory;
    /** The history of the drawing of the content, which the first Excalidraw of it creates. */
    drawing?: DrawingHistory;
}

const HISTORY_COMMANDS: readonly HistoryCommand[] = [ "undo", "redo" ];

/**
 * The undo histories of the content in the embeds of a text note, which keep their steps on the
 * undo stack of the text editor.
 */
export default class EmbedHistories {
    private readonly byId = new Map<string, ContentHistory>();
    private readonly bySource = new WeakMap<object, ContentHistory>();
    private readonly host: EmbedHostHistory;

    constructor(getEditor: () => Pick<CKTextEditor, "plugins" | "commands"> | null) {
        const getPlugin = () => getEditor()?.plugins.get("EmbedHistory");
        this.host = {
            push: (step) => getPlugin()?.push(step) ?? { isLatest: () => false },
            undo: () => getPlugin()?.undo(),
            redo: () => getPlugin()?.redo(),
            isEnabled: (name) => !!getEditor()?.commands.get(name)?.isEnabled,
            subscribe: (listener) => {
                const commands = HISTORY_COMMANDS.map((name) => getEditor()?.commands.get(name));
                for (const command of commands) {
                    command?.on("change:isEnabled", listener);
                }
                return () => {
                    for (const command of commands) {
                        command?.off("change:isEnabled", listener);
                    }
                };
            }
        };
    }

    /**
     * The history of the content that `key` identifies: the ID of a note or an attachment, or the
     * source of an inline embed. `write` saves the content while no editor shows it.
     */
    get(key: string | object, write: (text: string) => void): ContentHistory {
        const existing = typeof key === "string" ? this.byId.get(key) : this.bySource.get(key);
        if (existing) {
            return existing;
        }

        const history: ContentHistory = { host: this.host, write };
        if (typeof key === "string") {
            this.byId.set(key, history);
        } else {
            this.bySource.set(key, history);
        }
        return history;
    }
}
