// A button label that renders MathLive's own menu markup rather than plain text.
//
// Most of MathLive's menu labels are not words: the insert entries draw the structure they would
// insert, the accents draw themselves around the current selection, and the swatches are coloured
// spans. `getMenuItemLabel()` hands those back as a fragment of HTML, which CKEditor's own
// `ButtonLabelView` would show verbatim — it binds `text` as a text node. `ButtonView` takes a
// label view in its constructor, so this one stands in for it.
//
// The markup is MathLive's, produced by its own `convertLatexToMarkup()`, and its rendering CSS
// is loaded with the library. The classes it carries (`ML__insert-template`, `ML__insert-label`)
// are styled globally by MathLive, so an entry reads here the way it reads in the menu.
import { type ButtonLabel, type Locale, View } from 'ckeditor5';

export default class MathLiveLabelView extends View implements ButtonLabel {
	declare public text: string | undefined;
	declare public id: string | undefined;
	declare public style: string | undefined;

	constructor( locale?: Locale ) {
		super( locale );

		const bind = this.bindTemplate;

		this.set( { text: undefined, id: undefined, style: undefined } );

		this.setTemplate( {
			tag: 'span',
			attributes: {
				// `ck-reset_all`, which every balloon carries, sets `position: static`,
				// `vertical-align: middle`, `margin: 0` and a font of its own on *every*
				// descendant. MathLive stacks a formula out of relatively positioned wrappers
				// offset by `top`, struts aligned by `vertical-align`, and inline tables — the
				// reset flattens all of it, and the pieces paint over the rows above. The
				// exclusion is CKEditor's own way out, and it covers the subtree.
				class: [ 'ck', 'ck-button__label', 'ck-math-live-label', 'ck-reset_all-excluded' ],
				style: bind.to( 'style' ),
				id: bind.to( 'id' )
			}
		} );

		this.on( 'change:text', () => this._renderText() );
	}

	public override render(): void {
		super.render();
		this._renderText();
	}

	private _renderText(): void {
		/* v8 ignore next 3 -- `change:text` cannot fire before the template is rendered: the view
		   is handed to a ButtonView, which renders it with itself */
		if ( !this.element ) {
			return;
		}

		this.element.innerHTML = this.text ?? '';
	}
}
