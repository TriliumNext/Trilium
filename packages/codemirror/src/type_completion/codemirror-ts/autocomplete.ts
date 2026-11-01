import type { Completion } from "@codemirror/autocomplete";
import ts from "typescript";
import { type VirtualTypeScriptEnvironment } from "@typescript/vfs";

const TS_COMPLETE_BLOCKLIST: ts.ScriptElementKind[] = [
  ts.ScriptElementKind.warning,
];

/**
 * The completions the language service offers at `pos`. Whether a list opens there at all is the
 * caller's decision.
 */
export async function getAutocompletion({
  env,
  path,
  pos,
}: {
  env: VirtualTypeScriptEnvironment;
  path: string;
  pos: number;
}): Promise<(Completion & { boost: number })[] | null> {
  const completionInfo = env.languageService.getCompletionsAtPosition(
    path,
    pos,
    {},
    {},
  );

  if (!completionInfo) return null;

  const options = completionInfo.entries
    .filter(
      (entry) =>
        !TS_COMPLETE_BLOCKLIST.includes(entry.kind) &&
        !entry.kindModifiers?.split(",").includes(ts.ScriptElementKindModifier.deprecatedModifier),
    )
    .map((entry): Completion & { boost: number } => {
      const boost = -Number(entry.sortText) || 0;
      let type = entry.kind ? String(entry.kind) : undefined;

      if (type === "member") type = "property";

      if (type && !DEFAULT_CODEMIRROR_TYPE_ICONS.has(type)) {
        type = undefined;
      }

      return {
        label: entry.name,
        type,
        boost,
      };
    });

  return options;
}

/**
 * There is some overlap between CodeMirror's
 * types and TypeScripts. This is all of the default
 * icons for CodeMirror: if TypeScript gives us one
 * of these, we pass it through.
 */
export const DEFAULT_CODEMIRROR_TYPE_ICONS = new Set([
  `class`,
  `constant`,
  `enum`,
  `function`,
  `interface`,
  `keyword`,
  `method`,
  `namespace`,
  `property`,
  `text`,
  `type`,
  `variable`,
]);
