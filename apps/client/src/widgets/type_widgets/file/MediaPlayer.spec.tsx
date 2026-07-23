import $ from "jquery";
import { RefObject, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNote, setLabel, removeAttributeById, logError } = vi.hoisted(() => ({
    getNote: vi.fn(async (_noteId: string) => null as unknown),
    setLabel: vi.fn(async () => {}),
    removeAttributeById: vi.fn(async () => {}),
    logError: vi.fn()
}));
vi.mock("../../../services/froca", () => ({ default: { getNote } }));
vi.mock("../../../services/attributes", () => ({ default: { setLabel, removeAttributeById } }));
// Replaces the setup-wide ws mock for this file, so it has to keep the subscription surface that mock
// provides (other services subscribe at import time) while adding the logError the play mode reports through.
vi.mock("../../../services/ws", () => ({
    default: { subscribeToMessages: () => {} },
    logError,
    subscribeToMessages: () => {},
    unsubscribeToMessage: () => {}
}));

import type NoteContext from "../../../components/note_context";
import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import { collectShortcutHints } from "../../../services/shortcut_hints";
import { ParentComponent } from "../../react/react_utils";
import { claimsKeystroke, formatTime, PlaybackSpeed, PlayModeButton, PlayPauseButton, SeekBar, SkipButton, useMediaPlayerShortcutHints, useMediaPlayMode, useMediaSessionController, VolumeControl } from "./MediaPlayer";
import type { MediaPlayMode } from "./media_play_mode";
import type { MediaSource } from "./media_source";

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    getNote.mockReset();
    getNote.mockResolvedValue(null);
    setLabel.mockClear();
    removeAttributeById.mockClear();
    logError.mockClear();
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
});

/** A media element standing in for a mounted player's, with the read-only bits made writable. */
function fakeMedia({ duration = 100, currentTime = 0 } = {}) {
    const media = document.createElement("audio");
    Object.defineProperty(media, "duration", { value: duration, writable: true, configurable: true });
    media.currentTime = currentTime;
    return { current: media } as RefObject<HTMLAudioElement>;
}

const click = (el: Element | null | undefined) =>
    act(() => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

const input = (el: Element | null, value: string) =>
    act(() => {
        (el as HTMLInputElement).value = value;
        el?.dispatchEvent(new Event("input", { bubbles: true }));
    });

/** A Dropdown only mounts its items once Bootstrap announces the open, which is what this stands in for. */
const openDropdown = () =>
    act(() => { $(container.querySelector(".dropdown") as HTMLElement).trigger("show.bs.dropdown"); });

/** Lets a chain of promises inside the component settle, then flushes the renders and effects it caused. */
const settle = async () => {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
};

describe("useMediaPlayerShortcutHints", () => {
    function collectHints(fullscreen: boolean) {
        const host = new Component();

        function Probe() {
            useMediaPlayerShortcutHints({ fullscreen });
            return null;
        }
        act(() => render(<ParentComponent.Provider value={host}><Probe /></ParentComponent.Provider>, container));
        return collectShortcutHints(host);
    }

    it("registers playback (incl. fullscreen) and navigation for video", () => {
        const sections = collectHints(true);

        expect(sections.map(s => s.titleKey)).toEqual([ "media.hints.playback", "media.hints.navigation" ]);
        expect(sections[0].hints.map(h => h.labelKey)).toEqual([
            "media.hints.play_pause",
            "media.hints.back_10s",
            "media.hints.forward_10s",
            "media.hints.jump_start",
            "media.hints.jump_end",
            "media.hints.mute",
            "media.hints.fullscreen"
        ]);
        expect(sections[1].hints.map(h => h.labelKey)).toEqual([ "media.hints.previous", "media.hints.next" ]);
    });

    it("omits fullscreen for audio", () => {
        const sections = collectHints(false);

        expect(sections[0].hints.map(h => h.labelKey)).toEqual([
            "media.hints.play_pause",
            "media.hints.back_10s",
            "media.hints.forward_10s",
            "media.hints.jump_start",
            "media.hints.jump_end",
            "media.hints.mute"
        ]);
    });
});

describe("claimsKeystroke", () => {
    const keystroke = (key: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
        ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers }) as KeyboardEvent;

    it("takes the bare keys the player binds", () => {
        expect(claimsKeystroke(keystroke(" "))).toBe(true);
        expect(claimsKeystroke(keystroke("f"))).toBe(true);
        expect(claimsKeystroke(keystroke("Home"))).toBe(true);
        // Shift isn't an application modifier, so it doesn't take the key away.
        expect(claimsKeystroke(keystroke("m", { shiftKey: true }))).toBe(true);
    });

    it("leaves chords to the application, which owns Ctrl+F and the rest", () => {
        expect(claimsKeystroke(keystroke("f", { ctrlKey: true }))).toBe(false);
        expect(claimsKeystroke(keystroke("m", { ctrlKey: true }))).toBe(false);
        expect(claimsKeystroke(keystroke(" ", { ctrlKey: true }))).toBe(false);
        expect(claimsKeystroke(keystroke("Home", { metaKey: true }))).toBe(false);
        expect(claimsKeystroke(keystroke("ArrowUp", { altKey: true }))).toBe(false);
    });

    it("keeps its own Ctrl+Left/Right minute jump", () => {
        expect(claimsKeystroke(keystroke("ArrowLeft", { ctrlKey: true }))).toBe(true);
        expect(claimsKeystroke(keystroke("ArrowRight", { ctrlKey: true }))).toBe(true);
        // Only with Ctrl alone: Alt+Left is the application's (history back), not a minute jump.
        expect(claimsKeystroke(keystroke("ArrowLeft", { altKey: true }))).toBe(false);
        expect(claimsKeystroke(keystroke("ArrowRight", { ctrlKey: true, altKey: true }))).toBe(false);
    });
});

