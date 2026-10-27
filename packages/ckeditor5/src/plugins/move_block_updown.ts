/**
 * https://github.com/TriliumNext/Trilium/issues/1002
 */

import {
	ButtonView, Command, IconArrowDown, IconArrowUp, ModelDocumentSelection, ModelElement, ModelLiveRange,
	ModelNode, Plugin, _isMac, Editor
} from 'ckeditor5';

import { isSelectionInTable } from "./table_move/table_move_commands.js";

interface MoveKeyCommands {
    table: "moveTableRowUp" | "moveTableRowDown";
    block: "moveBlockUp" | "moveBlockDown";
}

const MOVE_UP: MoveKeyCommands = { table: "moveTableRowUp", block: "moveBlockUp" };
const MOVE_DOWN: MoveKeyCommands = { table: "moveTableRowDown", block: "moveBlockDown" };

const keyMap = new Map<string, MoveKeyCommands>([
    ["ArrowUp", MOVE_UP],
    ["ArrowDown", MOVE_DOWN]
]);

/**
 * Registers the `moveBlockUp` and `moveBlockDown` commands, their Alt+↑/↓ shortcuts and buttons
 * of the same names. The shortcuts and the buttons move the table row instead in a table.
 */
export default class MoveBlockUpDownPlugin extends Plugin {
    init() {
        const editor = this.editor;
        const t = editor.t;

        editor.commands.add('moveBlockUp', new MoveBlockUpCommand(editor));
        editor.commands.add('moveBlockDown', new MoveBlockDownCommand(editor));

		// Use native DOM capturing to intercept Ctrl/Alt + ↑/↓,
		// as plugin-level keystroke handling may fail when the selection is near an object.
        this.bindMoveBlockShortcuts();

        this.addButton('moveBlockUp', t('Move up'), IconArrowUp, MOVE_UP);
        this.addButton('moveBlockDown', t('Move down'), IconArrowDown, MOVE_DOWN);
    }

    private addButton(name: string, label: string, icon: string, commands: MoveKeyCommands) {
        const editor = this.editor;
        editor.ui.componentFactory.add(name, (locale) => {
            const button = new ButtonView(locale);
            button.set({ label, icon, tooltip: true });

            const refresh = () => {
                button.isEnabled = this.canMove(commands);
            };
            refresh();
            button.listenTo(editor.model.document, 'change', refresh);
            button.listenTo(editor, 'change:isReadOnly', refresh);

            button.on('execute', () => {
                this.move(commands);
                editor.editing.view.focus();
            });
            return button;
        });
    }

    /**
     * The command that moves the selection: the row of the table it is in, or its blocks. Inside
     * a table the block commands would only shuffle paragraphs inside one cell. The block commands
     * still serve editor builds without the TableMove plugin.
     */
    private getMoveCommandName(commands: MoveKeyCommands) {
        const editor = this.editor;
        return editor.commands.get(commands.table) && isSelectionInTable(editor.model.document.selection)
            ? commands.table
            : commands.block;
    }

    private canMove(commands: MoveKeyCommands) {
        return !!this.editor.commands.get(this.getMoveCommandName(commands))?.isEnabled;
    }

    private move(commands: MoveKeyCommands) {
        if (this.canMove(commands)) {
            this.editor.execute(this.getMoveCommandName(commands));
        }
    }

	bindMoveBlockShortcuts() {
		addEditingKeydownCapture(this, (e) => {
			const commands = keyMap.get(e.key);
			if (!commands || !hasMoveModifier(e)) {
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();

			this.move(commands);
		});
	}

}

/** True when the keydown carries the move-shortcut modifier: plain Alt, or plain Meta off macOS. */
export function hasMoveModifier(e: KeyboardEvent): boolean {
	const isMac = _isMac(navigator.userAgent.toLowerCase());
	const isOnlyMeta = (!e.ctrlKey && !e.altKey && e.metaKey);
	const isOnlyAlt = (!e.ctrlKey && e.altKey && !e.metaKey);
	return (!isMac && isOnlyMeta) || isOnlyAlt;
}

/**
 * Adds a capture-phase keydown listener on the editing DOM root once it renders. Native
 * capturing intercepts the keystroke before plugin-level keystroke handling, which can fail
 * when the selection is near an object, and before window-scoped application shortcuts.
 *
 * The listener is removed when the editor is destroyed. The editing root is reused across
 * editor recreations (e.g. switching the content language rebuilds the editor in the same
 * container — see #10095). Without this cleanup the orphaned listener stays attached, captures
 * the keystroke first and runs editor.execute() against the destroyed editor — silently
 * swallowing the shortcut until a reload.
 *
 * The keys pressed in the content of an embed, such as in its editor, are skipped.
 */
export function addEditingKeydownCapture(plugin: Plugin, handleKeydown: (e: KeyboardEvent) => void) {
	const editor = plugin.editor;
	const onKeydown = (e: KeyboardEvent) => {
		if (isFromEditable(editor, e)) {
			handleKeydown(e);
		}
	};
	editor.editing.view.once('render', () => {
		const domRoot = editor.editing.view.getDomRoot();
		/* v8 ignore next 1 -- domRoot is always set while the editor is alive; only null after destroy */
		if (!domRoot) return;

		domRoot.addEventListener('keydown', onKeydown, { capture: true });
		plugin.listenTo(editor, 'destroy', () => {
			domRoot.removeEventListener('keydown', onKeydown, { capture: true });
		});
	});
}

/**
 * Whether `event` comes from an editable of `editor`, such as its root, a caption or a table cell,
 * rather than from the content of an embed, which the wrapper of the embed marks with
 * `data-cke-ignore-events`.
 */
export function isFromEditable(editor: Editor, event: Event) {
	const root = editor.editing.view.getDomRoot();
	const target = event.target instanceof Element ? event.target : null;
	const embedWrapper = target?.closest('[data-cke-ignore-events]');
	return !!root && !!target && root.contains(target)
		&& !(embedWrapper && root.contains(embedWrapper));
}

abstract class MoveBlockUpDownCommand extends Command {

