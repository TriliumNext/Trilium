import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  getHeader,
  setHeader,
  getRangeHeader,
  setContentTypeHeader,
  setContentLengthHeader,
  setAcceptRangesHeader,
  setContentDispositionHeader,
  setContentRangeHeader,
  setCacheControlHeaderNoCache
} from "./utils.js";

describe("utils tests", () => {
  let req: Request;
  let res: Response;
  beforeEach(() => {
    req = {
      headers: {
        "content-type": "application/octet-stream",
        range: "*"
      }
    } as Request;
    res = {
      setHeader: vi.fn() as (name: string, value: string) => void
    } as Response;
  });
  describe("getHeader tests", () => {
    it("gets the specified header value if present", () => {
      const value = getHeader("content-type", req);
      expect(value).to.equal("application/octet-stream");
    });
    it("returns undefined if the specified header value is absent", () => {
      const value = getHeader("mime-type", req);
      expect(value).to.be.undefined;
    });
  });
  describe("setHeader tests", () => {
    it("invokes res.setHeader API with the specified name and value args", () => {
      const name = "Content-Type";
      const value = "application/octet-stream";
      setHeader(name, value, res);
      expect(res.setHeader).toHaveBeenCalledExactlyOnceWith(name, value);
    });
  });
  describe("getRangeHeader tests", () => {
    it("gets range header value", () => {
      const value = getRangeHeader(req);
      expect(value).to.equal("*");
    });
  });
  describe("setContentTypeHeader tests", () => {
    it("sets Content-Type header with specified value", () => {
      const value = "application/octet-stream";
      setContentTypeHeader(value, res);
      expect(res.setHeader).toHaveBeenCalledExactlyOnceWith("Content-Type", value);
    });
  });
  describe("setContentLengthHeader tests", () => {
    it("sets Content-Length header with specified value", () => {
      const value = "100";
      setContentLengthHeader(value, res);
      expect(res.setHeader).toHaveBeenCalledExactlyOnceWith("Content-Length", value);
    });
  });
  describe("setAcceptRangesHeader tests", () => {
    it("sets Accept-Ranges header with specified value", () => {
      const value = "bytes";
      setAcceptRangesHeader(res);
      expect(res.setHeader).toHaveBeenCalledExactlyOnceWith("Accept-Ranges", value);
    });
  });
  describe("setContentRangeHeader tests", () => {
    it("sets Content-Range header with specified value", () => {
      let range: { start: number, end: number } | null = { start: 10, end: 100 };
      const size = 1000;
      let value = `bytes ${range.start}-${range.end}/${size}`;
      setContentRangeHeader(range, size, res);
      expect(res.setHeader).toHaveBeenCalledExactlyOnceWith("Content-Range", value);
      (res.setHeader as Mock).mockReset();

      range = null;
      value = `bytes */${size}`;
      setContentRangeHeader(range, size, res);
      expect(res.setHeader).toHaveBeenCalledExactlyOnceWith("Content-Range", value);
    });
  });
  describe("setContentDispositionHeader tests", () => {
    it("sets Content-Disposition header with specified value", () => {
      const fileName = "file.txt";
      const value = `attachment; filename*=utf-8''${fileName}`;
      setContentDispositionHeader(fileName, res);
      expect(res.setHeader).toHaveBeenCalledExactlyOnceWith("Content-Disposition", value);
    });
    it("sets Content-Disposition header with specified unicode", () => {
      const fileName = "file.txt";
      const value = `attachment; filename*=utf-8''${encodeURIComponent(fileName)}`;
      setContentDispositionHeader(fileName, res);
      expect(res.setHeader).toHaveBeenCalledExactlyOnceWith("Content-Disposition", value);
    });
  });
  describe("setCacheControlHeaderNoCache tests", () => {
    it("sets Cache-Control header with specified value", () => {
      const value = "no-cache";
      setCacheControlHeaderNoCache(res);
      expect(res.setHeader).toHaveBeenCalledExactlyOnceWith("Cache-Control", value);
    });
  });
});