describe("formatTime", () => {
    it("renders m:ss, zero-padding the seconds and flooring the remainder", () => {
        expect(formatTime(0)).toBe("0:00");
        expect(formatTime(9.9)).toBe("0:09");
        expect(formatTime(65)).toBe("1:05");
        expect(formatTime(3600)).toBe("60:00");
    });
});

describe("SeekBar", () => {
    const trackbar = () => container.querySelector(".media-trackbar") as HTMLInputElement;
    const times = () => Array.from(container.querySelectorAll(".media-time")).map(el => el.textContent);

    it("seeds from an element whose metadata already loaded, so the thumb isn't pinned at zero", () => {
        // The element is ready before the (passive) effect runs — common for cached media — so the initial
        // durationchange/timeupdate already fired and listeners alone would leave duration at 0.
        const mediaRef = fakeMedia({ duration: 200, currentTime: 30 });
        act(() => render(<SeekBar mediaRef={mediaRef} />, container));

        expect(trackbar().getAttribute("max")).toBe("200");
        expect(times()).toEqual([ "0:30", "-2:50" ]);
    });

    it("follows the element as it plays and as its duration resolves", () => {
        const mediaRef = fakeMedia({ duration: 0, currentTime: 0 });
        act(() => render(<SeekBar mediaRef={mediaRef} />, container));
        expect(trackbar().getAttribute("max")).toBe("0");

        const media = mediaRef.current;
        if (!media) throw new Error("no media");
        act(() => {
            Object.defineProperty(media, "duration", { value: 60, writable: true, configurable: true });
            media.dispatchEvent(new Event("durationchange"));
        });
        expect(trackbar().getAttribute("max")).toBe("60");

        act(() => {
            media.currentTime = 15;
            media.dispatchEvent(new Event("timeupdate"));
        });
        expect(times()).toEqual([ "0:15", "-0:45" ]);
    });

    it("scrubs the element to the dragged position", () => {
        const mediaRef = fakeMedia({ duration: 100 });
        act(() => render(<SeekBar mediaRef={mediaRef} />, container));

        input(trackbar(), "42.5");
        expect(mediaRef.current?.currentTime).toBe(42.5);
    });
});

