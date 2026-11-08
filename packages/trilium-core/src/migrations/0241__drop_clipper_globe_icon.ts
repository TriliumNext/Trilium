import becca from "../becca/becca";
import becca_loader from "../becca/becca_loader";
import { getContext } from "../services/context";

/** The icon the web clipper wrote onto every clipping that had a page URL. */
const CLIPPER_GLOBE_ICON = "bx bx-globe";

/**
 * Deletes the `#iconClass` the web clipper wrote onto its clippings, so they take the icon
 * `getNoteIcon()` derives from their `#clipType`. Only an owned, non-inheritable label holding
 * exactly the clipper's value is deleted; any other icon was set by the user.
 */
export default () => {
    getContext().init(() => {
        becca_loader.load();

        for (const note of Object.values(becca.notes)) {
            if (!note.hasOwnedLabel("clipType")) {
                continue;
            }

            for (const label of note.getOwnedLabels("iconClass")) {
                if (label.value === CLIPPER_GLOBE_ICON && !label.isInheritable) {
                    label.markAsDeleted();
                }
            }
        }
    });
};
