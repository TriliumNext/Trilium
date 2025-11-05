import { Command, Mention, Plugin, ModelRange, type ModelSelectable } from "ckeditor5";
import { CreateNoteAction } from "@triliumnext/commons"

/**
 * Overrides the actions taken by the Mentions plugin (triggered by `@` in the text editor, or `~` & `#` in the attribute editor):
 *
 * - Auto-completes attributes and relations in the attribute editor.
 * - Triggers the modal to create notes.
 * - Inserts a reference link when a mention is selected.
 */
export default class MentionCustomization extends Plugin {

	static get requires() {
		return [ Mention ];
	}

	public static get pluginName() {
		return "MentionCustomization" as const;
	}

	afterInit() {
		const editor = this.editor;
		// override standard mention command (see https://github.com/ckeditor/ckeditor5/issues/6470)
		editor.commands.add('mention', new CustomMentionCommand(editor));
	}
}

interface MentionOpts {
	mention: string | {
	    id: string;
	    [key: string]: unknown;
	};
	marker: string;
	text?: string;
	range?: ModelRange;
}

interface MentionAttribute {
	id: string;
	action?: CreateNoteAction;
	noteTitle: string;
	notePath: string;
	parentNoteId?: string;
}

class CustomMentionCommand extends Command {

	override execute(options: MentionOpts) {
		const {model} = this.editor;
		const {document} = model;
		const {selection} = document;
		const mention = options.mention as unknown as MentionAttribute;
		const range = (options.range || selection.getFirstRange()) as ModelSelectable;

		if (mention.id.startsWith('#') || mention.id.startsWith('~')) {
			model.change(writer => {
				// Replace a range with the text with a mention.
				model.insertContent( writer.createText( mention.id, {} ), range );
			});
		}
	    else if (
	        mention.action === CreateNoteAction.CreateNote ||
	            mention.action === CreateNoteAction.CreateChildNote ||
	            mention.action === CreateNoteAction.CreateAndLinkNote ||
	            mention.action === CreateNoteAction.CreateAndLinkChildNote
	    ) {
	        const editorEl = this.editor.editing.view.getDomRoot();
	        const component = glob.getComponentByEl<EditorComponent>(editorEl);

	        // use parentNoteId as fallback when notePath is missing
	        const parentNotePath = mention.notePath || mention.parentNoteId;

	        component
	            .createNoteFromCkEditor(mention.noteTitle, parentNotePath, mention.action)
	            .then(notePath => {
	                if (notePath) {
	                    this.insertReference(range, notePath);
	                }
	            })
	            .catch(err => console.error("Error creating note from CKEditor mention:", err));
	    }
		else {
			this.insertReference(range, mention.notePath);
		}
	}

	insertReference(range: ModelSelectable, notePath: string) {
		const {model} = this.editor;

		model.change(writer => {
			// override the selection or at least the beginning @ character
			model.insertContent(writer.createText('', {}), range);

			this.editor.execute('referenceLink', {href: '#' + notePath});
		});
	}
}
