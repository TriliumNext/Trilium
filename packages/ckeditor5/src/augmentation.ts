import "ckeditor5";
import { CKTextEditor } from "src";

export enum MentionAction {
    CreateNoteIntoInbox = "create-note-into-inbox",
    CreateNoteIntoPath = "create-note-into-path",
    CreateAndLinkNoteIntoInbox = "create-and-link-note-into-inbox",
    CreateAndLinkNoteIntoPath = "create-and-link-note-into-path"
}

declare global {
    interface Component {
        triggerCommand(command: string): void;
    }

    interface EditorComponent extends Component {
        loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string): Promise<void>;
        // Must Return Note Path
        createNoteFromCkEditor(title: string, parentNotePath: string | undefined, action: MentionAction): Promise<string>;
        loadIncludedNote(noteId: string, $el: JQuery<HTMLElement>): void;
    }

    var glob: {
        getComponentByEl<T extends Component>(el: unknown): T;
        getActiveContextNote(): {
            noteId: string;
        };
        getHeaders(): Promise<Record<string, string>>;
        getReferenceLinkTitle(href: string): Promise<string>;
        getReferenceLinkTitleSync(href: string): string;
    }
}