	abstract getSibling(selectedBlock: ModelElement): ModelNode | null;
    abstract get offset(): "before" | "after";

	override refresh() {
		const blocks = this.getSelectedBlocks(this.editor.model.document.selection);
		this.isEnabled = blocks.length > 0 && blocks.every(block => !!this.getSibling(block));
	}

	override execute() {
		const model = this.editor.model;
		const selection = model.document.selection;
		const selectedBlocks = this.getSelectedBlocks(selection);
		const isEnabled = selectedBlocks.length > 0
			&& selectedBlocks.every(block => !!this.getSibling(block));

		if (!isEnabled) {
			return;
		}

		const movingBlocks = this.offset === 'before'
            ? selectedBlocks
            : [...selectedBlocks].reverse();

		// Live ranges follow the caret through the move operations, so the selection
		// ends up on the same characters it started on. Re-deriving it from an offset
		// stored beforehand cannot: a caret in a collapsible's <summary> resolves to the
		// enclosing <details>, whose offsets count child blocks, so offset 5 of a title
		// restored onto the <details> lands in the body — after which the next keystroke
		// moves a body block instead of the collapsible (see #11081).
		const restoredRanges = [...selection.getRanges()].map(range => ModelLiveRange.fromRange(range));

		model.change((writer) => {
			// Move blocks
			for (const block of movingBlocks) {
				const sibling = this.getSibling(block);
				/* v8 ignore next 1 -- isEnabled already ensures every block has a sibling; null path is unreachable */
				if (sibling) {
					const range = model.createRangeOn(block);
					writer.move(range, sibling, this.offset);
				}
			}

			writer.setSelection(restoredRanges.map(range => range.toRange()));
			this.editor.editing.view.focus();
			scrollToSelection(this.editor);
		});

		for (const range of restoredRanges) {
			range.detach();
		}
    }

	getSelectedBlocks(selection: ModelDocumentSelection) {
		const blocks = [...selection.getSelectedBlocks()];
		const resolved: ModelElement[] = [];

		// Selects elements (such as Mermaid) when there are no blocks
		if (!blocks.length) {
			const selectedObj = selection.getSelectedElement();
			if (selectedObj) {
				return [selectedObj];
			}
		}

		for (const block of blocks) {
			let el: ModelElement = block;
			// Hoist a caret-in-<summary> to the enclosing <details> so the
			// collapsible's title acts as a handle for the whole block (the
			// schema's `isBlock: true` on <summary> was specifically engineered
			// for this — see packages/ckeditor5-collapsible/src/collapsible-editing.ts).
			// Everything else uses the block as-is, so nested children
			// (collapsible body, admonition body, blockquote children) move
			// within their immediate container instead of escalating to the
			// top-level block.
			if (el.name === 'summary' && el.parent) {
				el = el.parent as ModelElement;
			}
			resolved.push(el);
		}

		// Deduplicate adjacent duplicates (e.g., nested selections resolving to same block)
		return resolved.filter((blk, idx) => idx === 0 || blk !== resolved[idx - 1]);
	}
}

class MoveBlockUpCommand extends MoveBlockUpDownCommand {

    getSibling(selectedBlock: ModelElement) {
        return selectedBlock.previousSibling;
    }

    get offset() {
        return "before" as const;
    }

}

class MoveBlockDownCommand extends MoveBlockUpDownCommand {

	/** @override */
	getSibling(selectedBlock: ModelElement) {
		return selectedBlock.nextSibling;
	}

	/** @override */
	get offset() {
		return "after" as const;
	}
}

function scrollToSelection(editor: Editor) {
    editor.editing.view.forceRender();
    editor.editing.view.scrollToTheSelection();
};
