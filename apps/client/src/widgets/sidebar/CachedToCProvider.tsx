import "./TableOfContents.css";

import type { CachedTocResponse, ReferenceParams, TocOutlineHeading } from "@triliumnext/commons";
import {
    findTocFormatName, MAX_TOC_DEPTH, type TocFormatName
} from "@triliumnext/commons/src/lib/toc.js";
import { escapeHtml } from "@triliumnext/commons/src/lib/utils.js";
import type { RefObject } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { rememberHeadingTitles } from "../../services/link";
import { createLinkedTarget } from "../../services/link_targets";
import server from "../../services/server";
import { getUnavailableReason } from "../NoteDetail";
import Button from "../react/Button";
import { useWhenShown } from "../react/hooks/dom";
import { useTriliumEvent } from "../react/hooks/events";
import { useActiveNoteContext, useGetContextData } from "../react/hooks/tree";
import Icon from "../react/Icon";
import NoItems from "../react/NoItems";
import { type OutlineReport, useOutlineReport } from "./outline_filter";
import { AbstractTableOfContents, type HeadingLinks, type RawHeading } from "./TableOfContents";

/** What the type widget of a document with a ToC format publishes as `tocDocument`. */
export type TocDocumentState =
    /** The widget is putting the document in place: the outline waits. */
    | { status: "rendering"; attachmentId?: string }
    /** The widget cannot show the document, such as a preview refused as too large. */
    | { status: "unavailable"; attachmentId?: string }
    | TocDocumentContext;

/** A document that its type widget shows, and what the outline needs from that widget. */
export interface TocDocumentContext {
    status: "shown";
    /** The ToC route of the document, from `getTocUrl()`, such as `notes/abc/toc`. */
    tocUrl: string;
    /** The attachment that the attachments view shows; absent for a note. */
    attachmentId?: string;
    /** The blob whose bytes the widget shows. Rows of the cache apply only for this blob. */
    renderedBlobId: string;
    /** The note that holds the cache attachment, whose changes reload the outline. */
    ownerNoteId: string;
    /** The link path that a copied reference extends with a heading's parameters. */
    linkPath: string;
    /** The title that a copied reference starts with: the note's, or the attachment's. */
    title: string;
    /**
     * Lands on `params` as a followed link does. `false` when its load or render is no longer the
     * current one, or the place is not shown.
     */
    showTarget(params: ReferenceParams): boolean;
    /** The id of the heading of `headings` that is being read. Republished as it changes. */
    findActiveHeading(headings: TocOutlineHeading[]): string | null;
    /** The viewer's build, where the server cannot read the format (PDF on standalone). */
    clientBuild?: ClientTocBuild;
}

/** The build of a ToC cache by the viewer of a document. */
export interface ClientTocBuild {
    status: "idle" | "building" | "failed";
    /** The latest ready cache that the build met, and the blob it is of. */
    ready?: { blobId: string; headings: TocOutlineHeading[] };
    /** Starts a build unless one runs, from `failed` too, and is `building` at once. */
    request(): void;
}

/** The ToC formats whose outline comes from the ToC cache. */
const SERVED_FORMATS = new Set<TocFormatName>([ "pdf", "docx", "odt", "epub" ]);

/** Whether the outline of a note of `type` and `mime` comes from its ToC cache. */
export function isServedTocFormat(type: string, mime: string) {
    const format = findTocFormatName(type, mime);
    return format !== undefined && SERVED_FORMATS.has(format);
}

