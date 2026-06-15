import sql from "@/app/lib/db";

export async function GET() {
  const rows = await sql`
    SELECT
      s.id,
      s.phone,
      s.name,
      s.dob::text          AS dob,
      s.gender,
      s.city,
      s.is_jain,
      s.is_jito_member,
      s.submitted_at,
      s.remarks            AS submission_remarks,
      s.verification_status,
      s.source,
      s.in_latest_csv,
      r.id                 AS reel_id,
      r.url,
      r.status,
      r.username,
      r.views,
      r.likes,
      r.comments,
      r.thumbnail,
      r.reel_timestamp,
      r.marks,
      r.remarks,
      r.reel_index,
      r.week,
      r.verification_status AS reel_verification_status
    FROM submissions s
    LEFT JOIN reels r ON r.submission_id = s.id
    ORDER BY s.submitted_at ASC, r.reel_index ASC
  `;

  const map = new Map<string, {
    phone: string;
    name: string;
    dob: string;
    gender: string;
    city: string;
    isJain: boolean | null;
    isJitoMember: boolean | null;
    firstSubmittedAt: string;
    firstSubmissionId: string;
    remarks: string;
    verificationStatus: string;
    source: string;
    inLatestCsv: boolean;
    reelUrls: string[];
    reels: object[];
  }>();

  for (const row of rows) {
    if (!map.has(row.phone)) {
      // First encounter = oldest submission (ORDER BY submitted_at ASC)
      map.set(row.phone, {
        phone: row.phone,
        name: row.name,
        dob: row.dob,
        gender: row.gender,
        city: row.city,
        isJain: row.is_jain ?? null,
        isJitoMember: row.is_jito_member ?? null,
        firstSubmittedAt: row.submitted_at,
        firstSubmissionId: row.id,
        remarks: row.submission_remarks ?? "",
        verificationStatus: row.verification_status ?? "-",
        source: row.source ?? "form",
        inLatestCsv: row.in_latest_csv ?? false,
        reelUrls: [],
        reels: [],
      });
    }
    const creator = map.get(row.phone)!;
    if (row.reel_id) {
      creator.reelUrls.push(row.url);
      creator.reels.push({
        id: row.reel_id,
        submissionId: row.id,
        url: row.url,
        status: row.status,
        username: row.username ?? null,
        views: row.views != null ? Number(row.views) : null,
        likes: row.likes != null ? Number(row.likes) : null,
        comments: row.comments != null ? Number(row.comments) : null,
        thumbnail: row.thumbnail ?? null,
        timestamp: row.reel_timestamp ?? null,
        marks: row.marks ?? 0,
        remarks: row.remarks ?? "",
        week: row.week ?? 1,
        submittedAt: row.submitted_at ?? null,
        verificationStatus: row.reel_verification_status ?? "-",
      });
    }
  }

  return Response.json(Array.from(map.values()));
}

export async function POST(request: Request) {
  const body = await request.json() as {
    phone: string;
    name: string;
    dob: string;
    gender: string;
    city: string;
    reelUrls: string[];
    isJain: boolean | null;
    isJitoMember: boolean | null;
    week: number;
  };

  const { phone, name, dob, gender, city, reelUrls, isJain, week } = body;
  const isJitoMember = isJain === true ? (body.isJitoMember ?? null) : null;

  if (!phone || !name || !dob || !gender || !city || !Array.isArray(reelUrls) || reelUrls.length === 0) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!Number.isInteger(week) || week < 1 || week > 5) {
    return Response.json({ error: "week must be an integer between 1 and 5" }, { status: 400 });
  }

  if (reelUrls.length > 1) {
    return Response.json({ error: "Only one reel is allowed per week." }, { status: 400 });
  }

  // Campaign rules — fail open if table not yet initialised
  try {
    const campaignRows = await sql`SELECT status, open_weeks FROM campaign_settings WHERE id = 1`;
    if (campaignRows.length > 0) {
      const cfg = campaignRows[0];
      if (cfg.status !== "active") {
        return Response.json({ error: "Campaign is currently closed." }, { status: 403 });
      }
      let openWeeks: number[] = [1];
      try {
        const parsed = JSON.parse(cfg.open_weeks || "[1]");
        if (Array.isArray(parsed)) openWeeks = parsed as number[];
      } catch {
        // malformed — default to [1]
      }
      if (!openWeeks.includes(week)) {
        return Response.json(
          { error: `Week ${week} is not currently open for submissions.` },
          { status: 400 }
        );
      }
      if (week > 1) {
        const [{ count: w1count }] = await sql`
          SELECT COUNT(*) AS count
          FROM reels r
          JOIN submissions s ON r.submission_id = s.id
          WHERE s.phone = ${phone} AND r.week = 1
        `;
        if (Number(w1count) === 0) {
          return Response.json(
            { error: "Week 1 must be submitted before participating in later weeks." },
            { status: 400 }
          );
        }
      }
    }
  } catch {
    // campaign_settings table doesn't exist yet — skip checks, backend safety still applies
  }

  const [{ count }] = await sql`
    SELECT COUNT(*) AS count
    FROM reels r
    JOIN submissions s ON r.submission_id = s.id
    WHERE s.phone = ${phone} AND r.week = ${week}
  `;
  if (Number(count) > 0) {
    return Response.json(
      { error: `Week ${week} already contains a reel. Only one reel is allowed per week.` },
      { status: 409 }
    );
  }

  const [submission] = await sql`
    INSERT INTO submissions (phone, name, dob, gender, city, is_jain, is_jito_member, source, in_latest_csv)
    VALUES (${phone}, ${name}, ${dob}, ${gender}, ${city}, ${isJain ?? null}, ${isJitoMember}, 'form', false)
    RETURNING id, submitted_at
  `;

  const reelRows = await Promise.all(
    reelUrls.map((url: string, i: number) =>
      sql`
        INSERT INTO reels (submission_id, url, reel_index, week)
        VALUES (${submission.id}, ${url}, ${i}, ${week})
        RETURNING id, url
      `.then((r) => r[0])
    )
  );

  return Response.json({
    id: submission.id,
    reels: reelRows.map((r) => ({ id: r.id, url: r.url })),
  });
}
