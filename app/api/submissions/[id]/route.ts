import sql from "@/app/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json() as { remarks: string; verificationStatus?: string };

  await sql`
    UPDATE submissions
    SET remarks = ${body.remarks ?? ""},
        verification_status = ${body.verificationStatus ?? "-"}
    WHERE id = ${id}
  `;

  return Response.json({ ok: true });
}
