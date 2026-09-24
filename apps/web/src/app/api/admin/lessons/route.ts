import { lessonHealth } from "@qa/core";
import { api } from "@/lib/server";

export const GET = api(async () => lessonHealth(), { roles: ["author", "reviewer", "admin"] });
