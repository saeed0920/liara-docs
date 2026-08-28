import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildChangelogEntry, escapeBraces, extractChangelog } from "./build-changelog-entry.mjs";

test("extracts only public changelog section", () => {
  const body = `Intro\n## Changelog entry\n## Faster deploys\n\nUseful change.\n\n---\n\n## PR details (not published)\nsecret`;
  assert.equal(extractChangelog(body), "## Faster deploys\n\nUseful change.");
});

test("skips an unchanged changelog template", async () => {
  const blogsDir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-"));
  fs.mkdirSync(path.join(blogsDir, "content"));
  fs.writeFileSync(path.join(blogsDir, "content", "changelog.mdx"), "## Existing\n");
  const result = await buildChangelogEntry({
    blogsDir,
    event: {
      repository: { full_name: "saeed0920/liara-docs" },
      pull_request: {
        number: 1,
        title: "Internal change",
        body: "## Changelog entry\n\n## <Short, human-readable title of what changed>",
        merged_at: "2026-08-28T10:00:00Z",
      },
    },
  });
  assert.equal(result.skip, true);
});

test("escapes braces outside fenced code", () => {
  assert.equal(
    escapeBraces("Fixed {id}\n```js\nconst x = { id: 1 };\n```"),
    "Fixed \\{id\\}\n```js\nconst x = { id: 1 };\n```",
  );
});

test("prepends entry, rehosts image, and prevents duplicates", async () => {
  const blogsDir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-"));
  fs.mkdirSync(path.join(blogsDir, "content"));
  fs.writeFileSync(path.join(blogsDir, "content", "changelog.mdx"), "## Existing\n");
  const event = {
    repository: { full_name: "saeed0920/liara-docs" },
    pull_request: {
      number: 42,
      title: "Faster deploys",
      body: "## Changelog entry\n## Faster deploys\n\n![Result](https://example.com/result.png)\n\n## PR details (not published)\nprivate",
      merged_at: "2026-08-28T10:00:00Z",
    },
  };
  const fetchImpl = async () => new Response(Buffer.from("png"), {
    headers: { "content-type": "image/png", "content-length": "3" },
  });

  const result = await buildChangelogEntry({ event, blogsDir, fetchImpl });
  assert.equal(result.skip, false);
  const changelog = fs.readFileSync(path.join(blogsDir, "content", "changelog.mdx"), "utf8");
  assert.match(changelog, /source: saeed0920\/liara-docs#42/);
  assert.match(changelog, /\.\/images\/2026-08-28-faster-deploys-42\/image-1\.png/);
  assert.doesNotMatch(changelog, /private/);
  assert.equal((await buildChangelogEntry({ event, blogsDir, fetchImpl })).skip, true);
});
