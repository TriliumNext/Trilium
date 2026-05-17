import { Fragment } from "preact";

import { t } from "../../services/i18n";

export interface TabSegment {
    ntxId: string;
    title?: string;
    iconClass?: string;
}

export interface TabProps {
    ntxId: string;
    segments: TabSegment[];
}

export default function Tab({ ntxId, segments }: TabProps) {
    const hasSplits = segments.length > 1;

    return (
        <div className={`note-tab${hasSplits ? " note-tab-split" : ""}`} data-ntx-id={ntxId}>
            <div className="note-tab-wrapper">
                <div className="note-tab-drag-handle" />
                {segments.map((segment, index) => (
                    <Fragment key={segment.ntxId}>
                        {index > 0 && <div className="note-tab-separator" />}
                        <div
                            className="note-tab-segment"
                            data-ntx-id={segment.ntxId}
                        >
                            <div className={`note-tab-icon${segment.iconClass ? ` ${segment.iconClass}` : ""}`} />
                            <div className="note-tab-title">{segment.title}</div>
                        </div>
                    </Fragment>
                ))}
                <div className="note-tab-close bx bx-x" title={t("tab_row.close_tab")} />
            </div>
        </div>
    );
}
