import "./MediaPlayer.css";

import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import type { ViewScope } from "../../../services/link";
import type { ShortcutHint, ShortcutHintDefinition, ShortcutHintSection } from "../../../services/shortcut_hints";
import { isAppShortcutChord } from "../../../services/shortcuts";
import { isMobile } from "../../../services/utils";
import { logError } from "../../../services/ws";
import ActionButton from "../../react/ActionButton";
import Dropdown from "../../react/Dropdown";
import { useContextualShortcutHints, useTriliumEvent, useTriliumEvents } from "../../react/hooks";
import Icon from "../../react/Icon";
import { getParentFromNotePath } from "../../react/sibling_navigation";
import { attachmentSiblingProvider, noteSiblingProvider, type SiblingNavigationState, useSiblingKeyboard, useSiblingNavigation } from "../../react/SiblingNavigator";
import type { MediaEnvironment } from "./media_environment";
import { getAutoAdvanceTarget, MEDIA_PLAY_MODE_ICONS, MEDIA_PLAY_MODE_LABEL, MEDIA_PLAY_MODE_LABEL_KEYS, MEDIA_PLAY_MODES, type MediaPlayMode, playModeFromLabel, playModeToLabel, shouldLoop } from "./media_play_mode";
import type { MediaSource } from "./media_source";

const NO_KEYS: readonly string[] = [];

/** What {@link AudioPreview} and {@link VideoPreview} are given, whichever environment they render in. */
export interface MediaPlayerProps {
    /** What is being played: a file note, or an attachment. {@link source} is its resolved media. */
    entity: FNote | FAttachment;
    source: MediaSource;
    environment: MediaEnvironment;
    /**
     * The tab showing the media. Only a detail view has one; it enables sibling navigation, the folder-level
     * play mode and OS media session ownership, all of which are silently skipped without it.
     */
    noteContext?: NoteContext;
    /**
     * When {@link entity} is an attachment: the note owning it and the tab's view scope. Together they are what
     * lets the player cycle the owner's other media attachments — the equivalent of a note's folder siblings.
     */
    ownerNote?: FNote;
    viewScope?: ViewScope;
    isVisible?: boolean;
    /** Start playing as soon as the media is ready — the user just activated a lazy preview. */
    autoPlay?: boolean;
}

// Navigation is Page Up/Down only — the player reserves Home/End for seeking (edgeKeys: false), and
// Space/Backspace aren't bound.
const MEDIA_NAVIGATION_HINTS: ShortcutHintSection = {
    titleKey: "media.hints.navigation",
    hints: [
        { keys: ["PageUp"], labelKey: "media.hints.previous" },
        { keys: ["PageDown"], labelKey: "media.hints.next" }
    ]
};

/**
 * Registers the media player's contextual keyboard hints. Video passes `fullscreen: true`; audio has
 * no fullscreen. Mirrors the actual keys bound in Video/Audio's `useKeyboardShortcuts`.
 */
export function useMediaPlayerShortcutHints({ fullscreen }: { fullscreen: boolean }) {
    useContextualShortcutHints((): ShortcutHintDefinition => {
        const playback: ShortcutHint[] = [
            { keys: ["Space"], labelKey: "media.hints.play_pause" },
            { keys: ["Left"], labelKey: "media.hints.back_10s" },
            { keys: ["Right"], labelKey: "media.hints.forward_10s" },
            { keys: ["Home"], labelKey: "media.hints.jump_start" },
            { keys: ["End"], labelKey: "media.hints.jump_end" },
            { keys: ["M"], labelKey: "media.hints.mute" }
        ];
        if (fullscreen) {
            playback.push({ keys: ["F"], labelKey: "media.hints.fullscreen" });
        }
        return [
            { titleKey: "media.hints.playback", hints: playback },
            MEDIA_NAVIGATION_HINTS
        ];
    });
}

/**
 * Whether a keystroke belongs to the player rather than to Trilium's own shortcuts. The players bind bare
 * keys (Space, arrows, M, F), which as chords are the application's — Ctrl+F is not "fullscreen", and acting
 * on it would fire alongside whatever the app does with it. The single exception is the player's own
 * Ctrl+Left/Right minute jump.
 */
