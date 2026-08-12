#!/usr/bin/env node

import { access, lstat, readFile, readlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  throw new Error(`Distribution validation failed: ${message}`);
}

async function readText(path) {
  return readFile(resolve(projectRoot, path), "utf8");
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

function readReleaseVersion(argv) {
  if (argv.length === 0) {
    return undefined;
  }
  if (argv.length !== 2 || argv[0] !== "--release-version" || !argv[1]) {
    fail("usage is validate-distribution.mjs [--release-version VERSION].");
  }
  return argv[1];
}

function frontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(?:"([^"]+)"|'([^']+)'|(.+))$`, "m"));
  return match?.[1] ?? match?.[2] ?? match?.[3]?.trim();
}

async function validateSkill() {
  const skillPath = "skills/freee/SKILL.md";
  const skill = await readText(skillPath);
  const frontmatterMatch = skill.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
  if (!frontmatterMatch) {
    fail(`${skillPath} must contain YAML frontmatter and a non-empty body.`);
  }

  const frontmatter = frontmatterMatch[1];
  const name = frontmatterValue(frontmatter, "name");
  const description = frontmatterValue(frontmatter, "description");
  if (name !== "freee" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    fail(`${skillPath} must declare the canonical skill name "freee".`);
  }
  if (!description || description.length > 1024) {
    fail(`${skillPath} must declare a description between 1 and 1024 characters.`);
  }

  for (const match of skill.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)) {
    const referencedPath = resolve(projectRoot, "skills/freee", match[1]);
    await access(referencedPath).catch(() => fail(`${skillPath} references missing file ${match[1]}.`));
  }

  const agentMetadata = await readText("skills/freee/agents/openai.yaml");
  for (const key of ["display_name", "short_description", "default_prompt"]) {
    if (!new RegExp(`^\\s*${key}:\\s*.+$`, "m").test(agentMetadata)) {
      fail(`skills/freee/agents/openai.yaml is missing ${key}.`);
    }
  }

  for (const linkPath of [".agents/skills/freee", ".claude/skills/freee"]) {
    const absolutePath = resolve(projectRoot, linkPath);
    if (!(await lstat(absolutePath)).isSymbolicLink()) {
      fail(`${linkPath} must be a symbolic link to the canonical Skill.`);
    }
    if ((await readlink(absolutePath)) !== "../../skills/freee") {
      fail(`${linkPath} must target ../../skills/freee.`);
    }
  }
}

const releaseVersion = readReleaseVersion(process.argv.slice(2));
const [packageJson, packageLock, plugin, marketplace, readme, license] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson(".claude-plugin/plugin.json"),
  readJson(".claude-plugin/marketplace.json"),
  readText("README.md"),
  readText("LICENSE"),
]);

const version = packageJson.version;
if (typeof version !== "string" || !semverPattern.test(version)) {
  fail(`package.json version ${JSON.stringify(version)} is not valid SemVer.`);
}
for (const [source, value] of [
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
  [".claude-plugin/plugin.json", plugin.version],
]) {
  if (value !== version) {
    fail(`${source} version ${JSON.stringify(value)} does not match package.json ${version}.`);
  }
}
if (releaseVersion !== undefined && releaseVersion !== version) {
  fail(`requested release ${releaseVersion} does not match repository version ${version}.`);
}
if (!readme.includes(`#v${version}'`) && !readme.includes(`#v${version}\"`)) {
  fail(`README.md must pin the portable install command to #v${version}.`);
}

if (packageJson.license !== "MIT" || plugin.license !== "MIT" || !license.startsWith("MIT License\n")) {
  fail("package, plugin, and LICENSE metadata must consistently declare MIT.");
}
if (packageJson.bin?.["freee-agent"] !== "scripts/standalone-cli.mjs" ||
    packageJson.bin?.["freee-mcp"] !== "scripts/standalone-mcp.mjs") {
  fail("package.json portable CLI and MCP binaries are not configured as expected.");
}

const requiredPackageFiles = [
  "dist/",
  "scripts/plugin-cli.mjs",
  "scripts/plugin-runtime.mjs",
  "scripts/standalone-cli.mjs",
  "scripts/standalone-mcp.mjs",
  "skills/freee/",
];
for (const path of requiredPackageFiles) {
  if (!packageJson.files?.includes(path)) {
    fail(`package.json files is missing ${path}.`);
  }
}

if (plugin.name !== "freee" || plugin.mcpServers?.freee?.command !== "node") {
  fail("Claude plugin must declare the freee MCP server with the Node runtime.");
}
if (plugin.mcpServers.freee.args?.[0] !== "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-mcp.mjs" ||
    plugin.mcpServers.freee.env?.FREEE_PLUGIN_DATA !== "${CLAUDE_PLUGIN_DATA}") {
  fail("Claude plugin MCP paths must resolve through the managed plugin directories.");
}
if (marketplace.name !== "freee-tools" || marketplace.plugins?.[0]?.name !== "freee" ||
    marketplace.plugins[0].source !== ".") {
  fail("Claude marketplace must expose the repository-root freee plugin.");
}

await Promise.all([
  ...Object.values(packageJson.bin).map((path) => access(resolve(projectRoot, path))),
  validateSkill(),
]);

process.stdout.write(`Distribution metadata, Claude plugin, and freee Skill are valid for ${version}.\n`);
