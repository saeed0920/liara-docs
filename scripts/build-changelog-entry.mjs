import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

export function extractChangelog(body) {
  const marker = "## Changelog entry";
  const start = body.indexOf(marker);
  const content = start >= 0 ? body.slice(start + marker.length) : body;
  return content
    .split(/^## PR details \(not published\)\s*$/m)[0]
    .trim()
    .replace(/(?:^|\n)---\s*$/, "")
    .trim();
}

export function escapeBraces(text) {
  let fence;
  return text
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(```|~~~)/);
      if (match) {
        if (!fence) fence = match[1];
        else if (fence === match[1]) fence = undefined;
        return line;
      }
      return fence ? line : line.replaceAll("{", "\\{").replaceAll("}", "\\}");
    })
    .join("\n");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function imageUrls(markdown) {
  const urls = new Set();
  const patterns = [
    /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/g,
    /<img[^>]+src=["'](https:\/\/[^"']+)["'][^>]*>/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(markdown))) urls.add(match[1]);
  }
  return urls;
}

async function downloadImage(url, destination, fetchImpl, token) {
  const hostname = new URL(url).hostname;
  const headers = token && (hostname === "github.com" || hostname.endsWith("githubusercontent.com"))
    ? { Authorization: `Bearer ${token}` }
    : {};
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase();
  const extension = IMAGE_EXTENSIONS.get(contentType);
  if (!extension) throw new Error(`unsupported content type: ${contentType || "unknown"}`);

  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_IMAGE_BYTES) throw new Error("image exceeds 10 MB");

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("image exceeds 10 MB");
  fs.writeFileSync(`${destination}.${extension}`, buffer);
  return extension;
}

export async function buildChangelogEntry({ event, blogsDir, fetchImpl = fetch, token, warn = console.warn }) {
  const pr = event.pull_request;
  const body = pr.body || "";
  if (!body.trim()) return { skip: true, reason: "PR body is empty" };

  let newBody = extractChangelog(body);
  if (!newBody || newBody.includes("<Short, human-readable title of what changed>")) {
    return { skip: true, reason: "changelog section is empty or still uses the template placeholder" };
  }

  const source = `${event.repository.full_name}#${pr.number}`;
  const sourceMarker = `<!-- source: ${source} -->`;
  const changelogPath = path.join(blogsDir, "content", "changelog.mdx");
  const current = fs.readFileSync(changelogPath, "utf8");
  if (current.includes(sourceMarker)) return { skip: true, reason: `${source} already exists` };

  const date = pr.merged_at.slice(0, 10);
  const slug = `${date}-${slugify(pr.title) || "update"}-${pr.number}`;
  let index = 0;
  for (const url of imageUrls(newBody)) {
    index += 1;
    const directory = path.join(blogsDir, "public", "changelog", "images", slug);
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, `image-${index}`);
    try {
      const extension = await downloadImage(url, destination, fetchImpl, token);
      newBody = newBody.replaceAll(url, `./images/${slug}/image-${index}.${extension}`);
    } catch (error) {
      warn(`Could not download ${url}: ${error.message}`);
    }
  }

  newBody = escapeBraces(newBody);
  fs.writeFileSync(
    changelogPath,
    `${sourceMarker}\n${newBody}\n\n---\n\n${current.trimStart()}`,
  );

  return { skip: false, branch: `changelog/liara-docs-pr-${pr.number}` };
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const result = await buildChangelogEntry({
    event,
    blogsDir: process.env.BLOGS_DIR || "blogs",
    token: process.env.GITHUB_TOKEN,
  });
  setOutput("skip", String(result.skip));
  if (result.branch) setOutput("branch", result.branch);
  console.log(result.reason || "Changelog entry prepared.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