export function claimsKeystroke(e: KeyboardEvent): boolean {
    if (!isAppShortcutChord(e)) return true;
    const isMinuteJump = e.key === "ArrowLeft" || e.key === "ArrowRight";
    return isMinuteJump && e.ctrlKey && !e.altKey && !e.metaKey;
}

export function SeekBar({ mediaRef }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement> }) {
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        const onTimeUpdate = () => setCurrentTime(media.currentTime);
        const onDurationChange = () => setDuration(media.duration);

        // Seed from the element now: if its metadata already loaded before this (passive) effect ran — common
        // for cached/fast media or a reused element — the initial durationchange/timeupdate already fired and
        // the listeners below would miss them, leaving duration 0. That pins max=0, so the slider sticks at the
        // start and any seek snaps playback back to 0.
        onTimeUpdate();
        onDurationChange();

        media.addEventListener("timeupdate", onTimeUpdate);
        media.addEventListener("durationchange", onDurationChange);
        return () => {
            media.removeEventListener("timeupdate", onTimeUpdate);
            media.removeEventListener("durationchange", onDurationChange);
        };
    }, [ mediaRef ]);

    const onSeek = (e: Event) => {
        const media = mediaRef.current;
        if (!media) return;
        media.currentTime = parseFloat((e.target as HTMLInputElement).value);
    };

    return (
        <div class="media-seekbar-row">
            <span class="media-time">{formatTime(currentTime)}</span>
            <input
                type="range"
                class="media-trackbar"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onInput={onSeek}
            />
            <span class="media-time">-{formatTime(Math.max(0, duration - currentTime))}</span>
        </div>
    );
}

export function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function PlayPauseButton({ playing, togglePlayback }: {    
    playing: boolean,
    togglePlayback: () => void
}) {
    return (
        <ActionButton
            className="play-button"
            icon={playing ? "bx bx-pause" : "bx bx-play"}
            text={playing ? t("media.pause") : t("media.play")}
            onClick={togglePlayback}
        />
    );
}

export function VolumeControl({ mediaRef }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement> }) {
    const [volume, setVolume] = useState(() => mediaRef.current?.volume ?? 1);
    const [muted, setMuted] = useState(() => mediaRef.current?.muted ?? false);

    // Sync state when the media element changes volume externally.
    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        setVolume(media.volume);
        setMuted(media.muted);

        const onVolumeChange = () => {
            setVolume(media.volume);
            setMuted(media.muted);
        };
        media.addEventListener("volumechange", onVolumeChange);
        return () => media.removeEventListener("volumechange", onVolumeChange);
    }, [ mediaRef ]);

    const onVolumeChange = (e: Event) => {
        const media = mediaRef.current;
        if (!media) return;
        const val = parseFloat((e.target as HTMLInputElement).value);
        media.volume = val;
        setVolume(val);
        if (val > 0 && media.muted) {
            media.muted = false;
            setMuted(false);
        }
    };

    const toggleMute = () => {
        const media = mediaRef.current;
        if (!media) return;
        media.muted = !media.muted;
        setMuted(media.muted);
    };

    // Mobile defers volume to the OS/hardware volume buttons, matching native mobile media players (and the
    // fixed-width slider doesn't fit the narrow controls row anyway).
    if (isMobile()) return null;

    return (
        <div class="media-volume-row">
            <ActionButton
                icon={muted || volume === 0 ? "bx bx-volume-mute" : volume < 0.5 ? "bx bx-volume-low" : "bx bx-volume-full"}
                text={muted ? t("media.unmute") : t("media.mute")}
                onClick={toggleMute}
            />
            <input
                type="range"
                class="media-volume-slider"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onInput={onVolumeChange}
            />
        </div>
    );
}

/** Id of the sibling we're jumping to, so only *that* media auto-plays (a cancelled jump can't leak). */
let autoPlayTargetId: string | null = null;

/** The player instance currently owning the (global) Media Session action handlers, if any. */
let mediaSessionOwner: object | null = null;

