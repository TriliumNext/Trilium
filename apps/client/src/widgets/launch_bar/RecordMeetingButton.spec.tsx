import type { TranscriptionState } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import { renderInto } from "../../test/render";

const mocks = vi.hoisted(() => ({
    getInboxNote: vi.fn(),
    createNote: vi.fn(),
    showError: vi.fn(),
    requireResources: vi.fn(),
    transcriptionModel: null as string | null,
    speakersEnabled: true,
    transcriptionEnabled: true,
    keepRecordings: false,
    isSupported: vi.fn()
}));

vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useTriliumOptionBool: (name: string) => [
        (name === "transcriptionEnabled" && mocks.transcriptionEnabled)
            || (name === "transcriptionKeepRecordings" && mocks.keepRecordings),
        vi.fn()
    ]
}));

vi.mock("../../services/date_notes", () => ({
    default: { getInboxNote: mocks.getInboxNote }
}));
vi.mock("../../services/note_create", () => ({
    default: { createNote: mocks.createNote }
}));
vi.mock("../../services/dialog", () => ({
    requireResources: mocks.requireResources
}));
vi.mock("../../services/options", () => ({
    default: {
        get: (name: string) => name === "transcriptionModel" ? mocks.transcriptionModel : null,
        is: (name: string) => name === "transcriptionSpeakersEnabled" && mocks.speakersEnabled
    }
}));
vi.mock("../../services/toast", () => ({
    default: { showError: mocks.showError }
}));
vi.mock("../../services/i18n", () => ({
    t: (key: string, options?: { date?: string }) => `${key} ${options?.date}`
}));
vi.mock("./launch_bar_widgets", () => ({
    LaunchBarActionButton: ({ icon, text, disabled, onClick }: {
        icon: string; text: string; disabled?: boolean; onClick: () => void;
    }) => <button className={icon} disabled={disabled} onClick={onClick}>{text}</button>,
    useLauncherIconAndTitle: () => ({ icon: "bx bx-microphone", title: "Record meeting" }),
    useLaunchBarTitlePosition: () => "right"
}));

import RecordMeetingButton, {
    createMeetingNote, formatElapsed, toggleRecording
} from "./RecordMeetingButton";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.transcriptionModel = null;
    mocks.speakersEnabled = true;
    mocks.transcriptionEnabled = true;
    mocks.keepRecordings = false;
    mocks.isSupported.mockResolvedValue(true);
    vi.useFakeTimers({ now: new Date(2026, 9, 13, 14, 30), toFake: [ "Date" ] });
});

describe("createMeetingNote", () => {
    it("creates a labeled text note titled with the date and time in the inbox", async () => {
        mocks.getInboxNote.mockResolvedValue({ noteId: "inbox", isProtected: true });

        await createMeetingNote();

        expect(mocks.createNote).toHaveBeenCalledExactlyOnceWith("inbox", {
            title: "record_meeting.note_title 2026-10-13 14:30",
            type: "text",
            isProtected: true,
            focus: "content",
            attributes: [ { type: "label", name: "meetingRecording", value: "" } ]
        });
    });

    it("creates nothing without an inbox note", async () => {
        mocks.getInboxNote.mockResolvedValue(null);
        vi.spyOn(console, "warn").mockImplementation(() => {});

        await createMeetingNote();

        expect(mocks.createNote).not.toHaveBeenCalled();
    });
});

