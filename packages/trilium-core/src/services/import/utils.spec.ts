import { describe, it, expect } from "vitest";
import importUtils from "./utils.js";

type TestCase<T extends (...args: any) => any> = [desc: string, fnParams: Parameters<T>, expected: ReturnType<T>];

describe("#extractHtmlTitle", () => {
    const htmlWithNoTitle = `
  <html>
    <body>
      <div>abc</div>
    </body>
  </html>`;

    const htmlWithTitle = `
  <html><head>
    <title>Test Title</title>
  </head>
  <body>
    <div>abc</div>
  </body>
  </html>`;

    const htmlWithTitleWOpeningBracket = `
  <html><head>
  <title>Test < Title</title>
  </head>
  <body>
    <div>abc</div>
  </body>
  </html>`;

    // prettier-ignore
    const testCases: TestCase<typeof importUtils.extractHtmlTitle>[] = [
        [
            "w/ existing <title> tag, it should return the content of the title tag",
            [htmlWithTitle],
            "Test Title"
        ],
        [
            // @TriliumNextTODO: this seems more like an unwanted behaviour to me – check if this needs rather fixing
            "with existing <title> tag, that includes an opening HTML tag '<', it should return null",
            [htmlWithTitleWOpeningBracket], 
            null
        ],
        [
            "w/o an existing <title> tag, it should reutrn null",
            [htmlWithNoTitle],
            null
        ],
        [
            "w/ empty string content, it should return null",
            [""],
            null
        ]
    ];

    testCases.forEach((testCase) => {
        const [desc, fnParams, expected] = testCase;
        return it(desc, () => {
            const actual = importUtils.extractHtmlTitle(...fnParams);
            expect(actual).toStrictEqual(expected);
        });
    });
});

describe("#handleH1", () => {
    // prettier-ignore
    const testCases: TestCase<typeof importUtils.handleH1>[] = [
        [
            "w/ single <h1> tag w/ identical text content as the title tag: the <h1> tag should be stripped",
            ["<h1>Title</h1>", "Title"],
            ""
        ],
        [
            "w/ multiple <h1> tags, with the fist matching the title tag: the first <h1> tag should be stripped and subsequent tags converted to <h2>",
            ["<h1>Title</h1><h1>Header 1</h1><h1>Header 2</h1>", "Title"],
            "<h2>Header 1</h2><h2>Header 2</h2>"
        ],
        [
            "w/ no <h1> tag and only <h2> tags, it should not cause any changes and return the same content",
            ["<h2>Heading 1</h2><h2>Heading 2</h2>", "Title"],
            "<h2>Heading 1</h2><h2>Heading 2</h2>"
        ],
        [
            "w/ multiple <h1> tags, and the 1st matching the title tag, it should strip ONLY the very first occurence of the <h1> tags in the returned content",
            ["<h1>Topic ABC</h1><h1>Heading 1</h1><h1>Topic ABC</h1>", "Topic ABC"],
            "<h2>Heading 1</h2><h2>Topic ABC</h2>"
        ],
        [
            "w/ multiple <h1> tags, and the 1st matching NOT the title tag, it should NOT strip any other <h1> tags",
            ["<h1>Introduction</h1><h1>Topic ABC</h1><h1>Summary</h1>", "Topic ABC"],
            "<h2>Introduction</h2><h2>Topic ABC</h2><h2>Summary</h2>"
        ],
        [
            "w/ a content <h1> followed by an <h2>, it should shift the hierarchy down instead of collapsing both onto <h2> (#8383)",
            ["<h1>Main</h1><h2>Sub</h2>", "Title"],
            "<h2>Main</h2><h3>Sub</h3>"
        ],
        [
            "w/ the 1st <h1> matching the title and a remaining content <h1>, it should strip the title and shift the rest",
            ["<h1>Title</h1><h1>Chapter</h1><h2>Section</h2>", "Title"],
            "<h2>Chapter</h2><h3>Section</h3>"
        ],
        [
            "w/ the 1st <h1> matching the title and only <h2> content remaining, it should strip the title without shifting",
            ["<h1>Title</h1><h2>Section</h2>", "Title"],
            "<h2>Section</h2>"
        ],
        [
            "w/ headings deeper than <h2>, the shift should clamp at <h6>",
            ["<h1>A</h1><h2>B</h2><h6>C</h6>", "Title"],
            "<h2>A</h2><h3>B</h3><h6>C</h6>"
        ],
        [
            "w/ a content <h1> containing inline markup, it should still be demoted and shifted",
            ["<h1>Chapter <em>One</em></h1><h2>Intro</h2>", "Doc"],
            "<h2>Chapter <em>One</em></h2><h3>Intro</h3>"
        ],
        [
            "w/ a content <h1> carrying attributes, the attributes should be preserved on the demoted <h2>",
            [`<h1 id="top">Main</h1><h2>Sub</h2>`, "Doc"],
            `<h2 id="top">Main</h2><h3>Sub</h3>`
        ]
    ];

    testCases.forEach((testCase) => {
        const [desc, fnParams, expected] = testCase;
        return it(desc, () => {
            const actual = importUtils.handleH1(...fnParams);
            expect(actual).toStrictEqual(expected);
        });
    });
});
