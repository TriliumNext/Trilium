import "./revisions.css";

import { dayjs, type RevisionItem, type RevisionPojo } from "@triliumnext/commons";
import clsx from "clsx";
import { diffWords } from "diff";
import HtmlDiff from "htmldiff-js";
import { Fragment } from "preact";
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
import Dropdown from "../react/Dropdown";
import FormList, { FormDropdownDivider, FormListItem } from "../react/FormList";
import FormToggle from "../react/FormToggle";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import NoItems from "../react/NoItems";
import { RawHtmlBlock, SanitizedHtml } from "../react/RawHtml";
import PdfViewer from "../type_widgets/file/PdfViewer";

const DIFFABLE_TYPES = ["text", "code", "mermaid"];

export default function RevisionsDialog() {
    const [ note, setNote ] = useState<FNote>();
    const [ noteContent, setNoteContent ] = useState<string>();
    const [ revisions, setRevisions ] = useState<RevisionItem[]>();
    const [ currentRevision, setCurrentRevision ] = useState<RevisionItem>();
    const [ shown, setShown ] = useState(false);
    const [ showDiff, setShowDiff ] = useState(true);
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

    const revisionsLoaded = revisions !== undefined;
    const hasRevisions = !!revisions?.length;

    if (revisions?.length && !currentRevision) {
        setCurrentRevision(revisions[0]);
    }

    const onHidden = () => {
        setShown(false);
        setShowDiff(true);
        setNote(undefined);
        setCurrentRevision(undefined);
        setRevisions(undefined);
    };

    if (revisionsLoaded && !hasRevisions) {
        return (
            <Modal
                className="revisions-dialog"
                size="md"
                title={t("revisions.note_revisions")}
                helpPageId="vZWERwf8U3nx"
                header={note && (
                    <RevisionsMenu
                        note={note}
                        onRevisionSaved={() => {
                            setRefreshCounter(c => c + 1);
                            setCurrentRevision(undefined);
                        }}
                        onAllDeleted={() => {
                            setRevisions([]);
                            setCurrentRevision(undefined);
                        }}
                        hasRevisions={false}
                    />
                )}
                onHidden={onHidden}
                show={shown}
            >
                <NoItems icon="bx bx-history" text={t("revisions.no_revisions")} />
            </Modal>
        );
    }

    return (
        <Modal
            className="revisions-dialog"
            size="xl"
            title={t("revisions.note_revisions")}
            helpPageId="vZWERwf8U3nx"
            header={note && (
                <RevisionsMenu
                    note={note}
                    onRevisionSaved={() => {
                        setRefreshCounter(c => c + 1);
                        setCurrentRevision(undefined);
                    }}
                    onAllDeleted={() => {
                        setRevisions([]);
                        setCurrentRevision(undefined);
                    }}
                    hasRevisions={true}
                />
            )}
            sidebar={
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
            }
            onHidden={onHidden}
            show={shown}
        >
            <RevisionToolbar
                revisionItem={currentRevision}
                showDiff={showDiff}
                setShowDiff={setShowDiff}
                setShown={setShown}
                onRevisionDeleted={() => {
                    setRefreshCounter(c => c + 1);
                    setCurrentRevision(undefined);
                }}
                onDescriptionUpdated={(revisionId, description) => {
                    setRevisions(prev => prev?.map(r =>
                        r.revisionId === revisionId ? { ...r, description } : r
                    ));
                    if (currentRevision?.revisionId === revisionId) {
                        setCurrentRevision({ ...currentRevision, description });
                    }
                }}
            />
            <div className="revision-content-wrapper">
                <RevisionPreview
                    noteContent={noteContent}
                    revisionItem={currentRevision}
                    showDiff={showDiff}
                />
            </div>
        </Modal>
    );
}

