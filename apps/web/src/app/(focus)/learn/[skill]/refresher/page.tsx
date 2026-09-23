import { notFound } from "next/navigation";
import { AppError, getRefresher } from "@qa/core";
import { LessonPlayer, type LessonData } from "@/components/lesson/player";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Refresher" };

/** Tech spec §19.6 — the refresher: the lesson's steps that address the diagnosed gap. */
export default async function RefresherPage({ params, searchParams }: { params: Promise<{ skill: string }>; searchParams: Promise<{ session?: string }> }) {
  const user = await requireUser();
  const skillId = decodeURIComponent((await params).skill);
  const sp = await searchParams;
  const r = await getRefresher(user.id, skillId).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  if (!r.steps.length) notFound();
  return <LessonPlayer lesson={{ ...(r as unknown as LessonData), estMinutes: 5, resumeStepId: r.steps[0]!.id }} mode="refresher" sessionId={sp.session ?? null} initialStep={null} review={false} />;
}
