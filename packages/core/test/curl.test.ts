import { describe, expect, it } from "vitest";
import { parseInput } from "../src/curl";
import { tokenize } from "../src/tokenize";

describe("tokenize", () => {
  it("handles quotes, escapes and continuations", () => {
    expect(tokenize(`curl 'a b' "c \\"d\\"" e\\ f \\\n  -s`)).toEqual(["curl", "a b", 'c "d"', "e f", "-s"]);
  });

  it("handles ANSI-C quoting", () => {
    expect(tokenize(`--data-raw $'{"a":"it\\'s\\n"}'`)).toEqual(["--data-raw", `{"a":"it's\n"}`]);
  });

  it("stops at a pipe", () => {
    expect(tokenize(`curl https://x.io | jq .`)).toEqual(["curl", "https://x.io"]);
  });
});

describe("parseInput", () => {
  it("parses a bare URL", () => {
    expect(parseInput("api.example.com/v1/users")).toMatchObject({
      method: "GET",
      url: "http://api.example.com/v1/users",
      source: "url",
    });
  });

  it("parses METHOD URL shorthand", () => {
    expect(parseInput("delete https://x.io/a").method).toBe("DELETE");
  });

  it("parses a typical curl", () => {
    const req = parseInput(`curl -X POST 'https://api.example.com/v1/orders?expand=items' \\
      -H 'Authorization: Bearer abc' \\
      -H 'Content-Type: application/json' \\
      --data-raw '{"qty":2}'`);
    expect(req).toMatchObject({
      method: "POST",
      url: "https://api.example.com/v1/orders?expand=items",
      headers: [["Authorization", "Bearer abc"], ["Content-Type", "application/json"]],
      body: { kind: "raw", data: '{"qty":2}' },
    });
  });

  it("infers POST from data and adds the form content type", () => {
    const req = parseInput(`curl https://x.io -d a=1 -d b=2`);
    expect(req.method).toBe("POST");
    expect(req.body).toEqual({ kind: "raw", data: "a=1&b=2" });
    expect(req.headers).toContainEqual(["Content-Type", "application/x-www-form-urlencoded"]);
  });

  it("moves data to the query with -G", () => {
    const req = parseInput(`curl -G https://x.io/s?q=1 -d page=2`);
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://x.io/s?q=1&page=2");
    expect(req.body).toBeUndefined();
  });

  it("handles --json, bundled flags, attached values and -u", () => {
    const req = parseInput(`curl -sSL -XPUT --json '{"a":1}' -u me:pw https://x.io`);
    expect(req.method).toBe("PUT");
    expect(req.followRedirects).toBe(true);
    expect(req.headers).toContainEqual(["Content-Type", "application/json"]);
    expect(req.headers).toContainEqual(["Authorization", "Basic " + btoa("me:pw")]);
  });

  it("parses multipart forms", () => {
    const req = parseInput(`curl https://x.io -F name=avatar -F file=@./me.png`);
    expect(req.body).toEqual({
      kind: "multipart",
      parts: [{ name: "name", value: "avatar" }, { name: "file", value: "./me.png", file: true }],
    });
  });

  it("strips quotes from -F values like curl does", () => {
    const req = parseInput(`curl https://x.io --form 'file=@"/tmp/a b.png"' --form 'alt="My face"' --form-string 'raw="kept"'`);
    expect(req.body).toEqual({
      kind: "multipart",
      parts: [
        { name: "file", value: "/tmp/a b.png", file: true },
        { name: "alt", value: "My face" },
        { name: "raw", value: '"kept"' },
      ],
    });
  });

  it("skips options it ignores, including their values", () => {
    const req = parseInput(`curl --compressed -o out.json -m 10 https://x.io`);
    expect(req.url).toBe("https://x.io/");
  });

  it("rejects garbage", () => {
    expect(() => parseInput("hello there world")).toThrow();
    expect(() => parseInput("curl -H 'a: b'")).toThrow(/No URL/);
  });
});
