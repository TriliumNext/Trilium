import child_process from "child_process";
import fs from "fs";

function getBuildDate() {
    const now = new Date();
    now.setMilliseconds(0);
    return now.toISOString().replace(".000", "");
}

function getGitRevision() {
    return child_process.execSync('git log -1 --format="%H"').toString("utf-8").trimEnd();
}

const output = `\
export default {
    buildDate: "${getBuildDate()}",
    buildRevision: "${getGitRevision()}"
};
`;

fs.writeFileSync("packages/trilium-core/src/services/build.ts", output);
