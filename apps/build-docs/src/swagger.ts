import BuildContext from "./context";
import { join } from "path";
import { execSync } from "child_process";
import { mkdirSync } from "fs";

interface BuildInfo {
    specPath: string;
    outDir: string;
}

const buildInfos: BuildInfo[] = [
    {
        // Paths are relative to Git root.
        specPath: "apps/server/src/assets/api-openapi.yaml",
        outDir: "api/internal"
    },
    {
        specPath: "apps/server/src/assets/etapi.openapi.yaml",
        outDir: "api/etapi"
    }
];

export default function buildSwagger({ baseDir, gitRootDir }: BuildContext) {
    for (const { specPath, outDir } of buildInfos) {
        const absSpecPath = join(gitRootDir, specPath);
        const targetDir = join(baseDir, outDir);
        mkdirSync(outDir, { recursive: true });
        execSync(`pnpm redocly build-docs ${absSpecPath} -o ${targetDir}/index.html`, { stdio: "inherit" });
    }
}
