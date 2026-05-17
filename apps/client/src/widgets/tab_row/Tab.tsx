import { t } from "../../services/i18n";

export interface TabProps {
    ntxId: string;
    title?: string;
    iconClass?: string;
    closeTitle?: string;
}

export default function Tab({ ntxId, title, iconClass, closeTitle }: TabProps) {
    return (
        <div className="note-tab" data-ntx-id={ntxId} title={title}>
            <div className="note-tab-wrapper">
                <div className="note-tab-drag-handle"></div>
                <div className={`note-tab-icon${iconClass ? ` ${iconClass}` : ""}`}></div>
                <div className="note-tab-title">{title}</div>
                <div className="note-tab-close bx bx-x" title={closeTitle ?? t("tab_row.close_tab")}></div>
            </div>
        </div>
    );
}
