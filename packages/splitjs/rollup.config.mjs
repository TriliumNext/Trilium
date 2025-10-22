import buble from '@rollup/plugin-buble'
import pkg from "./package.json" with { type: "json" };

const output = {
    format: 'umd',
    file: "dist/split.js",
    name: 'Split',
    sourcemap: false,
    banner: `/*! Split.js - v${pkg.version} */\n`
}

export default [
    {
        input: 'src/split.js',
        output: [
            output,
            {
                file: "dist/split.min.js",
                format: 'esm',
                sourcemap: false,
            },
        ],
        plugins: [buble()],
    }
]
