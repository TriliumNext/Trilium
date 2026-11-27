import type { SetupMarker } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { initializeCore } from "./index.js";
import * as backup from "./services/backup.js";
import * as config from "./services/config.js";
import * as context from "./services/context.js";
import * as crypto from "./services/encryption/crypto.js";
import * as zipExportFactory from "./services/export/zip_export_provider_factory.js";
import * as i18n from "./services/i18n.js";
import * as imageProvider from "./services/image_provider.js";
import * as inAppHelp from "./services/in_app_help.js";
import * as log from "./services/log.js";
import * as messaging from "./services/messaging/index.js";
import * as platform from "./services/platform.js";
import * as request from "./services/request.js";
import * as setupMode from "./services/setup_mode.js";
import * as sqlIndex from "./services/sql/index.js";
import type { SqlServiceParams } from "./services/sql/sql.js";
import * as sqlInit from "./services/sql_init.js";
import * as zipProvider from "./services/zip_provider.js";

type CoreParams = Parameters<typeof initializeCore>[0];

describe("initializeCore", () => {
    let spies: Record<string, MockInstance>;

    beforeEach(() => {
        // Every initializer is stubbed, so the spec checks the wiring without replacing the
        // providers the suite's setup already installed.
        spies = {
            initConfig: vi.spyOn(config, "initConfig").mockImplementation(() => {}),
            initPlatform: vi.spyOn(platform, "initPlatform").mockImplementation(() => {}),
            initLog: vi.spyOn(log, "initLog").mockImplementation(() => {}),
            initBackup: vi.spyOn(backup, "initBackup").mockImplementation(() => {}),
            enterSetupMode: vi.spyOn(setupMode, "enterSetupMode").mockImplementation(() => {}),
            initSetupPlatform: vi.spyOn(setupMode, "initSetupPlatform").mockImplementation(() => {}),
            initTranslations: vi.spyOn(i18n, "initTranslations").mockResolvedValue(undefined),
            initCrypto: vi.spyOn(crypto, "initCrypto").mockImplementation(() => {}),
            initZipProvider: vi.spyOn(zipProvider, "initZipProvider").mockImplementation(() => {}),
            initZipExportProviderFactory: vi.spyOn(zipExportFactory, "initZipExportProviderFactory").mockImplementation(() => {}),
            initContext: vi.spyOn(context, "initContext").mockImplementation(() => {}),
            initInAppHelp: vi.spyOn(inAppHelp, "initInAppHelp").mockImplementation(() => {}),
            initSql: vi.spyOn(sqlIndex, "initSql").mockResolvedValue(undefined),
            initSchema: vi.spyOn(sqlInit, "initSchema").mockImplementation(() => {}),
            initImageProvider: vi.spyOn(imageProvider, "initImageProvider").mockImplementation(() => {}),
            initDemoArchive: vi.spyOn(sqlInit, "initDemoArchive").mockImplementation(() => {}),
            initMessaging: vi.spyOn(messaging, "initMessaging").mockImplementation(() => {}),
            initRequest: vi.spyOn(request, "initRequest").mockImplementation(() => {})
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function requiredParams(): CoreParams {
        return {
            dbConfig: { provider: {}, isReadOnly: false } as SqlServiceParams,
            executionContext: {} as CoreParams["executionContext"],
            crypto: {} as CoreParams["crypto"],
            zip: {} as CoreParams["zip"],
            zipExportProviderFactory: vi.fn(),
            translations: vi.fn(),
            platform: {} as CoreParams["platform"],
            schema: "CREATE TABLE x (y)",
            backup: {} as CoreParams["backup"],
            image: {} as CoreParams["image"]
        };
    }

    it("hands every optional provider to its service when given", async () => {
        const params = requiredParams();
        const optional = {
            config: {} as NonNullable<CoreParams["config"]>,
            setupPlatform: {} as NonNullable<CoreParams["setupPlatform"]>,
            getDemoArchive: async () => null,
            messaging: {} as NonNullable<CoreParams["messaging"]>,
            request: {} as NonNullable<CoreParams["request"]>,
            inAppHelp: {} as NonNullable<CoreParams["inAppHelp"]>
        };

        await initializeCore({ ...params, ...optional });

        expect(spies.initConfig).toHaveBeenCalledWith(optional.config);
        expect(spies.initSetupPlatform).toHaveBeenCalledWith(optional.setupPlatform);
        expect(spies.initDemoArchive).toHaveBeenCalledWith(optional.getDemoArchive);
        expect(spies.initMessaging).toHaveBeenCalledWith(optional.messaging);
        expect(spies.initRequest).toHaveBeenCalledWith(optional.request);
        expect(spies.initInAppHelp).toHaveBeenCalledWith(optional.inAppHelp);
        expect(spies.enterSetupMode).toHaveBeenCalledWith(null);
        expect(spies.initTranslations).toHaveBeenCalledWith(params.translations, undefined);
        expect(spies.initSchema).toHaveBeenCalledWith(params.schema);
        expect(spies.initSql).toHaveBeenCalledOnce();
    });

    it("skips the optional providers it is not given and opens setup in the marker's language", async () => {
        const params = requiredParams();
        const setupMarker: SetupMarker = { lang: "de" };

        await initializeCore({ ...params, setupMarker });

        for (const name of [ "initConfig", "initSetupPlatform", "initDemoArchive", "initMessaging", "initRequest", "initInAppHelp" ]) {
            expect(spies[name], name).not.toHaveBeenCalled();
        }
        expect(spies.enterSetupMode).toHaveBeenCalledWith(setupMarker);
        expect(spies.initTranslations).toHaveBeenCalledWith(params.translations, "de");
    });
});
