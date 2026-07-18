import $ from "jquery";
import { beforeEach,describe, expect, it, vi } from "vitest";

import dialog from "../../../services/dialog";

vi.mock("../../../services/utils", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        default: {
            ...actual.default,
            filterAttributeName: vi.fn((val: string) => val.replace(/[^\p{L}\p{N}_:]/gu, ""))
        }
    };
});

vi.mock("../../../services/dialog", () => ({
    default: {
        prompt: vi.fn()
    }
}));

vi.mock("../../../services/attribute_autocomplete", () => ({
    default: {
        initAttributeNameAutocomplete: vi.fn()
    }
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

// Call promptForRelationName and extract the $answer input element from the dialog's shown callback
async function getAnswerFromPrompt(): Promise<JQuery<HTMLInputElement>> {
    const { promptForRelationName } = await import("./utils");

    let $answer!: JQuery<HTMLInputElement>;

    vi.mocked(dialog.prompt).mockImplementation(({ shown }) => {
        document.body.innerHTML = '<div><form><label /><input type="text" /></form></div>';
        const input = document.querySelector("input") as HTMLInputElement;
        $answer = $(input) as JQuery<HTMLInputElement>;
        shown?.({
            $dialog: $(document.querySelector("div")!) as JQuery<HTMLDivElement>,
            $question: $(document.querySelector("label")!) as JQuery<HTMLLabelElement>,
            $answer,
            $form: $(document.querySelector("form")!) as JQuery<HTMLFormElement>
        });
        return Promise.resolve(null);
    });

    promptForRelationName();
    return $answer;
}

describe("IME composition handling - Chinese input (promptForRelationName)", () => {
    let input: HTMLInputElement;
    let $answer: JQuery<HTMLInputElement>;

    beforeEach(async () => {
        vi.clearAllMocks();
        $answer = await getAnswerFromPrompt();
        input = $answer[0] as HTMLInputElement;
    });

    it("does not filter intermediate Chinese characters during composition", () => {
        // user starts typing in Chinese IME
        input.dispatchEvent(new Event("compositionstart"));

        // intermediate IME states — these are pinyin keystrokes shown before final char
        input.value = "n";
        input.dispatchEvent(new Event("input"));
        input.value = "ni";
        input.dispatchEvent(new Event("input"));
        input.value = "nin";
        input.dispatchEvent(new Event("input"));
        input.value = "ning";
        input.dispatchEvent(new Event("input"));

        expect(input.value).toBe("ning");
    });

    it("preserves valid Unicode characters after IME composition ends", () => {
        input.dispatchEvent(new Event("compositionstart"));

        // intermediate pinyin
        input.value = "n";
        input.dispatchEvent(new Event("input"));
        input.value = "ni";
        input.dispatchEvent(new Event("input"));

        // user selects the Chinese character 你 from the IME picker
        input.value = "你";
        input.dispatchEvent(new Event("compositionend"));

        expect(input.value).toBe("你");
    });

    it("allows normal latin input after Chinese composition ends", () => {
        // first do a Chinese composition
        input.dispatchEvent(new Event("compositionstart"));
        input.value = "你";
        input.dispatchEvent(new Event("compositionend"));

        // then type normally in latin
        input.value = "hello";
        input.dispatchEvent(new Event("input"));

        expect(input.value).toBe("hello");
    });

    it("handles multiple Chinese characters in sequence", () => {
        // first character
        input.dispatchEvent(new Event("compositionstart"));
        input.value = "你";
        input.dispatchEvent(new Event("compositionend"));

        // second character
        input.dispatchEvent(new Event("compositionstart"));
        input.value = "好";
        input.dispatchEvent(new Event("compositionend"));

        expect(input.value).toBe("好");
    });
});
