/*
 * Это пользовательский виджет, показывающий количество слов и символов в текущей текстовой заметке.
 * Чтобы включить виджет для заметки, добавьте ей метку 'wordCount'. Метку можно сделать наследуемой — тогда виджет включится для всего поддерева.
 * 
 * Посмотрите, как виджет работает в разделе «Книги» и его подразделах.
 */
const TPL = `<div style="padding: 10px; border-top: 1px solid var(--main-border-color); contain: none;">
    <strong>Количество слов: </strong>
    <span class="word-count"></span>

    &nbsp;

    <strong>Количество символов: </strong>
    <span class="character-count"></span>
</div>`;

class WordCountWidget extends api.NoteContextAwareWidget {
    get position() { return 100; } // Чем больше значение, тем ниже или правее будет расположен элемент

    get parentWidget() { return 'center-pane'; }

    isEnabled() {
        return super.isEnabled()
            && this.note.type === 'text'
            && this.note.hasLabel('wordCount');
    }

    doRender() {
        this.$widget = $(TPL);
        this.$wordCount = this.$widget.find('.word-count');
        this.$characterCount = this.$widget.find('.character-count');
        return this.$widget;
    }

    async refreshWithNote(note) {
        const {content} = await note.getNoteComplement();

        const text = $(content).text(); // Получить только обычный текст

        const counts = this.getCounts(text);

        this.$wordCount.text(counts.words);
        this.$characterCount.text(counts.characters);
    }

    getCounts(text) {
        const chunks = text
            .split(/[\s-+:,/\\]+/)
            .filter(chunk => chunk !== '');

        let words;

        if (chunks.length === 1 && chunks[0] === '') {
            words = 0;
        }
        else {
            words = chunks.length;
        }

        const characters = chunks.join('').length;

        return {words, characters};
    }

    async entitiesReloadedEvent({loadResults}) {
        if (loadResults.isNoteContentReloaded(this.noteId)) {
            this.refresh();
        }
    }
}

module.exports = new WordCountWidget();