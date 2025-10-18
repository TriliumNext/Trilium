import { describe, it, expect } from "vitest";
import { normalizeSharePathInput } from "./share_path_utils.js";

type TestCase<T extends (...args: any) => any> = [
    desc: string,
    fnParams: Parameters<T>,
    expected: ReturnType<T>
];

describe("ShareSettingsOptions", () => {

    describe("#normalizeSharePathInput", () => {

        const testCases: TestCase<typeof normalizeSharePathInput>[] = [
            [
                "should handle multiple trailing '/' and remove them completely",
                ["/trailingtest////"],
                "/trailingtest"
            ],
            [
                "should handle multiple starting '/' and replace them by a single '/'",
                ["////startingtest"],
                "/startingtest"
            ],
            [
                "should handle multiple starting & trailing '/' and replace them by a single '/'",
                ["////startingAndTrailingTest///"],
                "/startingAndTrailingTest"
            ],
            [
                "should not remove any '/' other than at the end or start of the input",
                ["/test/with/subpath"],
                "/test/with/subpath"
            ],
            [
                "should prepend the string with a '/' if it does not start with one",
                ["testpath"],
                "/testpath"
            ],
            [
                "should not change anything, if the string is a single '/'",
                ["/"],
                "/"
            ],
        ];

        testCases.forEach((testCase) => {
            const [desc, fnParams, expected] = testCase;
            it(desc, () => {
                const actual = normalizeSharePathInput(...fnParams);
                expect(actual).toStrictEqual(expected);
            });
        });


    })

})