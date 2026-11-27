/**
 * Every stylesheet the editor brings, in the order the editor loads them, without its code. The
 * client's read-only text view imports this instead of the package, so a note's content looks as
 * it does in the editor without loading the editor. `index.ts` imports it first, which keeps the
 * order the same in both; `styles.spec.ts` fails when a stylesheet is missing or out of place.
 */
import "ckeditor5/ckeditor5.css";
// Baseline block-quote styling from CKEditor's block-quote feature. It arrived here with the
// admonition plugin (which was forked from block-quote) but styles `blockquote`, not admonitions —
// the client's theme-next stylesheet overrides parts of it with `!important`.
import "./theme/blockquote.css";
import "./theme/content_colors.css";
import "./theme/code_block_toolbar.css";
import "./theme/format_painter.css";
import "./theme/resizable_widgets.css";
import "./theme/mention.css";
import "mathlive/fonts.css";
import "mathlive/static.css";
import "./theme/math_form.css";
import "./theme/tile_row.css";
import "./theme/block_drag_handle.css";
import "./theme/find_in_link_widgets.css";
import "./theme/collapsible.css";
import "./theme/scrollable_bar.css";
import "./theme/tabs.css";
import "./theme/multicolumn.css";
import "./theme/aside.css";
import "./theme/footnotes.css";
import "./theme/footnotes_editing.css";
import "./plugins/snippets/theme/snippets.css";
import "./plugins/ai_assistant/theme/ai_assistant.css";
import "./theme/code_block_insert_paragraph.css";
import "./theme/content_embed_tools.css";
import "./theme/block_reference.css";
import "./theme/collapsible_headings.css";
import "./theme/collapsible_list_items.css";
import "./theme/hidden_blocks.css";
import "./theme/table_insert.css";
import "./theme/table_column_bar.css";
import "./theme/table_touch_selection.css";
import "./theme/vim.css";
