import { Math as MathDll, AutoformatMath as AutoformatMathDll } from '../src';
import Math from '../src/math';
import AutoformatMath from '../src/autoformatmath';
import { describe, it, expect } from 'vitest';

// Suppress MathLive errors during async cleanup in tests
if (typeof window !== 'undefined') {
	window.addEventListener('unhandledrejection', event => {
		if (event.reason?.message?.includes('options') || event.reason?.message?.includes('mathlive')) {
			event.preventDefault();
		}
	});
	window.addEventListener('error', event => {
		if (event.message?.includes('options') || event.message?.includes('mathlive')) {
			event.preventDefault();
		}
	});
}

describe( 'CKEditor5 Math DLL', () => {
	it( 'exports Math', () => {
		expect( MathDll ).to.equal( Math );
	} );

	it( 'exports AutoformatMath', () => {
		expect( AutoformatMathDll ).to.equal( AutoformatMath );
	} );
} );
