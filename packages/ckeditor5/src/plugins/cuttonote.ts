import scissorsIcon from '../icons/scissors.svg?raw';
import { ButtonView, HtmlDataProcessor, Plugin } from 'ckeditor5';

export default class CutToNotePlugin extends Plugin {

    private htmlDataProcessor!: HtmlDataProcessor;

	init() {
		this.htmlDataProcessor = new HtmlDataProcessor(this.editor.editing.view.document);

		this.editor.ui.componentFactory.add( 'cutToNote', locale => {
			const view = new ButtonView( locale );

			view.set( {
				label: 'Cut & paste selection to sub-note',
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
		this.editor.removeSelection = () => this.removeSelection();
	}

	getSelectedHtml() {
		const model = this.editor.model;
		const document = model.document;

		// Downcast through the clipboard pipeline so editor-only list bookkeeping
		// (data-list-item-id) is skipped, matching what a native copy produces.
		const content = this.editor.data.toView(model.getSelectedContent(document.selection), {
			isClipboardPipeline: true
		});

		return this.htmlDataProcessor.toData(content);
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
