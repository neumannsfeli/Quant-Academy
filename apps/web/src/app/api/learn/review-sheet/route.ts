import { getReviewSheet } from "@qa/core";
import { api } from "@/lib/server";

export const GET = api(async (_req, { user }) => getReviewSheet(user.id));
