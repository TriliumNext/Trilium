import { ButtonView, Locale } from 'ckeditor5';
import { describe, expect, it } from 'vitest';

import MathLiveLabelView from './mathlive_label_view.js';

describe( 'MathLiveLabelView', () => {
	function rendered(): MathLiveLabelView {
		const view = new MathLiveLabelView( new Locale() );
		view.render();
		return view;
	}

	it( 'renders its text as markup rather than as a text node', () => {
		const view = rendered();

		view.text = '<span class="ML__insert-template">x</span><span class="ML__insert-label">Name</span>';

		expect( view.element?.querySelectorAll( 'span' ) ).toHaveLength( 2 );
		expect( view.element?.querySelector( '.ML__insert-label' )?.textContent ).toBe( 'Name' );
	} );

	it( 'keeps up with later changes, and empties out for no text', () => {
		const view = rendered();

		view.text = '<b>one</b>';
		expect( view.element?.innerHTML ).toBe( '<b>one</b>' );

		view.text = '<i>two</i>';
		expect( view.element?.innerHTML ).toBe( '<i>two</i>' );

		view.text = undefined;
		expect( view.element?.innerHTML ).toBe( '' );
	} );

	it( 'renders text set before it, and carries CKEditor\'s own label class', () => {
		const view = new MathLiveLabelView( new Locale() );
		view.text = '<b>early</b>';
		view.render();

		expect( view.element?.innerHTML ).toBe( '<b>early</b>' );
		expect( view.element?.classList.contains( 'ck-button__label' ) ).toBe( true );
	} );

	it( 'opts its subtree out of the balloon\'s reset', () => {
		// `ck-reset_all` forces `position: static` and `vertical-align: middle` on every
		// descendant, which flattens the relatively positioned wrappers MathLive stacks a
		// formula out of. Without this class the pieces paint over whatever is above them.
		expect( rendered().element?.classList.contains( 'ck-reset_all-excluded' ) ).toBe( true );
	} );

	it( 'stands in for a ButtonView\'s own label view', () => {
		const label = new MathLiveLabelView( new Locale() );
		const button = new ButtonView( new Locale(), label );
		button.set( { withText: true, label: '<b>bold</b>' } );
		button.render();

		expect( button.labelView ).toBe( label );
		expect( label.element?.innerHTML ).toBe( '<b>bold</b>' );
	} );
} );
