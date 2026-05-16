import { describe, expect, it } from "vitest";

import NodejsInAppHelpProvider from "../in_app_help_provider.js";
import type NoteMeta from "./meta/note_meta.js";

const provider = new NodejsInAppHelpProvider();

describe("In-app help", () => {
    it("preserves custom folder icon", () => {
        const meta: NoteMeta = {
            isClone: false,
            noteId: "yoAe4jV2yzbd",
            notePath: [ "OkOZllzB3fqN", "yoAe4jV2yzbd" ],
            title: "Features",
            notePosition: 40,
            prefix: null,
            isExpanded: false,
            type: "text",
            mime: "text/html",
            attributes: [
                {
                    type: "label",
                    name: "iconClass",
                    value: "bx bx-star",
                    isInheritable: false,
                    position: 10
                }
            ],
            format: "html",
            attachments: [],
            dirFileName: "Features",
            children: []
        };

        const item = provider.parseNoteMeta(meta, "/");
        const icon = item?.attributes?.find((a) => a.name === "iconClass");
        expect(icon?.value).toBe("bx bx-star");
    });

    it("hides note that is hidden from share tree", () => {
        const meta: NoteMeta = {
            isClone: false,
            noteId: "yoAe4jV2yzbd",
            notePath: [ "OkOZllzB3fqN", "yoAe4jV2yzbd" ],
            title: "Features",
            notePosition: 40,
            prefix: null,
            isExpanded: false,
            type: "text",
            mime: "text/html",
            attributes: [
                {
                    type: "label",
                    name: "shareHiddenFromTree",
                    value: "",
                    isInheritable: false,
                    position: 10
                }
            ],
            format: "html",
            attachments: [],
            dirFileName: "Features",
            children: []
        };

        const item = provider.parseNoteMeta(meta, "/");
        expect(item).toBeFalsy();
    });
});
