const CONTEXT_MENU_ITEMS: Browser.contextMenus.CreateProperties[] = [
    {
        id: "trilium-save-selection",
        title: "Save selection to Trilium",
        contexts: ["selection"]
    },
    {
        id: "trilium-save-cropped-screenshot",
        title: "Crop screenshot to Trilium",
        contexts: ["page"]
    },
    {
        id: "trilium-save-whole-screenshot",
        title: "Save whole screenshot to Trilium",
        contexts: ["page"]
    },
    {
        id: "trilium-save-page",
        title: "Save whole page to Trilium",
        contexts: ["page"]
    },
    {
        id: "trilium-save-link",
        title: "Save link to Trilium",
        contexts: ["link"]
    },
    {
        id: "trilium-save-image",
        title: "Save image to Trilium",
        contexts: ["image"]
    }
];

export default async function setupContextMenu() {
    // Context menu items need to be registered only once.
    // https://stackoverflow.com/questions/64318529/cannot-create-item-with-duplicate-context-menu-id-in-extension
    await browser.contextMenus.removeAll();
    for (const item of CONTEXT_MENU_ITEMS) {
        browser.contextMenus.create(item);
    }
}
