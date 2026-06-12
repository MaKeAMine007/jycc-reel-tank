import sql from "@/app/lib/db";

const RESERVED_IDS = new Set(["admin", "superadmin"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { adminId, password, status } = await request.json() as {
    adminId: string;
    password: string;
    status: string;
  };

  const trimId  = (adminId  ?? "").trim();
  const trimPwd = (password ?? "").trim();

  if (!trimId)  return Response.json({ error: "Admin ID is required."  }, { status: 400 });
  if (!trimPwd) return Response.json({ error: "Password is required."  }, { status: 400 });
  if (!status)  return Response.json({ error: "Status is required."    }, { status: 400 });

  if (RESERVED_IDS.has(trimId.toLowerCase())) {
    return Response.json({ error: "This Admin ID is reserved." }, { status: 409 });
  }

  // Check duplicate ID against OTHER rows
  const conflict = await sql`
    SELECT id FROM admins WHERE admin_id = ${trimId} AND id != ${id}
  `;
  if (conflict.length > 0) {
    return Response.json({ error: "Admin ID already exists." }, { status: 409 });
  }

  const [row] = await sql`
    UPDATE admins
    SET admin_id = ${trimId}, password = ${trimPwd}, status = ${status}
    WHERE id = ${id}
    RETURNING id, admin_id, password, status, created_at
  `;

  if (!row) return Response.json({ error: "Admin not found." }, { status: 404 });

  return Response.json({
    id:        row.id,
    adminId:   row.admin_id,
    password:  row.password,
    status:    row.status,
    createdAt: row.created_at,
  });
}
