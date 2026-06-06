/**
 * @module mermaid/mermaidui
 */

import insertMermaidIcon from '../theme/icons/insert.svg?raw';
import previewModeIcon from '../theme/icons/preview-mode.svg?raw';
import splitModeIcon from '../theme/icons/split-mode.svg?raw';
import sourceModeIcon from '../theme/icons/source-mode.svg?raw';
import infoIcon from '../theme/icons/info.svg?raw';
import { addListToDropdown, ButtonView, Collection, createDropdown, Editor, ListDropdownItemDefinition, Locale, ModelElement, Observable, Plugin, SplitButtonView, ViewModel } from 'ckeditor5';
import InsertMermaidCommand, { INSERT_MERMAID_COMMAND } from './commands/insertMermaidCommand.js';

/* global window, document */

/**
 * A selectable Mermaid diagram template (a localized name and its source
 * markup), listed in the insert-diagram split button's dropdown.
 */
export interface MermaidSample {
	name: string;
	content: string;
}

export default class MermaidUI extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'MermaidUI' as const;
	}

	/**
	 * @inheritDoc
	 */
	init() {
		this._addButtons();
	}

	/**
	 * Adds all mermaid-related buttons.
	 *
	 * @private
	 */
	_addButtons() {
		const editor = this.editor;

		this._addInsertMermaidButton();
		this._addMermaidInfoButton();
		this._createToolbarButton( editor, 'mermaidPreview', 'Preview', previewModeIcon );
		this._createToolbarButton( editor, 'mermaidSourceView', 'Source view', sourceModeIcon );
		this._createToolbarButton( editor, 'mermaidSplitView', 'Split view', splitModeIcon );
	}

	/**
	 * Adds the split button for inserting mermaid.
	 *
	 * The main action inserts a blank diagram, while the dropdown lists the
	 * configured diagram templates (see the `mermaid.samples` config). Picking
	 * a template inserts a diagram pre-filled with its source.
	 *
	 * @private
	 */
	_addInsertMermaidButton() {
		const editor = this.editor;
		const t = editor.t;
		const command = editor.commands.get( INSERT_MERMAID_COMMAND ) as InsertMermaidCommand;
		if (!command) {
			throw new Error("Missing command.");
		}

		const samples = editor.config.get( 'mermaid.samples' ) ?? [];

		editor.ui.componentFactory.add( 'mermaid', (locale: Locale) => {
			const dropdownView = createDropdown( locale, SplitButtonView );
			const splitButtonView = dropdownView.buttonView;

			splitButtonView.set( {
				label: t( 'Insert Mermaid diagram' ),
				icon: insertMermaidIcon,
				tooltip: true
			} );

			// Main action: insert a blank diagram.
			splitButtonView.on( 'execute', () => this._insertDiagram() );

			// Dropdown: insert a diagram pre-filled with the picked template.
			// Reuse the shared scrollable dropdown style so the long list of
			// templates doesn't overflow the viewport.
			// `createDropdown` already binds the split button's `isEnabled` to the
			// dropdown, so binding the dropdown alone disables both parts.
			dropdownView.class = 'ck-tn-dropdown';
			addListToDropdown( dropdownView, this._getSampleDropdownItems( samples ) );
			dropdownView.bind( 'isEnabled' ).to( command, 'isEnabled' );
			dropdownView.on( 'execute', evt => {
				const source = (evt.source as { commandParam?: string } | undefined)?.commandParam;
				this._insertDiagram( { source } );
			} );

			return dropdownView;
		} );
	}

	/**
	 * Inserts a mermaid diagram — blank by default, or pre-filled with the given
	 * template source — and moves the focus into its editing view.
	 *
	 * @private
	 */
	_insertDiagram( options: { source?: string } = {} ) {
		const editor = this.editor;
		const view = editor.editing.view;

		const mermaidItem = editor.execute( INSERT_MERMAID_COMMAND, options ) as ModelElement;
		const mermaidItemViewElement = editor.editing.mapper.toViewElement( mermaidItem );

		view.scrollToTheSelection();
		view.focus();

		if ( mermaidItemViewElement ) {
			const mermaidItemDomElement = view.domConverter.viewToDom( mermaidItemViewElement );

			if ( mermaidItemDomElement ) {
				(mermaidItemDomElement.querySelector( '.ck-mermaid__editing-view' ) as HTMLElement)?.focus();
			}
		}
	}

	/**
	 * Builds the dropdown list of diagram templates.
	 *
	 * @private
	 */
	_getSampleDropdownItems( samples: MermaidSample[] ) {
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

	/**
	 * Adds the button linking to the mermaid guide.
	 *
	 * @private
	 */
	_addMermaidInfoButton() {
		const editor = this.editor;
		const t = editor.t;

		editor.ui.componentFactory.add( 'mermaidInfo', locale => {
			const buttonView = new ButtonView( locale );
			const link = 'https://ckeditor.com/blog/basic-overview-of-creating-flowcharts-using-mermaid/';

			buttonView.set( {
				label: t( 'Read more about Mermaid diagram syntax' ),
				icon: infoIcon,
				tooltip: true
			} );

			buttonView.on( 'execute', () => {
				window.open( link, '_blank', 'noopener' );
			} );

			return buttonView;
		} );
	}

	/**
	 * Adds the mermaid balloon toolbar button.
	 *
	 * @private
	 */
	_createToolbarButton( editor: Editor, name: string, label: string, icon: string ) {
		const t = editor.t;

		editor.ui.componentFactory.add( name, locale => {
			const buttonView = new ButtonView( locale );
			const command = editor.commands.get( `${ name }Command` );
			if (!command) {
				throw new Error("Missing command.");
			}

			buttonView.set( {
				label: t( label ),
				icon,
				tooltip: true
			} );

			buttonView.bind( 'isOn', 'isEnabled' ).to( command as (Observable & { value: boolean; } & { isEnabled: boolean; }), 'value', 'isEnabled' );

			// Execute the command when the button is clicked.
			command.listenTo( buttonView, 'execute', () => {
				editor.execute( `${ name }Command` );
				editor.editing.view.scrollToTheSelection();
				editor.editing.view.focus();
			} );

			return buttonView;
		} );
	}
}
