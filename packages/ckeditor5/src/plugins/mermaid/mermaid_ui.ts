/**
 * @module mermaid/mermaid_ui
 */

import { NEW_MERMAID_CONTENT } from '@triliumnext/commons';
import { addListToDropdown, Collection, createDropdown, type Editor, type ListDropdownItemDefinition, type Locale, Plugin, SplitButtonView, ViewModel } from 'ckeditor5';

import insertMermaidIcon from '../../icons/mermaid-insert.svg?raw';
import { INSERT_INLINE_EMBED_COMMAND } from '../content_embed/inline_source.js';

/**
 * A selectable Mermaid diagram template (a localized name and its source
 * markup), listed in the insert-diagram split button's dropdown.
 */
export interface MermaidSample {
	name: string;
	content: string;
}

/**
 * The `mermaid` split button, which inserts a Mermaid diagram as an embed of its source. The main
 * action inserts a new diagram, while the dropdown lists the diagram templates of the
 * `mermaid.samples` config.
 */
export default class MermaidUI extends Plugin {
	static get pluginName() {
		return 'MermaidUI' as const;
	}

	init() {
		const editor = this.editor;
		const t = editor.t;
		const samples = editor.config.get( 'mermaid.samples' ) ?? [];

		editor.ui.componentFactory.add( 'mermaid', ( locale: Locale ) => {
			const dropdownView = createDropdown( locale, SplitButtonView );
			const splitButtonView = dropdownView.buttonView;
			splitButtonView.set( {
				label: t( 'Mermaid diagram' ),
				icon: insertMermaidIcon,
				tooltip: true
			} );
			splitButtonView.on( 'execute', () => insertMermaidDiagram( editor ) );

			// `createDropdown` binds the split button's `isEnabled` to the dropdown, so binding the
			// dropdown alone disables both parts.
			dropdownView.class = 'ck-tn-dropdown';
			addListToDropdown( dropdownView, getSampleDropdownItems( samples ) );
			const command = editor.commands.get( INSERT_INLINE_EMBED_COMMAND );
			if ( command ) {
				dropdownView.bind( 'isEnabled' ).to( command, 'isEnabled' );
			}
			dropdownView.on( 'execute', evt => {
				const source = ( evt.source as { commandParam?: string } | undefined )?.commandParam;
				insertMermaidDiagram( editor, source );
			} );

			return dropdownView;
		} );
	}
}

/** Inserts a Mermaid diagram of `source`, a new one by default, and gives it the focus. */
export function insertMermaidDiagram( editor: Editor, source = NEW_MERMAID_CONTENT ) {
	editor.execute( INSERT_INLINE_EMBED_COMMAND, { language: 'mermaid', source } );
	editor.editing.view.scrollToTheSelection();
	editor.editing.view.focus();
}

function getSampleDropdownItems( samples: MermaidSample[] ) {
	const itemDefinitions = new Collection<ListDropdownItemDefinition>();

	for ( const sample of samples ) {
		itemDefinitions.add( {
			type: 'button',
			model: new ViewModel( {
				commandParam: sample.content,
				label: sample.name,
				role: 'menuitem',
				withText: true
			} )
		} );
	}

	return itemDefinitions;
}
