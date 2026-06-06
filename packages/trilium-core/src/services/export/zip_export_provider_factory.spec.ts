import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ZipExportProvider, ZipExportProviderData } from "./zip/abstract_provider.js";
import type { ZipExportProviderFactory } from "./zip_export_provider_factory.js";

/**
 * The module keeps the registered factory in module-level state, so each test
 * re-imports it through a reset module registry to get a clean, uninitialized
 * starting point.
 */
async function freshModule() {
    vi.resetModules();
    return import("./zip_export_provider_factory.js");
}

describe("zip export provider factory", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it("throws a descriptive error when no factory has been registered", async () => {
        const { getZipExportProviderFactory } = await freshModule();

        expect(() => getZipExportProviderFactory()).toThrowError("ZipExportProviderFactory not initialized.");
    });

    it("returns the exact factory registered via initZipExportProviderFactory", async () => {
        const { initZipExportProviderFactory, getZipExportProviderFactory } = await freshModule();

        const provider = {} as ZipExportProvider;
        const factory: ZipExportProviderFactory = vi.fn(async () => provider);

        initZipExportProviderFactory(factory);

        const retrieved = getZipExportProviderFactory();
        expect(retrieved).toBe(factory);

        // The retrieved factory is the live function: invoking it forwards the
        // arguments and resolves to whatever the registered factory returns.
        const data = {} as ZipExportProviderData;
        await expect(retrieved("html", data)).resolves.toBe(provider);
        expect(factory).toHaveBeenCalledWith("html", data);
    });

    it("overwrites a previously registered factory on re-initialization", async () => {
        const { initZipExportProviderFactory, getZipExportProviderFactory } = await freshModule();

        const first: ZipExportProviderFactory = vi.fn(async () => ({}) as ZipExportProvider);
        const second: ZipExportProviderFactory = vi.fn(async () => ({}) as ZipExportProvider);

        initZipExportProviderFactory(first);
        initZipExportProviderFactory(second);

        expect(getZipExportProviderFactory()).toBe(second);
    });

    it("isolates state between module instances so a reset clears the factory", async () => {
        const initialized = await freshModule();
        initialized.initZipExportProviderFactory(vi.fn(async () => ({}) as ZipExportProvider));
        expect(initialized.getZipExportProviderFactory()).toBeDefined();

        // A fresh module registry must start uninitialized again.
        const reloaded = await freshModule();
        expect(() => reloaded.getZipExportProviderFactory()).toThrowError(
            "ZipExportProviderFactory not initialized."
        );
    });
});
