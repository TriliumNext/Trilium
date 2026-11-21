import { useEffect } from "preact/hooks";

export function usePageTitle(title: string) {
    useEffect(() => {
        if (title.length) {
            document.title = `${title} - Trilium Notes`;
        } else {
            document.title = "Trilium Notes";
        }
    }, [ title ]);
}
