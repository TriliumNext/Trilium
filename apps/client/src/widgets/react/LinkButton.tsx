import clsx from "clsx";
import { ComponentChild } from "preact";
import { CommandNames } from "../../components/app_context";

interface LinkButtonProps {
    onClick?: () => void;
    text: ComponentChild;
    triggerCommand?: CommandNames;
    className?: string;
}

export default function LinkButton({ onClick, text, triggerCommand, className }: LinkButtonProps) {
    return (
        <a class={clsx("tn-link", className)} href="#"
           data-trigger-command={triggerCommand}
           role="button"
           onKeyDown={(e)=> {
                if (e.code === "Space") {
                    onClick?.();
                }
           }}
           onClick={(e) => {
                e.preventDefault();
                onClick?.();
           }}>
            {text}
        </a>
    )
}

interface PageLinkProps {
    /** Where the link goes, as a note path such as `#root/_hidden/_options/_optionsBackup`. */
    href: string;
    /** The words the link is read as. */
    text: ComponentChild;
}

/**
 * A way to another page of the application, worded as what is found there rather than as the title
 * of the page it goes to. That wording is also why the note preview is left out: the text has
 * already said what the page holds, so the preview would only repeat it in less readable form.
 */
export function PageLink({ href, text }: PageLinkProps) {
    return <a className="tn-link no-tooltip-preview" href={href}>{text}</a>;
}
