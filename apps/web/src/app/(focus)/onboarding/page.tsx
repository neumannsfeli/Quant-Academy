import { redirect } from "next/navigation";
import { getMe } from "@qa/core";
import { Onboarding } from "@/components/onboarding";
import { requireUser } from "@/lib/server";

export const metadata = { title: "Your goal" };

/** Frame 01 · Onboarding — goal and placement. */
export default async function OnboardingPage() {
  const user = await requireUser({ allowOnboarding: true });
  if (user.onboarding === "done") redirect("/home");
  const me = await getMe(user.id);
  return <Onboarding archetypes={me.archetypes} current={me.archetypeId} />;
}
