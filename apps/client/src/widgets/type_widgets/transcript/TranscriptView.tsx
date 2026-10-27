import "./TranscriptView.css";

import {
    cleanUtteranceText, getSpeakerKey, markDisfluencies, MAX_SPEAKER_NAME_LENGTH, parseTranscript,
    setSpeakerName, type TranscriptSource, type TranscriptSourceIssue, type TranscriptUtterance
} from "@triliumnext/commons";
import clsx from "clsx";
import { Fragment } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type FAttachment from "../../../entities/fattachment";
import { copyTextWithToast } from "../../../services/clipboard_ext";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { isIMEComposing } from "../../../services/shortcuts";
import utils from "../../../services/utils";
import { useTranscriptionState } from "../../launch_bar/RecordMeetingButton";
import ActionButton from "../../react/ActionButton";
import FormTextBox from "../../react/FormTextBox";
import { useStaticTooltip, useTriliumEvent, useTriliumOptionBool } from "../../react/hooks";
import LinkButton from "../../react/LinkButton";
import NoItems from "../../react/NoItems";

/** Names given to speakers, by {@link getSpeakerKey}. */
type SpeakerNames = Record<string, string>;

/** How close to the end, in pixels, still counts as reading the newest turn. */
const FOLLOW_THRESHOLD = 16;

/** How long a pause within one speaker's turn starts a new paragraph. */
const PARAGRAPH_PAUSE_MS = 2000;

/**
 * Shows a `transcript` attachment as the conversation it records, one paragraph per speaker turn.
 * Follows the attachment as a running recording rewrites it, shows which speakers the recording
 * hears before their words are transcribed, keeps a reader who is at the end there as new
 * turns arrive, and fades its top and bottom edges while more turns are above or below. With
 * `transcriptCleanupEnabled`, shows each utterance through `cleanUtteranceText()` and leaves out
 * the ones it empties; without, shows every word, the ones the cleanup removes grayed out. The
 * stored transcript stays verbatim.
 */