/** The player instance whose media element is currently playing. At most one plays at a time: starting
 * playback in one player makes it active and pauses every other one (see {@link setActiveMediaPlayer}). */
let activeMediaPlayer: object | null = null;

/** Per-instance callbacks (one per mounted player) invoked when {@link activeMediaPlayer} changes, so each
 * player can pause itself when it isn't the active one and re-evaluate Media Session ownership. */
const mediaPlayerSubscribers = new Set<() => void>();

/** Seconds the OS seek-back/seek-forward jump, matching the player's rewind/fast-forward buttons. */
const SEEK_BACK_SECONDS = 10;
const SEEK_FORWARD_SECONDS = 30;

/** Media Session actions this controller owns (and must release together) — distinct from play/pause/seek,
 * which the browser binds to the media element on its own. */
const OWNED_MEDIA_ACTIONS: MediaSessionAction[] = [ "previoustrack", "nexttrack", "seekbackward", "seekforward", "seekto", "stop" ];

/**
 * Wires a media player to its surroundings: sibling navigation (returned, for the prev/next buttons) plus
 * PageUp/PageDown, and the OS Media Session — previous/next track, seek (matching the −10s/+30s buttons),
 * seek-to (scrubber) and stop, with the note title as metadata. Play/pause and basic seek are left to the
 * browser's default binding on the element. Jumping to a sibling auto-plays it, like a playlist. Starting
 * playback pauses every other media player (audio or video), so only one plays at a time; that player owns
 * the global Media Session and keeps the OS controls while paused or while its tab is inactive (it keeps
 * playing in the background). It releases the session — and, when its tab switches to a different note type so
 * this player is hidden/cached, also stops playing — on that navigation, on a handover, or on unmount.
 */
