import { NoteMeta } from "../../../meta.js";
import { getContentJobExecutor } from "../../content_jobs/executor.js";
import { ZipExportProvider } from "./abstract_provider.js";

export default class MarkdownExportProvider extends ZipExportProvider {

    override readonly concurrentPrepare = true;

    prepareMeta() { }

    async prepareContent(title: string, content: string | Uint8Array, noteMeta: NoteMeta): Promise<string | Uint8Array> {
        if (noteMeta.format === "markdown" && typeof content === "string") {
            content = this.rewriteFn(content, noteMeta);
            content = await getContentJobExecutor().run({ kind: "htmlToMarkdown", html: content, env: this.contentEnv });

            if (content.trim().length > 0 && !content.startsWith("# ")) {
                content = `\
# ${title}\r
${content}`;
            }
        }
        return content;
    }

    afterDone() { }

}