export default function TranscriptView({ attachment }: { attachment: FAttachment }) {
    const [ content, setContent ] = useState<string | null>();
    const [ isCleanedUp, setCleanedUp ] = useTriliumOptionBool("transcriptCleanupEnabled");
    const recording = useTranscriptionState();
    const pending = recording.noteId === attachment.ownerId ? recording.pendingSources : [];
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [ hasMoreAbove, setHasMoreAbove ] = useState(false);
    const [ hasMoreBelow, setHasMoreBelow ] = useState(false);
    const updateEdges = (scroller: HTMLElement) => {
        setHasMoreAbove(scroller.scrollTop > 0);
        setHasMoreBelow(!wasAtEnd(scroller, scroller.scrollHeight));
    };
    /** The scroll height at the previous render, or `null` before the transcript first shows. */
    const scrollHeightRef = useRef<number | null>(null);
    /** How many utterances the first transcript read held; only later ones fade in. */
    const initialCountRef = useRef<number | null>(null);

    /** Counts loads, so only the latest one's answer is shown, whichever arrives last. */
    const loadCountRef = useRef(0);

    const load = useCallback(() => {
        const count = ++loadCountRef.current;
        void attachment.getBlob().then((blob) => {
            if (loadCountRef.current === count) {
                setContent(blob?.content ?? null);
            }
        });
        return () => {
            loadCountRef.current++;
        };
    }, [ attachment ]);
    useEffect(load, [ load ]);
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) {
            return;
        }
        const previousHeight = scrollHeightRef.current;
        if (previousHeight !== null && wasAtEnd(scroller, previousHeight)) {
            scroller.scrollTop = scroller.scrollHeight;
        }
        scrollHeightRef.current = scroller.scrollHeight;
        updateEdges(scroller);
    });
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const { attachmentId } = attachment;
        if (loadResults.getAttachmentRows().some((row) => row.attachmentId === attachmentId)) {
            load();
        }
    });

    if (content === undefined) {
        return null;
    }

    const transcript = parseTranscript(content);
    if (!transcript) {
        return <NoItems icon="bx bx-error" text={t("transcript.unreadable")} />;
    }
    if (!transcript.utterances.length && !pending.length) {
        return <NoItems icon="bx bx-microphone" text={t("transcript.empty")} />;
    }

    initialCountRef.current ??= transcript.utterances.length;
    const arrived = new Set(transcript.utterances.slice(initialCountRef.current));
    const names = transcript.speakers ?? {};
    const shownTexts = new Map<TranscriptUtterance, string>();
    for (const utterance of transcript.utterances) {
        const text = isCleanedUp ? cleanUtteranceText(utterance.text) : utterance.text;
        if (text) {
            shownTexts.set(utterance, text);
        }
    }
    const turns = groupIntoTurns([ ...shownTexts.keys() ], names);
    const lastTurn = turns.at(-1);
    const speaking = (
        <p className="transcript-speaking">
            <span className="bx bx-user-voice" aria-hidden="true" />
            {t("transcript.speaking")}
        </p>
    );
    return (
        <div
            ref={scrollerRef}
            className={clsx("transcript", {
                "more-above": hasMoreAbove,
                "more-below": hasMoreBelow
            })}
            onScroll={(e) => updateEdges(e.currentTarget)}
        >
            {transcript.utterances.length > 0 && (
                <div className="transcript-options">
                    <ActionButton
                        className="transcript-copy"
                        icon="bx bx-copy"
                        text={t("transcript.copy")}
                        onClick={() => copyTextWithToast(formatTranscriptText(
                            turns, transcript.startedAt, names,
                            (utterance) => shownTexts.get(utterance) ?? utterance.text))}
                    />
                    <ActionButton
                        className="transcript-cleanup"
                        icon="bx bx-eraser"
                        text={t("transcript.cleanup")}
                        active={isCleanedUp}
                        aria-pressed={isCleanedUp}
                        onClick={() => setCleanedUp(!isCleanedUp)}
                    />
                </div>
            )}
            {turns.map((turn) => (
                <div key={turn.offsetMs} className={`transcript-turn transcript-${turn.source}`}>
                    <div className="transcript-turn-header">
                        <SpeakerName
                            speakerKey={getSpeakerKey(turn.source, turn.speaker)}
                            name={speakerName(turn.source, turn.speaker, names)}
                            defaultName={speakerName(turn.source, turn.speaker)}
                            onRename={(key, name) => renameSpeaker(attachment, key, name)}
                        />
                        <TurnTime startedAt={transcript.startedAt} offsetMs={turn.offsetMs} />
                    </div>
                    {turn.paragraphs.map((paragraph, index) => (
                        <p key={index}>
                            {paragraph.map((utterance, position) => {
                                const text = shownTexts.get(utterance) ?? utterance.text;
                                return (
                                    <span
                                        key={utterance.offsetMs}
                                        className={arrived.has(utterance) ? "transcript-new" : undefined}
                                    >
                                        {position ? " " : ""}
                                        {isCleanedUp ? text : <SaidText text={text} />}
                                    </span>
                                );
                            })}
                        </p>
                    ))}
                    {turn === lastTurn && pending.includes(turn.source) && speaking}
                </div>
            ))}
            {pending.filter((source) => source !== lastTurn?.source).map((source) => (
                <div key={`pending-${source}`} className={`transcript-turn transcript-${source}`}>
                    <div className="transcript-turn-header">
                        <span className="transcript-speaker">
                            {speakerName(source, undefined, names)}
                        </span>
                    </div>
                    {speaking}
                </div>
            ))}
        </div>
    );
}

/** An utterance as said, its disfluencies grayed out. */
function SaidText({ text }: { text: string }) {
    return (
        <>
            {markDisfluencies(text).map((word, index) => (
                <Fragment key={index}>
                    {index ? " " : ""}
                    {word.isDisfluency
                        ? <span className="transcript-disfluency">{word.text}</span>
                        : word.text}
                </Fragment>
            ))}
        </>
    );
}

const LEVEL_ICONS: Record<TranscriptSource, string> = {
    microphone: "bx-microphone",
    system: "bx-volume-full"
};
const LEVEL_SOURCES = Object.keys(LEVEL_ICONS) as TranscriptSource[];
const ISSUE_LABELS: Record<TranscriptSourceIssue, () => string> = {
    not_captured: () => t("transcript.not_captured"),
    no_audio: () => t("transcript.no_audio"),
    silent: () => t("transcript.silent")
};

/**
 * While the meeting of `attachment` records, one meter per source, named as the transcript names
 * it, filled to its latest level, and saying so when the source is not captured, delivers no
 * audio or only silence. Shown in the header of the transcript's section, so it stays in view
 * while the turns scroll or are collapsed.
 */
export function TranscriptRecordingLevels({ attachment }: { attachment: FAttachment }) {
    const { status, noteId, sourceIssues } = useTranscriptionState();
    if (status !== "recording" || noteId !== attachment.ownerId) {
        return null;
    }
    return <TranscriptLevels sourceIssues={sourceIssues ?? {}} />;
}

