import { count, eq } from "drizzle-orm";
import { getDb, schema as s } from "@qa/db";
import { AdminNav } from "@/components/admin/nav";
import { DesktopRequired } from "@/components/ui";
import { requireStaff } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin", template: "%s · Admin · Quant Academy" } };

/** Frames 25–27, 36 · the authoring and review console (product spec §12, §16; tech spec §19.7). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const db = getDb();
  const [[review], [flags]] = await Promise.all([
    db.select({ n: count() }).from(s.itemTemplates).where(eq(s.itemTemplates.status, "in_review")),
    db.select({ n: count() }).from(s.flags).where(eq(s.flags.status, "open")),
  ]);
  return (
    <>
      <DesktopRequired />
      <div className="desktop-only">
        <div className="min-h-screen flex flex-col">
          <AdminNav review={Number(review?.n ?? 0)} flags={Number(flags?.n ?? 0)} who={`${user.role} · ${user.email.split("@")[0]}`} />
          <div className="flex-1 flex flex-col">{children}</div>
        </div>
      </div>
    </>
  );
}
