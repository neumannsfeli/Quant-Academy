import { SessionRunner } from "@/components/runner/runner";
import { requireUser } from "@/lib/server";

export const metadata = { title: "Session" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser({ allowOnboarding: true });
  const { id } = await params;
  return <SessionRunner sessionId={id} />;
}
