import type { TriliumVim, VimHint } from "@triliumnext/ckeditor5";
import { useEffect, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type { ShortcutHintSection } from "../../../services/shortcut_hints";

/**
 * The section of the Shortcut Hints panel with the full key list of `vim`. It follows the state of
 * the editor while the panel shows it, and keeps the panel open until it is dismissed.
 */
export function getVimHintSection(vim: TriliumVim): ShortcutHintSection {
    return { hints: [], content: () => <VimKeyReference vim={vim} />, isPersistent: true };
}

/** Opens the full key list of `vim` by `anchor`, or closes the panel when it is open. */
export function toggleVimKeyReference(vim: TriliumVim, anchor: HTMLElement) {
    appContext.triggerEvent("shortcutHintsRequested", {
        sections: [ getVimHintSection(vim) ],
        anchor
    });
}

/** The keys of the state of `vim`, by topic, in the rows of the Shortcut Hints panel. */
export function VimKeyReference({ vim }: { vim: TriliumVim }) {
    const [ sections, setSections ] = useState(() => vim.getKeyReference());

    useEffect(() => {
        const onChange = () => setSections(vim.getKeyReference());
        onChange();
        vim.on("change:status", onChange);
        return () => vim.off("change:status", onChange);
    }, [ vim ]);

    return (
        <>
            {sections.map((section, index) => (
                <div className="shortcut-hints-section" key={index}>
                    <div className="shortcut-hints-section-title">{section.title}</div>
                    <dl className="shortcut-hints-list">
                        {section.hints.map((hint, hintIndex) => (
                            <VimKeyRow hint={hint} key={hintIndex} />
                        ))}
                    </dl>
                </div>
            ))}
        </>
    );
}

function VimKeyRow({ hint }: { hint: VimHint }) {
    const { keys, isRange, isLiteral, description } = hint;
    const Key = isLiteral ? "code" : "kbd";

    return (
        <>
            <dt className="shortcut-hint-description">{description}</dt>
            <dd className="shortcut-hint-keys">
                {isRange
                    ? <><kbd>{keys[0]}</kbd>-<kbd>{keys[1]}</kbd></>
                    : keys.map((key, index) => (
                        <span className="shortcut-hint-alt" key={index}><Key>{key}</Key></span>
                    ))}
            </dd>
        </>
    );
}
