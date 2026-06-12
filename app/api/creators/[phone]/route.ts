import sql from "@/app/lib/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ phone: string }> }
) {
  const { phone } = await params;

  if (!phone) {
    return Response.json({ error: "Phone is required." }, { status: 400 });
  }

  await sql`DELETE FROM submissions WHERE phone = ${phone}`;

  return Response.json({ ok: true });
}
