/*
 * dayjs declares the plugin typings (and the Dayjs interface augmentations) under the suffix-less
 * ambient module names, which bundler-resolution consumers (e.g. the client) can only load through
 * these bare specifiers. The runtime imports in dayjs.ts must use the .js suffix instead, to
 * satisfy nodenext module resolution.
 *
 * This module exists so that the bare specifiers stay out of the runtime module graph: dayjs.ts
 * pulls it in with a type-only import, which is erased from the emitted JavaScript. Importing it
 * as a regular module would make Vite bundle every plugin twice (once per specifier spelling).
 */
import "dayjs/plugin/advancedFormat";
import "dayjs/plugin/duration";
import "dayjs/plugin/isBetween";
import "dayjs/plugin/isoWeek";
import "dayjs/plugin/isSameOrAfter";
import "dayjs/plugin/isSameOrBefore";
import "dayjs/plugin/quarterOfYear";
import "dayjs/plugin/relativeTime";
import "dayjs/plugin/utc";
