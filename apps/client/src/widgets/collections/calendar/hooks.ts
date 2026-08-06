import FNote from "../../../entities/fnote";
import { useNoteLabel, useNoteLabelByName } from "../../react/hooks";
import { EVENT_LABELS, EventLabelName } from "./utils";

/**
 * Reads and writes one of the labels the calendar draws an event by, honouring the note's own
 * renaming of it: with `#calendar:startDate=myStartDate`, the value is `#myStartDate`'s — falling
 * back to the stock `#startDate` where the renamed label holds nothing, exactly as the event
 * builder falls back (see getCustomisableLabel) — and an edit writes the renamed label, as a drag
 * on the grid does (see changeEvent in api.ts). Clearing clears the stock label too: a stale value
 * left there would come back through the builder's fallback the moment the renamed one went.
 */
export function useEventLabel(note: FNote, defaultName: EventLabelName): [string | null, (value: string | null) => void] {
    const [ customName ] = useNoteLabel(note, `calendar:${defaultName}`);
    const [ customValue, setCustomValue ] = useNoteLabelByName(note, customName || defaultName);
    const [ stockValue, setStockValue ] = useNoteLabelByName(note, defaultName);

    const value = (customName ? customValue : null) || stockValue || null;
    const setValue = (newValue: string | null) => {
        if (customName) {
            setCustomValue(newValue);
            if (newValue === null) {
                setStockValue(null);
            }
        } else {
            setStockValue(newValue);
        }
    };

    return [ value, setValue ];
}

/**
 * The label names the event popover's own fields already speak for, so the promoted grid does not
 * repeat them (see EventDetailsBody in EventPopover.tsx): the stock names always, and whatever
 * names the note has pointed the calendar at instead.
 */
export function useEventLabelOmissions(note: FNote): string[] {
    const [ customStartDate ] = useNoteLabel(note, "calendar:startDate");
    const [ customEndDate ] = useNoteLabel(note, "calendar:endDate");
    const [ customStartTime ] = useNoteLabel(note, "calendar:startTime");
    const [ customEndTime ] = useNoteLabel(note, "calendar:endTime");
    const [ customRecurrence ] = useNoteLabel(note, "calendar:recurrence");

    const customNames = [ customStartDate, customEndDate, customStartTime, customEndTime, customRecurrence ]
        .filter((name): name is string => !!name);
    return [ ...EVENT_LABELS, ...customNames ];
}
