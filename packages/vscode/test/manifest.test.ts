import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface WalkthroughStep {
  completionEvents?: string[];
  media: {
    image: string;
  };
}

interface ExtensionManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  icon: string;
  pricing: string;
  publisher: string;
  galleryBanner: {
    color: string;
    theme: string;
  };
  contributes: {
    commands: Array<{ command: string }>;
    menus: {
      "view/title": Array<{
        command: string;
        when: string;
        group: string;
      }>;
      "view/item/context": Array<{
        command: string;
        when: string;
        group: string;
      }>;
    };
    viewsContainers: {
      activitybar: Array<{ icon: string }>;
    };
    walkthroughs: Array<{
      id: string;
      steps: WalkthroughStep[];
    }>;
    configuration?: {
      properties?: Record<string, unknown>;
    };
  };
}

const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageDirectory = dirname(packagePath);
const manifest = JSON.parse(
  readFileSync(packagePath, "utf8"),
) as ExtensionManifest;

describe("VS Code extension manifest", () => {
  it("publishes the ThreadRelink identity and icon assets", () => {
    expect(manifest.name).toBe("threadrelink");
    expect(manifest.publisher).toBe("ascendho");
    expect(manifest.displayName).toBe("ThreadRelink");
    expect(manifest.description).toBe(
      "A VS Code extension that keeps local Codex conversations connected to their projects after repositories are renamed or moved.",
    );
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.pricing).toBe("Free");
    expect(manifest.galleryBanner).toEqual({
      color: "#315EF3",
      theme: "dark",
    });
    expect(manifest.icon).toBe("resources/threadrelink.png");
    expect(existsSync(resolve(packageDirectory, manifest.icon))).toBe(true);

    const activityIcon =
      manifest.contributes.viewsContainers.activitybar[0]?.icon;
    expect(activityIcon).toBe("resources/threadrelink.svg");
    if (!activityIcon) {
      throw new Error("Activity Bar icon is missing from the manifest");
    }
    expect(existsSync(resolve(packageDirectory, activityIcon))).toBe(true);
  });

  it("ships every walkthrough image and references declared commands", () => {
    const commandIds = new Set(
      manifest.contributes.commands.map(({ command }) => command),
    );
    expect([...commandIds].every((command) => command.startsWith("threadrelink.")))
      .toBe(true);

    const walkthrough = manifest.contributes.walkthroughs.find(
      ({ id }) => id === "threadrelink.gettingStarted",
    );

    expect(walkthrough).toBeDefined();
    expect(walkthrough?.steps).toHaveLength(5);
    expect(commandIds).toContain("threadrelink.openGettingStarted");
    expect(commandIds).toContain("threadrelink.openView");
    expect(commandIds).toContain("threadrelink.findOldConversations");
    expect(commandIds).toContain("threadrelink.forgetProject");
    expect(commandIds).toContain("threadrelink.unlink");
    expect(commandIds).toContain("threadrelink.move");
    expect(commandIds).toContain("threadrelink.copyAtPath");
    expect(commandIds).toContain("threadrelink.revealLocation");
    expect(commandIds).toContain("threadrelink.collapseTree");
    expect(commandIds).toContain("threadrelink.expandTree");

    const titleMenus = manifest.contributes.menus["view/title"];
    expect(titleMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "threadrelink.findOldConversations",
          group: "navigation@2",
        }),
        expect.objectContaining({
          command: "threadrelink.collapseTree",
          when:
            "view == threadrelink.conversations && !threadrelink.treeCollapsed",
          group: "navigation@3",
        }),
        expect.objectContaining({
          command: "threadrelink.expandTree",
          when:
            "view == threadrelink.conversations && threadrelink.treeCollapsed",
          group: "navigation@3",
        }),
      ]),
    );

    const copyAtMenus = manifest.contributes.menus["view/item/context"].filter(
      (entry) => entry.command === "threadrelink.copyAtPath",
    );
    expect(copyAtMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          when:
            "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\./",
          group: "inline@2",
        }),
        expect.objectContaining({
          when:
            "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\./",
          group: "manage@0",
        }),
      ]),
    );

    const revealMenus = manifest.contributes.menus["view/item/context"].filter(
      (entry) => entry.command === "threadrelink.revealLocation",
    );
    expect(revealMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          when:
            "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\./",
          group: "inline@3",
        }),
        expect.objectContaining({
          when:
            "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\./",
          group: "manage@1",
        }),
      ]),
    );
    expect(commandIds).toContain("threadrelink.collapseTree");
    expect(
      manifest.contributes.configuration?.properties?.["threadrelink.cursorHome"],
    ).toBeDefined();
    expect(
      manifest.contributes.configuration?.properties?.["threadrelink.agentPath"],
    ).toBeDefined();

    const resumeMenus = manifest.contributes.menus["view/item/context"].filter(
      (entry) => entry.command === "threadrelink.resume",
    );
    expect(resumeMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          when:
            "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\.(codex|cursor)$/",
          group: "inline@1",
        }),
      ]),
    );

    for (const step of walkthrough?.steps ?? []) {
      expect(step.media.image).toMatch(/^media\/guide\/.+\.png$/);
      expect(existsSync(resolve(packageDirectory, step.media.image))).toBe(true);

      for (const event of step.completionEvents ?? []) {
        const command = event.replace(/^onCommand:/, "");
        expect(commandIds).toContain(command);
      }
    }
  });
});
