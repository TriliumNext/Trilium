import type {
    Transcript, TranscriptionState, TranscriptSource, TranscriptUtterance
} from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type FAttachment from "../../../entities/fattachment";
import LoadResults from "../../../services/load_results";
import options from "../../../services/options";
import { renderInto } from "../../../test/render";
import { ParentComponent } from "../../react/react_utils";
import TranscriptView, {
    formatOffset, groupIntoTurns, levelToMeter, TranscriptRecordingLevels, type TranscriptTurn
} from "./TranscriptView";

const h = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), copyTextWithToast: vi.fn() }));
vi.mock("../../../services/clipboard_ext", () => ({ copyTextWithToast: h.copyTextWithToast }));
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));
// keyboard_actions asks the server for its shortcuts at import.
vi.mock("../../../services/server", () => ({
    default: { post: h.post, put: h.put, get: async () => [] }
}));

/** Local time, so that the clock times the spec expects hold in every time zone. */
const STARTED_AT = "2026-10-13T14:29:55";

function transcript(
    utterances: TranscriptUtterance[], startedAt = STARTED_AT, speakers?: Record<string, string>
) {
    const content: Transcript = { version: 1, startedAt, speakers, utterances };
    return JSON.stringify(content);
}

function paragraphTexts(turn: TranscriptTurn) {
    return turn.paragraphs.map((paragraph) => paragraph.map(({ text }) => text).join(" "));
}

describe("transcript helpers", () => {
    it("joins consecutive utterances of one source into a turn timed by its first", () => {
        const turns = groupIntoTurns([
            { source: "microphone", offsetMs: 1000, text: "Hello." },
            { source: "microphone", offsetMs: 3000, text: "Can you hear me?" },
            { source: "system", offsetMs: 5000, text: "Yes." },
            { source: "microphone", offsetMs: 7000, text: "Good." }
        ]);
        expect(turns.map(({ source, offsetMs }) => ({ source, offsetMs }))).toEqual([
            { source: "microphone", offsetMs: 1000 },
            { source: "system", offsetMs: 5000 },
            { source: "microphone", offsetMs: 7000 }
        ]);
        expect(turns.map(paragraphTexts)).toEqual([
            [ "Hello. Can you hear me?" ], [ "Yes." ], [ "Good." ]
        ]);
    });

    it("starts a turn when the speaker of a source changes, not for an unidentified one", () => {
        const turns = groupIntoTurns([
            { source: "system", offsetMs: 0, text: "Hi." },
            { source: "system", offsetMs: 1000, speaker: 1, text: "Welcome to the show." },
            { source: "system", offsetMs: 4000, text: "Yes." },
            { source: "system", offsetMs: 5000, speaker: 1, text: "Our guest is here." },
            { source: "system", offsetMs: 8000, speaker: 2, text: "Thanks for having me." }
        ]);
        expect(turns.map(({ speaker, offsetMs }) => ({ speaker, offsetMs }))).toEqual([
            { speaker: 1, offsetMs: 0 },
            { speaker: 2, offsetMs: 8000 }
        ]);
        expect(turns.map(paragraphTexts)).toEqual([
            [ "Hi. Welcome to the show. Yes. Our guest is here." ], [ "Thanks for having me." ]
        ]);
    });

    it("treats speakers given the same name as one", () => {
        const utterances: TranscriptUtterance[] = [
            { source: "system", offsetMs: 0, speaker: 1, text: "Hello." },
            { source: "system", offsetMs: 1000, speaker: 3, text: "It is me again." },
            { source: "system", offsetMs: 2000, speaker: 2, text: "Hi." }
        ];
        expect(groupIntoTurns(utterances).map(paragraphTexts)).toEqual([
            [ "Hello." ], [ "It is me again." ], [ "Hi." ]
        ]);
        const named = { "system:1": "Alexandra", "system:3": "Alexandra", "system:2": "Bob" };
        expect(groupIntoTurns(utterances, named).map(paragraphTexts)).toEqual([
            [ "Hello. It is me again." ], [ "Hi." ]
        ]);
    });

    it("orders turns by when they were spoken, not by when they were transcribed", () => {
        // The microphone's short reply ends, and is stored, before the long system utterance
        // that started first.
        const turns = groupIntoTurns([
            { source: "microphone", offsetMs: 6000, durationMs: 1000, text: "Yes." },
            { source: "system", offsetMs: 0, durationMs: 15_000, text: "Can you hear me?" },
            { source: "system", offsetMs: 16_000, durationMs: 1000, text: "Good." }
        ]);
        expect(turns.map(({ source, offsetMs }) => ({ source, offsetMs }))).toEqual([
            { source: "system", offsetMs: 0 },
            { source: "microphone", offsetMs: 6000 },
            { source: "system", offsetMs: 16_000 }
        ]);
    });

    it("starts a new paragraph within a turn after a long pause", () => {
        const turns = groupIntoTurns([
            { source: "system", offsetMs: 0, durationMs: 8000, text: "First point," },
            { source: "system", offsetMs: 8100, durationMs: 3000, text: "continued." },
            { source: "system", offsetMs: 12_600, durationMs: 2000, text: "Short pause." },
            { source: "system", offsetMs: 17_000, durationMs: 2000, text: "Second point." }
        ]);
        expect(turns.map(paragraphTexts)).toEqual([
            [ "First point, continued. Short pause.", "Second point." ]
        ]);
    });

    it("spreads 60 dB below full scale up to 10 dB below it over a level meter", () => {
        expect(levelToMeter(0)).toBe(0);
        expect(levelToMeter(10 ** (-60 / 20))).toBeCloseTo(0);
        expect(levelToMeter(10 ** (-35 / 20))).toBeCloseTo(0.5);
        expect(levelToMeter(10 ** (-10 / 20))).toBeCloseTo(1);
        expect(levelToMeter(1)).toBe(1);
    });

    it("formats offsets as m:ss, with hours once there are any", () => {
        expect(formatOffset(0)).toBe("0:00");
        expect(formatOffset(65_900)).toBe("1:05");
        expect(formatOffset(3_725_000)).toBe("1:02:05");
        expect(formatOffset(-5)).toBe("0:00");
    });
});

