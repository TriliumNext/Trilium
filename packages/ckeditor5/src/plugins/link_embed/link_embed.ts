import { Plugin } from 'ckeditor5';
import AutoLinkToMention from './link_embed_autodetect.js';
import LinkEmbedEditing from './link_embed_editing.js';
import LinkEmbedUI from './link_embed_ui.js';

export {
    CHANGE_LINK_DISPLAY_COMMAND,
    CHANGE_LINK_PREVIEW_TITLE_COMMAND,
    LINK_DISPLAY_MODES,
    LINK_EMBED_COMMAND,
    REMOVE_LINK_EMBED_COMMAND,
    type LinkDisplayMode
} from './link_embed_commands.js';

/**
 * Link previews: rich widgets for external URLs, in three shapes — an inline mention (favicon +
 * title pill), a block card (thumbnail, title, description) and a block embed (a player, for URLs
 * that have one). A fourth mode, "Plain link", converts back to an ordinary link.
 *
 * The feature is assembled from:
 *   - {@link LinkEmbedEditing} — schema, converters and the commands ({@link module:link_embed_commands});
 *   - {@link LinkEmbedUI} — the toolbar button and its balloon form;
 *   - {@link AutoLinkToMention} — auto-conversion of typed/pasted URLs;
 *   - LinkEmbedToolbar (loaded separately by the host) — the widget toolbar, whose Display dropdown
 *     also serves the native link balloon.
 */
export default class LinkEmbed extends Plugin {
    static get requires() {
        return [LinkEmbedEditing, LinkEmbedUI, AutoLinkToMention];
    }
}
