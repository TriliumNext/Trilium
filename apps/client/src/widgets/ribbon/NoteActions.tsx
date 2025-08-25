import { ConvertToAttachmentResponse } from "@triliumnext/commons";
import appContext, { CommandNames } from "../../components/app_context";
import FNote from "../../entities/fnote"
import dialog from "../../services/dialog";
import { t } from "../../services/i18n"
import server from "../../services/server";
import toast from "../../services/toast";
import ws from "../../services/ws";
import ActionButton from "../react/ActionButton"
import Dropdown from "../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import { isElectron as getIsElectron, isMac as getIsMac } from "../../services/utils";
import { ParentComponent } from "../react/react_utils";
import { useContext } from "preact/hooks";
import NoteContext from "../../components/note_context";
import branches from "../../services/branches";

interface NoteActionsProps {
  note?: FNote;
  noteContext?: NoteContext;
}

export default function NoteActions({ note, noteContext }: NoteActionsProps) {
  return (
    <>
      {note && <RevisionsButton note={note} />}
      {note && note.type !== "launcher" && <NoteContextMenu note={note as FNote} noteContext={noteContext}/>}
    </>
  );
}

function RevisionsButton({ note }: { note: FNote }) {
  const isEnabled = !["launcher", "doc"].includes(note?.type ?? "");

  return (isEnabled &&
    <ActionButton
      icon="bx bx-history"
      text={t("revisions_button.note_revisions")}
      triggerCommand="showRevisions"
      titlePosition="bottom"
    />
  );
}

function NoteContextMenu({ note, noteContext }: { note: FNote, noteContext?: NoteContext }) {
  const parentComponent = useContext(ParentComponent);
  const canBeConvertedToAttachment = note?.isEligibleForConversionToAttachment();
  const isSearchable = ["text", "code", "book", "mindMap", "doc"].includes(note.type);
  const isInOptions = note.noteId.startsWith("_options");
  const isPrintable = ["text", "code"].includes(note.type);
  const isElectron = getIsElectron();
  const isMac = getIsMac();
  const hasSource = ["text", "code", "relationMap", "mermaid", "canvas", "mindMap"].includes(note.type);
  const isSearchOrBook = ["search", "book"].includes(note.type);  

  return (
    <Dropdown
      buttonClassName="bx bx-dots-vertical-rounded"
      className="note-actions"
      hideToggleArrow
      noSelectButtonStyle
    >
      {canBeConvertedToAttachment && <ConvertToAttachment note={note} /> }
      {note.type === "render" && <CommandItem command="renderActiveNote" icon="bx bx-extension" text={t("note_actions.re_render_note")} />}
      <CommandItem command="findInText" icon="bx bx-search" disabled={!isSearchable} text={t("note_actions.search_in_note")} />
      <CommandItem command="printActiveNote" icon="bx bx-printer" disabled={!isPrintable} text={t("note_actions.print_note")} />
      {isElectron && <CommandItem command="exportAsPdf" icon="bx bxs-file-pdf" disabled={!isPrintable} text={t("note_actions.print_pdf")} />}
      <FormDropdownDivider />

      <CommandItem icon="bx bx-import" text={t("note_actions.import_files")}
        disabled={isInOptions || note.type === "search"}
        command={() => parentComponent?.triggerCommand("showImportDialog", { noteId: note.noteId })} />
      <CommandItem icon="bx bx-export" text={t("note_actions.export_note")}
        disabled={isInOptions || note.noteId === "_backendLog"}
        command={() => noteContext?.notePath && parentComponent?.triggerCommand("showExportDialog", {
          notePath: noteContext.notePath, 
          defaultType: "single"
        })} />
      <FormDropdownDivider />

      <CommandItem command="openNoteExternally" icon="bx bx-file-find" disabled={isSearchOrBook || !isElectron} text={t("note_actions.open_note_externally")} title={t("note_actions.open_note_externally_title")} />
      <CommandItem command="openNoteCustom" icon="bx bx-customize" disabled={isSearchOrBook || isMac || !isElectron} text={t("note_actions.open_note_custom")} />
      <CommandItem command="showNoteSource" icon="bx bx-code" disabled={!hasSource} text={t("note_actions.note_source")} />
      <FormDropdownDivider />

      <CommandItem command="forceSaveRevision" icon="bx bx-save" disabled={isInOptions} text={t("note_actions.save_revision")} />
      <CommandItem icon="bx bx-trash destructive-action-icon" text={t("note_actions.delete_note")} destructive
        disabled={isInOptions}
        command={() => branches.deleteNotes([note.getParentBranches()[0].branchId])}
      />
      <FormDropdownDivider />

      <CommandItem command="showAttachments" icon="bx bx-paperclip" disabled={isInOptions} text={t("note_actions.note_attachments")} />
    </Dropdown>
  );
}

function CommandItem({ icon, text, title, command, disabled }: { icon: string, text: string, title?: string, command: CommandNames | (() => void), disabled?: boolean, destructive?: boolean }) {
  return <FormListItem
    icon={icon}
    title={title}
    triggerCommand={typeof command === "string" ? command : undefined}
    onClick={typeof command === "function" ? command : undefined}
    disabled={disabled}
  >{text}</FormListItem>
}

function ConvertToAttachment({ note }: { note: FNote }) {
  return (
    <FormListItem
        icon="bx bx-paperclip"
        onClick={async () => {
          if (!note || !(await dialog.confirm(t("note_actions.convert_into_attachment_prompt", { title: note.title })))) {
            return;
          }

          const { attachment: newAttachment } = await server.post<ConvertToAttachmentResponse>(`notes/${note.noteId}/convert-to-attachment`);

          if (!newAttachment) {
            toast.showMessage(t("note_actions.convert_into_attachment_failed", { title: note.title }));
            return;
          }

          toast.showMessage(t("note_actions.convert_into_attachment_successful", { title: newAttachment.title }));
          await ws.waitForMaxKnownEntityChangeId();
          await appContext.tabManager.getActiveContext()?.setNote(newAttachment.ownerId, {
              viewScope: {
                  viewMode: "attachments",
                  attachmentId: newAttachment.attachmentId
              }
          });
        }}
      >{t("note_actions.convert_into_attachment")}</FormListItem>
  )
}