/** The outline of a document from its ToC cache, built when the cache is not ready. */
export function CachedToCProvider() {
    const { note, noteContext } = useActiveNoteContext();
    const entry = useGetContextData("tocDocument");
    const viewScope = noteContext?.viewScope;
    const scopeAttachmentId =
        viewScope?.viewMode === "attachments" ? viewScope.attachmentId : undefined;
    const unavailableReason = useUnavailableReason(note, scopeAttachmentId, entry?.status);
    // An entry of another attachment than the one in view is a late publish.
    const document = entry && entry.attachmentId === scopeAttachmentId ? entry : undefined;
    const shown = document?.status === "shown" ? document : undefined;
    const containerRef = useRef<HTMLDivElement>(null);
    const documentKey = `${note?.noteId}:${scopeAttachmentId ?? ""}`;
    const { phase, rows, retry } = useCachedToc(documentKey, shown, containerRef);

    const headings = useMemo(() => toRows(rows?.headings ?? []), [ rows?.headings ]);
    const shownRef = useRef(shown);
    shownRef.current = shown;
    const scrollToHeading = useCallback(({ heading }: CachedTocRow) => {
        const current = shownRef.current;
        return !!current && !!heading.params && current.showTarget(heading.params);
    }, []);
    const isReady = phase === "ready";
    const linkPath = shown?.linkPath;
    const title = shown?.title;
    const headingLinks = useMemo<HeadingLinks | undefined>(() => (isReady && linkPath ? {
        async getTarget(heading) {
            const { params, title: headingTitle } = (heading as CachedTocRow).heading;
            return params ? createLinkedTarget(linkPath, headingTitle, params) : null;
        },
        // Shared pages show these documents without Trilium's viewer or their marks.
        hasPublicLinks: false,
        title
    } : undefined), [ isReady, linkPath, title ]);
    const activeHeadingId = shown && rows ? shown.findActiveHeading(rows.headings) : null;

    const isUnavailable = !!unavailableReason || document?.status === "unavailable"
        || phase === "unavailable";
    const hasList = !isUnavailable && phase !== "failed" && (!!rows || isReady || phase === "none");
    // The list reports once it is on show; until then, the provider reports for the section.
    useOutlineReport("toc", hasList ? null : getWaitingReport(isUnavailable, phase));

    return (
        <div ref={containerRef} className="cached-toc">
            {isUnavailable && <NoItems icon="bx bx-block" text={t("toc.unavailable")} />}
            {!isUnavailable && phase === "failed" && (
                <NoItems icon="bx bx-error-circle" text={t("toc.build_failed")}>
                    <Button text={t("toc.retry")} onClick={retry} />
                </NoItems>
            )}
            {hasList && (
                <AbstractTableOfContents
                    headings={headings}
                    scrollToHeading={scrollToHeading}
                    activeHeadingId={activeHeadingId}
                    note={note}
                    headingLinks={headingLinks}
                    isInert={!shown}
                    // Rows of another blob stay on show, but a filter waits for the current ones.
                    isLoading={!isReady && phase !== "none"}
                />
            )}
            {!isUnavailable && !rows && !isReady && phase !== "none" && phase !== "failed" && (
                <div className="cached-toc-waiting">
                    <Icon icon="bx bx-loader-alt bx-spin" />
                    {phase === "building" && (
                        <span className="cached-toc-waiting-text">{t("toc.building")}</span>
                    )}
                </div>
            )}
        </div>
    );
}

/** What the section reports while the provider shows no list. */
function getWaitingReport(isUnavailable: boolean, phase: LoadPhase): OutlineReport {
    if (isUnavailable) return { status: "ready", count: 0 };
    if (phase === "failed") return { status: "failed" };
    return { status: "loading", navigates: true };
}

/** A row of the outline: a heading of the cache. */
interface CachedTocRow extends RawHeading {
    heading: TocOutlineHeading;
}

function toRows(headings: TocOutlineHeading[]): CachedTocRow[] {
    return headings.map((heading) => ({
        id: heading.id,
        level: Math.min(heading.level, MAX_TOC_DEPTH),
        text: escapeHtml(heading.title),
        isDisabled: !heading.params,
        heading
    }));
}

/** Where the load of the cache of a shown document is. `rendering`: no document is shown. */
type LoadPhase = "rendering" | "loading" | "building" | "ready" | "failed" | "unavailable" | "none";

interface LoadState {
    /** The ToC route and the blob that the load is for. */
    key: string;
    phase: Exclude<LoadPhase, "rendering">;
    /** Whether the load waits for the build of the document's viewer. */
    isClientBuild?: boolean;
}

/** Headings of a document as last read, which the outline shows meanwhile. */
interface ShownRows {
    /** The note and attachment in view when the rows were read. */
    documentKey: string;
    tocUrl: string;
    /** The blob that the rows were read from. */
    blobId: string;
    headings: TocOutlineHeading[];
}

/**
 * Loads the ToC cache of `shown` while the element of `containerRef` is shown, and builds it when
 * it is not ready. The rows are those of the blob that the widget shows once `phase` is `ready`,
 * and earlier ones of the same document before.
 */
