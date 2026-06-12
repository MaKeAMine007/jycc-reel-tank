import sql from "@/app/lib/db";

const RESERVED_IDS = new Set(["admin", "superadmin"]);

export async function GET() {
  const rows = await sql`
    SELECT id, admin_id, password, status, created_at
    FROM admins
    ORDER BY created_at ASC
  `;
  return Response.json(
    rows.map((r) => ({
      id:        r.id,
      adminId:   r.admin_id,
      password:  r.password,
      status:    r.status,
      createdAt: r.created_at,
    }))
  );
}

export async function POST(request: Request) {
  const { adminId, password } = await request.json() as { adminId: string; password: string };

  const trimId  = (adminId ?? "").trim();
  const trimPwd = (password ?? "").trim();

  if (!trimId)  return Response.json({ error: "Admin ID is required."  }, { status: 400 });
  if (!trimPwd) return Response.json({ error: "Password is required."  }, { status: 400 });

  if (RESERVED_IDS.has(trimId.toLowerCase())) {
    return Response.json({ error: "This Admin ID is reserved." }, { status: 409 });
  }

  const existing = await sql`SELECT id FROM admins WHERE admin_id = ${trimId}`;
  if (existing.length > 0) {
    return Response.json({ error: "Admin ID already exists." }, { status: 409 });
  }

  const [row] = await sql`
    INSERT INTO admins (admin_id, password)
    VALUES (${trimId}, ${trimPwd})
    RETURNING id, admin_id, password, status, created_at
  `;

  return Response.json({
    id:        row.id,
    adminId:   row.admin_id,
    password:  row.password,
    status:    row.status,
    createdAt: row.created_at,
  });
}
