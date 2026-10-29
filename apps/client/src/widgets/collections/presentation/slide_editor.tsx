import { Suspense } from "preact/compat";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { isHtmlEmpty } from "../../../services/utils";
import { findTextEditorIn } from "../../type_widgets/text/editable_embed";
import TextEmbedEditor from "../../type_widgets/text/TextEmbedEditor";

/** How long the editor can take to load before it is shown anyway. */
const READY_TIMEOUT = 3000;
/** How long the editor can take to be shown after it is ready, after which it is not focused. */
const FOCUS_TIMEOUT = 1000;

let editorStyleSheet: CSSStyleSheet | undefined;

interface SlideEditorProps {
    note: FNote;
    /** Called once the editor holds the slide's content and can replace the rendered slide. */
    onReady(): void;
    onFinish(): void;
}

/**
 * Edits a text slide in place, inside the slide's frame in the shadow root, so that the slide's
 * theme styles the text being edited. Escape finishes editing, unless the editor already handled
 * it.
 */
export default function SlideEditor({ note, onReady, onFinish }: SlideEditorProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    // A layout effect, so the editor's styles are in the shadow root before the editor paints.
    useLayoutEffect(() => {
        const root = rootRef.current?.getRootNode();
        if (root instanceof ShadowRoot) return adoptEditorStyleSheet(root);
    }, []);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        return whenEditorHoldsContent(root, note, () => onReadyRef.current());
    }, [ note ]);

    return (
        <div
            ref={rootRef}
            className="slide-editor-root"
            onKeyDown={(e) => {
                if (e.key === "Escape" && !e.defaultPrevented) {
                    e.preventDefault();
                    onFinish();
                }
            }}
        >
            <Suspense fallback={null}>
                <TextEmbedEditor note={note} hasFixedToolbar={false} onClose={() => {}} />
            </Suspense>
        </div>
    );
}

/**
 * Calls `onReady` once the text editor inside `root` holds the content of `note`, then focuses the
 * editor, which could not take the focus while hidden. An editor with no content is ready once
 * it exists, if the note is empty too. Returns the function that stops waiting.
 */
export function whenEditorHoldsContent(root: HTMLElement, note: FNote, onReady: () => void) {
    let isNoteEmpty: boolean | undefined;
    let isReady = false;
    let isStopped = false;
    let focusFrame: number | undefined;

    const check = () => {
        if (isReady || !findTextEditorIn(root) || isNoteEmpty === undefined) return;
        if (!isNoteEmpty && isHtmlEmpty(findTextEditorIn(root)?.getData() ?? "")) return;
        finish();
    };
    const finish = () => {
        isReady = true;
        observer.disconnect();
        clearTimeout(timeout);
        onReady();
        focusWhenShown(performance.now() + FOCUS_TIMEOUT);
    };
    // The slides render in an effect after `onReady`, and a hidden editor cannot take the focus.
    const focusWhenShown = (deadline: number) => {
        const editor = findTextEditorIn(root);
        const editable = editor?.editing.view.getDomRoot();
        if (isStopped || !editor || !editable) return;
        if (getComputedStyle(editable).visibility !== "hidden") {
            editor.editing.view.focus();
        } else if (performance.now() < deadline) {
            focusFrame = requestAnimationFrame(() => focusWhenShown(deadline));
        }
    };

    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    const timeout = setTimeout(finish, READY_TIMEOUT);
    void note.getContent().then((content) => {
        isNoteEmpty = isHtmlEmpty(content ?? "");
        check();
    });

    return () => {
        isStopped = true;
        isReady = true;
        observer.disconnect();
        clearTimeout(timeout);
        if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    };
}

/**
 * Adds the editor's styles to `root` and returns the function that removes them. The stylesheet
 * is built on the first edit and shared by every later one, so only the first edit collects and
 * parses it. This module imports the editor, so its stylesheets are in the document by then.
 *
 * The rules go in a cascade layer, which the theme's unlayered rules outrank whatever their
 * specificity, so the slide keeps the theme's spacing where both set it. The margins CKEditor
 * gives the first and last block of an inline editor are reverted, so the edited slide is as tall
 * as the rendered one.
 */
export function adoptEditorStyleSheet(root: ShadowRoot) {
    if (!editorStyleSheet) {
        editorStyleSheet = new CSSStyleSheet();
        editorStyleSheet.replaceSync(`@layer slide-editor {
${collectEditorStylesheet()}
.ck.ck-editor__editable_inline > :first-child { margin-top: revert-layer; }
.ck.ck-editor__editable_inline > :last-child { margin-bottom: revert-layer; }
}`);
    }
    const sheet = editorStyleSheet;
    root.adoptedStyleSheets = [ ...root.adoptedStyleSheets, sheet ];
    return () => {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((adopted) => adopted !== sheet);
    };
}

/**
 * Copies the document's rules for the editor UI, which CKEditor mounts in the shadow root along
 * with its balloons and toolbars, where the document's stylesheets do not apply. A rule is copied
 * when its selector names a CKEditor class other than `.ck-content`, so the rules that style the
 * content stay out and the slide's theme styles the text. `@keyframes` are copied for the editor's
 * animations.
 */
export function collectEditorStylesheet(styleSheets: Iterable<CSSStyleSheet> = document.styleSheets) {
    const css: string[] = [];
    for (const sheet of styleSheets) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            // A cross-origin stylesheet does not expose its rules.
            continue;
        }
        collectRules(rules, css);
    }
    return css.join("\n");
}

function collectRules(rules: CSSRuleList, css: string[]) {
    for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
            if (isEditorSelector(rule.selectorText)) css.push(rule.cssText);
        } else if (rule instanceof CSSKeyframesRule) {
            css.push(rule.cssText);
        } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
            const inner: string[] = [];
            collectRules(rule.cssRules, inner);
            if (inner.length) {
                const condition = rule instanceof CSSMediaRule ? `@media ${rule.conditionText}` : `@supports ${rule.conditionText}`;
                css.push(`${condition} {\n${inner.join("\n")}\n}`);
            }
        }
    }
}

function isEditorSelector(selector: string) {
    return selector.match(/\.ck[\w-]*/g)?.some((className) => className !== ".ck-content") ?? false;
}
