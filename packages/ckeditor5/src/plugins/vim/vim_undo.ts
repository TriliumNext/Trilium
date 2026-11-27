import { type Batch, type Command, type Editor, EmitterMixin, type Operation } from "ckeditor5";

/** The undo and redo commands, whose stacks hold the batches they undo next. */
type StackCommand = Command & {
    readonly createdBatches: WeakSet<Batch>;
    /** Protected in `UndoRedoBaseCommand`, and the only record of what the command undoes next. */
    readonly _stack: { batch: Batch }[];
};

/**
 * Groups the batches of the undo history into the steps that Vim undoes: a change command with the
 * text typed until Esc, an Insert session, and a macro run each undo as one step. A batch made
 * outside a step, such as with the toolbar, is a step of its own.
 */
export default class VimUndo extends EmitterMixin() {

    private readonly steps = new WeakMap<Batch, number>();
    private nextStep = 1;
    private openStep: number | null = null;
    private openCount = 0;

    constructor(private readonly editor: Editor) {
        super();
        const undo = this.getCommand("undo");
        const redo = this.getCommand("redo");
        if (!undo || !redo) {
            return;
        }

        this.listenTo(editor.model, "applyOperation", (_evt, args) => {
            const operation = (args as [ Operation ])[0];
            const batch = operation.batch as Batch | null;
            const isOwnBatch = undo.createdBatches.has(batch as Batch)
                || redo.createdBatches.has(batch as Batch);
            if (!operation.isDocumentOperation || !batch || this.steps.has(batch)
                || !batch.isUndoable || isOwnBatch) {
                return;
            }
            this.steps.set(batch, this.openStep ?? this.nextStep++);
        }, { priority: "highest" });

        for (const command of [ undo, redo ]) {
            this.listenTo(command, "revert", (_evt, batch: Batch, revertingBatch: Batch) => {
                const step = this.steps.get(batch);
                if (step !== undefined) {
                    this.steps.set(revertingBatch, step);
                }
            });
        }
    }

    /** Starts a step that the batches made until `close()` belong to. Nested calls share it. */
    open() {
        if (this.openCount++ === 0) {
            this.openStep = this.nextStep++;
        }
    }

    close() {
        if (this.openCount > 0 && --this.openCount === 0) {
            this.openStep = null;
        }
    }

    /** Undoes the last step. */
    undo() {
        this.revert("undo");
    }

    /** Redoes the last undone step. */
    redo() {
        this.revert("redo");
    }

    destroy() {
        this.stopListening();
    }

    private revert(commandName: "undo" | "redo") {
        const command = this.getCommand(commandName);
        const top = command?._stack.at(-1);
        if (!command || !top) {
            return;
        }
        const step = this.steps.get(top.batch);
        do {
            this.editor.execute(commandName);
        } while (step !== undefined && command._stack.length
            && this.steps.get(command._stack[command._stack.length - 1].batch) === step);
    }

    private getCommand(name: "undo" | "redo"): StackCommand | undefined {
        return this.editor.commands.get(name) as StackCommand | undefined;
    }
}
