import { trimIndentation } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { buildNote } from "../test/becca_easy_mocking";
import { buildRewardMap } from "./similarity";

describe("buildRewardMap", () => {
    it("calculates heading rewards", () => {
        const note = buildNote({
            content: trimIndentation`\
                <h1>Heading 1</h1>
                <h2>Heading 2</h2>
                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer eget purus et eros faucibus dignissim. Vestibulum lacinia urna quis eleifend consectetur. Aenean elementum pellentesque ultrices. Donec tincidunt, felis vel pretium suscipit, nibh lorem gravida est, quis tincidunt metus nibh a tortor. Aenean erat libero, faucibus ac mattis non, imperdiet eget nunc. Pellentesque aliquam molestie nibh eu interdum. Sed augue velit, varius id lacinia ut, dictum in dolor. Praesent posuere quam vel porta eleifend. Nullam porta tempus convallis. Aliquam auctor dui nec consectetur suscipit. Mauris laoreet commodo dapibus. Donec sodales justo velit, at placerat nulla cursus sit amet. Aliquam erat volutpat. Donec nec mauris iaculis, ullamcorper lectus et, feugiat arcu. Nunc vel ligula quis lectus efficitur porta non at nulla.</p>
                <h3>Heading 3</h3>
            `
        });
        const map = buildRewardMap(note);
        for (const key of [ "new", "note", "heading", "1", "2", "3" ]) {
            expect(typeof map.get(key)).toStrictEqual("number");
        }
    });
});
