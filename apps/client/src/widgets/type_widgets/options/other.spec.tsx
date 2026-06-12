import { OptionNames } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../../test/mocks";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());

vi.mock("../../../services/toast", () => ({
    default: { showMessage: vi.fn(), showError: vi.fn() }
}));

vi.mock("../../../services/search", () => ({
    default: { searchForNotes: vi.fn(async () => []), searchForNoteIds: vi.fn(async () => []) }
}));

let electronFlag = false;
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => electronFlag
}));

import options from "../../../services/options";
import search from "../../../services/search";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { buildNote } from "../../../test/easy-froca";
import { renderComponent as renderShared, resetFroca } from "../../../test/render";
import OtherSettings from "./other";

// --- Render harness (mounts the real component inside the Trilium providers) ----------------------

function renderComponent() {
    return renderShared(<OtherSettings />).container;
}

function blur(el: Element, value: string) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = value;
    }
    el.dispatchEvent(new Event("focusout", { bubbles: true }));
}

function toggleSwitch(el: Element) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
}

function setOptions(values: Record<string, string>) {
    options.load({
        // TimeSelector reads & parses these — keep scales >= 1 so convertTime() doesn't throw.
        eraseEntitiesAfterTimeInSeconds: "3600",
        eraseEntitiesAfterTimeScale: "3600",
        eraseUnusedAttachmentsAfterSeconds: "3600",
        eraseUnusedAttachmentsAfterTimeScale: "3600",
        revisionSnapshotTimeInterval: "600",
        revisionSnapshotTimeIntervalTimeScale: "60",
        // Component-level options.
        searchEnableFuzzyMatching: "false",
        searchAutocompleteFuzzy: "false",
        customSearchEngineName: "",
        customSearchEngineUrl: "",
        disableTray: "false",
        revisionSnapshotNumberLimit: "10",
        allowedHtmlTags: JSON.stringify([ "b", "i" ]),
        redirectBareDomain: "false",
        showLoginInShareTheme: "false",
        checkForUpdates: "true",
        ...values
    } as Record<OptionNames, string>);
}

