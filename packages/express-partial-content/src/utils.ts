import type { Request, Response } from "express";
import type { Range } from "./Range.js";
export const getHeader = (name: string, req: Request) => req.headers[name];
export const getRangeHeader: (req: Request) => string | string[] | undefined = getHeader.bind(null, "range");
export const setHeader = (name: string, value: string, res: Response) => res.setHeader(name, value);
export const setContentTypeHeader = setHeader.bind(null, "Content-Type");
export const setContentLengthHeader = setHeader.bind(null, "Content-Length");
export const setAcceptRangesHeader = setHeader.bind(null, "Accept-Ranges", "bytes");
export const setContentRangeHeader = (range: Range | null, size: number, res: Response) =>
  setHeader("Content-Range", `bytes ${range ? `${range.start}-${range.end}` : "*"}/${size}`, res);
export const setContentDispositionHeader = (fileName: string, res: Response) =>
  setHeader("Content-Disposition", `attachment; filename*=utf-8''${encodeURIComponent(fileName)}`, res);
export const setCacheControlHeaderNoCache = setHeader.bind(null, "Cache-Control", "no-cache");
export const setETagHeader = (etag: string, res: Response) =>
  setHeader("ETag", /^(W\/)?".*"$/.test(etag) ? etag : `"${etag}"`, res);
