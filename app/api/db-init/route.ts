import sql from "@/app/lib/db";

export async function GET() {
  await sql`
    CREATE TABLE IF NOT EXISTS submissions (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone        TEXT NOT NULL,
      name         TEXT NOT NULL,
      dob          DATE NOT NULL,
      gender       TEXT NOT NULL,
      city           TEXT NOT NULL,
      is_jain        BOOLEAN,
      is_jito_member BOOLEAN,
      submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_jain BOOLEAN`;
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_jito_member BOOLEAN`;

  await sql`
    CREATE TABLE IF NOT EXISTS reels (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id  UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      url            TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      username       TEXT,
      views          BIGINT,
      likes          BIGINT,
      comments       BIGINT,
      thumbnail      TEXT,
      reel_timestamp TEXT,
      marks          INTEGER NOT NULL DEFAULT 0,
      remarks        TEXT NOT NULL DEFAULT '',
      reel_index     INTEGER NOT NULL,
      week           INTEGER NOT NULL DEFAULT 1
    )
  `;

  await sql`ALTER TABLE reels ADD COLUMN IF NOT EXISTS week INTEGER NOT NULL DEFAULT 1`;

  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS remarks TEXT NOT NULL DEFAULT ''`;

  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'form'`;
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS in_latest_csv BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT '-'`;
  await sql`ALTER TABLE reels ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT '-'`;

  await sql`
    CREATE TABLE IF NOT EXISTS campaign_settings (
      id           INT PRIMARY KEY,
      status       TEXT NOT NULL DEFAULT 'active',
      active_week  INT  NOT NULL DEFAULT 1
    )
  `;
  await sql`
    INSERT INTO campaign_settings (id, status, active_week)
    VALUES (1, 'active', 1)
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS admins (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id   TEXT NOT NULL UNIQUE,
      password   TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'enabled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  return Response.json({ ok: true, message: "Schema initialized" });
}
