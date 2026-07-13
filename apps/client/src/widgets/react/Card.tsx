import "./Card.css";
import clsx from "clsx";
import { ComponentChildren, createContext, createElement, CSSProperties, HTMLAttributes, JSX } from "preact";
import { useContext, useMemo } from "preact/hooks";

// #region Card Frame

export interface CardFrameProps extends HTMLAttributes<HTMLDivElement> {
    className?: string;
    highlightOnHover?: boolean;
    children: ComponentChildren;
}

export function CardFrame({className, highlightOnHover, children, ...rest}: CardFrameProps) {
    return <div {...rest}
                className={clsx("tn-card-frame", className, {
                    "tn-card-highlight-on-hover": highlightOnHover
                })}>

        {children}
    </div>;
}

// #endregion

// #region Card

export interface CardProps {
    className?: string;
    heading?: string;
}

export function Card(props: {children: ComponentChildren} & CardProps) {
    return <div className={clsx("tn-card", props.className)}>
        {props.heading && <h5 class="tn-card-heading">{props.heading}</h5>}
        <div className="tn-card-body">
            {props.children}
        </div>
    </div>;
}

// #endregion

// #region Card Section

export interface CardSectionProps extends Omit<HTMLAttributes<HTMLElement>, "style"> {
    className?: string;
    style?: CSSProperties;
    /** The element to render as. Defaults to `section`; a section that is itself a link or a button
     *  has to say so, since it cannot nest the interactive element inside itself. */
    as?: "section" | "a" | "button" | "div";
    subSections?: JSX.Element | JSX.Element[];
    subSectionsVisible?: boolean;
    highlightOnHover?: boolean;
    onAction?: () => void;
    noPadding?: boolean;
}

interface CardSectionContextType {
    nestingLevel: number;
}

const CardSectionContext = createContext<CardSectionContextType | undefined>(undefined);

/** The nesting level a card section rendered at this point in the tree would take. */
function useNestingLevel() {
    const parentContext = useContext(CardSectionContext);
    return (parentContext && parentContext.nestingLevel + 1) ?? 0;
}

export function CardSection({
    children, className, style, as, subSections, subSectionsVisible,
    highlightOnHover, onAction, noPadding, onClick, ...rest
}: CardSectionProps) {
    const nestingLevel = useNestingLevel();
    const nesting = useMemo(() => ({ nestingLevel }), [ nestingLevel ]);

    const section = createElement(as ?? "section", {
        ...rest,
        className: clsx("tn-card-section", className, {
            "tn-card-section-nested": nestingLevel > 0,
            "tn-card-highlight-on-hover": highlightOnHover || onAction,
            "tn-no-padding": noPadding
        }),
        style: {
            ...style,
            "--tn-card-section-nesting-level": (nestingLevel) ? nestingLevel : null
        },
        onClick: onAction ?? onClick
    }, children);

    return <>
        {section}

        {subSectionsVisible && subSections &&
            <CardSectionContext.Provider value={nesting}>
                {subSections}
            </CardSectionContext.Provider>
        }
    </>;
}

/**
 * Places its children one nesting level deeper without rendering a section of its own, so that the
 * sections among them nest as siblings of the card body rather than as boxes within a box.
 *
 * Unlike `subSections`, this works wherever it is placed — including inside a wrapper component,
 * which a parent inspecting its own children could never see into.
 */
export function CardNesting({ children }: { children: ComponentChildren }) {
    const nestingLevel = useNestingLevel();
    const nesting = useMemo(() => ({ nestingLevel }), [ nestingLevel ]);

    return <CardSectionContext.Provider value={nesting}>{children}</CardSectionContext.Provider>;
}

// #endregion