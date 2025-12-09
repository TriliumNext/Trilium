import { Plugin, addListToDropdown, createDropdown, SplitButtonView, ViewModel, type ListDropdownItemDefinition, Collection } from 'ckeditor5';

import {
	ATTRIBUTES,
	COMMANDS,
	ELEMENTS,
	TOOLBAR_COMPONENT_NAME
} from './constants.js';
import insertFootnoteIcon from '../theme/icons/insert-footnote.svg?raw';
import { modelQueryElement, modelQueryElementsAll } from './utils.js';

export default class FootnoteUI extends Plugin {

	public static get pluginName() {
		return 'FootnoteUI' as const;
	}

	public init(): void {
		const editor = this.editor;
		const translate = editor.t;

		editor.ui.componentFactory.add( TOOLBAR_COMPONENT_NAME, locale => {
			const dropdownView = createDropdown( locale, SplitButtonView );
			const splitButtonView = dropdownView.buttonView;

			// Populate the list in the dropdown with items.
			// addListToDropdown( dropdownView, getDropdownItemsDefinitions( placeholderNames ) );
			const command = editor.commands.get( COMMANDS.insertFootnote );
			if ( !command ) {
				throw new Error( 'Command not found.' );
			}

			splitButtonView.set( {
				label: translate( 'Footnote' ),
				icon: insertFootnoteIcon,
				tooltip: true,
				isToggleable: true
			} );
			splitButtonView.bind( 'isOn' ).to( command, 'value', value => !!value );
			splitButtonView.on( 'execute', () => {
				editor.execute( COMMANDS.insertFootnote, {
					footnoteIndex: 0
				} );
				editor.editing.view.focus();
			} );

			dropdownView.class = 'ck-code-block-dropdown';
			dropdownView.bind( 'isEnabled' ).to( command );
			dropdownView.on(
				'change:isOpen',
				( evt, propertyName, newValue ) => {
					dropdownView?.listView?.items.clear();
					if ( newValue ) {
						addListToDropdown(
							dropdownView,
							this.getDropdownItemsDefinitions() as any
						);
					} else {
						dropdownView?.listView?.items.clear();
						const listElement = dropdownView?.listView?.element;
						if ( listElement && listElement.parentNode ) {
							listElement.parentNode.removeChild( listElement );
						}
					}
				}
			);
			// Execute the command when the dropdown item is clicked (executed).
			this.listenTo( dropdownView, 'execute', evt => {
				editor.execute( COMMANDS.insertFootnote, {
					footnoteIndex: ( evt.source as any ).commandParam
				} );
				editor.editing.view.focus();
			} );

			return dropdownView;
		} );
	}

	public getDropdownItemsDefinitions(): Collection<ListDropdownItemDefinition> {
		const itemDefinitions = new Collection<ListDropdownItemDefinition>();
		const defaultDef: ListDropdownItemDefinition = {
			type: 'button',
			model: new ViewModel( {
				commandParam: 0,
				label: 'New footnote',
				withText: true
			} )
		};
		itemDefinitions.add( defaultDef );

		const rootElement = this.editor.model.document.getRoot();
		if ( !rootElement ) {
			throw new Error( 'Document has no root element.' );
		}

		const footnoteSection = modelQueryElement(
			this.editor,
			rootElement,
			element => element.is( 'element', ELEMENTS.footnoteSection )
		);

		if ( footnoteSection ) {
			const footnoteItems = modelQueryElementsAll(
				this.editor,
				rootElement,
				element => element.is( 'element', ELEMENTS.footnoteItem )
			);
			footnoteItems.forEach( footnote => {
				const index = footnote.getAttribute( ATTRIBUTES.footnoteIndex );
				const definition: ListDropdownItemDefinition = {
					type: 'button',
					model: new ViewModel( {
						commandParam: index,
						label: `Insert footnote ${ index }`,
						withText: true
					} )
				};

				itemDefinitions.add( definition );
			} );
		}

		return itemDefinitions;
	}
}
