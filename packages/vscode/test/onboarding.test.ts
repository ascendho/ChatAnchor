import { describe, expect, it } from "vitest";
import {
  GETTING_STARTED_WALKTHROUGH_ID,
  ONBOARDING_SHOWN_KEY,
  walkthroughTarget,
} from "../src/onboarding.js";

describe("onboarding", () => {
  it("builds the VS Code walkthrough target from the installed extension ID", () => {
    expect(walkthroughTarget("ascendho.threadrelink")).toBe(
      "ascendho.threadrelink#threadrelink.gettingStarted",
    );
  });

  it("uses stable IDs so completion and welcome state survive reloads", () => {
    expect(GETTING_STARTED_WALKTHROUGH_ID).toBe("threadrelink.gettingStarted");
    expect(ONBOARDING_SHOWN_KEY).toBe("threadrelink.onboardingShown.v1");
  });
});
