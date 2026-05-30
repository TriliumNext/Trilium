/**
 * @license Copyright (c) 2023-2024, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md.
 */

import { defineConfig } from 'vitest/config';
import svg from 'vite-plugin-svgo';
import { webdriverio } from "@vitest/browser-webdriverio";

export default defineConfig( {
	plugins: [
		svg()
	],
	test: {
		browser: {
			enabled: true,
			provider: webdriverio(),
			headless: true,
			ui: false,
			instances: [ { browser: 'chrome' } ]
		},
		include: [
			'tests/**/*.[jt]s'
		],
		globals: true,
		watch: false,
		passWithNoTests: true,
		coverage: {
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100
			},
			provider: 'v8',
			include: [ 'src/**/*.{ts,tsx}' ],
			exclude: [ '**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}', '**/*.d.ts' ],
			reporter: [ 'text', 'lcov' ]
		}
	}
} );