describe("toggleRecording", () => {
    const transcription = { start: vi.fn(), stop: vi.fn() };

    beforeEach(() => {
        window.electronApi = { transcription } as unknown as typeof window.electronApi;
        mocks.getInboxNote.mockResolvedValue({ noteId: "inbox", isProtected: false });
        mocks.createNote.mockResolvedValue({ note: { noteId: "meeting" } });
        mocks.requireResources.mockResolvedValue(true);
    });

    it("starts recording into a new meeting note, and shows why it could not", async () => {
        transcription.start.mockResolvedValueOnce("");
        expect(await toggleRecording("idle")).toBe(true);
        expect(transcription.start).toHaveBeenCalledExactlyOnceWith("meeting");
        expect(mocks.showError).not.toHaveBeenCalled();

        transcription.start.mockResolvedValueOnce("No speech model");
        expect(await toggleRecording("idle")).toBe(false);
        expect(mocks.showError).toHaveBeenCalledExactlyOnceWith("No speech model");
        expect(mocks.createNote).toHaveBeenCalledTimes(2);
    });

    it("stops a running recording, and leaves one that is starting or stopping alone", async () => {
        expect(await toggleRecording("recording")).toBe(false);
        await toggleRecording("starting");
        await toggleRecording("stopping");

        expect(transcription.stop).toHaveBeenCalledOnce();
        expect(transcription.start).not.toHaveBeenCalled();
        expect(mocks.createNote).not.toHaveBeenCalled();
    });

    it("asks for the model first, and creates no note when it is not downloaded", async () => {
        await toggleRecording("idle");
        expect(mocks.requireResources).toHaveBeenCalledExactlyOnceWith(
            [ "transcription.parakeet", "transcription.silero-vad", "transcription.titanet" ]);
        expect(transcription.start).toHaveBeenCalledOnce();

        mocks.requireResources.mockResolvedValueOnce(false);
        await toggleRecording("idle");
        expect(mocks.createNote).toHaveBeenCalledOnce();
        expect(transcription.start).toHaveBeenCalledOnce();
    });

    it("asks for the model the settings select", async () => {
        mocks.transcriptionModel = "parakeet-fp32";
        await toggleRecording("idle");
        expect(mocks.requireResources).toHaveBeenCalledExactlyOnceWith(
            [ "transcription.parakeet-fp32", "transcription.silero-vad", "transcription.titanet" ]);
    });

    it("leaves the speaker model out while speaker identification is off", async () => {
        mocks.speakersEnabled = false;
        await toggleRecording("idle");
        expect(mocks.requireResources).toHaveBeenCalledExactlyOnceWith(
            [ "transcription.parakeet", "transcription.silero-vad" ]);
    });

    it("starts nothing when no meeting note could be created", async () => {
        mocks.getInboxNote.mockResolvedValue(null);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await toggleRecording("idle");
        expect(transcription.start).not.toHaveBeenCalled();
    });

    it("does nothing outside the desktop app", async () => {
        window.electronApi = undefined;
        await toggleRecording("idle");
        expect(mocks.createNote).not.toHaveBeenCalled();
    });
});

describe("formatElapsed", () => {
    it("counts minutes and seconds within the first hour, then hours and minutes", () => {
        expect(formatElapsed(0)).toBe("0:00");
        expect(formatElapsed(65_000)).toBe("1:05");
        expect(formatElapsed(3_599_999)).toBe("59:59");
        expect(formatElapsed(3_600_000)).toBe("1:00");
        expect(formatElapsed(3_727_000)).toBe("1:02");
        expect(formatElapsed(-5_000)).toBe("0:00");
    });
});

