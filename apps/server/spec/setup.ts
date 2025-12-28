import { beforeAll } from "vitest";
import i18next from "i18next";
import { join } from "path";
import { setDayjsLocale } from "@triliumnext/commons";

// Initialize environment variables.
process.env.TRILIUM_DATA_DIR = join(__dirname, "db");
process.env.TRILIUM_RESOURCE_DIR = join(__dirname, "../src");
process.env.TRILIUM_INTEGRATION_TEST = "memory";
process.env.TRILIUM_ENV = "dev";
process.env.TRILIUM_PUBLIC_SERVER = "http://localhost:4200";

beforeAll(async () => {
    // Initialize the translations manually to avoid any side effects.
    const Backend = (await import("i18next-fs-backend")).default;

    // Initialize translations
    await i18next.use(Backend).init({
        lng: "en",
        fallbackLng: "en",
        ns: "server",
        backend: {
            loadPath: join(__dirname, "../src/assets/translations/{{lng}}/{{ns}}.json")
        }
    });

    // Initialize dayjs
    await setDayjsLocale("en");
});
