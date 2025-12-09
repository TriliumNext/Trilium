// Source: https://github.com/Devasta/highlightjs-kdl/blob/master/src/languages/kdl.js
import type { HLJSApi, Language } from "highlight.js";

/*
Language: KDL
Description: A cuddly document language.
Author: Daniel Murphy <daniel@devasta.ie>
Website: https://kdl.dev
Category: config
*/

export default function hljsDefineKDL(hljs: HLJSApi): Language {
    const ESCAPES = {
        scope: 'char.escape',
        variants: [
            { begin: /\\n/ },
            { begin: /\\r/ },
            { begin: /\\t/ },
            { begin: /\\"/ },
            { begin: /\\\\/ },
            { begin: /\\b/ },
            { begin: /\\f/ }
        ]
    };

    const LITERALS = [
        "true",
        "false",
        "null"
    ];

    const STRINGS = {
        scope: 'string',
        variants: [
            {
                begin: /r(#)+"/,
                end: /"(#)+/
            },
            {
                begin: /"/,
                end: /"/
            }
        ],
        contains: [
            ESCAPES
        ]
    };


    const COMMENTS = {
        scope: 'comment',
        variants: [
            hljs.C_BLOCK_COMMENT_MODE,
            hljs.C_LINE_COMMENT_MODE,
            {
                begin: /\/-/,
                end: /\n/
            }
        ]
    };

    const NUMBERS = {
        scope: 'number',
        variants: [
            {
                begin: /([+-])?0b[_01]*/,
            },
            {
                begin: /([+-])?0o[_0-7]*/,
            },
            {
                begin: /([+-])?0x[_0-9A-Fa-f]*/,
            },
            {
                begin: hljs.C_NUMBER_RE
            }
        ]
    };

    const TYPEANNOTATIONS = {
        scope: 'type',
        begin: /\(/,
        end: /\)/
    };

    return {
        name: 'KDL',
        aliases: [ 'kdl' ],
        contains: [
            STRINGS,
            COMMENTS,
            NUMBERS,
            TYPEANNOTATIONS
        ],
        keywords: {
            literal: LITERALS
        }
    };
}