describe("VolumeControl", () => {
    const slider = () => container.querySelector(".media-volume-slider") as HTMLInputElement;
    const muteButton = () => container.querySelector(".media-volume-row button");

    it("shows the element's level, picking the icon from how loud it is", () => {
        const mediaRef = fakeMedia();
        const media = mediaRef.current;
        if (!media) throw new Error("no media");

        media.volume = 0.8;
        act(() => render(<VolumeControl mediaRef={mediaRef} />, container));
        expect(container.querySelector(".bx-volume-full")).not.toBeNull();

        act(() => {
            media.volume = 0.2;
            media.dispatchEvent(new Event("volumechange"));
        });
        expect(container.querySelector(".bx-volume-low")).not.toBeNull();

        act(() => {
            media.volume = 0;
            media.dispatchEvent(new Event("volumechange"));
        });
        expect(container.querySelector(".bx-volume-mute")).not.toBeNull();
    });

    it("sets the element's volume, and unmutes when dragged up from silence", () => {
        const mediaRef = fakeMedia();
        const media = mediaRef.current;
        if (!media) throw new Error("no media");
        media.muted = true;
        act(() => render(<VolumeControl mediaRef={mediaRef} />, container));
        // A muted player reads as silent whatever its stored level.
        expect(slider().value).toBe("0");

        input(slider(), "0.4");
        expect(media.volume).toBeCloseTo(0.4);
        expect(media.muted).toBe(false);
        expect(slider().value).toBe("0.4");
    });

    it("toggles mute from the icon button", () => {
        const mediaRef = fakeMedia();
        const media = mediaRef.current;
        if (!media) throw new Error("no media");
        act(() => render(<VolumeControl mediaRef={mediaRef} />, container));

        click(muteButton());
        expect(media.muted).toBe(true);
        expect(container.querySelector(".bx-volume-mute")).not.toBeNull();

        click(muteButton());
        expect(media.muted).toBe(false);
    });
});

describe("PlaybackSpeed", () => {
    const items = () => Array.from(container.querySelectorAll(".dropdown-item"));

    it("offers the speeds, marking the element's current one", () => {
        const mediaRef = fakeMedia();
        const media = mediaRef.current;
        if (!media) throw new Error("no media");
        media.playbackRate = 1.5;
        act(() => render(<PlaybackSpeed mediaRef={mediaRef} />, container));
        openDropdown();

        expect(items().map(el => el.textContent)).toEqual([ "0.5x", "1x", "1.25x", "1.5x", "2x" ]);
        expect(items().find(el => el.classList.contains("active"))?.textContent).toBe("1.5x");
        expect(container.querySelector(".media-speed-label")?.textContent).toBe("1.5x");
    });

    it("applies a chosen speed, and follows one changed elsewhere", () => {
        const mediaRef = fakeMedia();
        const media = mediaRef.current;
        if (!media) throw new Error("no media");
        act(() => render(<PlaybackSpeed mediaRef={mediaRef} />, container));
        openDropdown();

        click(items().find(el => el.textContent === "2x"));
        expect(media.playbackRate).toBe(2);
        expect(container.querySelector(".media-speed-label")?.textContent).toBe("2x");

        act(() => {
            media.playbackRate = 0.5;
            media.dispatchEvent(new Event("ratechange"));
        });
        expect(container.querySelector(".media-speed-label")?.textContent).toBe("0.5x");
    });
});

describe("SkipButton", () => {
    it("jumps by its offset, staying inside the media", () => {
        const mediaRef = fakeMedia({ duration: 100, currentTime: 50 });
        act(() => render(<SkipButton mediaRef={mediaRef} seconds={10} icon="bx bx-fast-forward" text="forward" />, container));

        click(container.querySelector("button"));
        expect(mediaRef.current?.currentTime).toBe(60);

        if (mediaRef.current) mediaRef.current.currentTime = 95;
        click(container.querySelector("button"));
        expect(mediaRef.current?.currentTime).toBe(100);
    });

    it("jumps backwards without going below zero", () => {
        const mediaRef = fakeMedia({ duration: 100, currentTime: 4 });
        act(() => render(<SkipButton mediaRef={mediaRef} seconds={-10} icon="bx bx-rewind" text="back" />, container));

        click(container.querySelector("button"));
        expect(mediaRef.current?.currentTime).toBe(0);
    });
});

describe("PlayPauseButton", () => {
    it("shows play or pause for the current state, and reports the press", () => {
        const togglePlayback = vi.fn();
        act(() => render(<PlayPauseButton playing={false} togglePlayback={togglePlayback} />, container));
        expect(container.querySelector(".bx-play")).not.toBeNull();

        click(container.querySelector("button"));
        expect(togglePlayback).toHaveBeenCalledTimes(1);

        act(() => render(<PlayPauseButton playing togglePlayback={togglePlayback} />, container));
        expect(container.querySelector(".bx-pause")).not.toBeNull();
    });
});

describe("PlayModeButton", () => {
    it("shows the current mode, ticks it in the menu, and reports a new choice", () => {
        const onSelectMode = vi.fn();
        act(() => render(<PlayModeButton mode="loop" onSelectMode={onSelectMode} />, container));
        openDropdown();

        const items = Array.from(container.querySelectorAll(".dropdown-item"));
        expect(items).toHaveLength(3);
        const active = items.find(el => el.classList.contains("active"));
        expect(active?.querySelector(".bx-repeat")).not.toBeNull();
        expect(active?.querySelector(".play-mode-check")).not.toBeNull();

        click(items[2]);
        expect(onSelectMode).toHaveBeenCalledWith("next");
    });
});

