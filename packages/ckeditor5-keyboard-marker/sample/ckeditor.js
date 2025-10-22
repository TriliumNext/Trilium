import { ClassicEditor, Autoformat, Base64UploadAdapter, BlockQuote, Bold, Code, CodeBlock, Essentials, Heading, Image, ImageCaption, ImageStyle, ImageToolbar, ImageUpload, Indent, Italic, Link, List, MediaEmbed, Paragraph, Table, TableToolbar } from 'ckeditor5';
import CKEditorInspector from '@ckeditor/ckeditor5-inspector';
import Kbd from '../src/kbd.js';
import 'ckeditor5/ckeditor5.css';
ClassicEditor
    .create(document.getElementById('editor'), {
    licenseKey: 'GPL',
    plugins: [
        Kbd,
        Essentials,
        Autoformat,
        BlockQuote,
        Bold,
        Heading,
        Image,
        ImageCaption,
        ImageStyle,
        ImageToolbar,
        ImageUpload,
        Indent,
        Italic,
        Link,
        List,
        MediaEmbed,
        Paragraph,
        Table,
        TableToolbar,
        CodeBlock,
        Code,
        Base64UploadAdapter
    ],
    toolbar: [
        'undo',
        'redo',
        '|',
        'keyboardMarker',
        '|',
        'heading',
        '|',
        'bold',
        'italic',
        'link',
        'code',
        'bulletedList',
        'numberedList',
        '|',
        'outdent',
        'indent',
        '|',
        'uploadImage',
        'blockQuote',
        'insertTable',
        'mediaEmbed',
        'codeBlock'
    ],
    image: {
        toolbar: [
            'imageStyle:inline',
            'imageStyle:block',
            'imageStyle:side',
            '|',
            'imageTextAlternative'
        ]
    },
    table: {
        contentToolbar: [
            'tableColumn',
            'tableRow',
            'mergeTableCells'
        ]
    }
})
    .then(editor => {
    window.editor = editor;
    CKEditorInspector.attach(editor);
    window.console.log('CKEditor 5 is ready.', editor);
})
    .catch(err => {
    window.console.error(err.stack);
});
//# sourceMappingURL=ckeditor.js.map