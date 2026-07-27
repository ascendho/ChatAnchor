export const ONBOARDING_SHOWN_KEY = "threadrelink.onboardingShown.v1";
export const GETTING_STARTED_WALKTHROUGH_ID = "threadrelink.gettingStarted";

export function walkthroughTarget(extensionId: string): string {
  return `${extensionId}#${GETTING_STARTED_WALKTHROUGH_ID}`;
}