function TranscriptLevels({ sourceIssues }: {
    sourceIssues: Partial<Record<TranscriptSource, TranscriptSourceIssue>>;
}) {
    const levels = useTranscriptionLevels();
    return (
        <div className="transcript-levels">
            {LEVEL_SOURCES.map((source) => {
                const level = levelToMeter(levels[source]);
                const issue = sourceIssues[source];
                return (
                    <span
                        key={source}
                        data-source={source}
                        className={clsx("transcript-level", { "has-issue": issue })}
                        role="meter"
                        aria-label={speakerName(source)}
                        aria-valuemin={0}
                        aria-valuemax={1}
                        aria-valuenow={Math.round(level * 100) / 100}
                        style={{ "--level": level }}
                    >
                        <span className={`bx ${LEVEL_ICONS[source]}`} aria-hidden="true" />
                        {speakerName(source)}
                        <span className="transcript-level-bar" aria-hidden="true" />
                        {issue && (
                            <span className="transcript-level-warning">
                                {ISSUE_LABELS[issue]()}
                            </span>
                        )}
                    </span>
                );
            })}
        </div>
    );
}

/** Each source's latest level, from `electronApi.transcription.onLevel()`. */
function useTranscriptionLevels() {
    const [ levels, setLevels ] = useState<Record<TranscriptSource, number>>({
        microphone: 0, system: 0
    });

    useEffect(() => window.electronApi?.transcription.onLevel((source, level) =>
        setLevels((current) => ({ ...current, [source]: level }))), []);

    return levels;
}

/**
 * A speaker's name, which a click turns into a field that renames every turn of the speaker: Enter
 * or leaving the field saves, Escape cancels, and a blank name or the default restores the default.
 * Speech no speaker was found for, which has no key, cannot be renamed.
 */
function SpeakerName({ speakerKey, name, defaultName, onRename }: {
    speakerKey: string | null;
    name: string;
    defaultName: string;
    onRename: (key: string, name: string) => void;
}) {
    const [ typed, setTyped ] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    /** Set once the field closes, since removing it can fire its blur after Enter or Escape. */
    const closedRef = useRef(false);
    const isEditing = typed !== null;

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.select();
        }
    }, [ isEditing ]);

    if (!speakerKey) {
        return <span className="transcript-speaker">{name}</span>;
    }
    if (!isEditing) {
        const open = () => {
            closedRef.current = false;
            setTyped(name);
        };
        return <LinkButton className="transcript-speaker" text={name} onClick={open} />;
    }

    const close = (save: boolean) => {
        if (closedRef.current) {
            return;
        }
        closedRef.current = true;
        const trimmed = typed.trim();
        setTyped(null);
        if (save && trimmed !== name) {
            onRename(speakerKey, trimmed === defaultName ? "" : trimmed);
        }
    };
    return (
        <FormTextBox
            inputRef={inputRef}
            className="transcript-speaker-editor"
            autoFocus
            maxLength={MAX_SPEAKER_NAME_LENGTH}
            aria-label={t("transcript.speaker_name")}
            currentValue={typed}
            onChange={setTyped}
            onBlur={() => close(true)}
            onKeyDown={(e) => {
                if (e.key === "Enter" && !isIMEComposing(e)) {
                    e.preventDefault();
                    close(true);
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    close(false);
                }
            }}
        />
    );
}

/**
 * Names a speaker. While a recording writes this transcript, the recording applies the name,
 * since it rewrites the transcript after every utterance and a whole-transcript save here could
 * overwrite one. Otherwise the transcript as stored now is saved with the name.
 */
async function renameSpeaker(attachment: FAttachment, key: string, name: string) {
    const { attachmentId, ownerId, role, mime, title } = attachment;
    if (await window.electronApi?.transcription?.renameSpeaker(attachmentId, key, name)) {
        return;
    }
    const latest = parseTranscript((await attachment.getBlob())?.content);
    if (!latest) {
        return;
    }
    await server.post(`notes/${ownerId}/attachments?matchBy=attachmentId`, {
        attachmentId, role, mime, title,
        content: JSON.stringify(setSpeakerName(latest, key, name), null, 2)
    });
}

/**
 * When a turn began, in local clock time, with its offset into the recording as the tooltip. Shows
 * the offset alone when the transcript's `startedAt` cannot be read.
 */
function TurnTime({ startedAt, offsetMs }: { startedAt: string; offsetMs: number }) {
    const timeRef = useRef<HTMLTimeElement>(null);
    const offset = formatOffset(offsetMs);
    const time = getTurnTime(startedAt, offsetMs);
    const tooltip = time ? t("transcript.offset", { offset }) : "";
    const tooltipConfig = useMemo(() => ({ title: tooltip }), [ tooltip ]);
    useStaticTooltip(timeRef, tooltipConfig);

    if (!time) {
        return <span className="transcript-time">{offset}</span>;
    }
    return (
        <time ref={timeRef} className="transcript-time" dateTime={time.toISOString()}>
            {utils.formatTime(time)}
        </time>
    );
}

