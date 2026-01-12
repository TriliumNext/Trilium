import "./revisions.css";

import type { RevisionItem, RevisionPojo } from "@triliumnext/commons";
import clsx from "clsx";
import { diffWords } from "diff";
import type { CSSProperties } from "preact/compat";
import { Dispatch, StateUpdater, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import dialog from "../../services/dialog";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { renderMathInElement } from "../../services/math";
import open from "../../services/open";
import options from "../../services/options";
import protected_session_holder from "../../services/protected_session_holder";
import server from "../../services/server";
import toast from "../../services/toast";
import utils from "../../services/utils";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import FormList, { FormListItem } from "../react/FormList";
import FormToggle from "../react/FormToggle";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import { RawHtmlBlock } from "../react/RawHtml";
import PdfViewer from "../type_widgets/file/PdfViewer";

export default function RevisionsDialog() {
    const [ note, setNote ] = useState<FNote>();
    const [ noteContent, setNoteContent ] = useState<string>();
    const [ revisions, setRevisions ] = useState<RevisionItem[]>();
    const [ currentRevision, setCurrentRevision ] = useState<RevisionItem>();
    const [ shown, setShown ] = useState(false);
    const [ showDiff, setShowDiff ] = useState(false);
    const [ refreshCounter, setRefreshCounter ] = useState(0);

    useTriliumEvent("showRevisions", async ({ noteId }) => {
        const note = await getNote(noteId);
        if (note) {
            setNote(note);
            setShown(true);
        }
    });

    useEffect(() => {
        if (note?.noteId) {
            server.get<RevisionItem[]>(`notes/${note.noteId}/revisions`).then(setRevisions);
            note.getContent().then(setNoteContent);
        } else {
            setRevisions(undefined);
            setNoteContent(undefined);
        }
    }, [ note, refreshCounter ]);

    if (revisions?.length && !currentRevision) {
        setCurrentRevision(revisions[0]);
    }

    return (
        <Modal
            className="revisions-dialog"
            size="xl"
            title={t("revisions.note_revisions")}
            helpPageId="vZWERwf8U3nx"
            bodyStyle={{ display: "flex", height: "80vh" }}
            header={
                !!revisions?.length && (
                    <>
                        {["text", "code", "mermaid"].includes(currentRevision?.type ?? "") && (
                            <FormToggle
                                currentValue={showDiff}
                                onChange={(newValue) => setShowDiff(newValue)}
                                switchOnName={t("revisions.diff_on")}
                                switchOffName={t("revisions.diff_off")}
                                switchOnTooltip={t("revisions.diff_on_hint")}
                                switchOffTooltip={t("revisions.diff_off_hint")}
                            />
                        )}
                        &nbsp;
                        <Button
                            text={t("revisions.delete_all_revisions")}
                            size="small"
                            style={{ padding: "0 10px" }}
                            onClick={async () => {
                                const text = t("revisions.confirm_delete_all");

                                if (note && await dialog.confirm(text)) {
                                    await server.remove(`notes/${note.noteId}/revisions`);
                                    setRevisions([]);
                                    setCurrentRevision(undefined);
                                    toast.showMessage(t("revisions.revisions_deleted"));
                                }
                            }}
                        />
                    </>
                )
            }
            footer={<RevisionFooter note={note} />}
            footerStyle={{ paddingTop: 0, paddingBottom: 0 }}
            onHidden={() => {
                setShown(false);
                setShowDiff(false);
                setNote(undefined);
                setCurrentRevision(undefined);
                setRevisions(undefined);
            }}
            show={shown}
        >
            <RevisionsList
                revisions={revisions ?? []}
                onSelect={(revisionId) => {
                    const correspondingRevision = (revisions ?? []).find((r) => r.revisionId === revisionId);
                    if (correspondingRevision) {
                        setCurrentRevision(correspondingRevision);
                    }
                }}
                currentRevision={currentRevision}
            />

            <div className="revision-content-wrapper" style={{
                flexGrow: "1",
                marginInlineStart: "20px",
                display: "flex",
                flexDirection: "column",
                maxWidth: "calc(100% - 150px)",
                minWidth: 0
            }}>
                <RevisionPreview
                    noteContent={noteContent}
                    revisionItem={currentRevision}
                    showDiff={showDiff}
                    setShown={setShown}
                    onRevisionDeleted={() => {
                        setRefreshCounter(c => c + 1);
                        setCurrentRevision(undefined);
                    }} />
            </div>
        </Modal>
    );
}

function RevisionsList({ revisions, onSelect, currentRevision }: { revisions: RevisionItem[], onSelect: (val: string) => void, currentRevision?: RevisionItem }) {
    return (
        <FormList onSelect={onSelect} fullHeight wrapperClassName="revision-list">
            {revisions.map((item) =>
                <FormListItem
                    key={item.revisionId}
                    value={item.revisionId}
                    active={currentRevision && item.revisionId === currentRevision.revisionId}
                >
                    {item.dateCreated && item.dateCreated.substr(0, 16)} ({item.contentLength && utils.formatSize(item.contentLength)})
                </FormListItem>
            )}
        </FormList>);
}

function RevisionPreview({noteContent, revisionItem, showDiff, setShown, onRevisionDeleted }: {
    noteContent?: string,
    revisionItem?: RevisionItem,
    showDiff: boolean,
    setShown: Dispatch<StateUpdater<boolean>>,
    onRevisionDeleted?: () => void
}) {
    const [ fullRevision, setFullRevision ] = useState<RevisionPojo>();

    useEffect(() => {
        if (revisionItem) {
            server.get<RevisionPojo>(`revisions/${revisionItem.revisionId}`).then(setFullRevision);
        } else {
            setFullRevision(undefined);
        }
    }, [revisionItem]);

    return (
        <>
            <div style="flex-grow: 0; display: flex; justify-content: space-between;">
                <h3 className="revision-title" style="margin: 3px; flex-grow: 100;">{revisionItem?.title ?? t("revisions.no_revisions")}</h3>
                {(revisionItem && <div className="revision-title-buttons">
                    {(!revisionItem.isProtected || protected_session_holder.isProtectedSessionAvailable()) &&
                        <>
                            <Button
                                icon="bx bx-history"
                                text={t("revisions.restore_button")}
                                onClick={async () => {
                                    if (await dialog.confirm(t("revisions.confirm_restore"))) {
                                        await server.post(`revisions/${revisionItem.revisionId}/restore`);
                                        setShown(false);
                                        toast.showMessage(t("revisions.revision_restored"));
                                    }
                                }}/>
                            &nbsp;
                            <Button
                                icon="bx bx-trash"
                                text={t("revisions.delete_button")}
                                onClick={async () => {
                                    if (await dialog.confirm(t("revisions.confirm_delete"))) {
                                        await server.remove(`revisions/${revisionItem.revisionId}`);
                                        toast.showMessage(t("revisions.revision_deleted"));
                                        onRevisionDeleted?.();
                                    }
                                }} />
                            &nbsp;
                            <Button
                                primary
                                icon="bx bx-download"
                                text={t("revisions.download_button")}
                                onClick={() => {
                                    if (revisionItem.revisionId) {
                                        open.downloadRevision(revisionItem.noteId, revisionItem.revisionId);}
                                }
                                }/>
                        </>
                    }
                </div>)}
            </div>
            <div
                className={clsx("revision-content use-tn-links selectable-text", `type-${revisionItem?.type}`)}
                style={{ overflow: "auto", wordBreak: "break-word" }}
            >
                <RevisionContent noteContent={noteContent} revisionItem={revisionItem} fullRevision={fullRevision} showDiff={showDiff}/>
            </div>
        </>
    );
}

const IMAGE_STYLE: CSSProperties = {
    maxWidth: "100%",
    maxHeight: "90%",
    objectFit: "contain"
};

const CODE_STYLE: CSSProperties = {
    maxWidth: "100%",
    wordBreak: "break-all",
    whiteSpace: "pre-wrap"
};

function RevisionContent({ noteContent, revisionItem, fullRevision, showDiff }: { noteContent?:string, revisionItem?: RevisionItem, fullRevision?: RevisionPojo, showDiff: boolean}) {
    const content = fullRevision?.content;
    if (!revisionItem || !fullRevision) {
        return <></>;
    }

    if (showDiff) {
        return <RevisionContentDiff noteContent={noteContent} itemContent={content} itemType={revisionItem.type}/>;
    }
    switch (revisionItem.type) {
        case "text":
            return <RevisionContentText content={content} />;
        case "code":
            return <pre style={CODE_STYLE}>{content}</pre>;
        case "image":
            switch (revisionItem.mime) {
                case "image/svg+xml": {
                    //Base64 of other format images may be embedded in svg
                    const encodedSVG = encodeURIComponent(content as string);
                    return <img
                        src={`data:${fullRevision.mime};utf8,${encodedSVG}`}
                        style={IMAGE_STYLE} />;
                }
                default: {
                    // the reason why we put this inline as base64 is that we do not want to let user copy this
                    // as a URL to be used in a note. Instead, if they copy and paste it into a note, it will be uploaded as a new note
                    return <img
                        src={`data:${fullRevision.mime};base64,${fullRevision.content}`}
                        style={IMAGE_STYLE} />;
                }
            }
        case "file":
            return <FilePreview fullRevision={fullRevision} revisionItem={revisionItem} />;
        case "canvas":
        case "mindMap":
        case "mermaid": {
            const encodedTitle = encodeURIComponent(revisionItem.title);
            return <img
                src={`api/revisions/${revisionItem.revisionId}/image/${encodedTitle}?${Math.random()}`}
                style={IMAGE_STYLE} />;
        }
        default:
            return <>{t("revisions.preview_not_available")}</>;
    }
}

function RevisionContentText({ content }: { content: string | Buffer<ArrayBufferLike> | undefined }) {
    const contentRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (contentRef.current?.querySelector("span.math-tex")) {
            renderMathInElement(contentRef.current, { trust: true });
        }
    }, [content]);
    return <RawHtmlBlock containerRef={contentRef} className="ck-content" html={content as string} />;
}

