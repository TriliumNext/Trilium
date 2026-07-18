import type { ExportFormat } from "../../meta.js";
import type { ZipExportProvider, ZipExportProviderData } from "./zip/abstract_provider.js";

export type ZipExportProviderFactory = (format: ExportFormat, data: ZipExportProviderData) => Promise<ZipExportProvider>;

let factory: ZipExportProviderFactory | null = null;

export function initZipExportProviderFactory(f: ZipExportProviderFactory) {
    factory = f;
}

export function getZipExportProviderFactory(): ZipExportProviderFactory {
    if (!factory) throw new Error("ZipExportProviderFactory not initialized.");
    return factory;
}
