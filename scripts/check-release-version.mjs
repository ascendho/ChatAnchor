import { readFile } from "node:fs/promises";

const tag = process.argv[2];

if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error("Release tag must use the form vX.Y.Z");
}

const manifest = JSON.parse(
  await readFile(
    new URL("../packages/vscode/package.json", import.meta.url),
    "utf8",
  ),
);
const expectedVersion = tag.slice(1);

if (manifest.version !== expectedVersion) {
  throw new Error(
    `Release tag ${tag} does not match VS Code extension version ${manifest.version}`,
  );
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

console.log(`Release ${tag} matches the VS Code extension manifest and changelog.`);
