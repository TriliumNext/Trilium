import { beforeAll, describe, expect, it, vi } from "vitest";

import BNote from '../../becca/entities/bnote.js';
import cls from "../../services/cls";
import { buildNote } from "../../test/becca_easy_mocking";
import { processContent } from "./clipper";

let note!: BNote;

describe("processContent", () => {
    beforeAll(() => {
        note = buildNote({
            content: "Hi there"
        });
        note.saveAttachment = () => {};
        vi.mock("../../services/image.js", () => ({
            default: {
                saveImageToAttachment() {
                    return {
                        attachmentId: "foo",
                        title: "encodedTitle",
                    };
                }
            }
        }));
    });

    it("processes basic note", () => {
        const processed = cls.init(() => processContent([], note, "<p>Hello world.</p>"));
        expect(processed).toStrictEqual("<p>Hello world.</p>");
    });

    it("processes plain text", () => {
        const processed = cls.init(() => processContent([], note, "Hello world."));
        expect(processed).toStrictEqual("<p>Hello world.</p>");
    });

    it("replaces images", () => {
        const processed = cls.init(() => processContent(
            [{"imageId":"OKZxZA3MonZJkwFcEhId","src":"inline.png","dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAQCAYAAADESFVDAAAAF0lEQVQoU2P8DwQMBADjqKLRIGAgKggAzHs/0SoYCGwAAAAASUVORK5CYII="}],
            note, `<img src="OKZxZA3MonZJkwFcEhId">`
        ));
        expect(processed).toStrictEqual(`<img src="api/attachments/foo/image/encodedTitle" >`);
    });

    it("skips over non-data images", () => {
        for (const url of [ "foo", "" ]) {
            const processed = cls.init(() => processContent(
                [{"imageId":"OKZxZA3MonZJkwFcEhId","src":"inline.png","dataUrl": url}],
                note, `<img src="OKZxZA3MonZJkwFcEhId">`
            ));
            expect(processed).toStrictEqual(`<img src="OKZxZA3MonZJkwFcEhId" >`);
        }
    });
});
