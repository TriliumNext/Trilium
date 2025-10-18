import { it, describe } from "vitest";
import { getPresentationThemes, loadPresentationTheme } from "./themes";

describe("Presentation themes", () => {
    it("can load all themes", async () => {
        const themes = getPresentationThemes();

        await Promise.all(themes.map(theme => loadPresentationTheme(theme.id)));
    });
});
