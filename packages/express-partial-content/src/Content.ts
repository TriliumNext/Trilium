import type { Range } from "./Range.js";
import { Stream } from "stream";
export interface Content {
  /**
   * Returns a readable stream based on the provided range (optional).
   * @param {Range} range The start-end range of stream data.
   * @returns {Stream} A readable stream
   */
  getStream(range?: Range): Stream;
  /**
   * Total size of the content
   */
  readonly totalSize: number;
  /**
   * Mime type to be sent in Content-Type header
   */
  readonly mimeType: string;
  /**
   * File name to be sent in Content-Disposition header
   */
  readonly fileName: string;
  /**
   * Optional entity tag (a stable content identifier, e.g. a content hash) sent in the ETag header. Lets a
   * client revalidate and reliably resume a partially-downloaded stream after a dropped connection.
   */
  readonly etag?: string;
};
