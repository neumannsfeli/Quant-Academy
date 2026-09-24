import { DesktopRequired } from "@/components/ui";
import { requireUser } from "@/lib/server";

/** Full-screen surfaces with their own top bar: the runner, the lesson player, onboarding, results. */
export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  await requireUser({ allowOnboarding: true });
  return (
    <>
      <DesktopRequired />
      <div className="desktop-only">
        <div className="min-h-screen">{children}</div>
      </div>
    </>
  );
}
