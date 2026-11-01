import { Plugin } from "ckeditor5";

import FileUploadUI from "./file_upload_ui.js";
import type FileUploadCommand from "./fileuploadcommand.js";
import FileUploadEditing from "./fileuploadediting.js";

export default class Uploadfileplugin extends Plugin {
    static get requires() {
        return [ FileUploadEditing, FileUploadUI ] as const;
    }

    static get pluginName() {
        return "fileUploadPlugin" as const;
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        FileUploadEditing: FileUploadEditing;
        [FileUploadUI.pluginName]: FileUploadUI;
    }

    interface CommandsMap {
        fileUpload: FileUploadCommand;
    }
}
