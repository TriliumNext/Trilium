import { ClassicEditor, Paragraph, _setModelData as setModelData } from 'ckeditor5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MermaidEditing from './mermaid_editing.js';
import { checkIsOn, debounce } from './utils.js';

/* global document */

describe( 'utils', () => {
	describe( 'debounce()', () => {
		beforeEach( () => {
			vi.useFakeTimers();
		} );

		afterEach( () => {
			vi.useRealTimers();
		} );

		it( 'defers the call until the wait elapses', () => {
			const spy = vi.fn();
			const debounced = debounce( spy, 50 );

			debounced( 'a' );

			expect( spy ).not.toHaveBeenCalled();

			vi.advanceTimersByTime( 50 );

			expect( spy ).toHaveBeenCalledTimes( 1 );
			expect( spy ).toHaveBeenCalledWith( 'a' );
		} );

		it( 'collapses a burst of calls into the last one', () => {
			const spy = vi.fn();
			const debounced = debounce( spy, 50 );

			debounced( 'first' );
			vi.advanceTimersByTime( 20 );
			// Lands inside the window, so the pending timeout is cleared and restarted.
			debounced( 'second' );
			vi.advanceTimersByTime( 20 );
			debounced( 'third' );
			vi.advanceTimersByTime( 50 );

			expect( spy ).toHaveBeenCalledTimes( 1 );
			expect( spy ).toHaveBeenCalledWith( 'third' );
		} );

		it( 'preserves the caller as `this`', () => {
			const calls: unknown[] = [];
			const debounced = debounce( function( this: unknown ) {
				calls.push( this );
			}, 10 );
			const host = { run: debounced };

			host.run();
			vi.advanceTimersByTime( 10 );

			expect( calls ).to.deep.equal( [ host ] );
		} );
	} );

	describe( 'checkIsOn()', () => {
		let domElement: HTMLDivElement, editor: ClassicEditor;

		beforeEach( async () => {
			domElement = document.createElement( 'div' );
			document.body.appendChild( domElement );

			editor = await ClassicEditor.create( domElement, {
				licenseKey: 'GPL',
				plugins: [ Paragraph, MermaidEditing ]
			} );
		} );

		afterEach( () => {
			domElement.remove();
			return editor.destroy();
		} );

		it( 'is true for the selected mermaid whose displayMode matches', () => {
			setModelData( editor.model, '[<mermaid displayMode="preview" source="foo"></mermaid>]' );

			expect( checkIsOn( editor, 'preview' ) ).to.equal( true );
		} );

		it( 'is false for the selected mermaid whose displayMode differs', () => {
			setModelData( editor.model, '[<mermaid displayMode="split" source="foo"></mermaid>]' );

			expect( checkIsOn( editor, 'preview' ) ).to.equal( false );
		} );

		it( 'is false when the selection is not on a mermaid at all', () => {
			setModelData( editor.model, '<paragraph>foo[]</paragraph>' );

			expect( checkIsOn( editor, 'preview' ) ).to.equal( false );
		} );
	} );
} );
