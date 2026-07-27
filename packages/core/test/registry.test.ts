import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { RegistryStore } from "../src/registry.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe("RegistryStore", () => {
  it("creates a private versioned registry with atomic updates", async () => {
    const home = await mkdtemp(join(tmpdir(), "threadrelink-registry-"));
    cleanup.push(home);
    const store = new RegistryStore(home);

    const initial = await store.read();
    expect(initial.schemaVersion).toBe(1);

    await store.update((registry) => {
      registry.projects.push({
        id: "project-1",
        name: "FinSpec",
        kind: "git",
        aliases: [],
        remotes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect((await store.read()).projects).toHaveLength(1);
    expect(JSON.parse(await readFile(store.registryPath, "utf8")).schemaVersion)
      .toBe(1);
  });

  it("copies a valid legacy registry without deleting the original", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-migration-"));
    cleanup.push(base);
    const legacyHome = join(base, ".reporecall");
    const currentHome = join(base, ".threadrelink");
    const legacyStore = new RegistryStore(legacyHome);
    await legacyStore.update((registry) => {
      registry.projects.push({
        id: "legacy-project",
        name: "ToolSpec",
        kind: "git",
        aliases: [],
        remotes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const migrated = new RegistryStore(currentHome, legacyHome);
    expect((await migrated.read()).projects[0]?.id).toBe("legacy-project");
    expect(
      JSON.parse(await readFile(migrated.registryPath, "utf8")).projects[0].id,
    ).toBe("legacy-project");
    await expect(access(legacyStore.registryPath)).resolves.toBeUndefined();
  });

  it("never overwrites an existing ThreadRelink registry during migration", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-existing-"));
    cleanup.push(base);
    const legacyStore = new RegistryStore(join(base, ".reporecall"));
    const currentStore = new RegistryStore(join(base, ".threadrelink"));
    await legacyStore.update((registry) => {
      registry.projects.push({
        id: "legacy-project",
        name: "Legacy",
        kind: "directory",
        aliases: [],
        remotes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });
    await currentStore.update((registry) => {
      registry.projects.push({
        id: "current-project",
        name: "Current",
        kind: "directory",
        aliases: [],
        remotes: [],
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
    });

    const store = new RegistryStore(currentStore.home, legacyStore.home);
    expect((await store.read()).projects.map((project) => project.id))
      .toEqual(["current-project"]);
  });

  it("rejects invalid legacy data without creating a new registry", async () => {
    const base = await mkdtemp(join(tmpdir(), "threadrelink-invalid-"));
    cleanup.push(base);
    const legacyHome = join(base, ".reporecall");
    const currentHome = join(base, ".threadrelink");
    await mkdir(legacyHome);
    await writeFile(join(legacyHome, "registry.json"), "{broken", "utf8");
    const store = new RegistryStore(currentHome, legacyHome);

    await expect(store.read()).rejects.toMatchObject({
      code: "INVALID_REGISTRY",
    });
    await expect(access(store.registryPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
