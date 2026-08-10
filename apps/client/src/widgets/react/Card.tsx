import "./Card.css";
import { cloneElement, ComponentChildren, createContext, isValidElement } from "preact";
import { JSX, HTMLAttributes } from "preact";
import { useContext } from "preact/hooks";
import clsx from "clsx";

import { useUniqueName } from "./hooks";

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
    /** Sentence introducing the card, shown between the heading and the first section. */
    description?: ComponentChildren;
    /**
     * Controls for the card as a whole, kept at the far end of its heading — a help mark, or a
     * button that adds to what the card holds.
     *
     * Taken as children rather than named one by one, so that the card needs no import of its own
     * for them: `Card` is in the login and setup bundles, which have no business pulling in the app
     * a help mark would reach for.
     */
    actions?: ComponentChildren;
}

export function Card(props: {children: ComponentChildren} & CardProps) {
    return <div className={clsx("tn-card", props.className)}>
        {(props.heading || props.actions) && <h5 class="tn-card-heading">
            {props.heading}
            {props.actions && <span className="tn-card-heading-actions">{props.actions}</span>}
        </h5>}
        {props.description && <p className="tn-card-description">{props.description}</p>}
        <div className="tn-card-body">
            {props.children}
        </div>
    </div>;
}

// #endregion

// #region Card Section

export interface CardSectionProps {
    className?: string;
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

export function CardSection(props: {children: ComponentChildren} & CardSectionProps) {
    const parentContext = useContext(CardSectionContext);
    const nestingLevel = (parentContext && parentContext.nestingLevel + 1) ?? 0;

    return <>
        <section className={clsx("tn-card-section", props.className, {
                    "tn-card-section-nested": nestingLevel > 0,
                    "tn-card-highlight-on-hover": props.highlightOnHover || props.onAction,
                    "tn-no-padding": props.noPadding
                 })}
                 style={{"--tn-card-section-nesting-level": (nestingLevel) ? nestingLevel : null}}
                 onClick={props.onAction}>
            {props.children}
        </section>

        {props.subSectionsVisible && props.subSections &&
            <CardSectionContext.Provider value={{nestingLevel}}>
                {props.subSections}
            </CardSectionContext.Provider>
        }
    </>;
}

// #endregion

// #region Card Option

export interface CardOptionProps extends CardSectionProps {
    label: ComponentChildren;
    description?: ComponentChildren;
    /**
     * Binds the label to the control, so that clicking the text operates it. Only a single element
     * child can be bound, which covers the usual case of one toggle or one input per option.
     */
    name?: string;
    /** The controls the option is operated with, placed on the trailing edge. */
    children?: ComponentChildren;
}

/**
 * A card section built as one setting: what it is on the leading edge, what changes it on the
 * trailing one, with the sentence explaining it below the label.
 */
export function CardOption(props: CardOptionProps) {
    const {label, description, name, children, className, ...rest} = props;
    const id = useUniqueName(name);
    const bound = !!name && isValidElement(children);

    return <CardSection className={clsx("tn-card-option", className)} {...rest}>
        <label className="tn-card-option-label" for={bound ? id : undefined}>
            {label}
            {description && <small className="tn-card-option-description">{description}</small>}
        </label>

        {bound ? cloneElement(children, { id }) : children}
    </CardSection>;
}

// #endregion