export function useMediaSessionController({ source, entity, noteContext, ownerNote, viewScope, mimePrefix, mediaRef, isVisible = true, playMode, autoPlay }: MediaPlayerProps & {
    mimePrefix: string;
    mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement>;
    playMode: MediaPlayMode;
}) {
    // A note cycles the playable siblings in its folder; an attachment cycles the owner note's playable
    // attachments. Either way it takes a tab to navigate in, so without one there is nothing to move between.
    const note = "noteId" in entity ? entity : undefined;
    const navigation = useSiblingNavigation(note
        ? noteSiblingProvider(note, noteContext, { mimePrefix })
        : attachmentSiblingProvider(ownerNote, noteContext, viewScope ?? {}, { mimePrefix }));
    // Stable identity for this player instance, used to coordinate with the other mounted players.
    const self = useRef<object>({}).current;

    // Re-render on tab/note switches so a cached/background player re-evaluates promptly — its ownership of
    // the session can change when another player starts or its own context navigates.
    const [ , bump ] = useState(0);
    useTriliumEvents([ "activeContextChanged", "activeNoteChanged" ], () => bump((tick) => tick + 1));

    // The currently-playing player owns the OS Media Session. It owns iff it's the *displayed* type widget for
    // its context (`isVisible`) AND it holds the active-playback slot — so the session is kept through pauses and
    // while the tab is merely inactive (still the displayed type there → background playback). It's released on a
    // handover (another player starts), on unmount (tab closed), or when the tab switches to a different note type
    // so this player is hidden/cached (the stop-on-stale effect below also pauses it then). Using `isVisible`
    // rather than a note-id match avoids a transient release during a same-type sibling jump, where the cached
    // props briefly lag the context's note id.
    const ownsSession = isVisible && activeMediaPlayer === self;

    const wrapped = navigation && isVisible ? {
        ...navigation,
        navigatePrevious: () => { autoPlayTargetId = navigation.previousId; navigation.navigatePrevious(); },
        navigateNext: () => { autoPlayTargetId = navigation.nextId; navigation.navigateNext(); }
    } : null;

    useSiblingKeyboard(wrapped, noteContext, undefined, NO_KEYS, NO_KEYS, { edgeKeys: false });

    const hasMediaNav = !!wrapped;
    const wrappedRef = useRef(wrapped);
    wrappedRef.current = wrapped;
    // Read inside the (stable) ended handler without re-registering the listener on every mode change.
    const playModeRef = useRef(playMode);
    playModeRef.current = playMode;

    // Only one media element plays at a time. Starting playback claims the global "active" slot and notifies
    // every other mounted player (audio or video) so they pause themselves and hand over the OS Media Session.
    // The slot is *kept* through pause/end (a paused player keeps the session); it's only released when another
    // player claims it or when this player unmounts (its tab is closed). When a track ends and the parent folder
    // opted in (`#mediaNotesPlayMode=next`), auto-advance to the next sibling: navigation reuses this same media
    // element (siblings share the type), so playback — and with it the OS session that keeps a backgrounded /
    // sleeping mobile page alive — continues across the jump rather than the page going idle.
    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;
        const claim = () => setActiveMediaPlayer(self);
        const onEnded = () => {
            const navigation = wrappedRef.current;
            if (navigation && getAutoAdvanceTarget(playModeRef.current, navigation)) {
                navigation.navigateNext();
            }
        };
        media.addEventListener("play", claim);
        media.addEventListener("ended", onEnded);
        return () => {
            media.removeEventListener("play", claim);
            media.removeEventListener("ended", onEnded);
            if (activeMediaPlayer === self) setActiveMediaPlayer(null);
        };
    }, [ self, mediaRef ]);

    // When another player claims the active slot, pause ourselves and re-render so we release the session.
    useEffect(() => {
        const onActivePlayerChange = () => {
            if (activeMediaPlayer !== self) mediaRef.current?.pause();
            bump((tick) => tick + 1);
        };
        mediaPlayerSubscribers.add(onActivePlayerChange);
        return () => { mediaPlayerSubscribers.delete(onActivePlayerChange); };
    }, [ self, mediaRef ]);

    // Stop a hidden/cached player: when its tab switches to a different note type this widget is no longer the
    // displayed one (`isVisible` false), so pause it and give up the active slot — there's no visible player for
    // it anymore. A merely-inactive tab still displays this type (isVisible stays true) and so keeps playing.
    useEffect(() => {
        if (!isVisible) {
            mediaRef.current?.pause();
            if (activeMediaPlayer === self) setActiveMediaPlayer(null);
        }
    }, [ isVisible, mediaRef, self ]);

    // Bind the OS Media Session (which desktop/hardware media keys route to, rather than keydown) and its
    // metadata while this player owns the session (its context's current note, and the one playing). They're
    // global, so only ever release our own — otherwise the outgoing player's cleanup during a handover would
    // clobber the incoming player's; the release also clears them so nothing lingers in the OS overlay.
    useEffect(() => {
        if (!("mediaSession" in navigator)) return;
        const mediaSession = navigator.mediaSession;
        const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
            try { mediaSession.setActionHandler(action, handler); } catch { /* action unsupported */ }
        };
        const release = () => {
            if (mediaSessionOwner !== self) return;
            mediaSessionOwner = null;
            for (const action of OWNED_MEDIA_ACTIONS) setHandler(action, null);
            mediaSession.metadata = null;
        };
        if (!ownsSession) {
            release();
            return;
        }
        mediaSessionOwner = self;
        // Metadata makes Chromium reliably present the OS controls for video (it does so for audio by
        // default) and shows the note title there.
        if (typeof MediaMetadata !== "undefined") mediaSession.metadata = new MediaMetadata({ title: source.title });
        // Previous/next track navigate siblings (only when there are any); the live re-check guards against
        // the context having navigated to a different note since these handlers were bound.
        setHandler("previoustrack", hasMediaNav ? () => { if (isCurrentContextMedia(noteContext, source.id)) wrappedRef.current?.navigatePrevious(); } : null);
        setHandler("nexttrack", hasMediaNav ? () => { if (isCurrentContextMedia(noteContext, source.id)) wrappedRef.current?.navigateNext(); } : null);
        // Seek/stop drive this player's element, using the same amounts as its rewind/fast-forward buttons.
        setHandler("seekbackward", (details) => seekBy(mediaRef, -(details.seekOffset || SEEK_BACK_SECONDS)));
        setHandler("seekforward", (details) => seekBy(mediaRef, details.seekOffset || SEEK_FORWARD_SECONDS));
        setHandler("seekto", (details) => { if (details.seekTime != null) seekTo(mediaRef, details.seekTime); });
        setHandler("stop", () => stopMedia(mediaRef));
        return release;
    }, [ ownsSession, hasMediaNav, noteContext, source.id, source.title, mediaRef, self ]);

    // Keep the OS Media Session's playback and position state in sync while we own it. Android Chrome relies on
    // these to treat the page as actively playing media: it keeps the notification controls present and makes
    // the backgrounded tab far less likely to be frozen/suspended — a freeze drops the audio stream's connection
    // and stops playback. Without them Chrome only infers state from the element, which is unreliable once hidden.
    useEffect(() => {
        if (!("mediaSession" in navigator)) return;
        const mediaSession = navigator.mediaSession;
        const media = mediaRef.current;
        if (!ownsSession || !media) return;

        const syncPlaybackState = () => {
            mediaSession.playbackState = media.paused ? "paused" : "playing";
        };
        const syncPositionState = () => {
            if (typeof mediaSession.setPositionState !== "function") return;
            // setPositionState throws on a non-finite/zero duration or an out-of-range position.
            if (!Number.isFinite(media.duration) || media.duration <= 0) return;
            try {
                mediaSession.setPositionState({
                    duration: media.duration,
                    playbackRate: media.playbackRate || 1,
                    position: Math.min(Math.max(0, media.currentTime), media.duration)
                });
            } catch { /* transient invalid state; the next timeupdate will retry */ }
        };
        const syncBoth = () => { syncPlaybackState(); syncPositionState(); };

        syncBoth();
        media.addEventListener("play", syncBoth);
        media.addEventListener("pause", syncPlaybackState);
        media.addEventListener("ended", syncPlaybackState);
        media.addEventListener("durationchange", syncPositionState);
        media.addEventListener("ratechange", syncPositionState);
        media.addEventListener("timeupdate", syncPositionState);
        media.addEventListener("seeked", syncPositionState);
        return () => {
            media.removeEventListener("play", syncBoth);
            media.removeEventListener("pause", syncPlaybackState);
            media.removeEventListener("ended", syncPlaybackState);
            media.removeEventListener("durationchange", syncPositionState);
            media.removeEventListener("ratechange", syncPositionState);
            media.removeEventListener("timeupdate", syncPositionState);
            media.removeEventListener("seeked", syncPositionState);
            // We no longer own the session (handover/hidden/unmount); clear so the OS overlay doesn't keep a
            // stale "playing" state — but only if another player hasn't already taken the slot, otherwise this
            // late cleanup would clobber the new owner's freshly-set state.
            if (activeMediaPlayer === self || activeMediaPlayer === null) {
                mediaSession.playbackState = "none";
                if (typeof mediaSession.setPositionState === "function") {
                    try { mediaSession.setPositionState(); } catch { /* nothing to clear */ }
                }
            }
        };
    }, [ ownsSession, mediaRef, self ]);

    // Play as soon as the media can: either this note was reached by a sibling jump, or the user just
    // activated a lazy preview (whose player only mounts on that click, so it starts playing right away).
    useEffect(() => {
        const jumpedTo = autoPlayTargetId === source.id;
        if (jumpedTo) autoPlayTargetId = null;
        if (!jumpedTo && !autoPlay) return;

        const media = mediaRef.current;
        if (!media) return;
        const play = () => { media.play().catch(() => {}); };
        if (media.readyState >= media.HAVE_FUTURE_DATA) {
            play();
        } else {
            media.addEventListener("canplay", play, { once: true });
            return () => media.removeEventListener("canplay", play);
        }
    }, [ source.id, autoPlay, mediaRef ]);

    return wrapped;
}

