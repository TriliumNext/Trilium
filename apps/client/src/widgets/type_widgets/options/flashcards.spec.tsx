import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    flashcardSettings: defaultSettings(),
    setFlashcardSettings: vi.fn(async (request: ReturnType<typeof defaultSettings>) => request),
    showMessage: vi.fn(),
    showError: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../services/toast", () => ({
    default: { showMessage: mocks.showMessage, showError: mocks.showError }
}));

vi.mock("../../../services/flashcards", () => ({
    default: {
        getSettings: async () => mocks.flashcardSettings,
        setSettings: mocks.setFlashcardSettings
    }
}));

vi.mock("./components/OptionsPageHeader", () => ({ default: () => <div className="header-stub" /> }));

import FlashcardSettings from "./flashcards";

let host: HTMLElement;

beforeEach(() => {
    mocks.flashcardSettings = defaultSettings();
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

describe("flashcard scheduling settings", () => {
    it("loads FSRS settings and saves edited values through the flashcard API", async () => {
        await open();

        changeInput("flashcard-request-retention", "85", "change");
        await flush();

        changeInput("flashcard-learning-steps", "5m, 20m 1h", "focusout");
        await flush();

        expect(mocks.setFlashcardSettings).toHaveBeenCalledWith({
            schedulerConfig: expect.objectContaining({ requestRetention: 0.85 })
        });
        expect(mocks.setFlashcardSettings).toHaveBeenCalledWith({
            schedulerConfig: expect.objectContaining({ learningSteps: [ "5m", "20m", "1h" ] })
        });
    });

    it("rejects invalid step values before calling the API", async () => {
        await open();

        changeInput("flashcard-learning-steps", "tomorrow", "focusout");
        await flush();

        expect(mocks.setFlashcardSettings).not.toHaveBeenCalled();
        expect(mocks.showError).toHaveBeenCalledWith("flashcards.settings_step_validation");
    });

    it("restores previous settings when saving fails", async () => {
        mocks.setFlashcardSettings.mockRejectedValueOnce(new Error("boom"));
        await open();

        changeInput("flashcard-request-retention", "85", "change");
        await flush();

        const retention = host.querySelector<HTMLInputElement>("input[id^='flashcard-request-retention-']");
        expect(retention?.value).toBe("90");
        expect(mocks.showError).toHaveBeenCalledWith("flashcards.settings_save_failed");
    });
});

async function open() {
    act(() => {
        render(<FlashcardSettings />, host);
    });
    await flush();
}

async function flush() {
    await act(async () => {});
}

function changeInput(name: string, value: string, event: string) {
    const input = host.querySelector<HTMLInputElement>(`input[id^='${name}-']`);

    act(() => {
        if (input) {
            input.value = value;
            input.dispatchEvent(new Event(event, { bubbles: true }));
        }
    });
}

function defaultSettings() {
    return {
        schedulerConfig: {
            requestRetention: 0.9,
            maximumInterval: 36500,
            enableFuzz: true,
            enableShortTerm: true,
            learningSteps: [ "1m", "10m" ],
            relearningSteps: [ "10m" ],
            weights: null
        }
    };
}
