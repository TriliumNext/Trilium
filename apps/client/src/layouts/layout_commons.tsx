import type RootContainer from "../widgets/containers/root_container.js";

import AboutDialog from "../widgets/dialogs/about.js";
import HelpDialog from "../widgets/dialogs/help.js";
import JumpToNoteDialog from "../widgets/dialogs/jump_to_note.js";
import RecentChangesDialog from "../widgets/dialogs/recent_changes.js";
import PromptDialog from "../widgets/dialogs/prompt.js";
import AddLinkDialog from "../widgets/dialogs/add_link.js";
import IncludeNoteDialog from "../widgets/dialogs/include_note.js";
import BulkActionsDialog from "../widgets/dialogs/bulk_actions.js";
import BranchPrefixDialog from "../widgets/dialogs/branch_prefix.js";
import SortChildNotesDialog from "../widgets/dialogs/sort_child_notes.js";
import NoteTypeChooserDialog from "../widgets/dialogs/note_type_chooser.js";
import MoveToDialog from "../widgets/dialogs/move_to.js";
import CloneToDialog from "../widgets/dialogs/clone_to.js";
import ImportDialog from "../widgets/dialogs/import.js";
import ExportDialog from "../widgets/dialogs/export.js";
import MarkdownImportDialog from "../widgets/dialogs/markdown_import.js";
import ProtectedSessionPasswordDialog from "../widgets/dialogs/protected_session_password.js";
import ConfirmDialog from "../widgets/dialogs/confirm.js";
import RevisionsDialog from "../widgets/dialogs/revisions.js";
import DeleteNotesDialog from "../widgets/dialogs/delete_notes.js";
import InfoDialog from "../widgets/dialogs/info.js";
import IncorrectCpuArchDialog from "../widgets/dialogs/incorrect_cpu_arch.js";
import PopupEditorDialog from "../widgets/dialogs/popup_editor.js";
import FlexContainer from "../widgets/containers/flex_container.js";
import NoteIconWidget from "../widgets/note_icon";
import PromotedAttributesWidget from "../widgets/promoted_attributes.js";
import NoteDetailWidget from "../widgets/note_detail.js";
import CallToActionDialog from "../widgets/dialogs/call_to_action.jsx";
import NoteTitleWidget from "../widgets/note_title.jsx";
import { PopupEditorFormattingToolbar } from "../widgets/ribbon/FormattingToolbar.js";
import NoteList from "../widgets/collections/NoteList.jsx";

export function applyModals(rootContainer: RootContainer) {
    rootContainer
        .child(<BulkActionsDialog />)
        .child(<AboutDialog />)
        .child(<HelpDialog />)
        .child(<RecentChangesDialog />)
        .child(<BranchPrefixDialog />)
        .child(<SortChildNotesDialog />)
        .child(<IncludeNoteDialog />)
        .child(<NoteTypeChooserDialog />)
        .child(<JumpToNoteDialog />)
        .child(<AddLinkDialog />)
        .child(<CloneToDialog />)
        .child(<MoveToDialog />)
        .child(<ImportDialog />)
        .child(<ExportDialog />)
        .child(<MarkdownImportDialog />)
        .child(<ProtectedSessionPasswordDialog />)
        .child(<RevisionsDialog />)
        .child(<DeleteNotesDialog />)
        .child(<InfoDialog />)
        .child(<ConfirmDialog />)
        .child(<PromptDialog />)
        .child(<IncorrectCpuArchDialog />)
        .child(new PopupEditorDialog()
                .child(new FlexContainer("row")
                    .class("title-row")
                    .css("align-items", "center")
                    .cssBlock(".title-row > * { margin: 5px; }")
                    .child(<NoteIconWidget />)
                    .child(<NoteTitleWidget />))
                .child(<PopupEditorFormattingToolbar />)
                .child(new PromotedAttributesWidget())
                .child(new NoteDetailWidget())
                .child(<NoteList media="screen" displayOnlyCollections />))
        .child(<CallToActionDialog />);
}
