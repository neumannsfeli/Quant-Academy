import { redirect } from "next/navigation";
import { startSession } from "@qa/core";
import { requireUser } from "@/lib/server";

/** Onboarding "Take the placement": open (or resume) the placement session. */
export default async function PlacementPage() {
  const user = await requireUser({ allowOnboarding: true });
  const { sessionId } = await startSession(user.id, "placement");
  redirect(`/session/${sessionId}`);
}