function useCachedToc(
    documentKey: string, shown: TocDocumentContext | undefined,
    containerRef: RefObject<HTMLElement | null>
) {
    const [ load, setLoad ] = useState<LoadState | null>(null);
    const [ rows, setRows ] = useState<ShownRows | null>(null);
    const [ reloads, setReloads ] = useState(0);
    const whenShown = useWhenShown(containerRef);
    const generationRef = useRef(0);
    const requestedKeyRef = useRef<string | null>(null);
    const tocUrl = shown?.tocUrl;
    const renderedBlobId = shown?.renderedBlobId;
    const key = tocUrl && renderedBlobId ? `${tocUrl}:${renderedBlobId}` : null;

    const applyHeadings = useCallback((
        url: string, blobId: string, headings: TocOutlineHeading[]
    ) => {
        setRows({ documentKey, tocUrl: url, blobId, headings });
    }, [ documentKey ]);

    useEffect(() => {
        if (!key || !tocUrl || !renderedBlobId) {
            return;
        }
        const generation = ++generationRef.current;
        const isCurrent = () => generation === generationRef.current;
        const finish = (state: Omit<LoadState, "key">) => {
            if (isCurrent()) {
                setLoad({ key, ...state });
            }
        };
        const apply = (answer: CachedTocResponse) => {
            switch (answer.status) {
                case "ready":
                    if (answer.blobId !== renderedBlobId) {
                        // An answer for another blob waits until the widget shows that blob.
                        finish({ phase: "building" });
                        return;
                    }
                    rememberHeadingTitles(tocUrl, answer.blobId, answer.headings);
                    applyHeadings(tocUrl, answer.blobId, answer.headings);
                    finish({ phase: "ready" });
                    return;
                case "stale":
                case "missing":
                    if (answer.status === "stale") {
                        applyHeadings(tocUrl, answer.blobId, answer.headings);
                    }
                    finish(answer.pendingToc
                        ? { phase: "building", isClientBuild: true }
                        : { phase: "failed" });
                    return;
                case "unreadable":
                    finish({ phase: "failed" });
                    return;
                case "unavailable":
                case "none":
                    finish({ phase: answer.status });
                    return;
            }
        };

        whenShown(() => {
            if (!isCurrent()) {
                return;
            }
            // A reload of the same blob keeps what the outline shows until it answers.
            setLoad((previous) => (previous?.key === key && previous.phase !== "failed"
                ? previous
                : { key, phase: "loading" }));
            void (async () => {
                let answer: CachedTocResponse;
                try {
                    answer = await server.getWithSilentErrors<CachedTocResponse>(tocUrl);
                    if (!isCurrent()) {
                        return;
                    }
                    const isBuiltHere = (answer.status === "stale" || answer.status === "missing")
                        && !answer.pendingToc;
                    if (isBuiltHere) {
                        if (answer.status === "stale") {
                            applyHeadings(tocUrl, answer.blobId, answer.headings);
                        }
                        finish({ phase: "building" });
                        answer = await server.postWithSilentErrors<CachedTocResponse>(
                            `${tocUrl}/build`);
                    }
                } catch {
                    finish({ phase: "failed" });
                    return;
                }
                if (isCurrent()) {
                    apply(answer);
                }
            })();
        });
        return () => {
            generationRef.current++;
        };
    }, [ key, tocUrl, renderedBlobId, reloads, whenShown, applyHeadings ]);

    // Waits for the viewer's build, and asks for one once per load.
    useEffect(() => {
        const isWaiting = load?.key === key && load.isClientBuild && load.phase === "building";
        if (!shown || !key || !isWaiting) {
            return;
        }
        const { clientBuild } = shown;
        if (!clientBuild) {
            setLoad({ key, phase: "failed" });
            return;
        }
        const { ready, status } = clientBuild;
        if (ready && ready.blobId === shown.renderedBlobId) {
            rememberHeadingTitles(shown.tocUrl, ready.blobId, ready.headings);
            applyHeadings(shown.tocUrl, ready.blobId, ready.headings);
            setLoad({ key, phase: "ready" });
        } else if (status === "failed") {
            setLoad({ key, phase: "failed", isClientBuild: true });
        } else if (status === "idle" && requestedKeyRef.current !== key) {
            requestedKeyRef.current = key;
            clientBuild.request();
        }
    }, [ shown, key, load, applyHeadings ]);

    // A cache saved elsewhere: another instance, another tab, the viewer's build.
    const ownerNoteId = shown?.ownerNoteId;
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const isCacheChanged = loadResults.getAttachmentRows()
            .some(({ role, ownerId }) => role === "tocCache" && ownerId === ownerNoteId);
        if (ownerNoteId && isCacheChanged) {
            setReloads((count) => count + 1);
        }
    });

    const retry = useCallback(() => {
        if (shown?.clientBuild && key) {
            requestedKeyRef.current = key;
            shown.clientBuild.request();
        }
        setReloads((count) => count + 1);
    }, [ shown, key ]);

    const visibleRows = rows && rows.documentKey === documentKey
        && (!tocUrl || rows.tocUrl === tocUrl) ? rows : null;
    const phase: LoadPhase = key && load?.key === key ? load.phase : "rendering";
    // Rows apply as the document's own only for the blob that the widget shows.
    const isCurrent = phase === "ready" && visibleRows?.blobId === renderedBlobId;
    return {
        phase: phase === "ready" && !isCurrent ? "building" : phase,
        rows: visibleRows,
        retry
    };
}

/**
 * Why the content of `note`, or of its attachment `attachmentId` when the view shows one, cannot
 * be shown here. Checked again as its widget comes and goes.
 */
function useUnavailableReason(
    note: FNote | null | undefined, attachmentId: string | undefined,
    entryStatus: string | undefined
) {
    const [ reason, setReason ] = useState<string | null>(null);
    useEffect(() => {
        if (!note) {
            setReason(null);
            return;
        }
        let isCurrent = true;
        void readUnavailableReason(note, attachmentId).then((result) => {
            if (isCurrent) {
                setReason(result);
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [ note, attachmentId, entryStatus ]);
    return reason;
}

/** Why `note` or its attachment `attachmentId` cannot be shown; `null` for a removed attachment. */
async function readUnavailableReason(note: FNote, attachmentId: string | undefined) {
    if (!attachmentId) {
        return await getUnavailableReason(note);
    }
    const attachment = await froca.getAttachment(attachmentId, true);
    return attachment ? await getUnavailableReason(attachment) : null;
}
