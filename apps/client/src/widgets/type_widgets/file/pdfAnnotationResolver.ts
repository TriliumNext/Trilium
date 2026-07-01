import type { ViewScope } from "../../../services/link";

/**
 * Find the annotation to scroll to from a list, given the viewScope from the navigation URL.
 *
 * Tries an exact ID match first. Falls back to page-number + content matching because
 * PDF.js reassigns annotation IDs when the PDF is saved (temporary editor IDs become
 * permanent PDF object references), so a link copied before saving will have a stale ID.
 */
export function resolveAnnotation(
    annotations: PdfAnnotationInfo[],
    viewScope: ViewScope | undefined
): PdfAnnotationInfo | undefined {
    if (!viewScope?.annotationId) return undefined;

    // 1. Exact ID match (works for existing PDF annotations and links copied after save).
    const exact = annotations.find((a) => a.id === viewScope.annotationId);
    if (exact) return exact;

    // 2. Fallback: match by page number + content preview (handles ID rotation after save).
    const page = viewScope.annotationPage;
    const rawPreview = viewScope.annotationPreview?.replace(/…$/, "") ?? "";
    if (!page || !rawPreview) return undefined;

    return annotations.find(
        (a) =>
            a.pageNumber === page &&
            (a.highlightedText.startsWith(rawPreview) || a.contents.startsWith(rawPreview))
    );
}
