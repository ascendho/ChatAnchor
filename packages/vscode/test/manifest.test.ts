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
    commands: Array<{ command: string; icon?: string; title?: string }>;
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
  it("publishes the ChatAnchor identity and icon assets", () => {
    expect(manifest.name).toBe("threadrelink");
    expect(manifest.publisher).toBe("ascendho");
    expect(manifest.displayName).toBe("ChatAnchor");
    expect(manifest.description).toBe(
      "A VS Code extension that keeps AI coding agent conversations connected to their projects after folders are renamed or moved.",
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
    const commandById = new Map(
      manifest.contributes.commands.map((command) => [command.command, command]),
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
    expect(commandIds).toContain("threadrelink.manageLink");
    expect(commandIds).toContain("threadrelink.editDescription");
    expect(commandIds).toContain("threadrelink.hideConversation");
    expect(commandIds).toContain("threadrelink.showConversation");
    expect(commandIds).toContain("threadrelink.noHiddenConversations");
    expect(commandIds).toContain("threadrelink.showHiddenConversations");
    expect(commandIds).toContain("threadrelink.hideHiddenConversations");
    expect(commandIds).toContain("threadrelink.restoreHiddenConversations");
    expect(commandIds).toContain("threadrelink.copyAtPath");
    expect(commandIds).toContain("threadrelink.exportOpenCodeAtPath");
    expect(commandIds).toContain("threadrelink.copyCompactAtPath");
    expect(commandIds).toContain("threadrelink.startNewSession");
    expect(commandIds).toContain("threadrelink.revealLocation");
    expect(commandIds).toContain("threadrelink.collapseTree");
    expect(commandIds).toContain("threadrelink.expandTree");
    expect(commandById.get("threadrelink.showConversation")).toEqual(
      expect.objectContaining({
        title: "ChatAnchor: Unhide Conversation",
        icon: "$(eye)",
      }),
    );
    expect(commandById.get("threadrelink.noHiddenConversations")).toEqual(
      expect.objectContaining({
        title: "ChatAnchor: No Hidden Conversations",
        icon: "$(eye)",
      }),
    );
    expect(commandById.get("threadrelink.showHiddenConversations")).toEqual(
      expect.objectContaining({
        title: "ChatAnchor: Show Hidden Conversations",
        icon: "$(eye-closed)",
      }),
    );
    expect(commandById.get("threadrelink.hideHiddenConversations")).toEqual(
      expect.objectContaining({
        title: "ChatAnchor: Hide Hidden Conversations",
        icon: "$(eye)",
      }),
    );
    expect(commandById.get("threadrelink.restoreHiddenConversations")).toEqual(
      expect.objectContaining({
        title: "ChatAnchor: Unhide All Conversations",
        icon: "$(clear-all)",
      }),
    );
    expect(commandById.get("threadrelink.manageLink")).toEqual(
      expect.objectContaining({
        title: "ChatAnchor: Manage Conversation Link...",
        icon: "$(tools)",
      }),
    );
    expect(commandById.get("threadrelink.exportOpenCodeAtPath")).toEqual(
      expect.objectContaining({
        title: "ChatAnchor: Export OpenCode JSON and Copy @ Path",
        icon: "$(file-code)",
      }),
    );
    expect(commandById.get("threadrelink.copyCompactAtPath")).toEqual(
      expect.objectContaining({
        title: "ChatAnchor: Copy Compact @ Transcript",
        icon: "$(file-text)",
      }),
    );

    const titleMenus = manifest.contributes.menus["view/title"];
    expect(titleMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "threadrelink.findOldConversations",
          group: "navigation@2",
        }),
        expect.objectContaining({
          command: "threadrelink.startNewSession",
          when:
            "view == threadrelink.conversations && threadrelink.hasReadyProject",
          group: "navigation@2.5",
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
        expect.objectContaining({
          command: "threadrelink.noHiddenConversations",
          when:
            "view == threadrelink.conversations && !threadrelink.hasHiddenConversations && !threadrelink.showingHiddenConversations",
          group: "navigation@4",
        }),
        expect.objectContaining({
          command: "threadrelink.showHiddenConversations",
          when:
            "view == threadrelink.conversations && threadrelink.hasHiddenConversations && !threadrelink.showingHiddenConversations",
          group: "navigation@4",
        }),
        expect.objectContaining({
          command: "threadrelink.hideHiddenConversations",
          when:
            "view == threadrelink.conversations && threadrelink.showingHiddenConversations",
          group: "navigation@4",
        }),
        expect.objectContaining({
          command: "threadrelink.restoreHiddenConversations",
          when:
            "view == threadrelink.conversations && threadrelink.hasHiddenConversations",
          group: "manage@0",
        }),
      ]),
    );

    const startNewSessionMenus = manifest.contributes.menus[
      "view/item/context"
    ].filter((entry) => entry.command === "threadrelink.startNewSession");
    expect(startNewSessionMenus).toEqual([
      expect.objectContaining({
        when:
          "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linked\\.(codex|cursor|opencode)$/",
        group: "inline@1",
      }),
    ]);

    const copyAtMenus = manifest.contributes.menus["view/item/context"].filter(
      (entry) => entry.command === "threadrelink.copyAtPath",
    );
    expect(copyAtMenus).toEqual([
      expect.objectContaining({
        when:
          "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\.(codex|cursor)(\\.hidden)?$/",
        group: "inline@2",
      }),
    ]);

    const copyOpenCodeExportMenus = manifest.contributes.menus[
      "view/item/context"
    ].filter((entry) =>
      entry.command === "threadrelink.exportOpenCodeAtPath"
    );
    expect(copyOpenCodeExportMenus).toEqual([
      expect.objectContaining({
        when:
          "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\.opencode(\\.hidden)?$/",
        group: "inline@2",
      }),
    ]);

    const copyCompactMenus = manifest.contributes.menus[
      "view/item/context"
    ].filter((entry) => entry.command === "threadrelink.copyCompactAtPath");
    expect(copyCompactMenus).toEqual([
      expect.objectContaining({
        when:
          "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\.(codex|cursor|opencode)(\\.hidden)?$/",
        group: "manage@3.5",
      }),
    ]);

    const revealMenus = manifest.contributes.menus["view/item/context"].filter(
      (entry) => entry.command === "threadrelink.revealLocation",
    );
    expect(revealMenus).toEqual([
      expect.objectContaining({
        when:
          "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\.(codex|cursor)(\\.hidden)?$/",
        group: "manage@3.6",
      }),
    ]);
    expect(commandIds).toContain("threadrelink.collapseTree");
    expect(
      manifest.contributes.configuration?.properties?.["threadrelink.cursorHome"],
    ).toBeDefined();
    expect(
      manifest.contributes.configuration?.properties?.["threadrelink.agentPath"],
    ).toBeDefined();
    expect(
      manifest.contributes.configuration?.properties?.["threadrelink.opencodePath"],
    ).toBeDefined();
    expect(
      manifest.contributes.configuration?.properties?.["threadrelink.opencodeHome"],
    ).toBeDefined();

    const resumeMenus = manifest.contributes.menus["view/item/context"].filter(
      (entry) => entry.command === "threadrelink.resume",
    );
    expect(resumeMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          when:
            "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\.(codex|cursor|opencode)(\\.hidden)?$/",
          group: "inline@1",
        }),
      ]),
    );

    const hideMenus = manifest.contributes.menus["view/item/context"].filter(
      (entry) => entry.command === "threadrelink.hideConversation",
    );
    expect(hideMenus).toEqual([
      expect.objectContaining({
        when:
          "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\.(codex|cursor|opencode)$/",
        group: "manage@3",
      }),
    ]);

    const showMenus = manifest.contributes.menus["view/item/context"].filter(
      (entry) => entry.command === "threadrelink.showConversation",
    );
    expect(showMenus).toEqual([
      expect.objectContaining({
        when:
          "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\.(codex|cursor|opencode)\\.hidden$/",
        group: "manage@3",
      }),
    ]);

    const manageLinkMenus = manifest.contributes.menus["view/item/context"]
      .filter((entry) => entry.command === "threadrelink.manageLink");
    expect(manageLinkMenus).toEqual([
      expect.objectContaining({
        when:
          "view == threadrelink.conversations && viewItem =~ /^threadrelink\\.linkedThread\\.(codex|cursor|opencode)(\\.hidden)?$/",
        group: "manage@4",
      }),
    ]);

    const threadContextMenuCommands = manifest.contributes.menus[
      "view/item/context"
    ].map((entry) => entry.command);
    expect(threadContextMenuCommands).not.toContain("threadrelink.move");
    expect(threadContextMenuCommands).not.toContain("threadrelink.unlink");

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
