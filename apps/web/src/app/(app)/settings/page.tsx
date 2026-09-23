import { getMe } from "@qa/core";
import { SettingsForm } from "@/components/settings";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const me = await getMe(user.id);
  const timezones = Intl.supportedValuesOf("timeZone");
  return (
    <div className="max-w-[760px] mx-auto px-6 py-[30px]">
      <h1 className="text-[20px] font-semibold">Settings</h1>
      <SettingsForm me={me} timezones={timezones} />
    </div>
  );
}
