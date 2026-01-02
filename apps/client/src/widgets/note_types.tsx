/**
 * @module
 * Contains the definitions for all the note types supported by the application.
 */

import { NoteType } from "@triliumnext/commons";
import { type JSX, VNode } from "preact";

import { TypeWidgetProps } from "./type_widgets/type_widget";

/**
 * A `NoteType` altered by the note detail widget, taking into consideration whether the note is editable or not and adding special note types such as an empty one,
 * for protected session or attachment information.
 */
export type ExtendedNoteType = Exclude<NoteType, "launcher" | "text" | "code"> | "empty" | "readOnlyCode" | "readOnlyText" | "editableText" | "editableCode" | "attachmentDetail" | "attachmentList" |  "protectedSession" | "aiChat";

export type TypeWidget = ((props: TypeWidgetProps) => VNode | JSX.Element | undefined);
type NoteTypeView = () => (Promise<{ default: TypeWidget } | TypeWidget> | TypeWidget);

interface NoteTypeMapping {
    view: NoteTypeView;
    printable?: boolean;
    /** The class name to assign to the note type wrapper */
    className: string;
    isFullHeight?: boolean;
}

export const TYPE_MAPPINGS: Record<ExtendedNoteType, NoteTypeMapping> = {
    empty: {
        view: () => import("./type_widgets/Empty"),
        className: "note-detail-empty",
        printable: true
    },
    doc: {
        view: () => import("./type_widgets/Doc"),
        className: "note-detail-doc",
        printable: true
    },
    search: {
        view: () => (props: TypeWidgetProps) => <></>,
        className: "note-detail-none",
        printable: true
    },
    protectedSession: {
        view: () => import("./type_widgets/ProtectedSession"),
        className: "protected-session-password-component"
    },
    book: {
        view: () => import("./type_widgets/Book"),
        className: "note-detail-book",
        printable: true,
    },
    contentWidget: {
        view: () => import("./type_widgets/ContentWidget"),
        className: "note-detail-content-widget",
        printable: true
    },
    webView: {
        view: () => import("./type_widgets/WebView"),
        className: "note-detail-web-view",
        printable: true,
        isFullHeight: true
    },
    file: {
        view: () => import("./type_widgets/File"),
        className: "note-detail-file",
        printable: true,
        isFullHeight: true
    },
    image: {
        view: () => import("./type_widgets/Image"),
        className: "note-detail-image",
        printable: true
    },
    readOnlyCode: {
        view: async () => (await import("./type_widgets/code/Code")).ReadOnlyCode,
        className: "note-detail-readonly-code",
        printable: true
    },
    editableCode: {
        view: async () => (await import("./type_widgets/code/Code")).EditableCode,
        className: "note-detail-code",
        printable: true
    },
    mermaid: {
        view: () => import("./type_widgets/Mermaid"),
        className: "note-detail-mermaid",
        printable: true,
        isFullHeight: true
    },
    mindMap: {
        view: () => import("./type_widgets/MindMap"),
        className: "note-detail-mind-map",
        printable: true,
        isFullHeight: true
    },
    attachmentList: {
        view: async () => (await import("./type_widgets/Attachment")).AttachmentList,
        className: "attachment-list",
        printable: true
    },
    attachmentDetail: {
        view: async () => (await import("./type_widgets/Attachment")).AttachmentDetail,
        className: "attachment-detail",
        printable: true
    },
    readOnlyText: {
        view: () => import("./type_widgets/text/ReadOnlyText"),
        className: "note-detail-readonly-text"
    },
    editableText: {
        view: () => import("./type_widgets/text/EditableText"),
        className: "note-detail-editable-text",
        printable: true
    },
    render: {
        view: () => import("./type_widgets/Render"),
        className: "note-detail-render",
        printable: true
    },
    canvas: {
        view: () => import("./type_widgets/canvas/Canvas"),
        className: "note-detail-canvas",
        printable: true,
        isFullHeight: true
    },
    relationMap: {
        view: () => import("./type_widgets/relation_map/RelationMap"),
        className: "note-detail-relation-map",
        printable: true,
        isFullHeight: true
    },
    noteMap: {
        view: () => import("./type_widgets/NoteMap"),
        className: "note-detail-note-map",
        printable: true,
        isFullHeight: true
    },
    aiChat: {
        view: () => import("./type_widgets/AiChat"),
        className: "ai-chat-widget-container",
        isFullHeight: true
    }
};
