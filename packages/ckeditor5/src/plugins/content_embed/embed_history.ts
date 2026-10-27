import {
    type Batch,
    type ModelWriter,
    Plugin,
    UndoEditing,
    type UndoRedoBaseCommandRevertEvent
} from "ckeditor5";

/** A change made in the content of an embed, kept as a step of the text editor's undo. */
export interface EmbedHistoryStep {
    /** Reverts the change. Returns `false` when the content changed since, to skip the step. */
    undo(): boolean;
    /** Makes the change again. Returns `false` when the content changed since. */
    redo(): boolean;
}

/** A step that {@link EmbedHistory.push} added to the undo stack. */
export interface EmbedHistoryEntry {
    /** Whether no other change entered the undo stack after the step, so it can still grow. */
    isLatest(): boolean;
}

type HistoryCommandName = "undo" | "redo";

const STEP_MARKER = "embedHistoryStep";

/**
 * Keeps the changes made in the content of embeds, such as the code editor of an included note,
 * on the undo stack of the text editor. A step is a batch that only adds or removes a marker that
 * does not affect the data. Undoing or redoing that batch undoes or redoes the step.
 */
export default class EmbedHistory extends Plugin {
    private readonly steps = new WeakMap<Batch, EmbedHistoryStep>();
    private lastBatch: Batch | null = null;
    private isStepApplied = false;
    private isStepSkipped = false;

    static get requires() {
        return [ UndoEditing ] as const;
    }

    static get pluginName() {
        return "EmbedHistory" as const;
    }

    init() {
        const editor = this.editor;

        this.listenTo(editor.model, "applyOperation", (_evt, [ operation ]) => {
            if (operation.isDocumentOperation && operation.batch?.isUndoable) {
                this.lastBatch = operation.batch;
            }
        });
        this.listenTo(editor.data, "set", () => {
            this.lastBatch = null;
        });

        for (const name of [ "undo", "redo" ] as const) {
            const command = editor.commands.get(name);
            /* v8 ignore next 3 -- `UndoEditing` registers both commands */
            if (!command) {
                continue;
            }

            this.listenTo<UndoRedoBaseCommandRevertEvent>(command, "revert",
                (_evt, reverted, reverting) => this.revert(name, reverted, reverting));
            // Runs after the command, to go on to the next item of the stack.
            this.listenTo(command, "execute", () => {
                if (this.isStepSkipped) {
                    this.isStepSkipped = false;
                    if (command.isEnabled) {
                        editor.execute(name);
                    }
                }
            }, { priority: "low" });
        }
    }

    /** Adds `step` on top of the undo stack, and clears the redo stack. */
    push(step: EmbedHistoryStep): EmbedHistoryEntry {
        const model = this.editor.model;
        const batch = model.createBatch();
        this.steps.set(batch, step);
        model.enqueueChange(batch, (writer) => toggleStepMarker(writer));

        return { isLatest: () => this.lastBatch === batch };
    }

    /**
     * Undoes the last change of the note, for the content of an embed. The text editor takes the
     * focus when the change was one of its own.
     */
    undo() {
        this.runFromEmbed("undo");
    }

    /** Redoes the last undone change of the note, for the content of an embed. */
    redo() {
        this.runFromEmbed("redo");
    }

    private runFromEmbed(name: HistoryCommandName) {
        const editor = this.editor;
        if (!editor.commands.get(name)?.isEnabled) {
            return;
        }

        this.isStepApplied = false;
        editor.execute(name);
        if (!this.isStepApplied) {
            editor.editing.view.focus();
        }
    }

    private revert(name: HistoryCommandName, reverted: Batch, reverting: Batch) {
        const step = this.steps.get(reverted);
        if (!step) {
            return;
        }

        this.steps.set(reverting, step);
        const isApplied = name === "undo" ? step.undo() : step.redo();
        if (isApplied) {
            this.isStepApplied = true;
        } else {
            this.isStepSkipped = true;
        }
    }
}

/** Adds the step marker, or removes it, at the start of the document. */
function toggleStepMarker(writer: ModelWriter) {
    const model = writer.model;
    if (model.markers.has(STEP_MARKER)) {
        writer.removeMarker(STEP_MARKER);
        return;
    }

    const root = model.document.getRoot();
    /* v8 ignore next 3 -- a text editor always has its main root */
    if (!root) {
        return;
    }
    writer.addMarker(STEP_MARKER, {
        range: writer.createRange(writer.createPositionAt(root, 0)),
        usingOperation: true,
        affectsData: false
    });
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ EmbedHistory.pluginName ]: EmbedHistory;
    }
}
