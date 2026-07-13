import "./OptionsBlock.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";

import { CardSection } from "../../../react/Card";
import { OptionsCardContext } from "./OptionsSection";

interface OptionsBlockProps {
    className?: string;
    /** Drops the block's own padding, for content that fills its segment edge to edge (a preview
     *  pane, an admonition). */
    noPadding?: boolean;
    children: ComponentChildren;
}

/**
 * A segment of an options card holding something that is not a settings row — explanatory text, a
 * list of checkboxes, an empty-state, a preview pane.
 *
 * Rows make themselves into segments, but anything else would otherwise be left bare in the card,
 * with none of its padding or background. Wrap it here so it takes its place in the card's stack.
 */
export default function OptionsBlock({ className, noPadding, children }: OptionsBlockProps) {
    const segmented = useContext(OptionsCardContext);

    if (!segmented) {
        return <>{children}</>;
    }

    return (
        <CardSection className={clsx("options-block", className)} noPadding={noPadding}>
            {children}
        </CardSection>
    );
}
