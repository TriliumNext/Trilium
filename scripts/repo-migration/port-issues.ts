import { spawnSync } from "node:child_process";
import fs from "node:fs";

const result = spawnSync("gh issue list -s all -L 5000 --json number,title", { shell: true });
if (result.error) {
  console.error("Error executing command:", result.error);
  process.exit(1);
}
const items = JSON.parse(result.stdout.toString()) as { number: number; title: string }[];

const logFile = fs.openSync("issues.txt", "a");

for (const item of items.reverse()) {
    console.log("Migrating ", item.number);

    const issueContent = spawnSync(`gh issue transfer ${item.number} TriliumNext/trilium`, { shell: true });
    if (issueContent.error) {
        console.error(`Error transferring issue #${item.number}:`, issueContent.error);
        fs.writeSync(logFile, `Error transferring issue #${item.number}: ${issueContent.error}\n`);
        process.exit(1);
    }

    const link = issueContent.stdout.toString().trim();
    fs.writeSync(logFile, `Migrated issue #${item.number} - ${item.title} to ${link}\n`);
}

fs.closeSync(logFile);