/** Consecutive utterances of one speaker, split into paragraphs at long pauses. */
export interface TranscriptTurn {
    source: TranscriptSource;
    /** The first speaker identified in the turn, if any. */
    speaker?: number;
    offsetMs: number;
    paragraphs: TranscriptUtterance[][];
}

/**
 * Joins each run of utterances from one source and speaker into a turn, timed by its first
 * utterance, and starts a new paragraph after a pause of {@link PARAGRAPH_PAUSE_MS} or more.
 * Utterances are taken in the order they began: a recording stores them as they finish, so a
 * short reply can precede the longer utterance it answers.
 * Speakers given the same name count as one. An utterance without a speaker continues the turn of
 * its source, and an utterance without a `durationMs` never starts a paragraph, since the pause
 * before the next is unknown.
 */
export function groupIntoTurns(
    utterances: TranscriptUtterance[], names: SpeakerNames = {}
): TranscriptTurn[] {
    const identity = (source: TranscriptSource, speaker?: number) => {
        const key = getSpeakerKey(source, speaker);
        return key && names[key] ? `name:${names[key]}` : key;
    };
    const turns: TranscriptTurn[] = [];
    let previousEndMs: number | null = null;
    for (const utterance of utterances.toSorted((a, b) => a.offsetMs - b.offsetMs)) {
        const { source, speaker, offsetMs, durationMs } = utterance;
        const last = turns.at(-1);
        const isSameSpeaker = speaker === undefined || last?.speaker === undefined
            || identity(last.source, last.speaker) === identity(source, speaker);
        if (last?.source !== source || !isSameSpeaker) {
            turns.push({ source, speaker, offsetMs, paragraphs: [ [ utterance ] ] });
        } else {
            last.speaker ??= speaker;
            if (previousEndMs !== null && offsetMs - previousEndMs >= PARAGRAPH_PAUSE_MS) {
                last.paragraphs.push([ utterance ]);
            } else {
                last.paragraphs.at(-1)?.push(utterance);
            }
        }
        previousEndMs = durationMs === undefined ? null : offsetMs + durationMs;
    }
    return turns;
}

/** `m:ss`, or `h:mm:ss` from the first hour on. */
/** The quietest and the loudest RMS a level meter shows, in dB below full scale. */
const METER_FLOOR_DB = -60;
const METER_CEILING_DB = -10;

/**
 * Maps an RMS from 0 to 1 onto a level meter's 0 to 1, in decibels: speech, about 35 dB below full
 * scale, fills half of it.
 */
export function levelToMeter(level: number) {
    if (level <= 0) {
        return 0;
    }
    const db = 20 * Math.log10(level);
    const fraction = (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB);
    return Math.min(1, Math.max(0, fraction));
}

/**
 * The transcript as plain text: each turn a line with its speaker's name and clock time, then its
 * paragraphs, each as `textOf` gives its utterances, with a blank line between paragraphs and
 * turns.
 */
export function formatTranscriptText(
    turns: TranscriptTurn[], startedAt: string, names: SpeakerNames,
    textOf: (utterance: TranscriptUtterance) => string
) {
    return turns.map((turn) => {
        const time = getTurnTime(startedAt, turn.offsetMs);
        const clock = time ? utils.formatTime(time) : formatOffset(turn.offsetMs);
        const heading = `${speakerName(turn.source, turn.speaker, names)} (${clock})`;
        const paragraphs = turn.paragraphs
            .map((paragraph) => paragraph.map(textOf).join(" "));
        return `${heading}\n${paragraphs.join("\n\n")}`;
    }).join("\n\n");
}

/** The clock time a turn began at, or `null` when the transcript's start is unreadable. */
function getTurnTime(startedAt: string, offsetMs: number) {
    const startedAtMs = Date.parse(startedAt);
    return Number.isNaN(startedAtMs) ? null : new Date(startedAtMs + offsetMs);
}

export function formatOffset(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return hours
        ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
        : `${minutes}:${seconds}`;
}

/** Whether `scroller` showed the end of its content when that content was `scrollHeight` tall. */
function wasAtEnd(scroller: HTMLElement, scrollHeight: number) {
    return scrollHeight - scroller.scrollTop - scroller.clientHeight <= FOLLOW_THRESHOLD;
}

/** The name of a speaker: the one given in `names`, else the default. */
function speakerName(source: TranscriptSource, speaker?: number, names: SpeakerNames = {}) {
    const key = getSpeakerKey(source, speaker);
    if (key && names[key]) {
        return names[key];
    }
    if (source === "microphone") {
        return t("transcript.speaker_me");
    }
    return speaker === undefined
        ? t("transcript.speaker_others")
        : t("transcript.speaker_numbered", { number: speaker });
}
