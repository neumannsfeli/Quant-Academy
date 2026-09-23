import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/auth";
import { Label, Logo, btnClass } from "@/components/ui";
import { currentUser } from "@/lib/server";

export const metadata = { title: "Create your account" };

async function emailLink(formData: FormData) {
  "use server";
  const email = z.string().email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!email.success) redirect("/signup?error=email");
  try {
    await signIn("email", { email: email.data, redirect: false, redirectTo: "/onboarding" });
  } catch (e) {
    if ((e as Error).message?.includes("NEXT_REDIRECT")) throw e;
    redirect("/signup?error=limit");
  }
  redirect(`/check-email?email=${encodeURIComponent(email.data)}`);
}

async function google() {
  "use server";
  await signIn("google", { redirectTo: "/onboarding" });
}

/** Frame 09 · Sign up. Magic link or Google; no passwords (product spec §18.3). */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  if (await currentUser()) redirect("/home");
  const sp = await searchParams;
  const signin = sp.mode === "signin";
  const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  return (
    <div className="min-h-screen grid grid-cols-[61%_39%] max-[900px]:grid-cols-1">
      <div className="flex items-center px-20 max-[900px]:px-6 py-16">
        <div className="w-full max-w-[360px] flex flex-col gap-5">
          <Link href="/" className="flex items-center gap-[10px]"><Logo /><span className="text-[14px] font-semibold">Quant Academy</span></Link>
          <h1 className="text-[24px] font-semibold">{signin ? "Sign in" : "Create your account"}</h1>
          <p className="text-[13px] leading-[19px] text-ink-2">{signin ? "We will email you a link. No password to remember." : "Free while we calibrate. No card, and you can export or delete everything at any time."}</p>
          {googleEnabled ? (
            <>
              <form action={google}><button className={btnClass("secondary", "md", "w-full !py-3")}>Continue with Google</button></form>
              <div className="flex items-center gap-4 text-[11px] text-ink-3"><span className="flex-1 h-px bg-line" />or<span className="flex-1 h-px bg-line" /></div>
            </>
          ) : null}
          <form action={emailLink} className="flex flex-col gap-4" noValidate>
            <label className="flex flex-col gap-2">
              <Label>Email</Label>
              <input name="email" type="email" required autoComplete="email" placeholder="you@email.com" aria-invalid={sp.error === "email" || undefined} className={`h-[42px] rounded-[8px] bg-inset border px-4 text-[13px] focus:outline-none focus:ring-[3px] focus:ring-blue/55 ${sp.error === "email" ? "border-red" : "border-line-strong"}`} />
              {sp.error === "email" ? <span className="text-[11px] text-red" role="alert">Enter a valid email address.</span> : null}
              {sp.error === "limit" ? <span className="text-[11px] text-red" role="alert">Too many sign-in attempts. Try again in an hour.</span> : null}
            </label>
            <button className={btnClass("primary", "md", "w-full !py-3")}>Email me a sign-in link</button>
          </form>
          <p className="text-[10.5px] leading-[15px] text-ink-3">
            No password. We email you a single-use link that expires in 15 minutes. By continuing you confirm you are 16 or over and agree to the <Link className="underline" href="/legal/terms">terms</Link> and <Link className="underline" href="/legal/privacy">privacy policy</Link>.
          </p>
          <p className="text-[12px] text-ink-2">
            {signin ? <>New here? <Link className="text-ink underline-offset-2 hover:underline" href="/signup">Create an account</Link></> : <>Already have an account? <Link className="text-ink underline-offset-2 hover:underline" href="/signup?mode=signin">Sign in</Link></>}
          </p>
        </div>
      </div>
      <div className="bg-surface border-l border-line flex items-center px-14 max-[900px]:hidden">
        <div className="flex flex-col gap-6 max-w-[400px]">
          <Label>What happens next</Label>
          {[
            ["Pick your firm archetype", "Sets the domain weights behind your score and which skills count as required. 30 seconds."],
            ["Placement — or start from scratch", "A 20-minute adaptive placement if you know some of this already. New to it? Skip placement and start with your first lesson."],
            ["Learn it, then prove it", "Lessons teach each skill; practice proves it cold. Your readiness score is built only from the proof."],
          ].map(([t, d], i) => (
            <div key={t} className="flex gap-4">
              <span className="size-[26px] shrink-0 rounded-full border border-line-strong flex items-center justify-center font-mono text-[10px] text-ready">{i + 1}</span>
              <div>
                <p className="text-[13px] font-semibold">{t}</p>
                <p className="text-[11.5px] leading-[18px] text-ink-3 mt-1">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