function RevisionsMenu({ note, onRevisionSaved, onAllDeleted, hasRevisions }: {
    note: FNote,
    onRevisionSaved: () => void,
    onAllDeleted: () => void,
    hasRevisions: boolean
}) {
    let revisionsNumberLimit: number | string = parseInt(note.getLabelValue("versioningLimit") ?? "", 10);
    if (!Number.isInteger(revisionsNumberLimit)) {
        revisionsNumberLimit = options.getInt("revisionSnapshotNumberLimit") ?? 0;
    }
    if (revisionsNumberLimit === -1) {
        revisionsNumberLimit = "∞";
    }

    return (
        <Dropdown
            text={<span className="bx bx-dots-horizontal-rounded" />}
            hideToggleArrow
            buttonClassName="custom-title-bar-button"
            noSelectButtonStyle
            buttonProps={{ title: t("revisions.menu_tooltip") }}
            dropdownContainerClassName="mobile-bottom-menu"
            dropdownOptions={{ popperConfig: { strategy: "fixed" } }}
        >
            <FormListItem
                icon="bx bx-save"
                onClick={async () => {
                    await server.post(`notes/${note.noteId}/revision`);
                    toast.showMessage(t("revisions.revision_saved"));
                    onRevisionSaved();
                }}
            >
                {t("revisions.save_revision_now")}
            </FormListItem>
            <FormListItem
                icon="bx bx-purchase-tag"
                onClick={async () => {
                    const name = await dialog.prompt({
                        title: t("entrypoints.save-named-revision-title"),
                        message: t("entrypoints.save-named-revision-message"),
                        defaultValue: ""
                    });
                    if (name === null) return;
                    await server.post(`notes/${note.noteId}/revision`, { description: name || undefined });
                    toast.showMessage(t("revisions.revision_saved"));
                    onRevisionSaved();
                }}
            >
                {t("revisions.save_named_revision")}
            </FormListItem>
            <FormDropdownDivider />
            <FormListItem disabled className="revision-menu-header">
                {t("revisions.snapshot_header")}
            </FormListItem>
            <FormListItem disabled>
                {t("revisions.snapshot_interval_value", { seconds: options.getInt("revisionSnapshotTimeInterval") })}
            </FormListItem>
            <FormListItem disabled>
                {t("revisions.snapshot_limit_value", { number: revisionsNumberLimit })}
            </FormListItem>
            <FormListItem
                icon="bx bx-cog"
                onClick={() => appContext.tabManager.openContextWithNote("_optionsOther", { activate: true })}
            >
                {t("revisions.settings")}
            </FormListItem>
            {hasRevisions && (
                <>
                    <FormDropdownDivider />
                    <FormListItem
                        icon="bx bx-trash"
                        onClick={async () => {
                            if (await dialog.confirm(t("revisions.confirm_delete_all"))) {
                                await server.remove(`notes/${note.noteId}/revisions`);
                                onAllDeleted();
                                toast.showMessage(t("revisions.revisions_deleted"));
                            }
                        }}
                    >
                        {t("revisions.delete_all_revisions")}
                    </FormListItem>
                </>
            )}
        </Dropdown>
    );
}

const REVISION_SOURCE_ICONS: Record<string, string> = {
    auto: "bx bx-time-five",
    manual: "bx bx-save",
    etapi: "bx bx-code-alt",
    llm: "bx bx-bot",
    restore: "bx bx-history"
};
const DEFAULT_REVISION_ICON = "bx bx-file";

function getRevisionSourceTitle(source?: string): string {
    return t(`revisions.source_description_${source ?? "unknown"}`);
}

type DateGroup = "today" | "yesterday" | "this_week" | "this_month" | "older";

function getDateGroup(dateStr: string): DateGroup {
    const date = dayjs(dateStr);
    const now = dayjs();

    if (date.isSame(now, "day")) return "today";
    if (date.isSame(now.subtract(1, "day"), "day")) return "yesterday";
    if (date.isSame(now, "week")) return "this_week";
    if (date.isSame(now, "month")) return "this_month";
    return "older";
}

function getDateGroupLabel(group: DateGroup, dateStr: string): string {
    if (group === "older") return dayjs(dateStr).format("MMMM YYYY");
    return t(`revisions.date_${group}`);
}

function formatRevisionDate(dateStr: string, group: DateGroup): string {
    const date = dayjs(dateStr);
    switch (group) {
        case "today":
        case "yesterday":
            return date.format("HH:mm");
        case "this_week":
            return date.format("dddd · HH:mm");
        default:
            return date.isSame(dayjs(), "year")
                ? date.format("MMM D · HH:mm")
                : date.format("MMM D, YYYY · HH:mm");
    }
}

