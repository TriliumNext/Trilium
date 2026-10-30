import appContext from "./components/app_context.js";
import bundleService from "./services/bundle.js";
import { setupClipboardImageEmbed } from "./services/clipboard_image_embed.js";
import glob from "./services/glob.js";
import { preloadCommonNoteTypes } from "./widgets/note_types.js";

glob.setupGlobs();

await appContext.earlyInit();

setupClipboardImageEmbed();

const widgetBundles = await bundleService.getWidgetBundlesByParent();

// A dynamic import is required for layouts since they initialize components which require translations.
const MobileLayout = (await import("./layouts/mobile_layout.js")).default;

appContext.setLayout(new MobileLayout(widgetBundles));

/** Resolves once the layout is rendered and froca has the note tree; see desktop.ts. */
export const ready = appContext.start().then(preloadCommonNoteTypes);
