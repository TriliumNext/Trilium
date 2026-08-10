import { describe, expect, it } from "vitest";

import { SETUP_MARKER_FILE_NAME } from "./setup_marker.js";

describe("the setup marker", () => {
    it("is named the same for every build that has to find it", () => {
        // One build writes this file and the next start reads it, and those two need not be the
        // same version: renaming it strands the marker an older instance left behind, and the
        // wizard the user asked for silently never opens. It is a name on disk, not an internal
        // one, so it is pinned here rather than left to whoever edits the module next.
        expect(SETUP_MARKER_FILE_NAME).toBe("setup.json");
    });
});
