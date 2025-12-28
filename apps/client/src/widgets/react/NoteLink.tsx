import clsx from "clsx";
import { HTMLAttributes } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import link, { calculateHash, ViewScope } from "../../services/link";
import tree from "../../services/tree";
import { useImperativeSearchHighlighlighting, useNote, useNoteColorClass, useNoteIcon, useNoteLabelBoolean, useNoteTitle, useTriliumEvent } from "./hooks";
import Icon from "./Icon";

interface NoteLinkOpts {
    className?: string;
    containerClassName?: string;
    notePath: string | string[];
    showNotePath?: boolean;
    showNoteIcon?: boolean;
    style?: Record<string, string | number>;
    noPreview?: boolean;
    noTnLink?: boolean;
    highlightedTokens?: string[] | null | undefined;
    // Override the text of the link, otherwise the note title is used.
    title?: string;
    viewScope?: ViewScope;
    noContextMenu?: boolean;
    onContextMenu?: (e: MouseEvent) => void;
}

export default function NoteLink({ className, containerClassName, notePath, showNotePath, showNoteIcon, style, noPreview, noTnLink, highlightedTokens, title, viewScope, noContextMenu, onContextMenu }: NoteLinkOpts) {
    const stringifiedNotePath = Array.isArray(notePath) ? notePath.join("/") : notePath;
    const noteId = stringifiedNotePath.split("/").at(-1);
    const ref = useRef<HTMLSpanElement>(null);
    const [ jqueryEl, setJqueryEl ] = useState<JQuery<HTMLElement>>();
    const highlightSearch = useImperativeSearchHighlighlighting(highlightedTokens);
    const [ noteTitle, setNoteTitle ] = useState<string>();

    useEffect(() => {
        link.createLink(stringifiedNotePath, {
            title,
            showNotePath,
            showNoteIcon,
            viewScope
        }).then(setJqueryEl);
    }, [ stringifiedNotePath, showNotePath, title, viewScope, noteTitle ]);

    useEffect(() => {
        const el = jqueryEl?.[0];
        if (!el || !onContextMenu) return;
        el.addEventListener("contextmenu", onContextMenu);
        return () => el.removeEventListener("contextmenu", onContextMenu);
    }, [ jqueryEl, onContextMenu ]);

    useEffect(() => {
        if (!ref.current || !jqueryEl) return;
        ref.current.replaceChildren(jqueryEl[0]);
        highlightSearch(ref.current);
    }, [ jqueryEl, highlightedTokens ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        // React to note title changes, but only if the title is not overwritten.
        if (!title && noteId) {
            const entityRow = loadResults.getEntityRow("notes", noteId);
            if (entityRow) {
                setNoteTitle(entityRow.title);
            }
        }
    });

    if (style) {
        jqueryEl?.css(style);
    }

    const $linkEl = jqueryEl?.find("a");
    if (noPreview) {
        $linkEl?.addClass("no-tooltip-preview");
    }

    if (!noTnLink) {
        $linkEl?.addClass("tn-link");
    }

    if (noContextMenu) {
        $linkEl?.attr("data-no-context-menu", "true");
    }

    if (className) {
        $linkEl?.addClass(className);
    }

    return <span className={containerClassName} ref={ref} />;
}

interface NewNoteLinkProps extends Pick<HTMLAttributes<HTMLAnchorElement>, "onContextMenu"> {
    className?: string;
    notePath: string;
    viewScope?: ViewScope;
    noContextMenu?: boolean;
    showNoteIcon?: boolean;
    noPreview?: boolean;
}

export function NewNoteLink({ notePath, viewScope, noContextMenu, showNoteIcon, noPreview, ...linkProps }: NewNoteLinkProps) {

    const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
    const note = useNote(noteId);

    const title = useNoteTitle(noteId, parentNoteId);
    const icon = useNoteIcon(showNoteIcon ? note : null);
    const colorClass = useNoteColorClass(note);
    const [ archived ] = useNoteLabelBoolean(note, "archived");

    return (
        <a
            className={clsx("tn-link", colorClass, {
                "no-tooltip-preview": noPreview,
                archived
            })}
            href={calculateHash({ notePath, viewScope })}
            data-no-context-menu={noContextMenu}
            {...linkProps}
        >
            {icon && <><Icon icon={icon} />&nbsp;</>}
            {title}
        </a>
    );
}
