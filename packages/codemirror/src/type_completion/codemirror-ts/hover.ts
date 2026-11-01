import { EditorView, hoverTooltip, Tooltip, TooltipView } from "@codemirror/view";
import type ts from "typescript";
import { type VirtualTypeScriptEnvironment } from "@typescript/vfs";

interface HoverOptions {
  env: VirtualTypeScriptEnvironment;
  path: string;
  renderTooltip: TooltipRenderer;
}

/**
 * This binds the CodeMirror `hoverTooltip` method
 * with a code that pulls types and documentation
 * from the TypeScript environment.
 */
export function tsHover(options: HoverOptions) {
  return hoverTooltip(hoverSource(options));
}

/** The tooltip `tsHover()` shows at a position, or `null` where the language service has none. */
export function hoverSource({ env, path, renderTooltip }: HoverOptions) {
  return (view: EditorView, pos: number): Tooltip | null => {
    const hoverData = getHover({ env, path, pos });

    if (!hoverData) return null;

    return {
      pos: hoverData.start,
      end: hoverData.end,
      create: () => renderTooltip(hoverData, view),
    };
  };
}

/**
 * This information is passed to the API consumer to allow
 * them to create tooltips however they wish.
 */
export interface HoverInfo {
  start: number;
  end: number;
  quickInfo: ts.QuickInfo | undefined;
}

export function getHover({
  env,
  path,
  pos,
}: {
  env: VirtualTypeScriptEnvironment;
  path: string;
  pos: number;
}): HoverInfo | null {
  const quickInfo = env.languageService.getQuickInfoAtPosition(path, pos);
  if (!quickInfo) return null;

  const start = quickInfo.textSpan.start;

  return {
    start,
    end: start + quickInfo.textSpan.length,
    quickInfo,
  };
}

export type TooltipRenderer = (
  arg0: HoverInfo,
  editorView: EditorView,
) => TooltipView;