describe("useMediaPlayMode", () => {
    let latest: { mode: MediaPlayMode; setMode: (mode: MediaPlayMode) => void } | undefined;

    /** A note whose play-mode label is `labelValue`, owned unless stated otherwise (i.e. inherited). */
    const noteWithMode = (labelValue: string | null, { owned = true } = {}) => ({
        noteId: "parent1",
        getLabelValue: () => labelValue,
        getOwnedLabel: () => (owned && labelValue ? { attributeId: "attr1" } : null)
    });

    async function renderHook({ notePath, playlistNoteId, mediaRef = fakeMedia() }: {
        notePath?: string;
        playlistNoteId?: string;
        mediaRef?: RefObject<HTMLAudioElement>;
    }) {
        const noteContext = { notePath } as NoteContext;

        function Probe() {
            latest = useMediaPlayMode(noteContext, mediaRef, playlistNoteId);
            return null;
        }
        await act(async () => { render(<Probe />, container); });
        // The mode arrives from the note lookup a microtask later, and the element's `loop` an effect after that.
        await settle();
        return mediaRef;
    }

    it("reads the mode from the folder the media sits in, and loops the element to match", async () => {
        getNote.mockResolvedValue(noteWithMode("loop"));
        const mediaRef = await renderHook({ notePath: "root/folder1/snd1" });

        expect(getNote).toHaveBeenCalledWith("folder1");
        expect(latest?.mode).toBe("loop");
        expect(mediaRef.current?.loop).toBe(true);
    });

    it("takes the mode from the owning note instead, for one of its attachments", async () => {
        getNote.mockResolvedValue(noteWithMode("next"));
        await renderHook({ notePath: "root/folder1/own1", playlistNoteId: "own1" });

        // The attachment's playlist is the note owning it — not that note's folder.
        expect(getNote).toHaveBeenCalledWith("own1");
        expect(latest?.mode).toBe("next");
    });

    it("falls back to playing once for an unlabelled playlist, an unknown value, or no playlist at all", async () => {
        getNote.mockResolvedValue(noteWithMode(null));
        const mediaRef = await renderHook({ notePath: "root/folder1/snd1" });
        expect(latest?.mode).toBe("once");
        expect(mediaRef.current?.loop).toBe(false);

        getNote.mockResolvedValue(noteWithMode("nonsense"));
        await renderHook({ notePath: "root/folder2/snd1" });
        expect(latest?.mode).toBe("once");

        // A top-level note has no parent in its path, so there is nothing to read a mode from.
        getNote.mockClear();
        await renderHook({ notePath: "root" });
        expect(getNote).not.toHaveBeenCalled();
        expect(latest?.mode).toBe("once");
    });

    it("persists a chosen mode onto the playlist note", async () => {
        getNote.mockResolvedValue(noteWithMode(null));
        await renderHook({ notePath: "root/folder1/snd1" });

        await act(async () => { latest?.setMode("next"); });
        await settle();

        expect(latest?.mode).toBe("next");
        expect(setLabel).toHaveBeenCalledWith("parent1", "mediaNotesPlayMode", "next");
    });

    it("removes the label for 'play once', and only ever its own", async () => {
        getNote.mockResolvedValue(noteWithMode("loop"));
        await renderHook({ notePath: "root/folder1/snd1" });

        await act(async () => { latest?.setMode("once"); });
        await settle();

        expect(setLabel).not.toHaveBeenCalled();
        expect(removeAttributeById).toHaveBeenCalledWith("parent1", "attr1");

        // An inherited label belongs to an ancestor, so there is nothing of ours to remove.
        removeAttributeById.mockClear();
        getNote.mockResolvedValue(noteWithMode("loop", { owned: false }));
        await renderHook({ notePath: "root/folder2/snd1" });
        await act(async () => { latest?.setMode("once"); });
        await settle();
        expect(removeAttributeById).not.toHaveBeenCalled();
    });

    it("reports a failed write instead of silently keeping the optimistic mode", async () => {
        getNote.mockResolvedValue(noteWithMode(null));
        setLabel.mockRejectedValueOnce(new Error("offline"));
        await renderHook({ notePath: "root/folder1/snd1" });

        await act(async () => { latest?.setMode("loop"); });
        await settle();

        expect(logError).toHaveBeenCalledWith(expect.stringContaining("Could not persist media play mode"));
    });
});

