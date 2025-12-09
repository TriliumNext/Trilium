/**
 * @license Copyright (c) 2003-2024, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module admonition/admonitionui
 */

import { Plugin, addListToDropdown, createDropdown, ListDropdownItemDefinition, SplitButtonView, ViewModel } from 'ckeditor5';

import '../theme/blockquote.css';
import admonitionIcon from '../theme/icons/admonition.svg?raw';
import { AdmonitionType } from './admonitioncommand.js';
import { Collection } from 'ckeditor5';

interface AdmonitionDefinition {
	title: string;
}

export const ADMONITION_TYPES: Record<AdmonitionType, AdmonitionDefinition> = {
	note: {
		title: "Note"
	},
	tip: {
		title: "Tip"
	},
	important: {
		title: "Important"
	},
	caution: {
		title: "Caution"
	},
	warning: {
		title: "Warning"
	}
};

/**
 * The block quote UI plugin.
 *
 * It introduces the `'admonition'` button.
 *
 * @extends module:core/plugin~Plugin
 */
export default class AdmonitionUI extends Plugin {
	/**
	 * @inheritDoc
	 */
	public static get pluginName() {
		return 'AdmonitionUI' as const;
	}

	/**
	 * @inheritDoc
	 */
	public init(): void {
		const editor = this.editor;

		editor.ui.componentFactory.add( 'admonition', () => {
			const buttonView = this._createButton();

			return buttonView;
		} );
	}

	/**
	 * Creates a button for admonition command to use either in toolbar or in menu bar.
	 */
	private _createButton() {
		const editor = this.editor;
		const locale = editor.locale;
		const command = editor.commands.get( 'admonition' )!;
		const dropdownView = createDropdown(locale, SplitButtonView);
		const splitButtonView = dropdownView.buttonView;
		const t = locale.t;

		addListToDropdown(dropdownView, this._getDropdownItems())

		// Button configuration.
		splitButtonView.set( {
			label: t( 'Admonition' ),
			icon: admonitionIcon,
			isToggleable: true,
			tooltip: true
		} );
		splitButtonView.on("execute", () => {
			editor.execute("admonition", { usePreviousChoice: true });
			editor.editing.view.focus();
		});
		splitButtonView.bind( 'isOn' ).to( command, 'value', value => (!!value) as boolean);

		// Dropdown configuration
		dropdownView.bind( 'isEnabled' ).to( command, 'isEnabled' );
		dropdownView.on("execute", evt => {
			editor.execute("admonition", { forceValue: ( evt.source as any ).commandParam } );
			editor.editing.view.focus();
		});

		return dropdownView;
	}

	private _getDropdownItems() {
		const itemDefinitions = new Collection<ListDropdownItemDefinition>();
		const command = this.editor.commands.get("admonition");
		if (!command) {
			return itemDefinitions;
		}

		for (const [ type, admonition ] of Object.entries(ADMONITION_TYPES)) {
			const definition: ListDropdownItemDefinition = {
				type: "button",
				model: new ViewModel({
					commandParam: type,
					label: admonition.title,
					class: `ck-tn-admonition-option ck-tn-admonition-${type}`,
					role: 'menuitemradio',
					withText: true
				})
			}

			definition.model.bind("isOn").to(command, "value", currentType => currentType === type);
			itemDefinitions.add(definition);
		}

		return itemDefinitions;
	}
}
