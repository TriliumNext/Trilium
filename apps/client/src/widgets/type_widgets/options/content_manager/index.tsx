import "./index.css";

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import SegmentedChoice from "../../../react/SegmentedChoice";
import type { TypeWidgetProps } from "../../type_widget";
import ActiveContent from "./active_content";
import SpaceUsage from "./space_usage";

export type ContentManagerSection = "activeContent" | "spaceUsage";

/** What the shell hands each section: the page's own props plus the switcher between sections. */
export interface ContentManagerSectionProps extends TypeWidgetProps {
    /**
     * Rendered by the section inside its own header's title row, so the choice stays visible while
     * the section's content scrolls beneath it.
     */
    sectionSwitcher: ComponentChildren;
}

/**
 * The Content Manager page: a shell hosting the Active Content listing and the Space Usage tooling,
 * switched by a segmented button. Each section owns its header and toolbar — the shell holds nothing
 * but the choice, which starts over on Active Content each time the page opens, unless the page was
 * opened by a link asking for a particular section.
 */
export default function ContentManagerSettings(props: TypeWidgetProps) {
    const [ section, setSection ] = useState<ContentManagerSection>(takeRequestedSection);
    const sectionSwitcher = (
        <div className="content-manager-section-switcher">
            <SegmentedChoice options={SECTIONS} currentValue={section} onChange={setSection} />
        </div>
    );

    return section === "spaceUsage"
        ? <SpaceUsage {...props} sectionSwitcher={sectionSwitcher} />
        : <ActiveContent {...props} sectionSwitcher={sectionSwitcher} />;
}

const SECTIONS: { value: ContentManagerSection, label: string }[] = [
    { value: "activeContent", label: t("content_manager.section_active_content") },
    { value: "spaceUsage", label: t("content_manager.section_space_usage") }
];

/** The section a link asked for, until the page renders and takes it. */
let requestedSection: ContentManagerSection | null = null;

/**
 * Asks the page to open on a given section, for links pointing at a section rather than at the page
 * itself (the "Related actions" entry in Options → Other). The request is taken by the next render
 * and forgotten, so opening the page any other way still starts on Active Content.
 */
export function requestContentManagerSection(section: ContentManagerSection) {
    requestedSection = section;
}

function takeRequestedSection(): ContentManagerSection {
    const requested = requestedSection ?? "activeContent";

    requestedSection = null;
    return requested;
}
