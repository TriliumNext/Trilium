import "./MasterDetailHeader.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { onSystemBack } from "../../services/system_back";
import ActionButton from "./ActionButton";

export interface MasterDetailHeaderProps {
    /** Whether the detail is what is on show, which is what the header is a way back from. */
    inPage: boolean;
    onBack: () => void;
    /** The back button's tooltip: where it goes back to, in the dialog's own words. */
    backTitle: string;
    /** What the detail on show is called. */
    pageTitle?: ComponentChildren;
    /** What the dialog is called, shown while the list is. */
    listTitle: ComponentChildren;
    /** A decorative icon for the list view, standing where the back button stands in the other. */
    listIcon?: string;
    /** The dialog's own actions, which belong to the list rather than to one page of it. */
    listActions?: ComponentChildren;
    /**
     * Actions belonging to the page on show. The header carries the page's name here, so a control
     * that explains or acts on the page as a whole reads beside it rather than inside the page.
     */
    pageActions?: ComponentChildren;
}

/**
 * The header of a master-detail modal, in place of its static title (which master_detail.css hides):
 * the way back and the name of what is on show, or the dialog's own name while the list is.
 */
export default function MasterDetailHeader({
    inPage, onBack, backTitle, pageTitle, listTitle, listIcon, listActions, pageActions
}: MasterDetailHeaderProps) {
    const back = useRef(onBack);
    back.current = onBack;
    useEffect(() => {
        if (!inPage) return;
        return onSystemBack(() => {
            back.current();
            return true;
        });
    }, [ inPage ]);

    return (
        <div class="tn-master-detail-header">
            {inPage ? (
                <ActionButton icon="bx bx-chevron-left" text={backTitle} onClick={onBack} />
            ) : (
                // Borrows `icon-action` so it keeps exactly the back button's footprint, and the title
                // does not shift as the views change.
                listIcon && <span class={clsx("tn-master-detail-icon icon-action", listIcon)} aria-hidden="true" />
            )}
            {/* A page that names itself passes no title, and gets no room taken for one. */}
            {(inPage ? pageTitle : listTitle) && (
                <h5 class="tn-master-detail-title">{inPage ? pageTitle : listTitle}</h5>
            )}
            {inPage
                ? pageActions && <div class="tn-master-detail-page-actions">{pageActions}</div>
                : listActions}
        </div>
    );
}
