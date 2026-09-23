import { getContent, archetypeFor } from "@qa/core";
import { DesktopRequired } from "@/components/ui";
import { TopBar } from "@/components/topbar";
import { requireUser } from "@/lib/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const content = await getContent();
  const arch = user.archetypeId ? archetypeFor(content, user.archetypeId) : null;
  return (
    <>
      <DesktopRequired />
      <div className="desktop-only">
        <div className="min-h-screen flex flex-col">
          <TopBar archetypeName={arch?.name ?? null} email={user.email} staff={user.role !== "learner"} />
          <main className="flex-1 w-full max-w-[1440px] mx-auto">{children}</main>
        </div>
      </div>
    </>
  );
}