describe("RecordMeetingButton", () => {
    async function renderWithState(state: Partial<TranscriptionState>) {
        window.electronApi = {
            transcription: {
                isSupported: mocks.isSupported,
                getState: async () => ({
                    status: "idle", noteId: null, pendingSources: [], ...state
                }),
                onStateChanged: () => () => {}
            }
        } as unknown as typeof window.electronApi;
        let container: HTMLElement | undefined;
        await act(async () => {
            container = renderInto(<RecordMeetingButton launcherNote={{} as FNote} />);
        });
        return container;
    }

    it("shows how long it has been recording in place of the beta badge", async () => {
        vi.useFakeTimers({ now: new Date(2026, 9, 13, 14, 30) });
        const container = await renderWithState({
            status: "recording", noteId: "meeting", startedAt: Date.now() - 65_000
        });
        const badge = () => container?.querySelector(".record-meeting-launcher .ext-badge");
        // Preact runs effects after paint, which the fake clock schedules.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50);
        });

        expect(badge()?.className).toContain("record-meeting-time-badge");
        expect(badge()?.textContent).toBe("1:05");
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(badge()?.textContent).toBe("1:06");
        window.electronApi = undefined;
    });

    it("says before a recording that its audio will be kept, while recordings are kept", async () => {
        const button = async () => (await renderWithState({ status: "idle" }))?.querySelector("button");

        expect((await button())?.textContent).toBe("Record meeting");
        mocks.keepRecordings = true;
        expect((await button())?.textContent).toContain("record_meeting.title_keeping_recordings");
        window.electronApi = undefined;
    });

    it("shows no badge while the recording starts", async () => {
        const container = await renderWithState({ status: "starting", noteId: "meeting" });
        expect(container?.querySelector(".record-meeting-launcher .ext-badge")).toBeNull();
        window.electronApi = undefined;
    });

    it("shows nothing while transcription is turned off or the computer cannot transcribe", async () => {
        expect((await renderWithState({ status: "idle" }))?.querySelector("button")).not.toBeNull();
        expect(mocks.isSupported).toHaveBeenCalledOnce();

        mocks.transcriptionEnabled = false;
        const turnedOff = await renderWithState({ status: "idle" });
        expect(turnedOff?.querySelector(".record-meeting-launcher")).toBeNull();
        expect(turnedOff?.querySelector("button")).toBeNull();
        expect(mocks.isSupported).toHaveBeenCalledOnce();

        mocks.transcriptionEnabled = true;
        mocks.isSupported.mockResolvedValue(false);
        expect((await renderWithState({ status: "idle" }))?.querySelector("button")).toBeNull();
        window.electronApi = undefined;
        expect(renderInto(<RecordMeetingButton launcherNote={{} as FNote} />).querySelector("button"))
            .toBeNull();
    });

    it("keeps the stop button while a recording outlasts turning transcription off", async () => {
        mocks.transcriptionEnabled = false;
        for (const status of [ "starting", "recording", "stopping" ] as const) {
            const container = await renderWithState({ status, noteId: "meeting" });
            expect(container?.querySelector(".record-meeting-launcher button"), status)
                .not.toBeNull();
        }
        window.electronApi = undefined;
    });

    it("marks the launcher as beta", async () => {
        const container = await renderWithState({ status: "idle" });
        expect(container?.querySelector(".record-meeting-launcher .record-meeting-beta-badge")?.textContent)
            .toContain("common.beta");
        window.electronApi = undefined;
    });

    it("says once why a recording stopped by itself", async () => {
        let onStateChanged: (state: TranscriptionState) => void = () => {};
        const report = (state: Partial<TranscriptionState>) => act(() => onStateChanged({
            status: "idle", noteId: null, pendingSources: [], ...state
        }));
        window.electronApi = {
            transcription: {
                isSupported: async () => true,
                getState: async () => ({ status: "idle", noteId: null, pendingSources: [] }),
                onStateChanged: (callback: typeof onStateChanged) => {
                    onStateChanged = callback;
                    return () => {};
                }
            }
        } as unknown as typeof window.electronApi;
        act(() => {
            renderInto(<RecordMeetingButton launcherNote={{} as FNote} />);
        });

        await report({ status: "recording", noteId: "meeting" });
        await report({ error: "Stopped unexpectedly" });
        await report({ error: "Stopped unexpectedly", pendingSources: [] });
        expect(mocks.showError).toHaveBeenCalledExactlyOnceWith("Stopped unexpectedly");

        await report({ status: "recording", noteId: "meeting" });
        await report({ error: "Stopped unexpectedly" });
        expect(mocks.showError).toHaveBeenCalledTimes(2);
        window.electronApi = undefined;
    });

    it("says once why each source is not transcribed, and marks the time", async () => {
        let onStateChanged: (state: TranscriptionState) => void = () => {};
        const recording: TranscriptionState = {
            status: "recording", noteId: "meeting", pendingSources: [], startedAt: Date.now()
        };
        const report = (state: Partial<TranscriptionState>) =>
            act(() => onStateChanged({ ...recording, ...state }));
        window.electronApi = {
            transcription: {
                isSupported: async () => true,
                getState: async () => recording,
                onStateChanged: (callback: typeof onStateChanged) => {
                    onStateChanged = callback;
                    return () => {};
                }
            }
        } as unknown as typeof window.electronApi;
        let container: HTMLElement | null = null;
        await act(async () => {
            container = renderInto(<RecordMeetingButton launcherNote={{} as FNote} />);
        });
        const badge = () => (container as HTMLElement | null)
            ?.querySelector(".record-meeting-time-badge");
        const button = () => (container as HTMLElement | null)?.querySelector("button");

        await vi.waitFor(() => expect(badge()).not.toBeNull());
        expect(badge()?.classList.contains("has-issue")).toBe(false);
        await report({ sourceIssues: { system: "not_captured" } });
        await report({ sourceIssues: { system: "not_captured" } });
        expect(badge()?.classList.contains("has-issue")).toBe(true);
        expect(button()?.textContent).toContain("record_meeting.stop_with_issue");
        expect(mocks.showError).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining("record_meeting.not_captured_system"));

        await report({});
        expect(badge()?.classList.contains("has-issue")).toBe(false);
        expect(button()?.textContent).not.toContain("stop_with_issue");
        await report({ sourceIssues: { microphone: "no_audio", system: "silent" } });
        await report({ sourceIssues: { microphone: "silent", system: "silent" } });
        const keys = mocks.showError.mock.calls.map(([ message ]) => String(message).split(" ")[0]);
        expect(keys).toEqual([
            "record_meeting.not_captured_system",
            "record_meeting.no_audio_microphone",
            "record_meeting.silent_system",
            "record_meeting.silent_microphone"
        ]);
        window.electronApi = undefined;
    });

    it("reminds to ask for consent once its own click starts a recording", async () => {
        let onStateChanged: (state: TranscriptionState) => void = () => {};
        const report = (state: Partial<TranscriptionState>) => act(() => onStateChanged({
            status: "recording", noteId: "meeting", pendingSources: [], ...state
        }));
        const transcription = {
            isSupported: async () => true,
            getState: async () => ({ status: "idle", noteId: null, pendingSources: [] }),
            onStateChanged: (callback: typeof onStateChanged) => {
                onStateChanged = callback;
                return () => {};
            },
            start: vi.fn(async () => {
                onStateChanged({ status: "recording", noteId: "meeting", pendingSources: [] });
                return "";
            }),
            stop: vi.fn(async () => {})
        };
        window.electronApi = { transcription } as unknown as typeof window.electronApi;
        mocks.getInboxNote.mockResolvedValue({ noteId: "inbox", isProtected: false });
        mocks.createNote.mockResolvedValue({ note: { noteId: "meeting" } });
        mocks.requireResources.mockResolvedValue(true);
        let container: HTMLElement | null = null;
        await act(async () => {
            container = renderInto(<RecordMeetingButton launcherNote={{} as FNote} />);
        });
        const button = () => (container as HTMLElement | null)?.querySelector("button");
        const reminder = () => document.body.querySelector(".record-meeting-consent");
        const start = async () => {
            await vi.waitFor(() => expect(button()?.className).toBe("bx bx-microphone"));
            await act(async () => button()?.click());
            await vi.waitFor(() => expect(reminder()).not.toBeNull());
        };

        await report({ status: "idle", noteId: null });
        await report({});
        expect(reminder()).toBeNull();
        await report({ status: "idle", noteId: null });

        await start();
        expect(reminder()?.textContent).toContain("record_meeting.consent");
        expect(reminder()?.textContent).not.toContain("keeping");
        act(() => {
            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        });
        expect(reminder()).not.toBeNull();
        act(() => reminder()?.querySelector<HTMLElement>(".record-meeting-consent-body")?.click());
        expect(reminder()).toBeNull();

        await report({ status: "idle", noteId: null });
        mocks.keepRecordings = true;
        await start();
        expect(reminder()?.textContent).toContain("record_meeting.consent_keeping_recordings");
        await report({ status: "stopping" });
        expect(reminder()).toBeNull();
        window.electronApi = undefined;
    });

    it("closes the consent reminder by itself after 10 seconds", async () => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout", "Date" ] });
        let onStateChanged: (state: TranscriptionState) => void = () => {};
        window.electronApi = {
            transcription: {
                isSupported: async () => true,
                getState: async () => ({ status: "idle", noteId: null, pendingSources: [] }),
                onStateChanged: (callback: typeof onStateChanged) => {
                    onStateChanged = callback;
                    return () => {};
                },
                start: async () => {
                    onStateChanged({ status: "recording", noteId: "meeting", pendingSources: [] });
                    return "";
                }
            }
        } as unknown as typeof window.electronApi;
        mocks.getInboxNote.mockResolvedValue({ noteId: "inbox", isProtected: false });
        mocks.createNote.mockResolvedValue({ note: { noteId: "meeting" } });
        mocks.requireResources.mockResolvedValue(true);
        const advance = (ms: number) => act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
        let container: HTMLElement | null = null;
        await act(async () => {
            container = renderInto(<RecordMeetingButton launcherNote={{} as FNote} />);
        });
        await advance(50);
        const reminder = () => document.body.querySelector(".record-meeting-consent");

        await act(async () => (container as HTMLElement | null)?.querySelector("button")?.click());
        await advance(50);
        expect(reminder()).not.toBeNull();
        await advance(9_900);
        expect(reminder()).not.toBeNull();
        await advance(100);
        expect(reminder()).toBeNull();
        window.electronApi = undefined;
    });

    it("shows the shared recording's state, and starts or stops it on a click", async () => {
        let onStateChanged: (state: TranscriptionState) => void = () => {};
        const report = (status: TranscriptionState["status"]) =>
            act(() => onStateChanged({ status, noteId: "meeting", pendingSources: [] }));
        const transcription = {
            isSupported: async () => true,
            getState: async () => ({ status: "recording", noteId: "meeting", pendingSources: [] }),
            onStateChanged: (callback: typeof onStateChanged) => {
                onStateChanged = callback;
                return () => {};
            },
            stop: vi.fn(async () => {}),
            start: vi.fn(async () => "")
        };
        window.electronApi = { transcription } as unknown as typeof window.electronApi;
        mocks.getInboxNote.mockResolvedValue({ noteId: "inbox", isProtected: false });
        mocks.createNote.mockResolvedValue({ note: { noteId: "meeting" } });
        let container: HTMLElement | null = null;
        act(() => {
            container = renderInto(<RecordMeetingButton launcherNote={{} as FNote} />);
        });
        const button = () => (container as HTMLElement | null)?.querySelector("button");

        await vi.waitFor(() => expect(button()?.className).toBe("bx bx-stop-circle"));
        await act(async () => button()?.click());
        expect(transcription.stop).toHaveBeenCalledOnce();

        for (const status of [ "starting", "stopping" ] as const) {
            await report(status);
            expect(button()?.className).toBe("bx bx-loader-alt bx-spin");
            expect(button()?.disabled).toBe(true);
            expect(button()?.textContent).toContain(`record_meeting.${status}`);
        }

        await report("idle");
        expect(button()?.className).toBe("bx bx-microphone");
        await act(async () => button()?.click());
        await vi.waitFor(() => expect(transcription.start).toHaveBeenCalledExactlyOnceWith("meeting"));
        window.electronApi = undefined;
    });
});