function RevisionContentDiff({ noteContent, itemContent, itemType }: {
    noteContent?: string,
    itemContent: string | Buffer<ArrayBufferLike> | undefined,
    itemType: string
}) {
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!noteContent || typeof itemContent !== "string") {
            if (contentRef.current) {
                contentRef.current.textContent = t("revisions.diff_not_available");
            }
            return;
        }

        let processedNoteContent = noteContent;
        let processedItemContent = itemContent;

        if (itemType === "text") {
            processedNoteContent = utils.formatHtml(noteContent);
            processedItemContent = utils.formatHtml(itemContent);
        }

        const diff = diffWords(processedNoteContent, processedItemContent);
        const diffHtml = diff.map(part => {
            if (part.added) {
                return `<span class="revision-diff-added">${utils.escapeHtml(part.value)}</span>`;
            } else if (part.removed) {
                return `<span class="revision-diff-removed">${utils.escapeHtml(part.value)}</span>`;
            }
            return utils.escapeHtml(part.value);

        }).join("");

        if (contentRef.current) {
            contentRef.current.innerHTML = diffHtml;
        }
    }, [noteContent, itemContent, itemType]);

    return <div ref={contentRef} className="ck-content" style={{ whiteSpace: "pre-wrap" }} />;
}

function RevisionFooter({ note }: { note?: FNote }) {
    if (!note) {
        return <></>;
    }

    let revisionsNumberLimit: number | string = parseInt(note?.getLabelValue("versioningLimit") ?? "", 10);
    if (!Number.isInteger(revisionsNumberLimit)) {
        revisionsNumberLimit = options.getInt("revisionSnapshotNumberLimit") ?? 0;
    }
    if (revisionsNumberLimit === -1) {
        revisionsNumberLimit = "∞";
    }

    return <>
        <span class="revisions-snapshot-interval flex-grow-1 my-0 py-0">
            {t("revisions.snapshot_interval", { seconds: options.getInt("revisionSnapshotTimeInterval") })}
        </span>
        <span class="maximum-revisions-for-current-note flex-grow-1 my-0 py-0">
            {t("revisions.maximum_revisions", { number: revisionsNumberLimit })}
        </span>
        <ActionButton
            icon="bx bx-cog" text={t("revisions.settings")}
            onClick={() => appContext.tabManager.openContextWithNote("_optionsOther", { activate: true })}
        />
    </>;
}

