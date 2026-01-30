import { readFileSync } from "fs";
import { join } from "path";

const basePath = join(__dirname, "../../apps/server/src/services");
const oldFile = join(basePath, "icon_pack_boxicons-v2.json");
const newFile = join(basePath, "icon_pack_boxicons-v3.json");

const oldData = JSON.parse(readFileSync(oldFile, "utf-8"));
const newData = JSON.parse(readFileSync(newFile, "utf-8"));

const oldIcons = new Set(Object.keys(oldData.icons).filter(key => !key.startsWith("bxl")));
const newIcons = new Set(Object.keys(newData.icons));

const onlyInOld = [...oldIcons].filter(x => !newIcons.has(x));
const onlyInNew = [...newIcons].filter(x => !oldIcons.has(x));

console.log("## Icons only in old manifest\n", onlyInOld.map(x => `- ${x}`).join("\n"));
// console.log("## Icons only in new manifest\n", onlyInNew.map(x => `- ${x}`).join("\n"));

if (onlyInOld.length === 0 && onlyInNew.length === 0) {
    console.log("The icon manifests are identical in terms of icon keys.");
} else {
    console.log("There are differences between the icon manifests.");
}
