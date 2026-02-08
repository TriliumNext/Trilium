import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";

import BuildContext from "./context";

interface BuildInfo {
    specPath: string;
    outDir: string;
}

const DIR_PREFIX = "rest-api";

const buildInfos: BuildInfo[] = [
    {
        // Paths are relative to Git root.
        specPath: "apps/server/internal.openapi.yaml",
        outDir: `${DIR_PREFIX}/internal`
    },
    {
        specPath: "apps/server/etapi.openapi.yaml",
        outDir: `${DIR_PREFIX}/etapi`
    }
];

export default function buildSwagger({ baseDir, gitRootDir }: BuildContext) {
    for (const { specPath, outDir } of buildInfos) {
        const absSpecPath = join(gitRootDir, specPath);
        const targetDir = join(baseDir, outDir);
        mkdirSync(targetDir, { recursive: true });
        execSync(
            `pnpm redocly build-docs ${absSpecPath} -o ${targetDir}/index.html`,
            { stdio: "inherit" }
        );
    }
}