function FilePreview({ revisionItem, fullRevision }: { revisionItem: RevisionItem, fullRevision: RevisionPojo }) {
    return (
        <div className="revision-file-preview">
            <table className="file-preview-table">
                <tbody>
                    <tr>
                        <th>{t("revisions.mime")}</th>
                        <td>{revisionItem.mime}</td>
                    </tr>
                    <tr>
                        <th>{t("revisions.file_size")}</th>
                        <td>{revisionItem.contentLength && utils.formatSize(revisionItem.contentLength)}</td>
                    </tr>
                </tbody>
            </table>

            <div class="revision-file-preview-content">
                <FilePreviewInner revisionItem={revisionItem} fullRevision={fullRevision} />
            </div>
        </div>
    );
}

function FilePreviewInner({ revisionItem, fullRevision }: { revisionItem: RevisionItem, fullRevision: RevisionPojo }) {
    if (revisionItem.mime.startsWith("audio/")) {
        return (
            <audio
                src={`api/revisions/${revisionItem.revisionId}/download`}
                controls
            />
        );
    }

    if (revisionItem.mime.startsWith("video/")) {
        return (
            <video
                src={`api/revisions/${revisionItem.revisionId}/download`}
                controls
            />
        );
    }

    if (revisionItem.mime === "application/pdf") {
        return (
            <PdfViewer
                pdfUrl={`../../api/revisions/${revisionItem.revisionId}/download`}
            />
        );
    }

    if (fullRevision.content) {
        return <pre className="file-preview-content" style={CODE_STYLE}>{fullRevision.content}</pre>;
    }

    return t("revisions.preview_not_available");
}

async function getNote(noteId?: string | null) {
    if (noteId) {
        return await froca.getNote(noteId);
    }
    return appContext.tabManager.getActiveContextNote();

}
