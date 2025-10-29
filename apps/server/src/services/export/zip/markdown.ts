import NoteMeta from "../../meta/note_meta"
import { ZipExportProvider } from "./abstract_provider.js"
import mdService from "../markdown.js";

export default class MarkdownExportProvider extends ZipExportProvider {

    prepareMeta() { }

    prepareContent(title: string, content: string | Buffer, noteMeta: NoteMeta): string | Buffer {
        if (noteMeta.format === "markdown" && typeof content === "string") {
            let markdownContent = mdService.toMarkdown(content);

            if (markdownContent.trim().length > 0 && !markdownContent.startsWith("# ")) {
                markdownContent = `# ${title}\r
${markdownContent}`;
            }

            markdownContent = this.rewriteFn(markdownContent, noteMeta);
            return markdownContent;
        } else {
            return content;
        }
    }

    afterDone() { }

}
