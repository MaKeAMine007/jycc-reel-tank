import sql from "@/app/lib/db";

const EMERGENCY_ID       = "admin";
const EMERGENCY_PASSWORD = "admin123";

export async function POST(request: Request) {
  const { id, password } = await request.json() as { id: string; password: string };

  // Step 1 — permanent emergency admin (never stored in DB, never appears in UI)
  if (id === EMERGENCY_ID && password === EMERGENCY_PASSWORD) {
    return Response.json({ ok: true });
  }

  // Step 2 — dynamically created admins
  try {
    const rows = await sql`
      SELECT password, status FROM admins WHERE admin_id = ${id}
    `;
    if (rows.length > 0) {
      const admin = rows[0];
      if (admin.status !== "enabled") {
        return Response.json({ ok: false, error: "Account is disabled." }, { status: 401 });
      }
      if (admin.password === password) {
        return Response.json({ ok: true });
      }
    }
  } catch {
    // admins table not yet initialised — fall through to reject
  }

  return Response.json({ ok: false, error: "Invalid User ID or Password." }, { status: 401 });
}
