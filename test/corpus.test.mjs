import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCorpus,
  FALLBACK_NAMESPACE,
  GENERATED_NAMESPACE,
  validateManifest,
} from "../scripts/build-corpus.mjs";

async function project(files = { "docs/a.mdx": "# A\n\n<Section id='intro' title='Intro' />\nText\n" }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "liara-corpus-"));
  for (const [filename, content] of Object.entries(files)) {
    const target = path.join(root, "src/pages", filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

test("fallback manifest is reproducible, versioned, and isolated from generated namespace", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await buildCorpus({ projectRoot: root, source: "mdx-fallback", write: false });
  const second = await buildCorpus({ projectRoot: root, source: "mdx-fallback", write: false });
  assert.deepEqual(first, second);
  assert.equal(first.manifest.namespace, FALLBACK_NAMESPACE);
  assert.equal(first.manifest.entries[1].anchor, "intro");
  assert.equal(first.manifest.entries[1].url, "/docs/a/");
  assert.match(first.manifest.entries[1].contentHash, /^[a-f0-9]{64}$/);

  const generated = path.join(root, "public/llms/docs/a.md");
  await mkdir(path.dirname(generated), { recursive: true });
  await writeFile(generated, "# Stale title\n\n## Stale section\nText\n");
  const primary = await buildCorpus({ projectRoot: root, source: "generated", write: false, synchronize: true });
  assert.equal(primary.manifest.namespace, GENERATED_NAMESPACE);
  assert.notEqual(primary.manifest.namespace, first.manifest.namespace);
  assert.equal(await readFile(generated, "utf8"), "\uFEFF# A\n\n## Intro\nText\n");
});

test("corpus rejects empty input and URL collisions before manifest writes", async (t) => {
  const empty = await mkdtemp(path.join(os.tmpdir(), "liara-corpus-empty-"));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await assert.rejects(buildCorpus({ projectRoot: empty, source: "mdx-fallback" }), /missing or empty/);

  const collision = await project({
    "foo.mdx": "# Foo\n",
    "foo/index.mdx": "# Foo index\n",
  });
  t.after(() => rm(collision, { recursive: true, force: true }));
  await assert.rejects(buildCorpus({ projectRoot: collision, source: "mdx-fallback" }), /duplicate URL\/anchor identity/);
  await assert.rejects(readFile(path.join(collision, "public/llms.manifest.json")));
});

test("corpus rejects missing anchors, file mismatch, path escape, and content-hash mismatch", async (t) => {
  const invalidAnchor = await project({ "a.mdx": "# A\n<Section id='' title='Broken' />\n" });
  t.after(() => rm(invalidAnchor, { recursive: true, force: true }));
  await assert.rejects(buildCorpus({ projectRoot: invalidAnchor, source: "mdx-fallback", write: false }), /invalid Section/);

  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const corpusFile = path.join(root, "src/pages/docs/a.mdx");
  const { manifest } = await buildCorpus({ projectRoot: root, source: "mdx-fallback", write: false });
  await writeFile(corpusFile, "# changed\n");
  await assert.rejects(validateManifest({ corpusRoot: path.join(root, "src/pages"), corpusFiles: [corpusFile], manifest }), /content hash mismatch/);

  const escaped = structuredClone(manifest);
  escaped.entries[0].filename = "../outside.mdx";
  await assert.rejects(validateManifest({ corpusRoot: path.join(root, "src/pages"), corpusFiles: [corpusFile], manifest: escaped }), /mismatch|escape/);
});
