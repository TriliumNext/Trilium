import { useCallback, useMemo } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import {
    CollectionPropertiesDialog, IncludedNotesCard
} from "../../note_bars/CollectionProperties";
import { bookPropertiesConfig } from "../../note_bars/collection-properties-config";
import { Card } from "../../react/Card";
import { useNoteLabel } from "../../react/hooks";
import { ViewPropertySection } from "../../react/NotePropertyMenu";
import PromotedAttributesCard from "../../react/PromotedAttributesCard";
import TemplateSelectionCard from "../../react/TemplateSelectionCard";
import { offeredTemplateIds } from "../../react/TemplateDropdown";
import { type PromotedAttribute, storedPromotedAttributes } from "../promoted_attributes";
import { type CalendarViewData, DEFAULT_EVENT_TEMPLATES } from "./api";
import { useEventLabelOmissions } from "./hooks";

/**
 * The calendar's settings: those of the collection's settings dropdown, and the attributes its
 * events show and the templates they are made from, which only this dialog holds.
 */
export default function CalendarProperties({
    note, eventNoteIds, viewConfig, saveConfig, onClose
}: {
    /** The calendar note, which is the parent of any template created here. */
    note: FNote;
    /** The notes the calendar shows, whose own definitions are listed with the calendar's. */
    eventNoteIds: string[];
    viewConfig: CalendarViewData | undefined;
    saveConfig: (config: CalendarViewData) => void;
    onClose: () => void;
}) {
    // An empty list would leave nothing to make an event from.
    const storeTemplates = useCallback((templates: string[]) => {
        if (templates.length) {
            saveConfig({ ...viewConfig, templates });
        }
    }, [ viewConfig, saveConfig ]);
    const storeAttributes = useCallback((attributes: PromotedAttribute[]) => {
        saveConfig({ ...viewConfig, promotedAttributes: storedPromotedAttributes(attributes) });
    }, [ viewConfig, saveConfig ]);
    const drawnLabels = useEventLabelOmissions(note);
    const eventNotes = useMemo(() => froca.getNotesFromCache(eventNoteIds, true), [ eventNoteIds ]);
    // The events usually inherit the calendar's `#calendar:displayedAttributes`, which takes
    // precedence over this list (see `buildEvent()`).
    const [ displayedLabel ] = useNoteLabel(note, "calendar:displayedAttributes");

    return (
        <CollectionPropertiesDialog
            className="calendar-properties-dialog"
            title={t("calendar_view.properties-title")}
            show
            stackable
            onHidden={onClose}
        >
            <Card className="calendar-properties-general" heading={t("calendar_view.general")}>
                {bookPropertiesConfig.calendar.properties.map((property, index) => (
                    <ViewPropertySection key={index} note={note} property={property} />
                ))}
            </Card>

            <IncludedNotesCard note={note} />

            <PromotedAttributesCard
                heading={t("calendar_view.event_attributes")}
                instruction={displayedLabel === null || displayedLabel === undefined
                    ? t("calendar_view.event_attributes_hint")
                    : t("calendar_view.event_attributes_overridden")}
                note={note}
                settings={viewConfig?.promotedAttributes}
                drawnByCollection={drawnLabels}
                itemNotes={eventNotes}
                unarrangedHidden
                omitDrawn
                onChange={storeAttributes}
            />

            <TemplateSelectionCard
                heading={t("calendar_view.event_templates")}
                instruction={t("calendar_view.event_templates_hint")}
                note={note}
                newTemplateName={t("calendar_view.new_template_name")}
                templates={offeredTemplateIds(viewConfig, DEFAULT_EVENT_TEMPLATES)}
                onChange={storeTemplates}
            />
        </CollectionPropertiesDialog>
    );
}