/**
 * Whether `id` (a noteId, or an attachmentId when playing an attachment) is what `noteContext` currently
 * shows in its own tab/split, regardless of whether that tab is the active one. This gates Media Session
 * ownership: a backgrounded player stays the owner while its media plays, and only a stale/cached player
 * (whose context has since moved elsewhere) reports false and stands down. Closing the tab unmounts the
 * player, which releases the session via the effect cleanup instead.
 */
function isCurrentContextMedia(noteContext: NoteContext | undefined, id: string): boolean {
    if (!noteContext) return false;
    // An attachment view names its attachment in the view scope; the note behind it is only the owner.
    return noteContext.viewScope?.attachmentId ? noteContext.viewScope.attachmentId === id : noteContext.noteId === id;
}

/** Marks `player` as the one currently playing and notifies the rest so they pause and release the session. */
function setActiveMediaPlayer(player: object | null) {
    if (activeMediaPlayer === player) return;
    activeMediaPlayer = player;
    for (const notify of mediaPlayerSubscribers) notify();
}

function seekBy(mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement>, offset: number) {
    const media = mediaRef.current;
    // duration is NaN until metadata loads; setting currentTime to NaN throws.
    if (media && Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + offset));
}

function seekTo(mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement>, time: number) {
    const media = mediaRef.current;
    if (media && Number.isFinite(time)) media.currentTime = time;
}

