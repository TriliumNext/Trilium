import type { Request, Response } from "express";
import { parseRangeHeader } from "./parseRangeHeader.js";
import { RangeParserError } from "./RangeParserError.js";
import type { Logger } from "./Logger.js";
import type { ContentProvider } from "./ContentProvider.js";
import type { ParamsDictionary } from "express-serve-static-core";
import { ContentDoesNotExistError } from "./ContentDoesNotExistError.js";
import {
  getRangeHeader,
  setContentRangeHeader,
  setContentTypeHeader,
  setContentDispositionHeader,
  setAcceptRangesHeader,
  setContentLengthHeader,
  setCacheControlHeaderNoCache
} from "./utils.js";
export function createPartialContentHandler<P extends ParamsDictionary>(contentProvider: ContentProvider<P>, logger: Logger) {
  return async function handler(req: Request<P>, res: Response) {
    let content;
    try {
      content = await contentProvider(req);
    } catch (error) {
      logger.debug("createPartialContentHandler: ContentProvider threw exception: ", error);
      if (error instanceof ContentDoesNotExistError) {
        return res.status(404).send(error.message);
      }
      return res.sendStatus(500);
    }
    let { getStream, mimeType, fileName, totalSize } = content;
    const rangeHeader = getRangeHeader(req);
    let range;
    try {
      range = parseRangeHeader(rangeHeader, totalSize, logger);
    } catch (error) {
      logger.debug(`createPartialContentHandler: parseRangeHeader error: `, error);
      if (error instanceof RangeParserError) {
        setContentRangeHeader(null, totalSize, res);
        return res.status(416).send(`Invalid value for Range: ${rangeHeader}`);
      }
      return res.sendStatus(500);
    }
    setContentTypeHeader(mimeType, res);
    setContentDispositionHeader(fileName, res);
    setAcceptRangesHeader(res);
    // If range is not specified, or the file is empty, return the full stream
    if (range === null) {
      logger.debug("createPartialContentHandler: No range found, returning full content.");
      setContentLengthHeader(String(totalSize), res);
      return getStream().pipe(res);
    }
    setContentRangeHeader(range, totalSize, res);
    let { start, end } = range;
    setContentLengthHeader(String(start === end ? 0 : end - start + 1), res);
    setCacheControlHeaderNoCache(res);
    // Return 206 Partial Content status
    logger.debug("createPartialContentHandler: Returning partial content for range: ", JSON.stringify(range));
    res.status(206);

    return getStream(range).pipe(res);
  };
}
