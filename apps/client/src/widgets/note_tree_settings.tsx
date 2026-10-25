import "./note_tree_settings.css";

import type { ReferenceElement } from "@floating-ui/dom";
import type { TreeDensity } from "@triliumnext/commons";
import { useEffect, useMemo } from "preact/hooks";

import { t } from "../services/i18n.js";
import ActionButton from "./react/ActionButton.jsx";
import { Card, OptionCardSection } from "./react/Card.jsx";
import FormToggle from "./react/FormToggle.jsx";
import { useTriliumOption, useTriliumOptionBool, useUniqueName } from "./react/hooks.jsx";
import { suspendModalFocusTraps } from "./react/modal_focustrap.js";
import Popup from "./react/Popup.jsx";
import SegmentedChoice, { type SegmentedChoiceOption } from "./react/SegmentedChoice.jsx";

export interface TreeSettingsProps {
    /** The tree toolbar. The popup opens above its inline-end edge. */
    anchor: HTMLElement;
    /** Called after the archived notes option is saved, so the tree can reload. */
    onHideArchivedNotesChange: () => void;
    onClose: () => void;
}

/** The note tree settings popup. Each toggle saves its option as soon as it changes. */
export default function TreeSettings(props: TreeSettingsProps) {
    const { anchor, onHideArchivedNotesChange, onClose } = props;
    const [ isArchivedHidden, setArchivedHidden ] = useTriliumOptionBool("hideArchivedNotes_main");
    const [ isAutoCollapsed, setAutoCollapsed ] = useTriliumOptionBool("autoCollapseNoteTree");
    const [ isFollowingActiveNote, setFollowingActiveNote ] =
        useTriliumOptionBool("treeScrollFollowNavigation");
    const [ density, setDensity ] = useTriliumOption("treeDensity");
    const densities: SegmentedChoiceOption<TreeDensity>[] = [
        { value: "relaxed", label: t("note_tree.display-density-relaxed") },
        { value: "dense", label: t("note_tree.display-density-dense") }
    ];
    const titleId = useUniqueName("tree-settings-title");
    // The toolbar's start edge moves when it collapses. Its end edge does not.
    const reference = useMemo(() => inlineEndEdge(anchor), [ anchor ]);

    // The popup is outside the tree popup editor's modal, so the modal's focus trap is paused.
    useEffect(() => suspendModalFocusTraps(), []);

    return (
        <Popup
            anchor={reference}
            placement="top-end"
            offset={8}
            reveal
            role="dialog"
            aria-labelledby={titleId}
            className="tree-settings tn-tool-dialog"
            // The settings button closes the popup through its own click handler.
            keepOpenSelector=".tree-settings-button"
            onDismiss={onClose}
        >
            <div className="tree-settings-header">
                <h5 id={titleId} className="tree-settings-title">
                    {t("note_tree.tree-settings-title")}
                </h5>
                <ActionButton
                    icon="bx bx-x"
                    text={t("common.close")}
                    tooltipClass="tooltip-top"
                    onClick={onClose}
                />
            </div>

            <Card>
                <OptionCardSection label={t("note_tree.display-density")} inline>
                    <SegmentedChoice
                        options={densities}
                        currentValue={density}
                        onChange={setDensity}
                    />
                </OptionCardSection>

                <OptionCardSection
                    name="hide-archived-notes"
                    label={t("note_tree.hide-archived-notes")}
                >
                    <FormToggle
                        currentValue={isArchivedHidden}
                        onChange={async (isHidden) => {
                            await setArchivedHidden(isHidden);
                            onHideArchivedNotesChange();
                        }}
                    />
                </OptionCardSection>

                <OptionCardSection
                    name="auto-collapse-note-tree"
                    label={t("note_tree.automatically-collapse-notes")}
                    description={t("note_tree.automatically-collapse-notes-title")}
                >
                    <FormToggle currentValue={isAutoCollapsed} onChange={setAutoCollapsed} />
                </OptionCardSection>

                <OptionCardSection
                    name="follow-active-note"
                    label={t("note_tree.follow-active-note")}
                    description={t("note_tree.follow-active-note-title")}
                >
                    <FormToggle
                        currentValue={isFollowingActiveNote}
                        onChange={setFollowingActiveNote}
                    />
                </OptionCardSection>
            </Card>
        </Popup>
    );
}

/** A zero-width reference on the inline-end edge of `element`, for Floating UI. */
export function inlineEndEdge(element: HTMLElement): ReferenceElement {
    return {
        getBoundingClientRect() {
            const { left, right, y, height } = element.getBoundingClientRect();
            const edge = getComputedStyle(element).direction === "rtl" ? left : right;
            return DOMRect.fromRect({ x: edge, y, width: 0, height });
        },
        contextElement: element
    };
}