describe("TranscriptView", () => {
    it("shows the turns, and the new content once the recording rewrites it", async () => {
        const getBlob = vi.fn()
            .mockResolvedValueOnce({ content: transcript([]) })
            .mockResolvedValueOnce({ content: transcript([
                { source: "microphone", offsetMs: 1500, durationMs: 1000, text: "Can you hear me?" },
                { source: "microphone", offsetMs: 6000, durationMs: 1000, text: "Hello?" },
                { source: "system", offsetMs: 8000, speaker: 2, text: "Yes." }
            ]) });
        const attachment = { attachmentId: "transcript1", getBlob } as unknown as FAttachment;
        const component = new Component();

        const container = renderInto(
            <ParentComponent.Provider value={component}>
                <TranscriptView attachment={attachment} />
            </ParentComponent.Provider>
        );
        await vi.waitFor(() => expect(container.textContent).toContain("transcript.empty"));

        const loadResults = new LoadResults([]);
        loadResults.addAttachmentRow({ attachmentId: "transcript1", ownerId: "meeting" } as never);
        await act(async () => {
            await component.handleEvent("entitiesReloaded", { loadResults });
        });

        const turns = () => [ ...container.querySelectorAll(".transcript-turn") ]
            .map((turn) => turn.textContent);
        await vi.waitFor(() => expect(turns()).toHaveLength(2));
        expect(turns()).toEqual([
            "transcript.speaker_me14:29Can you hear me?Hello?",
            "transcript.speaker_numbered14:30Yes."
        ]);
        expect(container.querySelectorAll(".transcript-microphone p")).toHaveLength(2);
    });

    it("fades in only the utterances that arrive after the transcript opens", async () => {
        const first: TranscriptUtterance = { source: "system", offsetMs: 0, text: "Hi." };
        const getBlob = vi.fn()
            .mockResolvedValueOnce({ content: transcript([ first ]) })
            .mockResolvedValueOnce({ content: transcript([
                first, { source: "system", offsetMs: 2000, text: "Anyone?" }
            ]) });
        const attachment = { attachmentId: "transcript1", getBlob } as unknown as FAttachment;
        const component = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={component}>
                <TranscriptView attachment={attachment} />
            </ParentComponent.Provider>
        );
        await vi.waitFor(() => expect(container.textContent).toContain("Hi."));

        const loadResults = new LoadResults([]);
        loadResults.addAttachmentRow({ attachmentId: "transcript1", ownerId: "meeting" } as never);
        await act(async () => {
            await component.handleEvent("entitiesReloaded", { loadResults });
        });
        await vi.waitFor(() => expect(container.textContent).toContain("Anyone?"));

        const spans = [ ...container.querySelectorAll(".transcript-turn p span") ]
            .map((span) => [ span.textContent, span.classList.contains("transcript-new") ]);
        expect(spans).toEqual([ [ "Hi.", false ], [ " Anyone?", true ] ]);
    });

    it("times turns by the clock, with the offset as a tooltip or alone", async () => {
        const renderTimes = async (startedAt: string) => {
            const utterance: TranscriptUtterance =
                { source: "system", offsetMs: 65_000, text: "Yes." };
            const content = transcript([ utterance ], startedAt);
            const attachment = { attachmentId: "transcript1", getBlob: async () => ({ content }) };
            const container = renderInto(
                <ParentComponent.Provider value={new Component()}>
                    <TranscriptView attachment={attachment as unknown as FAttachment} />
                </ParentComponent.Provider>
            );
            await vi.waitFor(() =>
                expect(container.querySelector(".transcript-time")).not.toBeNull());
            return container.querySelector<HTMLElement>(".transcript-time");
        };

        const time = await renderTimes(STARTED_AT);
        expect(time?.textContent).toBe("14:31");
        expect(time?.getAttribute("datetime"))
            .toBe(new Date("2026-10-13T14:31:00").toISOString());
        const tooltip = time && Tooltip.getInstance(time);
        expect(tooltip).toBeTruthy();
        act(() => tooltip?.show());
        expect(document.querySelector(".tooltip")?.textContent).toBe("transcript.offset");
        act(() => tooltip?.dispose());

        const offset = await renderTimes("not a date");
        expect(offset?.textContent).toBe("1:05");
        expect(offset && Tooltip.getInstance(offset)).toBeNull();
    });

    it("renames a speaker in place, and only identified speakers", async () => {
        const utterances: TranscriptUtterance[] = [
            { source: "system", offsetMs: 0, speaker: 1, text: "Hi." },
            { source: "microphone", offsetMs: 2000, text: "Hello." },
            { source: "system", offsetMs: 4000, text: "Yes." }
        ];
        let stored = transcript(utterances, STARTED_AT, { microphone: "Elian" });
        const attachment = {
            attachmentId: "transcript1", ownerId: "meeting", role: "transcript",
            mime: "application/json", title: "Transcript",
            getBlob: async () => ({ content: stored })
        };
        const container = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <TranscriptView attachment={attachment as unknown as FAttachment} />
            </ParentComponent.Provider>
        );
        const names = () => [ ...container.querySelectorAll(".transcript-speaker") ];
        await vi.waitFor(() => expect(names()).toHaveLength(3));
        expect(names().map((name) => [ name.tagName, name.textContent ])).toEqual([
            [ "A", "transcript.speaker_numbered" ], [ "A", "Elian" ],
            [ "SPAN", "transcript.speaker_others" ]
        ]);

        const edit = async (index: number) => {
            await act(async () => (names()[index] as HTMLElement).click());
            const input = container.querySelector<HTMLInputElement>(".transcript-speaker-editor");
            if (!input) {
                throw new Error("no editor");
            }
            return input;
        };
        const type = (input: HTMLInputElement, value: string) => act(() => {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const press = (input: HTMLInputElement, key: string) => act(() => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        });

        const saved = (index: number) => {
            const [ url, { content, ...rest } ] = h.post.mock.calls[index];
            return { url, ...rest, ...JSON.parse(content) };
        };

        // The recording writes another utterance after the transcript was shown.
        const welcome: TranscriptUtterance = { source: "system", offsetMs: 6000, text: "Welcome." };
        stored = transcript([ ...utterances, welcome ], STARTED_AT, { microphone: "Elian" });
        const first = await edit(0);
        expect(first.value).toBe("transcript.speaker_numbered");
        type(first, " Alexandra ");
        // The field can lose focus while Enter takes it down; that must not save a second time.
        expect(document.activeElement).toBe(first);
        act(() => {
            first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            first.blur();
        });
        expect(container.querySelector(".transcript-speaker-editor")).toBeNull();
        await vi.waitFor(() => expect(h.post).toHaveBeenCalledOnce());
        expect(saved(0)).toEqual({
            url: "notes/meeting/attachments?matchBy=attachmentId",
            attachmentId: "transcript1", role: "transcript", mime: "application/json",
            title: "Transcript", version: 1, startedAt: STARTED_AT,
            speakers: { microphone: "Elian", "system:1": "Alexandra" },
            utterances: [ ...utterances, welcome ]
        });

        const me = await edit(1);
        expect(me.value).toBe("Elian");
        type(me, "  ");
        act(() => me.blur());
        await vi.waitFor(() => expect(h.post).toHaveBeenCalledTimes(2));
        expect(saved(1).speakers).toEqual({});

        const cancelled = await edit(0);
        type(cancelled, "Bob");
        press(cancelled, "Escape");
        const unchanged = await edit(0);
        type(unchanged, "transcript.speaker_numbered");
        press(unchanged, "Enter");
        await new Promise((resolve) => setTimeout(resolve));
        expect(h.post).toHaveBeenCalledTimes(2);
    });

    it("renames a speaker through the recording that writes the transcript, while it runs", async () => {
        const renameSpeaker = vi.fn(async () => true);
        window.electronApi = {
            transcription: {
                getState: async () => ({ status: "recording", noteId: "meeting", pendingSources: [] }),
                onStateChanged: () => () => {},
                onLevel: () => () => {},
                renameSpeaker
            }
        } as unknown as typeof window.electronApi;
        const getBlob = vi.fn(async () => ({
            content: transcript([ { source: "system", offsetMs: 0, speaker: 1, text: "Hi." } ])
        }));
        const attachment = { attachmentId: "transcript1", ownerId: "meeting", getBlob };
        const container = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <TranscriptView attachment={attachment as unknown as FAttachment} />
            </ParentComponent.Provider>
        );
        const speaker = () => container.querySelector<HTMLElement>(".transcript-speaker");
        await vi.waitFor(() => expect(speaker()).not.toBeNull());
        const posted = h.post.mock.calls.length;

        await act(async () => speaker()?.click());
        const input = container.querySelector<HTMLInputElement>(".transcript-speaker-editor");
        expect(input).not.toBeNull();
        act(() => {
            if (input) {
                input.value = "Alexandra";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        act(() => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        await vi.waitFor(() => expect(renameSpeaker)
            .toHaveBeenCalledExactlyOnceWith("transcript1", "system:1", "Alexandra"));
        await new Promise((resolve) => setTimeout(resolve));
        expect(h.post).toHaveBeenCalledTimes(posted);
        expect(getBlob).toHaveBeenCalledOnce();
        window.electronApi = undefined;
    });

    it("says content it cannot read is no transcript, and follows only its own attachment", async () => {
        let resolveFirst = (_blob: { content: string }) => {};
        const getBlob = vi.fn()
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveFirst = resolve;
            }))
            .mockResolvedValue({ content: "{ \"not\": \"a transcript\" }" });
        const attachment = {
            attachmentId: "transcript1", ownerId: "meeting", getBlob
        } as unknown as FAttachment;
        const component = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={component}>
                <TranscriptView attachment={attachment} />
            </ParentComponent.Provider>
        );

        // A newer load replaces the first, whose late answer is dropped.
        const reload = async (attachmentId: string) => {
            const loadResults = new LoadResults([]);
            loadResults.addAttachmentRow({ attachmentId, ownerId: "meeting" } as never);
            await act(async () => {
                await component.handleEvent("entitiesReloaded", { loadResults });
            });
        };
        await reload("transcript1");
        await vi.waitFor(() => expect(container.textContent).toContain("transcript.unreadable"));
        await act(async () => resolveFirst({ content: transcript([
            { source: "system", offsetMs: 0, text: "Stale." }
        ]) }));
        expect(container.textContent).toContain("transcript.unreadable");

        await reload("another");
        expect(getBlob).toHaveBeenCalledTimes(2);
    });

    it("renames nothing when the stored transcript cannot be read", async () => {
        const getBlob = vi.fn()
            .mockResolvedValueOnce({ content: transcript([
                { source: "microphone", offsetMs: 0, text: "Hello." }
            ]) })
            .mockResolvedValue({ content: "" });
        const attachment = {
            attachmentId: "transcript1", ownerId: "meeting", getBlob
        } as unknown as FAttachment;
        const container = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <TranscriptView attachment={attachment} />
            </ParentComponent.Provider>
        );
        const speaker = () => container.querySelector<HTMLElement>(".transcript-speaker");
        await vi.waitFor(() => expect(speaker()).not.toBeNull());
        const posted = h.post.mock.calls.length;

        await act(async () => speaker()?.click());
        const input = container.querySelector<HTMLInputElement>(".transcript-speaker-editor");
        act(() => {
            if (input) {
                input.value = "Elian";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        act(() => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        });
        expect(container.querySelector(".transcript-speaker-editor")).not.toBeNull();
        act(() => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        await vi.waitFor(() => expect(getBlob).toHaveBeenCalledTimes(2));
        await new Promise((resolve) => setTimeout(resolve));
        expect(h.post).toHaveBeenCalledTimes(posted);
    });

    it("shows who is speaking in the recorded meeting, before the words arrive", async () => {
        let onStateChanged: (state: TranscriptionState) => void = () => {};
        const recording = (noteId: string, pendingSources: TranscriptSource[]) =>
            act(() => onStateChanged({ status: "recording", noteId, pendingSources }));
        window.electronApi = {
            transcription: {
                getState: async () => ({
                    status: "recording", noteId: "meeting", pendingSources: []
                }),
                onStateChanged: (callback: typeof onStateChanged) => {
                    onStateChanged = callback;
                    return () => {};
                },
                onLevel: () => () => {}
            }
        } as unknown as typeof window.electronApi;
        const getBlob = vi.fn()
            .mockResolvedValueOnce({ content: transcript([]) })
            .mockResolvedValueOnce({ content: transcript([
                { source: "microphone", offsetMs: 1500, durationMs: 1000, text: "Hello?" }
            ]) });
        const attachment = { attachmentId: "transcript1", ownerId: "meeting", getBlob };
        const component = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={component}>
                <TranscriptView attachment={attachment as unknown as FAttachment} />
            </ParentComponent.Provider>
        );
        const turns = () => [ ...container.querySelectorAll(".transcript-turn") ]
            .map((turn) => turn.textContent);
        await vi.waitFor(() => expect(container.textContent).toContain("transcript.empty"));

        await recording("meeting", [ "system" ]);
        expect(turns()).toEqual([ "transcript.speaker_otherstranscript.speaking" ]);

        const loadResults = new LoadResults([]);
        loadResults.addAttachmentRow({ attachmentId: "transcript1", ownerId: "meeting" } as never);
        await act(async () => {
            await component.handleEvent("entitiesReloaded", { loadResults });
        });
        await recording("meeting", [ "microphone", "system" ]);
        await vi.waitFor(() => expect(turns()).toEqual([
            "transcript.speaker_me14:29Hello?transcript.speaking",
            "transcript.speaker_otherstranscript.speaking"
        ]));

        await recording("other", [ "system" ]);
        expect(turns()).toEqual([ "transcript.speaker_me14:29Hello?" ]);
        window.electronApi = undefined;
    });

    it("shows each source's level while its meeting records, apart from the turns", async () => {
        let onStateChanged: (state: TranscriptionState) => void = () => {};
        let onLevel: (source: TranscriptSource, level: number) => void = () => {};
        const unsubscribeLevels = vi.fn();
        const recording: TranscriptionState = {
            status: "recording", noteId: "meeting", pendingSources: []
        };
        const report = (state: Partial<TranscriptionState>) =>
            act(() => onStateChanged({ ...recording, ...state }));
        window.electronApi = {
            transcription: {
                getState: async () => recording,
                onStateChanged: (callback: typeof onStateChanged) => {
                    onStateChanged = callback;
                    return () => {};
                },
                onLevel: (callback: typeof onLevel) => {
                    onLevel = callback;
                    return unsubscribeLevels;
                }
            }
        } as unknown as typeof window.electronApi;
        const attachment = {
            attachmentId: "transcript1", ownerId: "meeting",
            getBlob: async () => ({ content: transcript([]) })
        };
        const view = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <TranscriptView attachment={attachment as unknown as FAttachment} />
            </ParentComponent.Provider>
        );
        const container = renderInto(
            <TranscriptRecordingLevels attachment={attachment as unknown as FAttachment} />
        );
        const meter = (source: string) => container.querySelector<HTMLElement>(
            `.transcript-level[data-source="${source}"]`);
        const fill = (source: string) =>
            Number(meter(source)?.style.getPropertyValue("--level"));

        await vi.waitFor(() => expect(meter("microphone")).not.toBeNull());
        await vi.waitFor(() => expect(view.textContent).toContain("transcript.empty"));
        expect(view.querySelector(".transcript-level, .transcript-options")).toBeNull();
        expect(meter("microphone")?.textContent).toContain("transcript.speaker_me");
        expect(meter("system")?.textContent).toContain("transcript.speaker_others");
        act(() => onLevel("microphone", 10 ** (-35 / 20)));
        expect(fill("microphone")).toBeCloseTo(0.5);
        expect(fill("system")).toBe(0);
        expect(meter("microphone")?.getAttribute("aria-valuenow")).toBe("0.5");

        await report({ sourceIssues: { system: "no_audio" } });
        expect(meter("system")?.classList.contains("has-issue")).toBe(true);
        expect(meter("system")?.textContent).toContain("transcript.no_audio");
        expect(meter("microphone")?.classList.contains("has-issue")).toBe(false);
        expect(meter("microphone")?.querySelector(".transcript-level-warning")).toBeNull();
        await report({ sourceIssues: { microphone: "silent", system: "not_captured" } });
        expect(meter("microphone")?.textContent).toContain("transcript.silent");
        expect(meter("system")?.textContent).toContain("transcript.not_captured");
        expect(meter("system")?.textContent).not.toContain("transcript.no_audio");

        await report({ noteId: "other" });
        expect(meter("microphone")).toBeNull();
        expect(unsubscribeLevels).toHaveBeenCalledOnce();
        window.electronApi = undefined;
    });

    it("follows new turns for a reader at the end, and marks when more is above or below", async () => {
        const utterance = (index: number): TranscriptUtterance =>
            ({ source: "microphone", offsetMs: index * 60_000, text: `Line ${index}` });
        // Each reload adds a turn, alternating sources so that none merge.
        let count = 1;
        const getBlob = vi.fn(async () => ({
            content: transcript(Array.from({ length: count }, (_, index) => ({
                ...utterance(index), source: index % 2 ? "system" : "microphone"
            })))
        }));
        const attachment = { attachmentId: "transcript1", getBlob } as unknown as FAttachment;
        const component = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={component}>
                <TranscriptView attachment={attachment} />
            </ParentComponent.Provider>
        );
        await vi.waitFor(() => expect(container.querySelector(".transcript")).not.toBeNull());

        // happy-dom lays nothing out: 100px of view over 50px a turn.
        const scroller = container.querySelector<HTMLElement>(".transcript");
        if (!scroller) {
            throw new Error("no scroller");
        }
        Object.defineProperty(scroller, "clientHeight", { value: 100 });
        Object.defineProperty(scroller, "scrollHeight", {
            get: () => scroller.querySelectorAll(".transcript-turn").length * 50
        });
        const addTurn = async () => {
            count++;
            const loadResults = new LoadResults([]);
            const row = { attachmentId: "transcript1", ownerId: "meeting" };
            loadResults.addAttachmentRow(row as never);
            await act(async () => {
                await component.handleEvent("entitiesReloaded", { loadResults });
            });
            await vi.waitFor(() =>
                expect(scroller.querySelectorAll(".transcript-turn")).toHaveLength(count));
        };

        const scrollTo = (top: number) => act(() => {
            scroller.scrollTop = top;
            scroller.dispatchEvent(new Event("scroll"));
        });

        await addTurn();
        await addTurn();
        const edges = () => [ "more-above", "more-below" ]
            .filter((name) => scroller.classList.contains(name));
        expect(scroller.scrollTop).toBe(150);
        expect(edges()).toEqual([ "more-above" ]);

        scrollTo(0);
        expect(edges()).toEqual([ "more-below" ]);
        await addTurn();
        expect(scroller.scrollTop).toBe(0);
        expect(edges()).toEqual([ "more-below" ]);

        scrollTo(50);
        expect(edges()).toEqual([ "more-above", "more-below" ]);
        scrollTo(100);
        expect(edges()).toEqual([ "more-above" ]);
    });

    it("hides filler words and stutters while the option is on, else grays them out", async () => {
        options.set("transcriptCleanupEnabled", "true");
        const content = transcript([
            { source: "system", offsetMs: 0, text: "Uh the the data is old." },
            { source: "system", offsetMs: 1000, text: "Uh." },
            { source: "system", offsetMs: 2000, text: "I know, I know." }
        ]);
        const attachment = { attachmentId: "transcript1", getBlob: async () => ({ content }) };
        const container = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <TranscriptView attachment={attachment as unknown as FAttachment} />
            </ParentComponent.Provider>
        );
        const spans = () => [ ...container.querySelectorAll(".transcript-turn p > span") ]
            .map((span) => span.textContent);
        const disfluencies = () => [ ...container.querySelectorAll(".transcript-disfluency") ]
            .map((span) => span.textContent);
        await vi.waitFor(() => expect(spans()).toHaveLength(2));
        expect(spans()).toEqual([ "The data is old.", " I know, I know." ]);
        expect(disfluencies()).toEqual([]);

        const toggle = container.querySelector<HTMLButtonElement>(
            ".transcript-options button.transcript-cleanup");
        expect(toggle?.classList.contains("bx-eraser")).toBe(true);
        expect(toggle?.classList.contains("active")).toBe(true);
        expect(toggle?.getAttribute("aria-pressed")).toBe("true");
        expect(container.querySelector(".transcript-options .switch-toggle")).toBeNull();
        await act(async () => {
            toggle?.click();
        });
        expect(h.put).toHaveBeenCalledWith("options", { transcriptCleanupEnabled: "false" });
        expect(toggle?.getAttribute("aria-pressed")).toBe("false");
        expect(disfluencies()).toEqual([ "Uh", "the", "Uh." ]);
        expect(spans()).toEqual([ "Uh the the data is old.", " Uh.", " I know, I know." ]);
    });

    it("copies the transcript as shown, one named and timed turn after another", async () => {
        options.set("transcriptCleanupEnabled", "true");
        const content = transcript([
            { source: "microphone", offsetMs: 5000, durationMs: 1000, text: "Uh hello." },
            { source: "microphone", offsetMs: 6000, durationMs: 1000, text: "Can you hear me?" },
            { source: "microphone", offsetMs: 30_000, text: "Um." },
            { source: "microphone", offsetMs: 40_000, text: "Still there?" },
            { source: "system", offsetMs: 70_000, speaker: 1, text: "Yes, I can." }
        ], STARTED_AT, { "system:1": "Olivier" });
        const attachment = { attachmentId: "transcript1", getBlob: async () => ({ content }) };
        const container = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <TranscriptView attachment={attachment as unknown as FAttachment} />
            </ParentComponent.Provider>
        );
        const copy = () => container.querySelector<HTMLButtonElement>(
            ".transcript-options .transcript-copy");
        await vi.waitFor(() => expect(copy()).not.toBeNull());

        act(() => copy()?.click());
        expect(h.copyTextWithToast).toHaveBeenCalledExactlyOnceWith([
            "transcript.speaker_me (14:30)",
            "Hello. Can you hear me?",
            "",
            "Still there?",
            "",
            "Olivier (14:31)",
            "Yes, I can."
        ].join("\n"));
    });
});