function buildRevisionTooltip(item: RevisionItem): string {
    const dateLine = item.dateCreated
        ? `${dayjs(item.dateCreated).format("YYYY-MM-DD HH:mm")} (${dayjs(item.dateCreated).fromNow()})`
        : "";
    return [
        item.description,
        getRevisionSourceTitle(item.source),
        dateLine,
        item.contentLength && utils.formatSize(item.contentLength)
    ].filter(Boolean).join("\n");
}

function RevisionsList({ revisions, onSelect, currentRevision }: { revisions: RevisionItem[], onSelect: (val: string) => void, currentRevision?: RevisionItem }) {
    let lastGroup: DateGroup | "" = "";

    return (
        <FormList onSelect={onSelect} fullHeight wrapperClassName="revision-list">
            {revisions.map((item) => {
                const group = item.dateCreated ? getDateGroup(item.dateCreated) : "" as DateGroup;
                const showHeader = group !== lastGroup;
                lastGroup = group;

                return (
                    <Fragment key={item.revisionId}>
                        {showHeader && (
                            <div className="revision-group-header">{item.dateCreated ? getDateGroupLabel(group, item.dateCreated) : ""}</div>
                        )}
                        <FormListItem
                            key={item.revisionId}
                            value={item.revisionId}
                            icon={REVISION_SOURCE_ICONS[item.source ?? ""] ?? DEFAULT_REVISION_ICON}
                            title={buildRevisionTooltip(item)}
                            active={currentRevision && item.revisionId === currentRevision.revisionId}
                        >
                            <div>
                                <div className="revision-item-date">
                                    {item.dateCreated && formatRevisionDate(item.dateCreated, group)}
                                </div>
                                {item.description && (
                                    <div className="revision-item-description">
                                        {item.description}
                                    </div>
                                )}
                            </div>
                        </FormListItem>
                    </Fragment>
                );
            })}
        </FormList>);
}

function RevisionToolbar({ revisionItem, showDiff, setShowDiff, setShown, onRevisionDeleted, onDescriptionUpdated }: {
    revisionItem?: RevisionItem,
    showDiff: boolean,
    setShowDiff: Dispatch<StateUpdater<boolean>>,
    setShown: Dispatch<StateUpdater<boolean>>,
    onRevisionDeleted?: () => void,
    onDescriptionUpdated?: (revisionId: string, description: string) => void,
}) {
    const canShowDiff = DIFFABLE_TYPES.includes(revisionItem?.type ?? "");
    const canInteract = revisionItem && (!revisionItem.isProtected || protected_session_holder.isProtectedSessionAvailable());
    const [ editingDescription, setEditingDescription ] = useState(false);
    const [ descriptionDraft, setDescriptionDraft ] = useState("");

    useEffect(() => {
        setEditingDescription(false);
    }, [revisionItem]);

    return (
        <div className="revision-toolbar">
            {revisionItem && (
                <div className="revision-toolbar-actions">
                    {canShowDiff && (
                        <FormToggle
                            currentValue={showDiff}
                            onChange={(newValue) => setShowDiff(newValue)}
                            switchOnName={t("revisions.highlight_changes")}
                            switchOffName={t("revisions.highlight_changes")}
                        />
                    )}
                    <div style="flex-grow: 1" />
                    {canInteract && (
                        <>
                            <ActionButton
                                icon="bx bx-trash"
                                text={t("revisions.delete_button")}
                                onClick={async () => {
                                    if (await dialog.confirm(t("revisions.confirm_delete"))) {
                                        await server.remove(`revisions/${revisionItem.revisionId}`);
                                        toast.showMessage(t("revisions.revision_deleted"));
                                        onRevisionDeleted?.();
                                    }
                                }} frame />
                            <ActionButton
                                icon="bx bx-download"
                                text={t("revisions.download_button")}
                                onClick={() => {
                                    if (revisionItem.revisionId) {
                                        open.downloadRevision(revisionItem.noteId, revisionItem.revisionId);
                                    }
                                }}
                                frame />
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
                        </>
                    )}
                </div>
            )}
            {revisionItem && (
                <RevisionDescription
                    revisionItem={revisionItem}
                    editing={editingDescription}
                    draft={descriptionDraft}
                    onEdit={() => {
                        setDescriptionDraft(revisionItem.description || "");
                        setEditingDescription(true);
                    }}
                    onDraftChange={setDescriptionDraft}
                    onSave={async () => {
                        await server.patch(`revisions/${revisionItem.revisionId}`, { description: descriptionDraft });
                        setEditingDescription(false);
                        toast.showMessage(t("revisions.description_updated"));
                        onDescriptionUpdated?.(revisionItem.revisionId!, descriptionDraft);
                    }}
                    onCancel={() => setEditingDescription(false)}
                />
            )}
        </div>
    );
}

