import { tidyFilesystemFriendlyName, toFilesystemFriendlyName } from "@triliumnext/commons";
import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import FormTextBox, { type FormTextBoxProps } from "./FormTextBox";

export interface FilesystemFriendlyNameProps
    extends Omit<FormTextBoxProps, "currentValue" | "onBlur" | "onChange" | "type"> {
    currentValue: string;
    /** Receives the value with everything a file name cannot hold already removed. */
    onChange(value: string): void;
}

/**
 * Keeps a name usable as a file name, as it is typed rather than once it is submitted.
 *
 * Two passes, because one cannot do both jobs. Every input event, typing and pasting alike, has the
 * forbidden characters taken straight back out, so the box never shows a character that will not
 * survive being saved. Losing focus then tidies what would have been rude to touch mid-edit: the
 * spaces and trailing dots a pasted name arrives with.
 *
 * The caret is put back where the typing was, since a rejected keystroke that also sent the cursor
 * to the end would be worse than the character it refused.
 */
export default function FilesystemFriendlyName({ currentValue, onChange, inputRef, ...rest }: FilesystemFriendlyNameProps) {
    const ownRef = useRef<HTMLInputElement | null>(null);
    const element = (inputRef ?? ownRef) as RefObject<HTMLInputElement>;
    /** Where to put the caret once the refused character is gone, or null when nothing was. */
    const caret = useRef<number | null>(null);

    useLayoutEffect(() => {
        if (caret.current !== null) {
            element.current?.setSelectionRange(caret.current, caret.current);
            caret.current = null;
        }
    });

    return (
        <FormTextBox
            {...rest}
            inputRef={element}
            currentValue={currentValue}
            onChange={(typed) => {
                // Forgotten first, and remembered again only if this keystroke is refused. A
                // refusal that changes nothing the host holds causes no render, so a position left
                // over from it would otherwise be applied to the render some later keystroke
                // causes, putting the caret behind the character just typed.
                caret.current = null;

                const cleaned = toFilesystemFriendlyName(typed);
                if (cleaned !== typed) {
                    // Where the caret sits once what preceded it has been filtered too, which is
                    // where the user was typing rather than the end of the box.
                    const upToCaret = typed.slice(0, element.current?.selectionStart ?? typed.length);
                    const position = toFilesystemFriendlyName(upToCaret).length;

                    // Put right here rather than left to the re-render: a refused character makes
                    // the value the host already holds, so there may be no re-render at all, and
                    // the box would go on showing what it just refused.
                    if (element.current) {
                        element.current.value = cleaned;
                        element.current.setSelectionRange(position, position);
                    }
                    // Kept for the render that does follow, which would otherwise put the caret
                    // back at the end while replacing the value.
                    caret.current = position;
                }

                onChange(cleaned);
            }}
            // Pasted names arrive whole, so the tidying that would interrupt typing waits for the
            // moment the name is finished with. The caret is nobody's business once the field has
            // been left, so nothing is held over for the render this causes.
            onBlur={(value) => {
                caret.current = null;
                onChange(tidyFilesystemFriendlyName(value));
            }}
        />
    );
}
