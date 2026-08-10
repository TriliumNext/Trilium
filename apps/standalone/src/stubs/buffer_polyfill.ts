/**
 * Installs the npm `buffer` polyfill as the global Buffer for officeparser, which
 * uses Buffer throughout its conversion path. Its own prebuilt browser bundle ships
 * this same polyfill; since we bundle from the package's Node entry instead (see the
 * officeparser alias in vite.config.mts), we have to provide it ourselves. The
 * trailing slash on "buffer/" forces resolution to the npm package rather than the
 * Node built-in.
 */
import { Buffer } from "buffer/";

if (!("Buffer" in globalThis)) {
    Object.assign(globalThis, { Buffer });
}
