import { Mermaid as MermaidDll, icons } from '../src/index.js';
import Mermaid from '../src/mermaid.js';

import infoIcon from './../theme/icons/info.svg?raw';
import insertMermaidIcon from './../theme/icons/insert.svg?raw';
import previewModeIcon from './../theme/icons/preview-mode.svg?raw';
import splitModeIcon from './../theme/icons/split-mode.svg?raw';
import sourceModeIcon from './../theme/icons/source-mode.svg?raw';
import { describe, it } from 'vitest';
import { expect } from 'vitest';

describe( 'CKEditor5 Mermaid DLL', () => {
	it( 'exports MermaidWidget', () => {
		expect( MermaidDll ).to.equal( Mermaid );
	} );

	describe( 'icons', () => {
		it( 'exports the "insertMermaidIcon" icon', () => {
			expect( icons.insertMermaidIcon ).to.equal( insertMermaidIcon );
		} );
		it( 'exports the "infoIcon" icon', () => {
			expect( icons.infoIcon ).to.equal( infoIcon );
		} );
		it( 'exports the "previewModeIcon" icon', () => {
			expect( icons.previewModeIcon ).to.equal( previewModeIcon );
		} );
		it( 'exports the "splitModeIcon" icon', () => {
			expect( icons.splitModeIcon ).to.equal( splitModeIcon );
		} );
		it( 'exports the "sourceModeIcon" icon', () => {
			expect( icons.sourceModeIcon ).to.equal( sourceModeIcon );
		} );
	} );
} );
