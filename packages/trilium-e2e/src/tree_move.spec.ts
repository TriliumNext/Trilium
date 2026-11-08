import test, { expect, Page } from "@playwright/test";

import App from "./support/app";

interface CreatedNote {
    noteId: string;
    branchId: string;
}

test("Moving several notes into a childless note leaves no ghost behind", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    const suffix = Date.now().toString(36);
    const main = await createNote(page, "root", `Main ${suffix}`);
    const children: CreatedNote[] = [];
    for (const index of [1, 2, 3, 4]) {
        children.push(await createNote(page, main.noteId, `Child ${index} ${suffix}`));
    }
    const target = await createNote(page, main.noteId, `Target ${suffix}`);

    const tree = app.noteTree;
    await tree.locator(".fancytree-node", { hasText: `Main ${suffix}` })
        .locator(".fancytree-expander").click();
    await tree.getByText(`Child 1 ${suffix}`, { exact: true }).click();
    await tree.getByText(`Child 4 ${suffix}`, { exact: true }).click({ modifiers: ["Shift"] });
    await page.keyboard.press("ControlOrMeta+X");

    await tree.getByText(`Target ${suffix}`, { exact: true }).click();
    await page.keyboard.press("ControlOrMeta+V");

    // Wait for the moves to land in froca, then for the tree to settle.
    await expect.poll(() => getFrocaChildIds(page, main.noteId)).toEqual([target.noteId]);
    await expect.poll(() => getFrocaChildIds(page, target.noteId))
        .toEqual(children.map((child) => child.noteId));
    await page.waitForTimeout(500);

    expect(await getTreeChildIds(page, main.noteId)).toEqual([target.noteId]);
    expect(await getStaleTreeBranchIds(page)).toEqual([]);
});

async function createNote(page: Page, parentNoteId: string, title: string): Promise<CreatedNote> {
    return page.evaluate(async ({ parentNoteId, title }) => {
        const response = await fetch(`/api/notes/${parentNoteId}/children?target=into`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-csrf-token": (window as any).glob.csrfToken
            },
            body: JSON.stringify({ title, content: "", type: "text" })
        });
        const { note, branch } = await response.json();
        return { noteId: note.noteId, branchId: branch.branchId };
    }, { parentNoteId, title });
}

function getFrocaChildIds(page: Page, noteId: string) {
    return page.evaluate((noteId) => {
        return (window as any).glob.froca.notes[noteId]?.children ?? [];
    }, noteId);
}

/** Note IDs of the tree nodes under every node of the note, in tree order. */
function getTreeChildIds(page: Page, noteId: string) {
    return page.evaluate((noteId) => {
        const tree = (window as any).$.ui.fancytree.getTree(".tree-wrapper .tree");
        const nodes = tree.getNodesByRef(noteId) ?? [];
        return nodes.flatMap((node: any) => (node.getChildren() ?? []).map((child: any) => child.data.noteId));
    }, noteId);
}

/** Branch IDs of tree nodes whose branch froca no longer knows. */
function getStaleTreeBranchIds(page: Page) {
    return page.evaluate(() => {
        const froca = (window as any).glob.froca;
        const tree = (window as any).$.ui.fancytree.getTree(".tree-wrapper .tree");
        const stale: string[] = [];
        tree.getRootNode().visit((node: any) => {
            if (node.data.branchId && !(node.data.branchId in froca.branches)) {
                stale.push(`${node.data.branchId} (${node.title})`);
            }
        });
        return stale;
    });
}
