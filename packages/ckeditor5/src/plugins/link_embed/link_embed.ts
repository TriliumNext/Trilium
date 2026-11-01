import { Plugin } from 'ckeditor5';
import AutoLinkToMention from './link_embed_autodetect.js';
import LinkEmbedEditing from './link_embed_editing.js';

export {
    CHANGE_LINK_DISPLAY_COMMAND,
    getLinkDisplayModeLabel,
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
 *   - {@link AutoLinkToMention} — auto-conversion of typed/pasted URLs;
 *   - LinkEmbedToolbar (loaded separately by the host) — the widget toolbar, whose Display dropdown
 *     also serves the native link balloon.
 *
 * The host's link dialog inserts previews through `LINK_EMBED_COMMAND`.
 */
export default class LinkEmbed extends Plugin {
    static get requires() {
        return [LinkEmbedEditing, AutoLinkToMention];
    }
}