beforeEach(() => {
    electronFlag = false;
    setOptions({});
    resetFroca();
    vi.clearAllMocks();
    Object.assign(server, {
        get: vi.fn(async () => ({})),
        post: vi.fn(async () => undefined)
    });
    (search.searchForNotes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

// --- Top-level structure -------------------------------------------------------------------------

describe("OtherSettings (non-electron)", () => {
    it("renders the base sections and omits electron-only sections", () => {
        const root = renderComponent();
        const sections = root.querySelectorAll(".options-section");
        // Search, NoteErasure, AttachmentErasure, Revisions, HtmlImport, Share, Network = 7 sections.
        expect(sections.length).toBe(7);
        // No search-engine / tray rows when not in electron.
        expect(root.querySelector(".search-engine-templates")).toBeNull();
        expect(root.querySelector("input.switch-toggle[id^='tray-enabled']")).toBeNull();
    });

    it("renders the search toggles and the html-tags textarea seeded from JSON option", () => {
        const root = renderComponent();
        const toggles = root.querySelectorAll(".switch-toggle");
        // Search has 2 toggles; Share has 2; Network has 1 = 5 (no tray in non-electron).
        expect(toggles.length).toBe(5);
        const textarea = root.querySelector("textarea.allowed-html-tags");
        expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
        if (textarea instanceof HTMLTextAreaElement) {
            expect(textarea.value).toBe("b i");
        }
    });
});

// --- Search settings -----------------------------------------------------------------------------

describe("SearchSettings", () => {
    it("toggling fuzzy matching saves the option", async () => {
        const root = renderComponent();
        const firstToggle = root.querySelector(".switch-toggle");
        expect(firstToggle).toBeInstanceOf(HTMLInputElement);
        await act(async () => {
            if (firstToggle) toggleSwitch(firstToggle);
        });
        expect(server.put).toHaveBeenCalled();
    });
});

// --- Electron-only sections ----------------------------------------------------------------------

describe("OtherSettings (electron)", () => {
    beforeEach(() => { electronFlag = true; });

    it("renders the search-engine and tray sections", () => {
        const root = renderComponent();
        const sections = root.querySelectorAll(".options-section");
        // +SearchEngine +Tray = 9 sections.
        expect(sections.length).toBe(9);
        expect(root.querySelector(".search-engine-templates")).not.toBeNull();
    });

    it("renders predefined search-engine badges", () => {
        const root = renderComponent();
        const badges = root.querySelectorAll(".search-engine-templates .ext-badge");
        expect(badges.length).toBe(4);
    });

    it("clicking a search-engine badge saves both name and url", async () => {
        const root = renderComponent();
        const badge = root.querySelector(".search-engine-templates .ext-badge");
        expect(badge).not.toBeNull();
        await act(async () => {
            if (badge instanceof HTMLElement) badge.click();
        });
        // setCustomSearchEngineName + setCustomSearchEngineUrl → two option saves.
        expect((server.put as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("marks the badge as selected when its url matches the current option", () => {
        setOptions({ customSearchEngineUrl: "https://duckduckgo.com/?q={keyword}" });
        const root = renderComponent();
        const selected = root.querySelectorAll(".search-engine-templates .ext-badge.selected");
        expect(selected.length).toBe(1);
    });

    it("editing the custom name / url text boxes saves on blur", async () => {
        const root = renderComponent();
        const inputs = root.querySelectorAll("input.form-control[type='text']");
        expect(inputs.length).toBeGreaterThanOrEqual(2);
        await act(async () => {
            blur(inputs[0], "My Engine");
            blur(inputs[1], "https://example.com/?q={keyword}");
        });
        expect((server.put as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("toggling tray enabled inverts and saves disableTray", async () => {
        const root = renderComponent();
        const trayInput = root.querySelector("input.switch-toggle[id^='tray-enabled']");
        expect(trayInput).toBeInstanceOf(HTMLInputElement);
        await act(async () => {
            if (trayInput) toggleSwitch(trayInput);
        });
        expect(server.put).toHaveBeenCalled();
    });
});

// --- Erasure timeouts ----------------------------------------------------------------------------

describe("Erasure timeouts", () => {
    it("clicking 'erase deleted notes now' posts and shows a toast", async () => {
        const root = renderComponent();
        const buttons = root.querySelectorAll("button.option-row-link");
        expect(buttons.length).toBeGreaterThanOrEqual(2);
        await act(async () => {
            if (buttons[0] instanceof HTMLElement) buttons[0].click();
        });
        await act(async () => {});
        expect(server.post).toHaveBeenCalledWith("notes/erase-deleted-notes-now");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("clicking 'erase unused attachments now' posts and shows a toast", async () => {
        const root = renderComponent();
        const buttons = root.querySelectorAll("button.option-row-link");
        await act(async () => {
            if (buttons[1] instanceof HTMLElement) buttons[1].click();
        });
        await act(async () => {});
        expect(server.post).toHaveBeenCalledWith("notes/erase-unused-attachments-now");
        expect(toast.showMessage).toHaveBeenCalled();
    });
});

// --- Revision settings ---------------------------------------------------------------------------

describe("RevisionSettings", () => {
    function getLimitInput(root: HTMLElement) {
        return root.querySelector(".tn-number-unit-pair input.form-control");
    }

    it("saves a valid revision snapshot number limit on blur", async () => {
        const root = renderComponent();
        const input = getLimitInput(root);
        expect(input).toBeInstanceOf(HTMLInputElement);
        await act(async () => {
            if (input) blur(input, "5");
        });
        expect(server.put).toHaveBeenCalled();
    });

    it("accepts -1 (unlimited) as a valid value", async () => {
        const root = renderComponent();
        const input = getLimitInput(root);
        await act(async () => {
            if (input) blur(input, "-1");
        });
        expect(server.put).toHaveBeenCalled();
    });

    it("clamps a non-numeric / below-minimum revision limit to -1 via applyLimits before saving", async () => {
        const root = renderComponent();
        const input = getLimitInput(root);
        (server.put as ReturnType<typeof vi.fn>).mockClear();
        await act(async () => {
            // applyLimits (min=-1) turns "abc" into "-1", which is then a valid value.
            if (input) blur(input, "abc");
        });
        const calls = (server.put as ReturnType<typeof vi.fn>).mock.calls;
        const saved = calls.find(c => c[1] && typeof c[1] === "object" && "revisionSnapshotNumberLimit" in (c[1] as object));
        expect(saved).toBeTruthy();
        if (saved) {
            expect((saved[1] as Record<string, unknown>).revisionSnapshotNumberLimit).toBe(-1);
        }
    });

    it("clicking 'erase excess revisions' posts and shows a toast", async () => {
        const root = renderComponent();
        const buttons = root.querySelectorAll("button.option-row-link");
        // The third option-row-link button is the revisions one.
        await act(async () => {
            if (buttons[2] instanceof HTMLElement) buttons[2].click();
        });
        await act(async () => {});
        expect(server.post).toHaveBeenCalledWith("revisions/erase-all-excess-revisions");
        expect(toast.showMessage).toHaveBeenCalled();
    });
});

// --- HTML import tags ----------------------------------------------------------------------------

describe("HtmlImportTags", () => {
    it("parses the textarea on blur into a tag array (split on space/comma/newline)", async () => {
        const root = renderComponent();
        const textarea = root.querySelector("textarea.allowed-html-tags");
        expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
        await act(async () => {
            if (textarea) blur(textarea, "div, span\np  table");
        });
        const calls = (server.put as ReturnType<typeof vi.fn>).mock.calls;
        const saved = calls.find(c => c[1] && typeof c[1] === "object" && "allowedHtmlTags" in (c[1] as object));
        expect(saved).toBeTruthy();
        if (saved) {
            const payload = saved[1] as Record<string, string>;
            expect(JSON.parse(payload.allowedHtmlTags)).toEqual([ "div", "span", "p", "table" ]);
        }
    });

    it("the reset button restores the default allowed tags", async () => {
        const root = renderComponent();
        // The reset button is a plain react Button (not option-row-link).
        const resetButton = Array.from(root.querySelectorAll("button"))
            .find(b => !b.classList.contains("option-row-link"));
        expect(resetButton).toBeTruthy();
        await act(async () => {
            resetButton?.click();
        });
        const calls = (server.put as ReturnType<typeof vi.fn>).mock.calls;
        const saved = calls.find(c => c[1] && typeof c[1] === "object" && "allowedHtmlTags" in (c[1] as object));
        expect(saved).toBeTruthy();
        if (saved) {
            const payload = saved[1] as Record<string, string>;
            expect(Array.isArray(JSON.parse(payload.allowedHtmlTags))).toBe(true);
        }
    });
});

// --- Share settings ------------------------------------------------------------------------------

describe("ShareSettings", () => {
    function getRedirectToggle(root: HTMLElement) {
        return root.querySelector("input.switch-toggle[id^='redirect-bare-domain']");
    }

    it("toggling redirect off (value=false) just saves without searching", async () => {
        setOptions({ redirectBareDomain: "true" });
        const root = renderComponent();
        const toggle = getRedirectToggle(root);
        expect(toggle).toBeInstanceOf(HTMLInputElement);
        await act(async () => {
            if (toggle) toggleSwitch(toggle);
        });
        await act(async () => {});
        expect(search.searchForNotes).not.toHaveBeenCalled();
        expect(server.put).toHaveBeenCalled();
    });

    it("enabling redirect shows a success message when a shared share-root exists", async () => {
        const shared = buildNote({ id: "shareRoot1", title: "Shared Root" });
        vi.spyOn(shared, "isShared").mockReturnValue(true);
        (search.searchForNotes as ReturnType<typeof vi.fn>).mockResolvedValue([ shared ]);

        const root = renderComponent();
        const toggle = getRedirectToggle(root);
        await act(async () => {
            if (toggle) toggleSwitch(toggle);
        });
        await act(async () => {});
        expect(search.searchForNotes).toHaveBeenCalledWith("#shareRoot");
        expect(toast.showMessage).toHaveBeenCalled();
        expect(toast.showError).not.toHaveBeenCalled();
        expect(server.put).toHaveBeenCalled();
    });

    it("enabling redirect shows an error when a share-root exists but is not shared", async () => {
        const notShared = buildNote({ id: "shareRoot2", title: "Unshared Root" });
        vi.spyOn(notShared, "isShared").mockReturnValue(false);
        (search.searchForNotes as ReturnType<typeof vi.fn>).mockResolvedValue([ notShared ]);

        const root = renderComponent();
        const toggle = getRedirectToggle(root);
        await act(async () => {
            if (toggle) toggleSwitch(toggle);
        });
        await act(async () => {});
        expect(toast.showError).toHaveBeenCalled();
    });

    it("enabling redirect shows an error when there is no share-root at all", async () => {
        (search.searchForNotes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        const root = renderComponent();
        const toggle = getRedirectToggle(root);
        await act(async () => {
            if (toggle) toggleSwitch(toggle);
        });
        await act(async () => {});
        expect(toast.showError).toHaveBeenCalled();
    });

    it("toggling the show-login-in-share-theme option saves it", async () => {
        const root = renderComponent();
        const toggle = root.querySelector("input.switch-toggle[id^='show-login-in-share-theme']");
        expect(toggle).toBeInstanceOf(HTMLInputElement);
        await act(async () => {
            if (toggle) toggleSwitch(toggle);
        });
        expect(server.put).toHaveBeenCalled();
    });
});

// --- Network settings ----------------------------------------------------------------------------

describe("NetworkSettings", () => {
    it("toggling check-for-updates saves the option", async () => {
        const root = renderComponent();
        const toggle = root.querySelector("input.switch-toggle[id^='check-for-updates']");
        expect(toggle).toBeInstanceOf(HTMLInputElement);
        await act(async () => {
            if (toggle) toggleSwitch(toggle);
        });
        expect(server.put).toHaveBeenCalled();
    });
});
