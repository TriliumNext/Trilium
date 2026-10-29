import { Suspense } from "preact/compat";
import { useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import TextEmbedEditor from "../../type_widgets/text/TextEmbedEditor";

/**
 * Edits a text slide in place, inside the slide's frame in the shadow root, so that the slide's
 * theme styles the text being edited. Escape finishes editing, unless the editor already handled
 * it.
 */
export default function SlideEditor({ note, onFinish }: { note: FNote; onFinish(): void }) {
    // This module imports the editor, so its stylesheets are in the document by now.
    const [ editorStylesheet ] = useState(collectEditorStylesheet);

    return (
        <div
            className="slide-editor-root"
            onKeyDown={(e) => {
                if (e.key === "Escape" && !e.defaultPrevented) {
                    e.preventDefault();
                    onFinish();
                }
            }}
        >
            <style>{editorStylesheet}</style>
            <Suspense fallback={null}>
                <TextEmbedEditor note={note} hasFixedToolbar={false} onClose={() => {}} />
            </Suspense>
        </div>
    );
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
