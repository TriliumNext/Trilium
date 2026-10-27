import { linter, Diagnostic } from "@codemirror/lint";
import ts from "typescript";
import type { DiagnosticWithLocation } from "typescript";
import { type VirtualTypeScriptEnvironment } from "@typescript/vfs";

/**
 * Binds the TypeScript `lint()` method with TypeScript's
 * semantic and syntactic diagnostics. You can use
 * the `getLints` method for a lower-level interface
 * to the same data.
 */
export function tsLinter(options: {
  env: VirtualTypeScriptEnvironment;
  path: string;
  diagnosticCodesToIgnore: number[];
}) {
  return linter(() => getLints(options));
}

/**
 * Lower-level interface to get semantic and syntactic
 * diagnostics from the TypeScript environment.
 *
 * This is used by tsLinter, and by getScriptLints()
 * for tests.
 */
export function getLints({
  env,
  path,
  diagnosticCodesToIgnore,
}: {
  env: VirtualTypeScriptEnvironment;
  path: string;
  diagnosticCodesToIgnore: number[];
}) {
  const syntaticDiagnostics = env.languageService.getSyntacticDiagnostics(path);
  const semanticDiagnostics = env.languageService.getSemanticDiagnostics(path);

  const diagnostics = [...syntaticDiagnostics, ...semanticDiagnostics].filter(
    (diagnostic): diagnostic is DiagnosticWithLocation =>
      isDiagnosticWithLocation(diagnostic) &&
      !diagnosticCodesToIgnore.includes(diagnostic.code),
  );

  return diagnostics.map(convertTSDiagnosticToCM);
}

/**
 * TypeScript has a set of diagnostic categories,
 * which maps roughly onto CodeMirror's categories.
 * Here, we do the mapping.
 */
export function tsCategoryToSeverity(
  diagnostic: Pick<ts.DiagnosticWithLocation, "category" | "code">,
): Diagnostic["severity"] {
  if (diagnostic.code === 7027) {
    // Unreachable code detected
    return "warning";
  }
  switch (diagnostic.category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Message:
      return "info";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
      return "info";
  }
}

/**
 * Not all TypeScript diagnostic relate to specific
 * ranges in source code: here we filter for those that
 * do.
 */
export function isDiagnosticWithLocation(
  diagnostic: ts.Diagnostic,
): diagnostic is ts.DiagnosticWithLocation {
  return !!(
    diagnostic.file &&
    typeof diagnostic.start === "number" &&
    typeof diagnostic.length === "number"
  );
}

/**
 * Get the message for a diagnostic. TypeScript
 * is kind of weird: messageText might have the message,
 * or a pointer to the message. This follows the chain
 * to get a string, regardless of which case we're in.
 */
export function tsDiagnosticMessage(
  diagnostic: Pick<ts.Diagnostic, "messageText">,
): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

/**
 * TypeScript and CodeMirror have slightly different
 * ways of representing diagnostics. This converts
 * from one to the other.
 */
export function convertTSDiagnosticToCM(
  d: ts.DiagnosticWithLocation,
): Diagnostic {
  const start = d.start;
  const message = tsDiagnosticMessage(d);

  return {
    from: start,
    to: start + d.length,
    message: message,
    severity: tsCategoryToSeverity(d),
  };
}
