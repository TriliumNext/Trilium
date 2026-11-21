import { Plugin } from 'ckeditor5';

export default class ScrollOnUndoRedoPlugin extends Plugin {
	init() {
		const editor = this.editor;

		const scrollToSelection = () => {
			// Ensure scroll happens in sync with DOM updates
			requestAnimationFrame(() => {
				if (editor.state === 'destroyed') return;
				editor.editing.view.scrollToTheSelection();
			});
		};

		// Scroll to selection after undo/redo to keep cursor in view
		editor.commands.get('undo')?.on('execute', scrollToSelection);
		editor.commands.get('redo')?.on('execute', scrollToSelection);
	}
}
