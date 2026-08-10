/**
 * Entry point for the customisations bundled into the vendored pdf.js viewer (see
 * `scripts/build.ts`). Kept to the bare invocation so the logic in {@link ./bootstrap} can be
 * imported and tested; anything added here is unreachable from the unit tests.
 */
import { main } from "./bootstrap";

main();
