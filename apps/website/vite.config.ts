import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { execFileSync } from "child_process";

import rootPackageJson from "../../package.json" with { type: "json" };
import { pickReleaseVersion } from "./src/release_version.ts";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    define: {
        // The test checkouts in CI carry no tags, and no spec reads the version.
        __RELEASE_VERSION__: JSON.stringify(mode === "test"
            ? rootPackageJson.version
            : pickReleaseVersion(rootPackageJson.version, listReleaseTags()))
    },
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
}));

/** The repository's `v*` tags; none when git or the tags are unavailable. */
function listReleaseTags(): string[] {
    try {
        return execFileSync("git", [ "tag", "--list", "v*" ], { encoding: "utf8" })
            .split("\n").filter(Boolean);
    } catch {
        return [];
    }
}
