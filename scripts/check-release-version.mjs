import { readFile } from "node:fs/promises";

const tag = process.argv[2];

if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error("Release tag must use the form vX.Y.Z");
}

const expectedVersion = tag.slice(1);
const manifests = [
  ["root", "../package.json"],
  ["core", "../packages/core/package.json"],
  ["CLI", "../packages/cli/package.json"],
  ["VS Code", "../packages/vscode/package.json"],
];

for (const [name, path] of manifests) {
  const manifest = JSON.parse(
    await readFile(new URL(path, import.meta.url), "utf8"),
  );
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `Release tag ${tag} does not match ${name} version ${manifest.version}`,
    );
  }
}

const sourceVersions = [
  [
    "CLI --version",
    "../packages/cli/src/index.ts",
    `.version("${expectedVersion}")`,
  ],
  [
    "Codex app-server client",
    "../packages/core/src/codex.ts",
    `version: "${expectedVersion}"`,
  ],
];

for (const [name, path, marker] of sourceVersions) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  if (!source.includes(marker)) {
    throw new Error(`${name} does not declare version ${expectedVersion}`);
  }
}

const changelog = await readFile(
  new URL("../packages/vscode/CHANGELOG.md", import.meta.url),
  "utf8",
);

if (!changelog.split(/\r?\n/).includes(`## ${expectedVersion}`)) {
  throw new Error(
    `packages/vscode/CHANGELOG.md has no ${expectedVersion} release heading`,
  );
}

console.log(`Release ${tag} matches all package manifests and the VS Code changelog.`);
