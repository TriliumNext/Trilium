import appContext from "./components/app_context.js";
import { startApp } from "./components/app_startup.js";
import bundleService from "./services/bundle.js";
import { setupClipboardImageEmbed } from "./services/clipboard_image_embed.js";
import glob from "./services/glob.js";
import { setupLinkHandlers } from "./services/link.js";
import { preloadCommonNoteTypes } from "./widgets/note_types.js";

// The mobile entry before the layout is rebuilt in Preact. Nothing imports it: mobile.ts is the
// entry, and what this file sets up moves there piece by piece.

glob.setupGlobs();

await appContext.earlyInit();

setupClipboardImageEmbed();
setupLinkHandlers();

const widgetBundles = await bundleService.getWidgetBundlesByParent();

// A dynamic import is required for layouts since they initialize components which require translations.
const MobileLayout = (await import("./layouts/mobile_layout.js")).default;

appContext.setLayout(new MobileLayout(widgetBundles));

/** Resolves once the layout is rendered and froca has the note tree; see desktop.ts. */
export const ready = startApp().then(preloadCommonNoteTypes);
