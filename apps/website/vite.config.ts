import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		preact({
			prerender: {
				enabled: true,
				renderTarget: '#app',
				additionalPrerenderRoutes: [
                    '/404',
                    '/get-started',
                    '/resources',
                    '/support-us'
                ],
				previewMiddlewareEnabled: true,
				previewMiddlewareFallback: '/404',
			},
		}),
	],
    test: {
        environment: "happy-dom",
        coverage: {
            provider: "v8",
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}", "**/*.d.ts"],
            reporter: ["text", "lcov"],
            reportsDirectory: "./test-output/vitest/coverage"
        }
    }
});