describe("useMediaSessionController", () => {
    const source = (id: string, title = "Track"): MediaSource => ({
        id,
        title,
        mime: "audio/mpeg",
        streamUrl: `api/notes/${id}/open-partial?v=b`,
        fullUrl: `api/notes/${id}/open?v=b`
    });
    const noteOf = (id: string) => ({ noteId: id, title: id, type: "file", mime: "audio/mpeg" } as unknown as FNote);

    let actionHandlers: Map<string, MediaSessionActionHandler | null>;
    let mediaSession: { metadata: unknown; playbackState: string; setActionHandler: ReturnType<typeof vi.fn>; setPositionState: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        actionHandlers = new Map();
        mediaSession = {
            metadata: null,
            playbackState: "none",
            setActionHandler: vi.fn((action: string, handler: MediaSessionActionHandler | null) => actionHandlers.set(action, handler)),
            setPositionState: vi.fn()
        };
        Object.defineProperty(navigator, "mediaSession", { value: mediaSession, configurable: true });
        (globalThis as { MediaMetadata?: unknown }).MediaMetadata = class {
            title: string;
            constructor(init: { title: string }) { this.title = init.title; }
        };
    });

    afterEach(() => {
        Reflect.deleteProperty(navigator, "mediaSession");
        Reflect.deleteProperty(globalThis as object, "MediaMetadata");
    });

    /** A folder holding `siblingIds` as same-type, same-mime children — what the media navigates between. */
    function withSiblings(...siblingIds: string[]) {
        getNote.mockImplementation(async (noteId: string) => (noteId === "folder1"
            ? { noteId: "folder1", getChildNotes: async () => siblingIds.map(noteOf) }
            : null));
    }

    function makeContext(noteId: string) {
        return {
            noteId,
            notePath: `root/folder1/${noteId}`,
            viewScope: {},
            isActive: () => true,
            setNote: vi.fn()
        } as unknown as NoteContext;
    }

    /** Mounts one controller per entry, all in one tree so a test's players share the module-wide slot. */
    async function renderPlayers(players: {
        id: string;
        noteContext?: NoteContext;
        isVisible?: boolean;
        playMode?: MediaPlayMode;
        autoPlay?: boolean;
    }[]) {
        const refs = players.map(() => fakeMedia());

        function Probe({ index, player }: { index: number; player: (typeof players)[number] }) {
            useMediaSessionController({
                source: source(player.id),
                entity: noteOf(player.id),
                environment: "standalone",
                noteContext: player.noteContext,
                isVisible: player.isVisible ?? true,
                autoPlay: player.autoPlay,
                mimePrefix: "audio/",
                mediaRef: refs[index],
                playMode: player.playMode ?? "once"
            });
            return null;
        }

        await act(async () => {
            render(<>{players.map((player, index) => <Probe key={player.id} index={index} player={player} />)}</>, container);
        });
        await settle();
        return { refs };
    }

    it("lets only one player play at a time, pausing whoever held the slot", async () => {
        const { refs } = await renderPlayers([ { id: "a" }, { id: "b" } ]);
        const [ first, second ] = refs.map(ref => ref.current);
        if (!first || !second) throw new Error("no media");
        const firstPause = vi.spyOn(first, "pause");

        await act(async () => { first.dispatchEvent(new Event("play")); });
        expect(firstPause).not.toHaveBeenCalled();

        await act(async () => { second.dispatchEvent(new Event("play")); });
        expect(firstPause).toHaveBeenCalled();
    });

    it("advances to the next sibling when the playlist plays through", async () => {
        withSiblings("a", "b");
        const noteContext = makeContext("a");
        const { refs } = await renderPlayers([ { id: "a", noteContext, playMode: "next" } ]);

        await act(async () => { refs[0].current?.dispatchEvent(new Event("ended")); });

        expect(noteContext.setNote).toHaveBeenCalledWith("root/folder1/b");
    });

    it("does not advance when playing once, nor past the last sibling", async () => {
        withSiblings("a", "b");
        const playOnce = makeContext("a");
        const { refs } = await renderPlayers([ { id: "a", noteContext: playOnce, playMode: "once" } ]);
        await act(async () => { refs[0].current?.dispatchEvent(new Event("ended")); });
        expect(playOnce.setNote).not.toHaveBeenCalled();

        // "next" doesn't wrap: the last sibling simply stops.
        const atEnd = makeContext("b");
        const last = await renderPlayers([ { id: "b", noteContext: atEnd, playMode: "next" } ]);
        await act(async () => { last.refs[0].current?.dispatchEvent(new Event("ended")); });
        expect(atEnd.setNote).not.toHaveBeenCalled();
    });

    it("hands the OS media session the title and the sibling actions while it owns it", async () => {
        withSiblings("a", "b");
        const noteContext = makeContext("a");
        const { refs } = await renderPlayers([ { id: "a", noteContext } ]);

        await act(async () => { refs[0].current?.dispatchEvent(new Event("play")); });
        await settle();

        expect((mediaSession.metadata as { title: string } | null)?.title).toBe("Track");
        expect(actionHandlers.get("nexttrack")).toBeTypeOf("function");

        actionHandlers.get("nexttrack")?.({ action: "nexttrack" });
        expect(noteContext.setNote).toHaveBeenCalledWith("root/folder1/b");
    });

    it("offers no sibling actions to the OS when the media has none", async () => {
        withSiblings("a");
        const { refs } = await renderPlayers([ { id: "a", noteContext: makeContext("a") } ]);
        await act(async () => { refs[0].current?.dispatchEvent(new Event("play")); });
        await settle();

        expect(actionHandlers.get("nexttrack")).toBeNull();
        expect(actionHandlers.get("previoustrack")).toBeNull();
    });

    it("drives the element from the OS seek and stop actions", async () => {
        const { refs } = await renderPlayers([ { id: "a", noteContext: makeContext("a") } ]);
        const media = refs[0].current;
        if (!media) throw new Error("no media");
        const pause = vi.spyOn(media, "pause");
        await act(async () => { media.dispatchEvent(new Event("play")); });
        await settle();

        media.currentTime = 40;
        actionHandlers.get("seekforward")?.({ action: "seekforward" });
        expect(media.currentTime).toBe(70);
        actionHandlers.get("seekbackward")?.({ action: "seekbackward" });
        expect(media.currentTime).toBe(60);

        // An explicit offset from the OS wins over the button-matching default.
        actionHandlers.get("seekbackward")?.({ action: "seekbackward", seekOffset: 5 });
        expect(media.currentTime).toBe(55);
        actionHandlers.get("seekto")?.({ action: "seekto", seekTime: 12 });
        expect(media.currentTime).toBe(12);

        actionHandlers.get("stop")?.({ action: "stop" });
        expect(pause).toHaveBeenCalled();
        expect(media.currentTime).toBe(0);
    });

    it("keeps the session state in step with the element, and clears it on the way out", async () => {
        const { refs } = await renderPlayers([ { id: "a", noteContext: makeContext("a") } ]);
        const media = refs[0].current;
        if (!media) throw new Error("no media");

        Object.defineProperty(media, "paused", { value: false, configurable: true });
        await act(async () => { media.dispatchEvent(new Event("play")); });
        await settle();
        expect(mediaSession.playbackState).toBe("playing");
        expect(mediaSession.setPositionState).toHaveBeenCalledWith(expect.objectContaining({ duration: 100 }));

        Object.defineProperty(media, "paused", { value: true, configurable: true });
        await act(async () => { media.dispatchEvent(new Event("pause")); });
        expect(mediaSession.playbackState).toBe("paused");

        // Closing the tab unmounts the player, which hands the session back rather than leaving it stale.
        await act(async () => { render(<></>, container); });
        expect(mediaSession.metadata).toBeNull();
        expect(actionHandlers.get("stop")).toBeNull();
    });

    it("pauses a player that is no longer the displayed one", async () => {
        const { refs } = await renderPlayers([ { id: "a" } ]);
        const media = refs[0].current;
        if (!media) throw new Error("no media");
        await act(async () => { media.dispatchEvent(new Event("play")); });
        const pause = vi.spyOn(media, "pause");

        await renderPlayers([ { id: "a", isVisible: false } ]);
        expect(pause).toHaveBeenCalled();
    });

    it("starts playing a player mounted for a just-activated preview", async () => {
        const { refs } = await renderPlayers([ { id: "a", autoPlay: true } ]);
        const media = refs[0].current;
        if (!media) throw new Error("no media");
        const play = vi.spyOn(media, "play").mockResolvedValue(undefined);

        // Playback waits for the media to become playable rather than racing the fetch.
        expect(play).not.toHaveBeenCalled();
        await act(async () => { media.dispatchEvent(new Event("canplay")); });
        expect(play).toHaveBeenCalled();
    });
});
