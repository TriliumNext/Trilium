import { nextSelfReificationTitle } from "@triliumnext/commons";

import appContext from "../components/app_context";
import { t } from "./i18n";
import server from "./server";

interface SelfReificationResponse {
    noteId: string | null;
    title: string | null;
}

/** The menu line for talking about this note one level up. */
export async function selfReificationMenuTitle(noteId: string, noteTitle: string): Promise<string> {
    let existing: string | null = null;
    try {
        const found = await server.get<SelfReificationResponse>(`notes/${noteId}/self-reification`);
        existing = found.noteId ? found.title : null;
    } catch {
        existing = null;
    }
    return existing
        ? t("self_reification.go_to", { title: existing })
        : t("self_reification.create", { title: nextSelfReificationTitle(noteTitle) });
}

/** Opens the note that talks about `noteId`, creating it the first time. */
export async function openSelfReification(noteId: string) {
    const result = await server.post<{ noteId: string }>(`notes/${noteId}/self-reification`);
    appContext.tabManager.openContextWithNote(result.noteId, { placement: "afterCurrent" });
}
