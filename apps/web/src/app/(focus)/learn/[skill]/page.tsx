import { notFound, redirect } from "next/navigation";
import { AppError, getLesson } from "@qa/core";
import { LessonPlayer, type LessonData } from "@/components/lesson/player";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lesson" };

/** Frames 28–31. ?session= returns to the runner; ?step=&review=1 is targeted review from a verdict. */
export default async function LessonPage({ params, searchParams }: { params: Promise<{ skill: string }>; searchParams: Promise<{ session?: string; step?: string; review?: string }> }) {
  const user = await requireUser();
  const skillId = decodeURIComponent((await params).skill);
  const sp = await searchParams;
  const lesson = await getLesson(user.id, skillId).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const review = sp.review === "1";
  if (!lesson.unlocked && !review && lesson.status === "not_started") redirect(`/skills/${encodeURIComponent(skillId)}`);
  return <LessonPlayer lesson={lesson as unknown as LessonData} mode="lesson" sessionId={sp.session ?? null} initialStep={sp.step ?? null} review={review} />;
}
