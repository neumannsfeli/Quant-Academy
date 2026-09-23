import { downloadExport } from "@qa/core";
import { publicApi } from "@/lib/server";

export const GET = publicApi<{ id: string }>(async (req, { params }) => {
  const csv = await downloadExport(params.id, req.nextUrl.searchParams.get("token") ?? "");
  return new Response(new Uint8Array(csv), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="quant-academy-responses.csv"', "cache-control": "no-store" },
  });
});
