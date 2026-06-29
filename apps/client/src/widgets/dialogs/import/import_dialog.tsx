import "./import_dialog.css";

import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import tree from "../../../services/tree.js";
import { Card, CardSection } from "../../react/Card.js";
import { useTriliumEvent } from "../../react/hooks.js";
import Modal from "../../react/Modal.js";
import SelectableCard, { SelectableCardGrid } from "../../react/SelectableCard.js";
import { importProviders } from "./index.js";

/**
 * Unified import dialog. The top shows a picker of registered {@link importProviders} as selectable
 * cards: external services in a grid, with local file import grouped full-width beneath them and
 * selected by default. The chosen provider's panel renders below, driving its own flow (file
 * selection, auth, progress). Add new sources by registering them in `index.ts`.
 */
export default function ImportDialog() {
    const [parentNoteId, setParentNoteId] = useState<string>();
    const [noteTitle, setNoteTitle] = useState<string>();
    const [providerId, setProviderId] = useState<string>();
    const [footer, setFooter] = useState<ComponentChildren>(null);
    const [shown, setShown] = useState(false);

    useTriliumEvent("showImportDialog", ({ noteId }) => {
        setParentNoteId(noteId);
        setNoteTitle(undefined);
        setProviderId(defaultProviderId);
        setFooter(null);
        setShown(true);
    });

    // Resolve the target note's title so it can be shown in the dialog title ("Import into <note>").
    useEffect(() => {
        if (!parentNoteId) {
            return;
        }
        void tree.getNoteTitle(parentNoteId).then(setNoteTitle);
    }, [parentNoteId]);

    const provider = importProviders.find((p) => p.id === providerId);

    // Stable so the chosen provider's panel can safely memoize on it (an inline arrow would change every
    // render, defeating the panel's useCallback/useEffect dependencies).
    const closeDialog = useCallback(() => setShown(false), []);

    return (
        <Modal
            className="import-provider-dialog"
            size="lg"
            scrollable
            title={noteTitle ? t("import.importIntoNoteNamed", { title: noteTitle }) : t("import.importIntoNote")}
            footer={footer}
            footerAlignment="right"
            helpPageId={provider?.helpPage}
            onHidden={() => setShown(false)}
            show={shown}
        >
            <Card heading={t("import.import_from")}>
                <CardSection>
                    <SelectableCardGrid>
                        {serviceProviders.map((p) => (
                            <SelectableCard key={p.id} iconUrl={p.iconUrl} icon={p.icon} title={p.name} description={p.description} selected={p.id === providerId} onSelect={() => setProviderId(p.id)} />
                        ))}
                    </SelectableCardGrid>

                    {localProviders.length > 0 && (
                        <div className="import-provider-local">
                            {localProviders.map((p) => (
                                <SelectableCard key={p.id} iconUrl={p.iconUrl} icon={p.icon} title={p.name} description={p.description} selected={p.id === providerId} onSelect={() => setProviderId(p.id)} />
                            ))}
                        </div>
                    )}
                </CardSection>
            </Card>

            {provider && parentNoteId
                ? <provider.Panel key={provider.id} parentNoteId={parentNoteId} closeDialog={closeDialog} setFooter={setFooter} />
                : <p className="import-provider-hint">{t("import_provider.choose_provider")}</p>}
        </Modal>
    );
}

// Services fill the card grid; local file import is grouped full-width beneath them and is the default
// selection (the dialog's primary path). Computed once — the registry is static.
const serviceProviders = importProviders.filter((p) => p.group !== "local");
const localProviders = importProviders.filter((p) => p.group === "local");
const defaultProviderId = (localProviders[0] ?? importProviders[0])?.id;
