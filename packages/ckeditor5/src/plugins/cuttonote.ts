import scissorsIcon from '../icons/scissors.svg?raw';
import {
	ButtonView,
	HtmlDataProcessor,
	ModelLiveRange,
	Plugin,
	plainTextToHtml,
	ViewDataTransfer,
	viewToPlainText
} from 'ckeditor5';
import type { ModelRange, ViewDocumentFragment } from 'ckeditor5';

/** A selection pinned by `capturePasteTarget()` for a paste whose content arrives later. */
export interface PasteTarget {
	/**
	 * Pastes at the pinned selection, then releases it. Does nothing when the pinned content is
	 * gone.
	 */
	paste(html: string, text: string): void;
	/**
	 * Moves the selection back onto the pinned ranges and releases them. Returns `false` when the
	 * pinned content is gone.
	 */
	restore(): boolean;
	/** Detaches the pinned ranges without pasting. Safe to call more than once. */
	release(): void;
}

export default class CutToNotePlugin extends Plugin {

    private htmlDataProcessor!: HtmlDataProcessor;

	init() {
		const t = this.editor.t;

		this.htmlDataProcessor = new HtmlDataProcessor(this.editor.editing.view.document);

		this.editor.ui.componentFactory.add( 'cutToNote', locale => {
			const view = new ButtonView( locale );

			view.set( {
				label: t('Cut selection into a sub-note'),
				icon: scissorsIcon,
				tooltip: true
			} );

			// Callback executed once the image is clicked.
			view.on('execute', () => {
				const editorEl = this.editor.editing.view.getDomRoot();
				const component = glob.getComponentByEl(editorEl);

				component.triggerCommand('cutIntoNote');
			});

			return view;
		} );

		this.editor.getSelectedHtml = () => this.getSelectedHtml();
		this.editor.getSelectedPlainText = () => this.getSelectedPlainText();
		this.editor.pasteContent = (html, text) => this.pasteContent(html, text);
		this.editor.capturePasteTarget = () => this.capturePasteTarget();
		this.editor.removeSelection = () => this.removeSelection();
	}

	getSelectedHtml() {
		return this.htmlDataProcessor.toData(this.getSelectedViewFragment());
	}

	/**
	 * Returns the selected content as plain text, through the same `viewToPlainText` the native
	 * copy uses for the `text/plain` clipboard flavor.
	 */
	getSelectedPlainText() {
		return viewToPlainText(this.editor.editing.view.domConverter, this.getSelectedViewFragment());
	}

	/**
	 * Returns the selected content as a view fragment.
	 *
	 * A multi-cell table selection goes through `TableSelection#getSelectionAsFragment()`, the
	 * same crop the native table copy uses, so it serializes as a table of just the selected
	 * cells. The downcast runs through the clipboard pipeline so editor-only list bookkeeping
	 * (data-list-item-id) is skipped, matching what a native copy produces.
	 */
	private getSelectedViewFragment(): ViewDocumentFragment {
		const model = this.editor.model;
		const tableFragment = this.editor.plugins.has("TableSelection")
			? this.editor.plugins.get("TableSelection").getSelectionAsFragment()
			: null;

		return this.editor.data.toView(
			tableFragment ?? model.getSelectedContent(model.document.selection),
			{ isClipboardPipeline: true }
		);
	}

	/**
	 * Runs `html` (or `text` when `html` is empty) through the clipboard paste pipeline, as a
	 * paste at the current selection. Pasting a table into a multi-cell table selection merges
	 * it the way a native paste does.
	 */
	pasteContent(html: string, text: string) {
		const content = html || (text ? plainTextToHtml(text) : "");
		if (!content) {
			return;
		}

		const view = this.editor.editing.view;
		view.focus();
		view.document.fire("clipboardInput", {
			dataTransfer: new ViewDataTransfer(new DataTransfer()),
			content,
			method: "paste",
			targetRanges: null
		});
	}

	/**
	 * Pins the current selection as live ranges, for a paste whose content arrives asynchronously,
	 * e.g. from `navigator.clipboard.read()`. `paste()` moves the selection back onto the pinned
	 * ranges first, so a selection changed while the content was read does not move the paste.
	 * Ranges whose content was removed in the meantime are dropped. With none left, for example
	 * after `setData()` loaded another note into the editor, the paste is discarded.
	 */
	capturePasteTarget(): PasteTarget {
		const editor = this.editor;
		const ranges = [...editor.model.document.selection.getRanges()]
			.map((range) => ModelLiveRange.fromRange(range));
		const release = () => {
			for (const range of ranges) {
				range.detach();
			}
		};
		const restore = () => {
			const targets = editor.state === "destroyed" ? [] : this.getRemainingRanges(ranges);
			release();
			if (targets.length) {
				this.restoreSelection(targets);
			}
			return targets.length > 0;
		};

		return {
			paste: (html, text) => {
				if (restore()) {
					this.pasteContent(html, text);
				}
			},
			restore,
			release
		};
	}

	/** The pinned ranges whose content is still in the document. */
	private getRemainingRanges(ranges: ModelLiveRange[]): ModelRange[] {
		const graveyard = this.editor.model.document.graveyard;
		return ranges
			.filter((range) => range.root !== graveyard)
			.map((range) => range.toRange());
	}

	private restoreSelection(targets: ModelRange[]) {
		const model = this.editor.model;
		const current = [...model.document.selection.getRanges()];
		const isUnchanged = targets.length === current.length
			&& targets.every((range, index) => range.isEqual(current[index]));
		if (!isUnchanged) {
			model.change((writer) => writer.setSelection(targets));
		}
	}

	async removeSelection() {
		const model = this.editor.model;

		model.deleteContent(model.document.selection);
		this.editor.execute("paragraph");

		const component = this.getComponent();

		await component.triggerCommand('saveNoteDetailNow');
	}

	getComponent() {
		const editorEl = this.editor.editing.view.getDomRoot();

		return glob.getComponentByEl( editorEl );
	}
}
