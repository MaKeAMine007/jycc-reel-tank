export async function POST(request: Request) {
  const { id, password } = await request.json() as { id: string; password: string };

  const validId       = process.env.SUPERADMIN_ID;
  const validPassword = process.env.SUPERADMIN_PASSWORD;

  if (!validId || !validPassword) {
    return Response.json({ ok: false, error: "Super Admin credentials not configured." }, { status: 503 });
  }

  if (id === validId && password === validPassword) {
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Invalid credentials." }, { status: 401 });
}
