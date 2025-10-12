import "ckeditor5";
import { type CreateNoteAction } from "@triliumnext/commons"

declare global {
    interface Component {
        triggerCommand(command: string): void;
    }

    interface EditorComponent extends Component {
        loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string): Promise<void>;
        // Must Return Note Path
        createNoteFromCkEditor(title: string, parentNotePath: string | undefined, action: CreateNoteAction): Promise<string>;
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
