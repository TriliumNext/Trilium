import { describe, it, expect } from "vitest";
import mimeService from "./mime.js";

type TestCase<T extends (...args: any) => any, W> = [desc: string, fnParams: Parameters<T>, expected: W];

describe("#getMime", () => {
    // prettier-ignore
    const testCases: TestCase<typeof mimeService.getMime, string | false>[] = [
        [
            "Dockerfile should be handled correctly",
            ["Dockerfile"], "text/x-dockerfile"
        ],

        [
            "File extension ('.py')  that is defined in EXTENSION_TO_MIME",
            ["test.py"], "text/x-python"
        ],

        [
            "File extension ('.ts') that is defined in EXTENSION_TO_MIME",
            ["test.ts"], "text/x-typescript"
        ],

        [
            "File extension ('.excalidraw') that is defined in EXTENSION_TO_MIME",
            ["test.excalidraw"], "application/json"
        ],

        [
            "File extension ('.mermaid') that is defined in EXTENSION_TO_MIME",
            ["test.mermaid"], "text/vnd.mermaid"
        ],
        [
            "File extension ('.mermaid') that is defined in EXTENSION_TO_MIME",
            ["test.mmd"], "text/vnd.mermaid"
        ],

        [
            "File extension with inconsistent capitalization that is defined in EXTENSION_TO_MIME",
            ["test.gRoOvY"], "text/x-groovy"
        ],

        [
            "File extension that is not defined in EXTENSION_TO_MIME should use mimeTypes.lookup",
            ["test.zip"], "application/zip"
        ],

        [
            "MP4 videos are supported",
            ["video.mp4"], "video/mp4"
        ],

        [
            "unknown MIME type not recognized by mimeTypes.lookup",
            ["test.fake"], false
        ],
    ];

    testCases.forEach((testCase) => {
        const [testDesc, fnParams, expected] = testCase;
        it(`${testDesc}: '${fnParams} should return '${expected}'`, () => {
            const actual = mimeService.getMime(...fnParams);
            expect(actual, testDesc).toEqual(expected);
        });
    });
});

describe("#getType", () => {
    // prettier-ignore
    const testCases: TestCase<typeof mimeService.getType, string>[] = [
        [
            "w/ no import options set and mime type empty – it should return 'file'",
            [{}, ""], "file"
        ],

        [
            "w/ no import options set and non-text or non-code mime type – it should return 'file'",
            [{}, "application/zip"], "file"
        ],

        [
            "w/ import options set and an image mime type – it should return 'image'",
            [{}, "image/jpeg"], "image"
        ],

        [
            "w/ image mime type and codeImportedAsCode: true – it should still return 'image'",
            [{codeImportedAsCode: true}, "image/jpeg"], "image"
        ],

        [
            "w/ image mime type and textImportedAsText: true – it should still return 'image'",
            [{textImportedAsText: true}, "image/jpeg"], "image"
        ],

        [
            "w/ codeImportedAsCode: true and a mime type that is in CODE_MIME_TYPES – it should return 'code'",
            [{codeImportedAsCode: true}, "text/css"], "code"
        ],

        [
            "w/ codeImportedAsCode: false and a mime type that is in CODE_MIME_TYPES – it should return 'file' not 'code'",
            [{codeImportedAsCode: false}, "text/css"], "file"
        ],

        [
            "w/ textImportedAsText: true and 'text/html' mime type – it should return 'text'",
            [{textImportedAsText: true}, "text/html"], "text"
        ],

        [
            "w/ textImportedAsText: true and 'text/markdown' mime type – it should return 'text'",
            [{textImportedAsText: true}, "text/markdown"], "text"
        ],

        [
            "w/ textImportedAsText: true and 'text/x-markdown' mime type – it should return 'text'",
            [{textImportedAsText: true}, "text/x-markdown"], "text"
        ],

        [
            "w/ textImportedAsText: false and 'text/x-markdown' mime type – it should return 'file'",
            [{textImportedAsText: false}, "text/x-markdown"], "file"
        ],

        [
            "w/ codeImportedAsCode: true and 'text/markdown' mime type (override) – it should return 'code'",
            [{codeImportedAsCode: true}, "text/markdown"], "code"
        ],

        [
            "w/ codeImportedAsCode: true and 'application/javascript' mime type (override) – it should return 'code'",
            [{codeImportedAsCode: true}, "application/javascript"], "code"
        ],

        [
            "w/ textImportedAsText: false and 'text/html' mime type – it should return 'file'",
            [{textImportedAsText: false}, "text/html"], "file"
        ],

    ]

    testCases.forEach((testCase) => {
        const [desc, fnParams, expected] = testCase;
        it(desc, () => {
            const actual = mimeService.getType(...fnParams);
            expect(actual).toEqual(expected);
        });
    });
});

describe("#normalizeMimeType", () => {
    // prettier-ignore
    const testCases: TestCase<typeof mimeService.normalizeMimeType, string | undefined>[] = [

        [
            "empty mime should return undefined",
            [""], undefined
        ],
        [
            "a mime that's defined in CODE_MIME_TYPES should return the same mime",
            ["text/x-python"], "text/x-python"
        ],
        [
            "a mime (with capitalization inconsistencies) that's defined in CODE_MIME_TYPES should return the same mime in lowercase",
            ["text/X-pYthOn"], "text/x-python"
        ],
        [
            "a mime that's non defined in CODE_MIME_TYPES should return undefined",
            ["application/zip"], undefined
        ],
        [
            "a mime that's defined in CODE_MIME_TYPES with a 'rewrite rule' should return the rewritten mime",
            ["text/markdown"], "text/x-markdown"
        ]
    ];

    testCases.forEach((testCase) => {
        const [desc, fnParams, expected] = testCase;
        it(desc, () => {
            const actual = mimeService.normalizeMimeType(...fnParams);
            expect(actual).toEqual(expected);
        });
    });
});