function stopMedia(mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement>) {
    const media = mediaRef.current;
    if (!media) return;
    media.pause();
    media.currentTime = 0;
}

/** "Skip to previous/next sibling" control, styled like the other media buttons; renders nothing without siblings. */
export function MediaSiblingButton({ navigation, direction, tooltipI18nKey }: { navigation: SiblingNavigationState | null, direction: "previous" | "next", tooltipI18nKey: string }) {
    if (!navigation) return null;
    const isPrevious = direction === "previous";
    return (
        <ActionButton
            icon={isPrevious ? "bx bx-skip-previous" : "bx bx-skip-next"}
            text={t(tooltipI18nKey, { title: isPrevious ? navigation.previousTitle : navigation.nextTitle })}
            onClick={() => (isPrevious ? navigation.navigatePrevious() : navigation.navigateNext())}
        />
    );
}

export function SkipButton({ mediaRef, seconds, icon, text }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement>, seconds: number, icon: string, text: string }) {
    const skip = () => {
        const media = mediaRef.current;
        if (!media) return;
        media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + seconds));
    };

    return (
        <ActionButton icon={icon} text={text} onClick={skip} />
    );
}

/**
 * The play mode (a `#mediaNotesPlayMode` label) shared by everything the player can move between, kept in sync
 * as that label changes. It lives on whatever holds that playlist: the parent folder for a media note, or — via
 * `playlistNoteId` — the owner note for one of its media attachments. Derives the element's `loop` from the
 * mode and persists changes back there; the `next` mode's actual auto-advance is handled by
 * {@link useMediaSessionController} (which receives the resolved `mode`).
 */
