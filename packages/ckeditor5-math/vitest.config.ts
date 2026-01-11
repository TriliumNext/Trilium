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
		exclude: [
			'tests/setup.ts'
		],
		globals: true,
		watch: false,
		coverage: {
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100
			},
			provider: 'istanbul',
			include: [
				'src'
			]
		}
	}
} );
