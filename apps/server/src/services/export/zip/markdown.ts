import NoteMeta from "../../meta/note_meta";
import mdService from "../markdown.js";
import { ZipExportProvider } from "./abstract_provider.js";

export default class MarkdownExportProvider extends ZipExportProvider {

    prepareMeta() { }

    prepareContent(title: string, content: string | Uint8Array, noteMeta: NoteMeta): string | Uint8Array {
        if (noteMeta.format === "markdown" && typeof content === "string") {
            content = this.rewriteFn(content, noteMeta);
            content = mdService.toMarkdown(content);

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
