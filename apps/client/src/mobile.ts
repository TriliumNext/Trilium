import "autocomplete.js/index_jquery.js";

import appContext from "./components/app_context.js";
import glob from "./services/glob.js";
import noteAutocompleteService from "./services/note_autocomplete.js";

glob.setupGlobs();

await appContext.earlyInit();

noteAutocompleteService.init();

// A dynamic import is required for layouts since they initialize components which require translations.
const MobileLayout = (await import("./layouts/mobile_layout.js")).default;

appContext.setLayout(new MobileLayout());
appContext.start();
