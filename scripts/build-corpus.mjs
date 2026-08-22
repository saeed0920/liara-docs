import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CORPUS_SCHEMA_VERSION = 1;
export const GENERATED_NAMESPACE = "liara-docs-generated-v1";
export const FALLBACK_NAMESPACE = "liara-docs-mdx-fallback-v1";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const lines = (value) => value.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").split("\n");

async function walk(root, extension) {
  const found = [];
  async function visit(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, item.name);
      if (item.isDirectory()) await visit(absolute);
      else if (item.isFile() && item.name.endsWith(extension)) found.push(absolute);
    }
  }
  await visit(root);
  return found.sort();
}

function relative(root, absolute) {
  const value = path.relative(root, absolute).replaceAll(path.sep, "/");
  if (!value || value === ".." || value.startsWith("../") || path.isAbsolute(value)) throw new Error(`corpus path escape: ${absolute}`);
  return value;
}

function routeFor(filename) {
  const withoutExtension = filename.replace(/\.(md|mdx)$/u, "");
  const route = withoutExtension === "index" ? "" : withoutExtension.replace(/\/?index$/u, "");
  return `/${route}${route ? "/" : ""}`.replace(/\/{2,}/gu, "/");
}

function firstHeading(content) {
  const heading = lines(content).find((line) => /^#\s+\S/u.test(line));
  if (!heading) throw new Error("corpus document has no H1");
  return heading.replace(/^#\s+/u, "").trim();
}

function sourceSections(content) {
  const visible = content.replace(/\{\/\*[\s\S]*?\*\/\}/gu, (comment) => comment.replace(/[^\n]/gu, " "));
  return [...visible.matchAll(/<Section\b([^>]*)\/?\s*>/gu)].map((match) => {
    const attrs = match[1];
    const id = attrs.match(/\bid\s*=\s*(["'])(.*?)\1/u)?.[2]?.trim();
    const title = attrs.match(/\btitle\s*=\s*(["'])(.*?)\1/u)?.[2]?.trim();
    if (!id || !title || /[#?/\\\s]/u.test(id)) throw new Error(`invalid Section id/title in MDX: ${attrs.slice(0, 120)}`);
    return { id, title, line: visible.slice(0, match.index).split("\n").length };
  });
}

export async function synchronizeGeneratedHeadings({ projectRoot = process.cwd() } = {}) {
  const sourceRoot = path.join(projectRoot, "src/pages");
  const generatedRoot = path.join(projectRoot, "public/llms");
  const sourceFiles = await walk(sourceRoot, ".mdx").catch(() => []);
  const generatedFiles = await walk(generatedRoot, ".md").catch(() => []);
  const sourceByStem = new Map(sourceFiles.map((file) => [relative(sourceRoot, file).replace(/\.mdx$/u, ""), file]));
  const generatedByStem = new Map(generatedFiles.map((file) => [relative(generatedRoot, file).replace(/\.md$/u, ""), file]));
  if (!sourceFiles.length || sourceByStem.size !== generatedByStem.size || [...sourceByStem.keys()].some((stem) => !generatedByStem.has(stem))) {
    throw new Error("generated Markdown is missing, stale, or orphaned");
  }
  for (const [stem, sourceFile] of sourceByStem) {
    const generatedFile = generatedByStem.get(stem);
    const sourceContent = await readFile(sourceFile, "utf8");
    const originalGenerated = await readFile(generatedFile, "utf8");
    const generatedLines = lines(originalGenerated);
    const h1 = generatedLines.findIndex((line) => /^#\s+\S/u.test(line));
    if (h1 < 0) throw new Error(`generated Markdown has no H1: ${stem}.md`);
    generatedLines[h1] = `# ${firstHeading(sourceContent)}`;
    const sections = sourceSections(sourceContent);
    let cursor = h1 + 1;
    for (const section of sections) {
      let index = generatedLines.findIndex((line, lineIndex) =>
        lineIndex >= cursor
        && /^#{2,6}\s+/u.test(line)
        && line.replace(/^#{2,6}\s+/u, "").replace(/^[-*]\s+/u, "").trim() === section.title);
      if (index < 0) {
        index = generatedLines.findIndex((line, lineIndex) =>
          lineIndex >= cursor
          && /^#{2,6}\s+/u.test(line)
          && line.replace(/^#{2,6}\s+/u, "").trim().toLowerCase() !== "all links");
      }
      if (index < 0) throw new Error(`generated Markdown is missing section slot '${section.title}' in ${stem}.md`);
      const depth = generatedLines[index].match(/^#+/u)[0];
      generatedLines[index] = `${depth} ${section.title}`;
      cursor = index + 1;
    }
    await writeFile(generatedFile, `\uFEFF${generatedLines.join("\n").replace(/\n*$/u, "")}\n`);
  }
}

function git(projectRoot, args, fallback) {
  try { return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return fallback; }
}

function buildTimestamp(projectRoot) {
  if (process.env.SOURCE_DATE_EPOCH) return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  return git(projectRoot, ["show", "-s", "--format=%cI", "HEAD"], "1970-01-01T00:00:00.000Z");
}

function entry({ namespace, filename, title, url, heading, anchor, startLine, endLine, content }) {
  return {
    id: sha256(`${namespace}\0${filename}\0${anchor}`).slice(0, 24),
    filename,
    title,
    url,
    heading,
    anchor,
    startLine,
    endLine,
    contentHash: sha256(content),
    namespace,
    schemaVersion: CORPUS_SCHEMA_VERSION,
  };
}

function entriesFor({ namespace, filename, corpusContent, sourceContent, fallback }) {
  const corpusLines = lines(corpusContent);
  const title = firstHeading(corpusContent);
  const url = routeFor(filename);
  const entries = [entry({
    namespace, filename, title, url, heading: title, anchor: "",
    startLine: 1, endLine: corpusLines.length, content: corpusLines.join("\n"),
  })];
  let cursor = 0;
  const sections = sourceSections(sourceContent);
  for (const [sectionIndex, section] of sections.entries()) {
    const index = fallback ? section.line - 1 : corpusLines.findIndex((line, lineIndex) => lineIndex >= cursor && /^#{2,6}\s+/u.test(line) && line.replace(/^#{2,6}\s+/u, "").replace(/^[-*]\s+/u, "").trim() === section.title);
    if (index < 0) throw new Error(`missing rendered heading '${section.title}' in ${filename}`);
    const next = fallback
      ? (sections[sectionIndex + 1]?.line ?? corpusLines.length + 1) - 1
      : corpusLines.findIndex((line, lineIndex) => lineIndex > index && /^#{1,2}\s+/u.test(line));
    const end = next < 0 ? corpusLines.length : next;
    entries.push(entry({
      namespace, filename, title, url, heading: section.title, anchor: section.id,
      startLine: index + 1, endLine: end, content: corpusLines.slice(index, end).join("\n"),
    }));
    cursor = index + 1;
  }
  if (entries.length > 1) {
    const endLine = Math.max(1, entries[1].startLine - 1);
    entries[0] = entry({
      namespace, filename, title, url, heading: title, anchor: "",
      startLine: 1, endLine, content: corpusLines.slice(0, endLine).join("\n"),
    });
  }
  return entries;
}

export async function validateManifest({ corpusRoot, corpusFiles, manifest }) {
  if (!corpusFiles.length) throw new Error("corpus is missing or empty");
  const filenames = corpusFiles.map((file) => relative(corpusRoot, file));
  if (new Set(filenames).size !== filenames.length) throw new Error("duplicate corpus filename");
  const manifestFiles = new Set(manifest.entries.map(({ filename }) => filename));
  if (filenames.some((filename) => !manifestFiles.has(filename)) || [...manifestFiles].some((filename) => !filenames.includes(filename))) throw new Error("corpus file/manifest mismatch");
  const identities = new Set();
  const byFile = new Map();
  for (const item of manifest.entries) {
    const identity = `${item.url}#${item.anchor}`;
    if (identities.has(identity)) throw new Error(`duplicate URL/anchor identity: ${identity}`);
    identities.add(identity);
    const absolute = path.resolve(corpusRoot, item.filename);
    relative(corpusRoot, absolute);
    const content = lines(await readFile(absolute, "utf8")).slice(item.startLine - 1, item.endLine).join("\n");
    if (sha256(content) !== item.contentHash) throw new Error(`content hash mismatch: ${item.filename}#${item.anchor}`);
    byFile.set(item.filename, true);
  }
  return true;
}

export async function buildCorpus({
  projectRoot = process.cwd(),
  source = process.env.CORPUS_SOURCE || "generated",
  write = true,
  synchronize = false,
} = {}) {
  if (!["generated", "mdx-fallback"].includes(source)) throw new Error("CORPUS_SOURCE must be generated or mdx-fallback");
  if (source === "generated" && synchronize) await synchronizeGeneratedHeadings({ projectRoot });
  const sourceRoot = path.join(projectRoot, "src/pages");
  const generatedRoot = path.join(projectRoot, "public/llms");
  const fallback = source === "mdx-fallback";
  const corpusRoot = fallback ? sourceRoot : generatedRoot;
  const extension = fallback ? ".mdx" : ".md";
  const namespace = fallback ? FALLBACK_NAMESPACE : GENERATED_NAMESPACE;
  const corpusFiles = await walk(corpusRoot, extension).catch(() => []);
  const sourceFiles = await walk(sourceRoot, ".mdx").catch(() => []);
  if (!corpusFiles.length || !sourceFiles.length) throw new Error("corpus input is missing or empty");

  const sourceByStem = new Map(sourceFiles.map((file) => [relative(sourceRoot, file).replace(/\.mdx$/u, ""), file]));
  const corpusByStem = new Map(corpusFiles.map((file) => [relative(corpusRoot, file).replace(new RegExp(`${extension.slice(1)}$`, "u"), "").replace(/\.$/u, ""), file]));
  if (!fallback && (sourceByStem.size !== corpusByStem.size || [...sourceByStem.keys()].some((stem) => !corpusByStem.has(stem)))) throw new Error("generated Markdown is missing, stale, or orphaned");

  const entries = [];
  for (const corpusFile of corpusFiles) {
    const filename = relative(corpusRoot, corpusFile);
    const stem = filename.replace(/\.(md|mdx)$/u, "");
    const sourceFile = sourceByStem.get(stem);
    if (!sourceFile) throw new Error(`missing rendered route for ${filename}`);
    entries.push(...entriesFor({
      namespace,
      filename,
      corpusContent: await readFile(corpusFile, "utf8"),
      sourceContent: await readFile(sourceFile, "utf8"),
      fallback,
    }));
  }
  entries.sort((a, b) => a.filename.localeCompare(b.filename) || a.startLine - b.startLine || a.anchor.localeCompare(b.anchor));
  const corpusDigest = sha256(JSON.stringify(entries));
  const manifest = {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    namespace,
    source,
    corpusRoot: path.relative(projectRoot, corpusRoot).replaceAll(path.sep, "/"),
    corpusDigest,
    entries,
  };
  await validateManifest({ corpusRoot, corpusFiles, manifest });

  const collectionManifest = {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    namespace,
    corpusDigest,
    corpusManifestDigest: sha256(JSON.stringify(manifest)),
    corpusCommit: git(projectRoot, ["rev-parse", "HEAD"], "unknown"),
    buildTimestamp: buildTimestamp(projectRoot),
    embedding: { provider: "avalai", model: "text-embedding-3-small", dimension: 1536 },
    chunkerVersion: "markdown-sections-v1",
    retrievalVersion: "hybrid-v2",
    fusionVersion: "rrf-page-v2",
    thresholdVersion: "sufficient-context-v2",
  };
  if (write) {
    const publicRoot = path.join(projectRoot, "public");
    await mkdir(publicRoot, { recursive: true });
    await writeFile(path.join(publicRoot, "llms.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(publicRoot, "llms.collection-manifest.json"), `${JSON.stringify(collectionManifest, null, 2)}\n`);
  }
  return { manifest, collectionManifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = process.argv.find((argument) => argument.startsWith("--source="))?.split("=", 2)[1];
  const { manifest } = await buildCorpus({ source, synchronize: source === "generated" });
  console.log(`Corpus ${manifest.namespace}: ${new Set(manifest.entries.map(({ filename }) => filename)).size} files, ${manifest.entries.length} entries`);
}
