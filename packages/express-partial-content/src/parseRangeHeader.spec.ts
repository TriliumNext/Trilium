import { parseRangeHeader } from "./parseRangeHeader.js";
import type { Logger } from "./Logger.js";
import { RangeParserError } from "./RangeParserError.js";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

describe("parseRangeHeader tests", () => {
  let logger: Logger;
  beforeEach(() => {
    logger = {
      debug: vi.fn() as (message: string, extra?: any) => void
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("returns null if range is not specified", () => {
    let value = parseRangeHeader("", 10, logger);
    expect(value).to.be.equal(null);
    value = parseRangeHeader(null, 10, logger);
    expect(value).to.be.equal(null);
  });
  it("returns null if total size is zero", () => {
    let value = parseRangeHeader("bytes=0-5", 0, logger);
    expect(value).to.be.equal(null);
  });
  it("if end is not provided, sets end to the last byte (totalSize - 1).", () => {
    let value = parseRangeHeader("bytes=0-", 10, logger);
    expect(value).to.be.deep.equal({ start: 0, end: 9 });
  });
  it('if start is not provided, set it to the offset of last "end" bytes from the end of the file.', () => {
    let value = parseRangeHeader("bytes=-5", 10, logger);
    expect(value).to.be.deep.equal({ start: 5, end: 9 });
  });
  it("handles invalid ranges", () => {
    try {
      parseRangeHeader("bytes=6-5", 10, logger);
    } catch (error) {
      expect(error).that.be.instanceOf(RangeParserError);
    }
    try {
      parseRangeHeader("bytes=6-7", 10, logger);
    } catch (error) {
      expect(error).that.be.instanceOf(RangeParserError);
    }
    try {
      parseRangeHeader("bytes=6-11", 10, logger);
    } catch (error) {
      expect(error).that.be.instanceOf(RangeParserError);
    }
  });
  it("returns a valid parsed range.", () => {
    let value = parseRangeHeader("bytes=0-5", 10, logger);
    expect(value).to.be.deep.equal({ start: 0, end: 5 });
  });
});
