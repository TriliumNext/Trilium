import * as utils from "./utils.js";
import { ContentDoesNotExistError } from "./ContentDoesNotExistError.js";
import { createPartialContentHandler } from "./createPartialContentHandler.js";
import type { ContentProvider } from "./ContentProvider.js";
import type { Logger } from "./Logger.js";
import type { Request, Response } from "express";
import type { Content } from "./Content.js";
import { Stream } from "stream";
import type { Range } from "./Range.js";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createPartialContentHandler tests", () => {
  let logger: Logger;
  beforeEach(() => {
    logger = {
      debug: vi.fn() as (message: string, extra?: any) => void
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("returns a handler", () => {
    const contentProvider = vi.fn().mockResolvedValue({}) as ContentProvider;
    const handler = createPartialContentHandler(contentProvider, logger);
    expect(typeof handler === "function");
  });

  describe("handler tests", () => {
    let req: Request;
    let res: Response;
    let statusSpy: MockInstance;
    let sendSpy: MockInstance;
    let sendStatusSpy: MockInstance;
    beforeEach(() => {
      req = {} as Request;
      res = {
        status: (code: number) => res,
        send: (message: string) => res,
        sendStatus: (code: number) => res,
        setHeader: vi.fn() as (name: string, value: string) => void
      } as Response;
      statusSpy = vi.spyOn(res, "status");
      sendSpy = vi.spyOn(res, "send");
      sendStatusSpy = vi.spyOn(res, "sendStatus");
    });
    it("invokes contentProvider with the specified request", async () => {
      const contentProvider = vi.fn().mockResolvedValue({}) as ContentProvider;
      const handler = createPartialContentHandler(contentProvider, logger);
      try {
        await handler(req, res);
      } catch {}
      expect(contentProvider).toHaveBeenCalledExactlyOnceWith(req);
    });
    it("returns 404 if contentProvider throws ContentDoesNotExistError error", async () => {
      const error = new ContentDoesNotExistError("404-File not found!");
      const contentProvider = vi.fn().mockRejectedValue(error) as ContentProvider;
      const handler = createPartialContentHandler(contentProvider, logger);
      try {
        await handler(req, res);
        expect(statusSpy).toHaveBeenCalledExactlyOnceWith(404);
        expect(sendSpy).toHaveBeenCalledExactlyOnceWith(error.message);
      } catch {
        expect(false);
      }
    });
    it("returns 500 if contentProvider throws any other error", async () => {
      const error = new Error("Something went wrong!");
      const contentProvider = vi.fn().mockRejectedValue(error) as ContentProvider;
      const handler = createPartialContentHandler(contentProvider, logger);
      try {
        await handler(req, res);
        expect(sendStatusSpy).toHaveBeenCalledExactlyOnceWith(500);
      } catch {
        expect(false);
      }
    });
    it("returns 416 if parseRangeHeader throws RangeParserError error", async () => {
      const contentProvider = vi.fn().mockResolvedValue({}) as ContentProvider;
      const handler = createPartialContentHandler(contentProvider, logger);
      req.headers = { range: "bytes=30-10" };
      try {
        await handler(req, res);
        expect(statusSpy).toHaveBeenCalledExactlyOnceWith(416);
      } catch {
        expect(false);
      }
    });
    it("returns 500 if parseRangeHeader throws other errors", async () => {
      const contentProvider = vi.fn().mockResolvedValue({}) as ContentProvider;
      const handler = createPartialContentHandler(contentProvider, logger);
      try {
        await handler(req, res);
        expect(sendStatusSpy).toHaveBeenCalledExactlyOnceWith(500);
      } catch {
        expect(false);
      }
    });
    it("returns correct response if range is not specified", async () => {
      const result = ({
        pipe() {
          return result;
        }
      } as any) as Stream;
      const content: Content = {
        fileName: "file.txt",
        totalSize: 10,
        mimeType: "text/plain",
        getStream(range?: Range) {
          return result;
        }
      };
      const pipeSpy = vi.spyOn(result, "pipe");
      const getStreamSpy = vi.spyOn(content, "getStream");
      const contentProvider = vi.fn().mockResolvedValue(content) as ContentProvider;
      const handler = createPartialContentHandler(contentProvider, logger);
      const setContentTypeHeaderSpy = vi.spyOn(utils, "setContentTypeHeader");
      const setContentDispositionHeaderSpy = vi.spyOn(utils, "setContentDispositionHeader");
      const setAcceptRangesHeaderSpy = vi.spyOn(utils, "setAcceptRangesHeader");
      const setContentLengthHeaderSpy = vi.spyOn(utils, "setContentLengthHeader");
      const setContentRangeHeaderSpy = vi.spyOn(utils, "setContentRangeHeader");
      try {
        await handler(req, res);
        expect(setContentTypeHeaderSpy).toHaveBeenCalledExactlyOnceWith(content.mimeType, res);
        expect(setContentDispositionHeaderSpy).toHaveBeenCalledExactlyOnceWith(content.fileName, res);
        expect(setAcceptRangesHeaderSpy).toHaveBeenCalledExactlyOnceWith(res);
        expect(setContentLengthHeaderSpy).toHaveBeenCalledExactlyOnceWith(content.totalSize, res);
        expect(getStreamSpy).toHaveBeenCalledExactlyOnceWith();
        expect(pipeSpy).toHaveBeenCalledExactlyOnceWith(res);
        expect(setContentRangeHeaderSpy).not.toHaveBeenCalled();
      } catch {
        expect(false);
      }
    });
    it("returns correct partial response if range is specified", async () => {
      req.headers = {
        range: "bytes=0-5"
      };
      const result = ({
        pipe() {
          return result;
        }
      } as any) as Stream;
      const content: Content = {
        fileName: "file.txt",
        totalSize: 10,
        mimeType: "text/plain",
        getStream(range?: Range) {
          return result;
        }
      };
      const range = { start: 0, end: 5 };
      const pipeSpy = vi.spyOn(result, "pipe");
      const getStreamSpy = vi.spyOn(content, "getStream");
      const contentProvider = vi.fn().mockResolvedValue(content) as ContentProvider;
      const handler = createPartialContentHandler(contentProvider, logger);
      const setContentTypeHeaderSpy = vi.spyOn(utils, "setContentTypeHeader");
      const setContentDispositionHeaderSpy = vi.spyOn(utils, "setContentDispositionHeader");
      const setAcceptRangesHeaderSpy = vi.spyOn(utils, "setAcceptRangesHeader");
      const setContentLengthHeaderSpy = vi.spyOn(utils, "setContentLengthHeader");
      const setContentRangeHeaderSpy = vi.spyOn(utils, "setContentRangeHeader");
      try {
        await handler(req, res);
        expect(setContentTypeHeaderSpy).toHaveBeenCalledExactlyOnceWith(content.mimeType, res);
        expect(setContentDispositionHeaderSpy).toHaveBeenCalledExactlyOnceWith(content.fileName, res);
        expect(setAcceptRangesHeaderSpy).toHaveBeenCalledExactlyOnceWith(res);
        expect(setContentRangeHeaderSpy).toHaveBeenCalledExactlyOnceWith(range, content.totalSize, res);
        expect(setContentLengthHeaderSpy).toHaveBeenCalledExactlyOnceWith(6, res);
        expect(getStreamSpy).toHaveBeenCalledExactlyOnceWith(range);
        expect(pipeSpy).toHaveBeenCalledExactlyOnceWith(res);
      } catch {
        expect(false);
      }
    });
  });
});
