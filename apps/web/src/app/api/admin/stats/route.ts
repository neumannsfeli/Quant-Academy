import { itemHealth } from "@qa/core";
import { api } from "@/lib/server";

export const GET = api(async () => itemHealth(), { roles: ["author", "reviewer", "admin"] });
