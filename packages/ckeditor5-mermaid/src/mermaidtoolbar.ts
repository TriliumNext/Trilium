/**
 * @module mermaid/mermaidtoolbar
 */

import { Plugin, ViewDocumentSelection, ViewElement, WidgetToolbarRepository } from "ckeditor5";


export default class MermaidToolbar extends Plugin {

	static get requires() {
		return [ WidgetToolbarRepository ];
	}

	static get pluginName() {
		return 'MermaidToolbar' as const;
	}

	afterInit() {
		const editor = this.editor;
		const t = editor.t;

		const widgetToolbarRepository = editor.plugins.get( WidgetToolbarRepository );
		const mermaidToolbarItems = [ 'mermaidSourceView', 'mermaidSplitView', 'mermaidPreview', '|', 'mermaidInfo' ];

		if ( mermaidToolbarItems ) {
			widgetToolbarRepository.register( 'mermaidToolbar', {
				ariaLabel: t( 'Mermaid toolbar' ),
				items: mermaidToolbarItems,
				getRelatedElement: selection => getSelectedElement( selection )
			} );
		}
	}
}

function getSelectedElement( selection: ViewDocumentSelection ) {
	const viewElement = selection.getSelectedElement() as unknown as ViewElement;

	if ( viewElement && viewElement.hasClass( 'ck-mermaid__wrapper' ) ) {
		return viewElement;
	}

	return null;
}