function RevisionPreview({noteContent, revisionItem, showDiff }: {
    noteContent?: string,
    revisionItem?: RevisionItem,
    showDiff: boolean,
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
        <div
            className={clsx("revision-content use-tn-links selectable-text", `type-${revisionItem?.type}`)}
            style={{ wordBreak: "break-word" }}
        >
            <h3 className="revision-title">{revisionItem?.title}</h3>
            <RevisionContent noteContent={noteContent} revisionItem={revisionItem} fullRevision={fullRevision} showDiff={showDiff}/>
        </div>
    );
}

function RevisionDescription({ revisionItem, editing, draft, onEdit, onDraftChange, onSave, onCancel }: {
    revisionItem: RevisionItem,
    editing: boolean,
    draft: string,
    onEdit: () => void,
    onDraftChange: (val: string) => void,
    onSave: () => void,
    onCancel: () => void
}) {
    if (editing) {
        return (
            <div className="revision-description-editor">
                <span className="bx bx-purchase-tag revision-description-icon" />
                <input
                    type="text"
                    className="form-control form-control-sm"
                    placeholder={t("revisions.description_placeholder")}
                    value={draft}
                    onInput={(e) => onDraftChange((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") onSave();
                        if (e.key === "Escape") onCancel();
                    }}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                />
                <ActionButton icon="bx bx-check" text={t("common.save")} onClick={onSave} />
                <ActionButton icon="bx bx-x" text={t("common.cancel")} onClick={onCancel} />
            </div>
        );
    }

    return (
        <div className="revision-description-display">
            <span className="bx bx-purchase-tag revision-description-icon" />
            <span className={clsx("revision-description-text", { empty: !revisionItem.description })}>
                {revisionItem.description || t("revisions.description_placeholder")}
            </span>
            <ActionButton
                icon="bx bx-edit-alt"
                text={t("revisions.edit_description")}
                onClick={onEdit}
            />
        </div>
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

    if (showDiff && DIFFABLE_TYPES.includes(revisionItem.type)) {
        return <RevisionContentDiff noteContent={noteContent} itemContent={content} itemType={revisionItem.type}/>;
    }
    switch (revisionItem.type) {
        case "text":
            return <RevisionContentText content={content} />;
        case "code":
            return <div className="revision-diff-code">{content}</div>;
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
        case "mermaid":
        case "spreadsheet": {
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
    if (!noteContent || typeof itemContent !== "string") {
        return <div className="revision-diff-content">{t("revisions.diff_not_available")}</div>;
    }

    let diffHtml: string;
    if (itemType === "text") {
        // Use proper HTML-aware diff for rich text content
        diffHtml = HtmlDiff.execute(noteContent, itemContent);
    } else {
        // Use word diff for code/mermaid (plain text)
        const diff = diffWords(noteContent, itemContent);
        diffHtml = diff.map(part => {
            if (part.added) {
                return `<span class="revision-diff-added">${utils.escapeHtml(part.value)}</span>`;
            } else if (part.removed) {
                return `<span class="revision-diff-removed">${utils.escapeHtml(part.value)}</span>`;
            }
            return utils.escapeHtml(part.value);
        }).join("");
    }

    return <SanitizedHtml
        className={clsx("revision-diff-content", itemType === "text" ? "ck-content" : "revision-diff-code")}
        html={diffHtml}
    />;
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