export function useMediaPlayMode(noteContext: NoteContext | undefined, mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement>, playlistNoteId?: string): { mode: MediaPlayMode; setMode: (mode: MediaPlayMode) => void } {
    const parentNoteId = playlistNoteId ?? getParentFromNotePath(noteContext?.notePath)?.parentNoteId;
    const [ mode, setLocalMode ] = useState<MediaPlayMode>("once");
    const [ refreshCounter, setRefreshCounter ] = useState(0);

    // On a folder change, reset to the default immediately so the button doesn't briefly show the previous
    // folder's mode until the new parent's label loads. Keyed on parentNoteId only — resetting on every
    // refreshCounter bump would flash "once" when the mode is changed via the dropdown.
    useEffect(() => { setLocalMode("once"); }, [ parentNoteId ]);

    // Load the mode from the parent's label. The `active` flag discards a stale response when the parent
    // changes mid-flight (rapid navigation), so a slower earlier fetch can't overwrite a newer note's mode.
    useEffect(() => {
        if (!parentNoteId) {
            setLocalMode("once");
            return;
        }
        let active = true;
        froca.getNote(parentNoteId)
            .then((parent) => { if (active) setLocalMode(playModeFromLabel(parent?.getLabelValue(MEDIA_PLAY_MODE_LABEL))); })
            .catch(() => {});
        return () => { active = false; };
    }, [ parentNoteId, refreshCounter ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (parentNoteId && loadResults.getAttributeRows().some((attr) => attr.noteId === parentNoteId && attr.name === MEDIA_PLAY_MODE_LABEL)) {
            setRefreshCounter((counter) => counter + 1);
        }
    });

    // Looping is derived from the mode (auto-advance for "next" lives in useMediaSessionController's ended handler).
    useEffect(() => {
        const media = mediaRef.current;
        if (media) media.loop = shouldLoop(mode);
    }, [ mode, mediaRef ]);

    const setMode = useCallback((next: MediaPlayMode) => {
        setLocalMode(next); // optimistic; the entitiesReloaded refresh confirms it once the parent label is written
        if (!parentNoteId) return;
        froca.getNote(parentNoteId).then((parent) => {
            if (!parent) return;
            const value = playModeToLabel(next);
            // Return the persist promise so a failed server write reaches the outer .catch instead of leaving the
            // optimistic mode silently diverged. Removal stays owned-only (never an inherited ancestor's label),
            // but via the awaitable removeAttributeById so its failure is caught too.
            if (value === null) {
                const owned = parent.getOwnedLabel(MEDIA_PLAY_MODE_LABEL);
                return owned ? attributes.removeAttributeById(parent.noteId, owned.attributeId) : undefined;
            }
            return attributes.setLabel(parent.noteId, MEDIA_PLAY_MODE_LABEL, value);
        }).catch((e) => logError(`Could not persist media play mode: ${e}`));
    }, [ parentNoteId ]);

    return { mode, setMode };
}

/** Replaces the loop toggle: a dropdown to pick the playlist's play mode (play once / loop / autoplay). */
export function PlayModeButton({ mode, onSelectMode }: { mode: MediaPlayMode, onSelectMode: (mode: MediaPlayMode) => void }) {
    return (
        <Dropdown
            iconAction
            hideToggleArrow
            className="play-mode-dropdown"
            text={<Icon icon={MEDIA_PLAY_MODE_ICONS[mode]} />}
            title={t("media.play-mode-title", { mode: t(MEDIA_PLAY_MODE_LABEL_KEYS[mode]) })}
        >
            {MEDIA_PLAY_MODES.map((candidate) => (
                <li key={candidate}>
                    <button
                        type="button"
                        class={`dropdown-item ${candidate === mode ? "active" : ""}`}
                        onClick={() => onSelectMode(candidate)}
                    >
                        <Icon icon={MEDIA_PLAY_MODE_ICONS[candidate]} />
                        <span class="play-mode-name">{t(MEDIA_PLAY_MODE_LABEL_KEYS[candidate])}</span>
                        {candidate === mode && <Icon icon="bx bx-check" className="play-mode-check" />}
                    </button>
                </li>
            ))}
        </Dropdown>
    );
}

const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export function PlaybackSpeed({ mediaRef }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement> }) {
    const [speed, setSpeed] = useState(() => mediaRef.current?.playbackRate ?? 1);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        setSpeed(media.playbackRate);

        const onRateChange = () => setSpeed(media.playbackRate);
        media.addEventListener("ratechange", onRateChange);
        return () => media.removeEventListener("ratechange", onRateChange);
    }, [ mediaRef ]);

    const selectSpeed = (rate: number) => {
        const media = mediaRef.current;
        if (!media) return;
        media.playbackRate = rate;
        setSpeed(rate);
    };

    return (
        <Dropdown
            iconAction
            hideToggleArrow
            buttonClassName="speed-dropdown"
            text={<>
                <Icon icon="bx bx-tachometer" />
                <span class="media-speed-label">{speed}x</span>
            </>}
            title={t("media.playback-speed")}
        >
            {PLAYBACK_SPEEDS.map((rate) => (
                <li key={rate}>
                    <button
                        class={`dropdown-item ${rate === speed ? "active" : ""}`}
                        onClick={() => selectSpeed(rate)}
                    >
                        {rate}x
                    </button>
                </li>
            ))}
        </Dropdown>
    );
}
