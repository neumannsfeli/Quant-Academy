import { runSweep } from "@qa/core";
import { api } from "@/lib/server";

export const POST = api<{ id: string }>(async (req, { params }) => runSweep(params.id, req.nextUrl.searchParams.get("version") ? Number(req.nextUrl.searchParams.get("version")) : undefined), { roles: ["author", "reviewer", "admin"] });
