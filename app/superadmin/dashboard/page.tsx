"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import SuperAdminNavbar from "@/app/components/SuperAdminNavbar";
import { type Creator, type ReelResult } from "@/app/lib/submissions";
import { formatNumber, formatSubmittedAt } from "@/app/lib/formatters";
import { WEEK_TOPICS } from "@/app/lib/weekTopics";
import type { ParsedRow } from "@/app/api/import/route";

// ── CSV helpers ──────────────────────────────────────────────────────────────

function parseCsvText(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        row.push(field); field = "";
      } else if (ch === "\n") {
        row.push(field); field = "";
        if (row.some(f => f !== "")) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  row.push(field);
  if (row.some(f => f !== "")) rows.push(row);
  return rows;
}

function parseBool(v: string): boolean | null {
  const l = v.trim().toLowerCase();
  if (l === "yes" || l === "true" || l === "1") return true;
  if (l === "no"  || l === "false" || l === "0") return false;
  return null;
}

function parseNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v.trim());
  return isNaN(n) ? null : n;
}

function parseDob(v: string): string | null {
  if (!v.trim()) return null;
  return v.trim().replace(/\//g, "-");
}

interface ImportPreview {
  creatorsToCreate: number;
  creatorsToUpdate: number;
  reelsToCreate: number;
  reelsToUpdate: number;
  weeksDetected: number[];
  fallbackDobCount: number;
  skipped: number;
  errors: string[];
}

interface ImportResult {
  imported: number;
  skipped: number;
  warnings: string[];
  errors: string[];
  reelsToScrape: { id: string; url: string; submissionId: string }[];
}

function getCreatorRowBg(creator: Creator): string {
  if (creator.inLatestCsv)          return "bg-green-50 hover:bg-green-100";
  if (creator.source === "csv")     return "bg-red-50 hover:bg-red-100";
  return "hover:bg-gray-50";
}

function StatusBadge({ status }: { status: ReelResult["status"] }) {
  const styles: Record<ReelResult["status"], string> = {
    pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    done:    "bg-green-50  text-green-700  border-green-200",
    failed:  "bg-red-50    text-red-700    border-red-200",
  };
  const labels: Record<ReelResult["status"], string> = {
    pending: "Pending",
    done:    "Done",
    failed:  "Failed",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function sumMarks(
  reels: ReelResult[],
  reelMarks: Record<string, string>,
  weekFilter?: number
): number {
  return reels
    .filter((r) => weekFilter == null || r.week === weekFilter)
    .reduce((sum, r) => {
      if (!r.id) return sum;
      const val = r.id in reelMarks
        ? Math.max(0, Number(reelMarks[r.id]) || 0)
        : (r.marks ?? 0);
      return sum + val;
    }, 0);
}

function sumMetric(
  reels: ReelResult[],
  field: "views" | "likes" | "comments"
): number | null {
  const hasData = reels.some((r) => r[field] != null);
  if (!hasData) return null;
  return reels.reduce((sum, r) => sum + (r[field] ?? 0), 0);
}

function csvField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export default function SuperAdminDashboard() {
  const router = useRouter();
  const [creators, setCreators]             = useState<Creator[]>([]);
  const [reelMarks, setReelMarks]                     = useState<Record<string, string>>({});
  const [creatorRemarks, setCreatorRemarks]           = useState<Record<string, string>>({});
  const [reelVerificationStatus, setReelVerificationStatus] = useState<Record<string, string>>({});
  const [creatorSaved, setCreatorSaved]               = useState<Record<string, boolean>>({});
  const [openWeeks, setOpenWeeks]                     = useState<Record<string, Set<number>>>({});
  const [authed, setAuthed]                           = useState(false);
  const [deleteTarget, setDeleteTarget]               = useState<{ phone: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading]             = useState(false);
  const [deleteReelTarget, setDeleteReelTarget]       = useState<{ reelId: string; submissionId: string } | null>(null);
  const [deleteReelLoading, setDeleteReelLoading]     = useState(false);

  // Import state
  const fileInputRef                             = useRef<HTMLInputElement>(null);
  const [importStage, setImportStage]            = useState<"idle" | "previewing" | "preview-ready" | "executing" | "done" | "error">("idle");
  const [importMode, setImportMode]              = useState<"merge" | "create-only">("merge");
  const [importPreview, setImportPreview]        = useState<ImportPreview | null>(null);
  const [importResult, setImportResult]          = useState<ImportResult | null>(null);
  const [importError, setImportError]            = useState<string | null>(null);
  const [pendingRows, setPendingRows]            = useState<ParsedRow[]>([]);

  async function reload() {
    const res = await fetch("/api/submissions");
    if (!res.ok) return;
    const data = (await res.json()) as Creator[];
    setCreators(data);

    const newReelMarks: Record<string, string>              = {};
    const newCreatorRemarks: Record<string, string>         = {};
    const newReelVerificationStatus: Record<string, string> = {};

    for (const creator of data) {
      newCreatorRemarks[creator.phone] = creator.remarks ?? "";
      for (const reel of creator.reels) {
        if (reel.id) {
          newReelMarks[reel.id] = String(reel.marks ?? 0);
          newReelVerificationStatus[reel.id] = reel.verificationStatus ?? "-";
        }
      }
    }

    setReelMarks(newReelMarks);
    setCreatorRemarks(newCreatorRemarks);
    setReelVerificationStatus(newReelVerificationStatus);
    setCreatorSaved({});
  }

  useEffect(() => {
    if (localStorage.getItem("superAdminLoggedIn") !== "true") {
      router.replace("/superadmin");
      return;
    }
    setAuthed(true);
    reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function toggleWeek(phone: string, week: number) {
    setOpenWeeks((prev) => {
      const current = new Set(prev[phone] ?? []);
      if (current.has(week)) current.delete(week);
      else current.add(week);
      return { ...prev, [phone]: new Set(current) };
    });
  }

  async function handleReelMarkBlur(reelId: string, submissionId: string) {
    const marks = Math.max(0, Number(reelMarks[reelId]) || 0);
    await fetch(`/api/submissions/${submissionId}/reels/${reelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marks }),
    });
  }

  // ── Import helpers ─────────────────────────────────────────────────────────

  async function scrapeImportedReels(
    toScrape: { id: string; url: string; submissionId: string }[]
  ) {
    await Promise.allSettled(
      toScrape.map(async ({ id: reelId, url, submissionId }) => {
        try {
          const res  = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = await res.json();
          await fetch(`/api/submissions/${submissionId}/reels/${reelId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              res.ok
                ? { status: "done", username: data.username ?? null,
                    views: data.views ?? null, likes: data.likes ?? null,
                    comments: data.comments ?? null, thumbnail: data.thumbnail ?? null,
                    timestamp: data.timestamp ?? null }
                : { status: "failed" }
            ),
          });
        } catch {
          await fetch(`/api/submissions/${submissionId}/reels/${reelId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "failed" }),
          }).catch(() => {});
        }
      })
    );
  }

  function buildParsedRows(text: string): { rows: ParsedRow[]; errors: string[] } {
    const matrix = parseCsvText(text);
    if (matrix.length < 2) return { rows: [], errors: ["CSV has no data rows"] };

    const headers = matrix[0].map(h => h.toLowerCase().trim());
    const col = (name: string) => headers.indexOf(name);

    const iName     = col("name");
    const iPhone    = col("phone");
    const iDob      = col("dob");
    const iGender   = col("gender");
    const iCity     = col("city");
    const iJain     = col("jain");
    const iJito     = col("jito");
    const iWeek     = col("week");
    const iUser     = col("instagram username");
    const iUrl      = col("reel url");
    const iStatus   = col("status");
    const iViews    = col("views");
    const iLikes    = col("likes");
    const iComments = col("comments");
    const iMarks    = col("reel marks");
    const iRemark   = col("creator remark");

    const get = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : "");

    const rows: ParsedRow[] = [];
    const errors: string[] = [];

    for (let ri = 1; ri < matrix.length; ri++) {
      const r     = matrix[ri];
      const phone = get(r, iPhone);
      const weekS = get(r, iWeek);
      const reelUrl = get(r, iUrl) || null;
      const remark  = get(r, iRemark);

      if (!phone) { errors.push(`Row ${ri + 1}: missing phone`); continue; }
      const week = parseInt(weekS, 10);
      if (!weekS || isNaN(week) || week < 1 || week > 5) {
        errors.push(`Row ${ri + 1}: invalid week "${weekS}" (must be 1–5)`); continue;
      }
      if (!reelUrl && !remark) {
        errors.push(`Row ${ri + 1}: no reel URL or remark`); continue;
      }

      const rawJain = get(r, iJain);
      const jain    = rawJain ? parseBool(rawJain) : null;
      const rawJito = get(r, iJito);
      const jito    = jain === true && rawJito ? parseBool(rawJito) : null;

      rows.push({
        name:     get(r, iName),
        phone,
        dob:      iDob >= 0 ? parseDob(get(r, iDob)) : null,
        gender:   get(r, iGender),
        city:     get(r, iCity),
        jain,
        jito,
        week,
        username: get(r, iUser) || null,
        reelUrl,
        status:   get(r, iStatus) || null,
        views:    parseNum(get(r, iViews)),
        likes:    parseNum(get(r, iLikes)),
        comments: parseNum(get(r, iComments)),
        marks:    Math.max(0, parseNum(get(r, iMarks)) ?? 0),
        remark,
      });
    }

    return { rows, errors };
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const text = await file.text();
    const { rows, errors } = buildParsedRows(text);

    if (rows.length === 0) {
      setImportError(errors.length > 0 ? errors.join("\n") : "No valid rows found in CSV.");
      setImportStage("error");
      return;
    }

    const seen = new Set<string>();
    const dupSlots: { phone: string; week: number }[] = [];
    const reported = new Set<string>();
    for (const row of rows) {
      if (!row.reelUrl) continue;
      const key = `${row.phone}|${row.week}`;
      if (seen.has(key)) {
        if (!reported.has(key)) {
          dupSlots.push({ phone: row.phone, week: row.week });
          reported.add(key);
        }
      } else {
        seen.add(key);
      }
    }
    if (dupSlots.length > 0) {
      const lines = dupSlots.map(d => `• Phone: +91 ${d.phone} — Week ${d.week}`).join("\n");
      setImportError(
        `CSV Validation Failed\n\nOnly one reel is allowed per creator per week.\n\nDuplicate entries found:\n\n${lines}\n\nPlease correct the CSV and try again.`
      );
      setImportStage("error");
      return;
    }

    setPendingRows(rows);
    setImportStage("previewing");
    setImportError(null);

    try {
      const res  = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true, mode: importMode, rows }),
      });
      const data = await res.json() as ImportPreview & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setImportPreview({ ...data, errors: [...(data.errors ?? []), ...errors] });
      setImportStage("preview-ready");
    } catch (err) {
      setImportError(String(err));
      setImportStage("error");
    }
  }

  async function executeImport() {
    if (!pendingRows.length) return;
    setImportStage("executing");
    try {
      const res  = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: false, mode: importMode, rows: pendingRows }),
      });
      const data = await res.json() as ImportResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setImportResult(data);
      setImportStage("done");
      reload();
      if (data.reelsToScrape?.length) scrapeImportedReels(data.reelsToScrape);
    } catch (err) {
      setImportError(String(err));
      setImportStage("error");
    }
  }

  function cancelImport() {
    setImportStage("idle");
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setPendingRows([]);
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  function exportCsv() {
    const headers = [
      "Name", "Phone", "DOB", "Gender", "City", "Jain", "JITO",
      "Week", "Instagram Username", "Reel URL", "Status",
      "Views", "Likes", "Comments", "Reel Marks", "Creator Remark",
    ];

    const rows: string[][] = [];

    for (const creator of creators) {
      const jain   = creator.isJain === true ? "Yes" : creator.isJain === false ? "No" : "";
      const jito   = creator.isJain === true
        ? (creator.isJitoMember === true ? "Yes" : creator.isJitoMember === false ? "No" : "")
        : "";
      const remark = creatorRemarks[creator.phone] ?? creator.remarks ?? "";

      for (const reel of creator.reels) {
        const reelMarksVal = reel.id
          ? String(Math.max(0, Number(reelMarks[reel.id]) || 0))
          : String(reel.marks ?? 0);
        rows.push([
          creator.name,
          creator.phone,
          creator.dob ?? "",
          creator.gender,
          creator.city,
          jain,
          jito,
          String(reel.week ?? ""),
          reel.username ?? "",
          reel.url,
          reel.status,
          reel.views    != null ? String(reel.views)    : "",
          reel.likes    != null ? String(reel.likes)    : "",
          reel.comments != null ? String(reel.comments) : "",
          reelMarksVal,
          remark,
        ]);
      }
    }

    const csv = [
      headers.map(csvField).join(","),
      ...rows.map((row) => row.map(csvField).join(",")),
    ].join("\n");

    const today    = new Date().toISOString().split("T")[0];
    const filename = `reel-tank-export-${today}.csv`;
    const blob     = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement("a");
    a.href         = url;
    a.download     = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCreatorSave(phone: string, firstSubmissionId: string) {
    const remarks = (creatorRemarks[phone] ?? "").trim();
    const creatorReels = creators.find((c) => c.phone === phone)?.reels ?? [];

    await Promise.all([
      fetch(`/api/submissions/${firstSubmissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remarks }),
      }),
      ...creatorReels
        .filter((r) => r.id && r.submissionId)
        .map((r) =>
          fetch(`/api/submissions/${r.submissionId}/reels/${r.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ verificationStatus: reelVerificationStatus[r.id!] ?? "-" }),
          })
        ),
    ]);

    setCreatorSaved((prev) => ({ ...prev, [phone]: true }));
    setTimeout(() => setCreatorSaved((prev) => ({ ...prev, [phone]: false })), 1500);
  }

  async function confirmDeleteReel() {
    if (!deleteReelTarget || deleteReelLoading) return;
    setDeleteReelLoading(true);
    try {
      await fetch(
        `/api/submissions/${deleteReelTarget.submissionId}/reels/${deleteReelTarget.reelId}`,
        { method: "DELETE" }
      );
      setDeleteReelTarget(null);
      await reload();
    } finally {
      setDeleteReelLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteLoading) return;
    setDeleteLoading(true);
    try {
      await fetch(`/api/creators/${encodeURIComponent(deleteTarget.phone)}`, {
        method: "DELETE",
      });
      setDeleteTarget(null);
      await reload();
    } finally {
      setDeleteLoading(false);
    }
  }

  if (!authed) return null;

  const totalReels = creators.reduce((sum, c) => sum + c.reels.length, 0);

  const thClass = "px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider";

  return (
    <div className="min-h-screen bg-gray-50">
      <SuperAdminNavbar />

      <main className="max-w-7xl mx-auto px-6 py-8">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Submissions</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {creators.length} creator{creators.length !== 1 ? "s" : ""} · {totalReels} reel{totalReels !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/form"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors"
            >
              Open Registration Form
            </a>
            <a
              href="/superadmin/admins"
              className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors"
            >
              Admin Panel
            </a>
            <a
              href="/campaign"
              className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors"
            >
              Campaign Control
            </a>
            <button
              onClick={reload}
              className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={exportCsv}
              className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors"
            >
              Export .csv
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importStage === "previewing" || importStage === "executing"}
              className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {importStage === "previewing" || importStage === "executing" ? "Importing…" : "Import .csv"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        </div>

        {creators.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
            <p className="text-sm text-gray-400">No submissions yet.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className={thClass}>Name</th>
                    <th className={thClass}>Phone</th>
                    <th className={thClass}>Gender</th>
                    <th className={thClass}>City</th>
                    <th className={thClass}>Jain</th>
                    <th className={thClass} style={{ minWidth: "80px" }}>JITO Member</th>
                    <th className={thClass} style={{ minWidth: "268px" }}>Weeks</th>
                    <th className={thClass} style={{ minWidth: "72px" }}>Views</th>
                    <th className={thClass} style={{ minWidth: "72px" }}>Likes</th>
                    <th className={thClass} style={{ minWidth: "80px" }}>Comments</th>
                    <th className={thClass} style={{ minWidth: "64px" }}>Marks</th>
                    <th className={thClass} style={{ minWidth: "168px" }}>Remarks</th>
                    <th className={thClass}></th>
                    <th className={thClass}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {creators.map((creator) => {
                    const phone    = creator.phone;
                    const expanded = openWeeks[phone] ?? new Set<number>();
                    const totalMarks    = sumMarks(creator.reels, reelMarks);
                    const totalViews    = sumMetric(creator.reels, "views");
                    const totalLikes    = sumMetric(creator.reels, "likes");
                    const totalComments = sumMetric(creator.reels, "comments");

                    return (
                      <Fragment key={phone}>

                        {/* ── Creator row ─────────────────────────────── */}
                        <tr className={`${getCreatorRowBg(creator)} transition-colors align-middle`}>
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{creator.name}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">+91&nbsp;{creator.phone}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{creator.gender}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{creator.city}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {creator.isJain === true ? "Yes" : creator.isJain === false ? "No" : "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {creator.isJain === true
                              ? (creator.isJitoMember === true ? "Yes" : creator.isJitoMember === false ? "No" : "—")
                              : "—"}
                          </td>
                          <td className="px-4 py-3" style={{ minWidth: "268px" }}>
                            <div className="flex gap-1.5" style={{ flexWrap: "nowrap" }}>
                              {[1, 2, 3, 4, 5].map((week) => {
                                const count    = creator.reels.filter((r) => r.week === week).length;
                                const isOpen   = expanded.has(week);
                                const hasReels = count > 0;
                                return (
                                  <button
                                    key={week}
                                    type="button"
                                    disabled={!hasReels}
                                    onClick={() => toggleWeek(phone, week)}
                                    className={`text-xs px-2 py-1 rounded border transition-colors whitespace-nowrap ${
                                      !hasReels
                                        ? "border-gray-100 text-gray-300 cursor-not-allowed"
                                        : isOpen
                                          ? "border-gray-400 bg-gray-100 text-gray-900"
                                          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer"
                                    }`}
                                  >
                                    Wk {week} ({count}){hasReels ? (isOpen ? " ▴" : " ▾") : ""}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap" style={{ minWidth: "72px" }}>
                            {formatNumber(totalViews)}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap" style={{ minWidth: "72px" }}>
                            {formatNumber(totalLikes)}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap" style={{ minWidth: "80px" }}>
                            {formatNumber(totalComments)}
                          </td>
                          <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap" style={{ minWidth: "64px" }}>
                            {totalMarks}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap" style={{ minWidth: "168px" }}>
                            <input
                              type="text"
                              value={creatorRemarks[phone] ?? ""}
                              onChange={(e) =>
                                setCreatorRemarks((prev) => ({ ...prev, [phone]: e.target.value }))
                              }
                              placeholder="Add remark"
                              style={{ minWidth: "148px" }}
                              className="border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-500"
                            />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <button
                              onClick={() => handleCreatorSave(phone, creator.firstSubmissionId)}
                              className={`text-xs font-medium px-3 py-1 rounded border transition-colors ${
                                creatorSaved[phone]
                                  ? "bg-green-50 border-green-200 text-green-700"
                                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              {creatorSaved[phone] ? "Saved" : "Save"}
                            </button>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <button
                              onClick={() => setDeleteTarget({ phone, name: creator.name })}
                              className="text-xs font-medium px-3 py-1 rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 transition-colors"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>

                        {/* ── Expanded week sections ───────────────────── */}
                        {[1, 2, 3, 4, 5].map((week) => {
                          if (!expanded.has(week)) return null;
                          const weekReels    = creator.reels.filter((r) => r.week === week);
                          const wMarks       = sumMarks(weekReels, reelMarks);
                          const wViews       = sumMetric(weekReels, "views");
                          const wLikes       = sumMetric(weekReels, "likes");
                          const wComments    = sumMetric(weekReels, "comments");
                          return (
                            <tr key={`${phone}-w${week}`}>
                              <td colSpan={14} className="p-0">

                                {/* Week label */}
                                <div className="px-6 py-2 bg-gray-50 border-y border-gray-100 flex items-center gap-2 flex-wrap">
                                  {WEEK_TOPICS[week] ? (
                                    <>
                                      <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">
                                        {WEEK_TOPICS[week].title}
                                      </span>
                                      <span className="w-full -mt-0.5 text-xs font-medium text-gray-600 leading-relaxed">
                                        {WEEK_TOPICS[week].description}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                                      Week {week}
                                    </span>
                                  )}
                                  {weekReels[0]?.submittedAt && (
                                    <>
                                      <span className="text-xs text-gray-300">·</span>
                                      <span className="text-xs text-gray-400 whitespace-nowrap">
                                        Submitted On: {formatSubmittedAt(weekReels[0].submittedAt)}
                                      </span>
                                    </>
                                  )}
                                  <span className="text-xs text-gray-400 whitespace-nowrap">
                                    {weekReels.length} reel{weekReels.length !== 1 ? "s" : ""}
                                  </span>
                                  {wViews != null && (
                                    <>
                                      <span className="text-xs text-gray-300">·</span>
                                      <span className="text-xs text-gray-400 whitespace-nowrap">{formatNumber(wViews)} views</span>
                                    </>
                                  )}
                                  {wLikes != null && (
                                    <>
                                      <span className="text-xs text-gray-300">·</span>
                                      <span className="text-xs text-gray-400 whitespace-nowrap">{formatNumber(wLikes)} likes</span>
                                    </>
                                  )}
                                  {wComments != null && (
                                    <>
                                      <span className="text-xs text-gray-300">·</span>
                                      <span className="text-xs text-gray-400 whitespace-nowrap">{formatNumber(wComments)} comments</span>
                                    </>
                                  )}
                                  <span className="text-xs text-gray-300">·</span>
                                  <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                                    {wMarks} pts
                                  </span>
                                </div>

                                {/* Reel sub-table */}
                                <table className="w-full text-sm text-left">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                      <th className="pl-8 pr-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Thumb</th>
                                      <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">IG Username</th>
                                      <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                                      <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Views</th>
                                      <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Likes</th>
                                      <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Comments</th>
                                      <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Reel URL</th>
                                      <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Marks</th>
                                      <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider" style={{ minWidth: "128px" }}>Verification</th>
                                      <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider"></th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {weekReels.map((reel) => {
                                      const reelId = reel.id!;
                                      return (
                                        <tr key={reelId} className="hover:bg-gray-50 transition-colors align-middle">
                                          <td className="pl-8 pr-4 py-3">
                                            {reel.thumbnail ? (
                                              <div className="relative w-8 h-11 rounded overflow-hidden border border-gray-200 shrink-0">
                                                <Image
                                                  src={reel.thumbnail}
                                                  alt=""
                                                  width={32}
                                                  height={48}
                                                  unoptimized
                                                  className="object-cover w-full h-full"
                                                />
                                              </div>
                                            ) : (
                                              <div className="w-8 h-11 rounded bg-gray-100 border border-gray-200" />
                                            )}
                                          </td>
                                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                            {reel.username ? `@${reel.username}` : "—"}
                                          </td>
                                          <td className="px-4 py-3">
                                            <StatusBadge status={reel.status} />
                                          </td>
                                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                            {reel.views != null ? formatNumber(reel.views) : "—"}
                                          </td>
                                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                            {reel.likes != null ? formatNumber(reel.likes) : "—"}
                                          </td>
                                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                            {reel.comments != null ? formatNumber(reel.comments) : "—"}
                                          </td>
                                          <td className="px-4 py-3 max-w-[160px]">
                                            <a
                                              href={reel.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-xs text-blue-600 hover:text-blue-800 hover:underline truncate block"
                                              title={reel.url}
                                            >
                                              {reel.url.replace("https://www.instagram.com/reel/", "reel/")}
                                            </a>
                                          </td>
                                          <td className="px-4 py-3 whitespace-nowrap">
                                            <input
                                              type="number"
                                              min={0}
                                              value={reelMarks[reelId] ?? "0"}
                                              onChange={(e) =>
                                                setReelMarks((prev) => ({ ...prev, [reelId]: e.target.value }))
                                              }
                                              onBlur={() => handleReelMarkBlur(reelId, reel.submissionId!)}
                                              className="w-16 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-gray-500"
                                            />
                                          </td>
                                          <td className="px-4 py-3 whitespace-nowrap" style={{ minWidth: "128px" }}>
                                            <select
                                              value={reelVerificationStatus[reelId] ?? "-"}
                                              onChange={(e) =>
                                                setReelVerificationStatus((prev) => ({ ...prev, [reelId]: e.target.value }))
                                              }
                                              className="border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-gray-500 bg-white"
                                            >
                                              <option value="-">-</option>
                                              <option value="Verified">Verified</option>
                                              <option value="Unverified">Unverified</option>
                                            </select>
                                          </td>
                                          <td className="px-4 py-3 whitespace-nowrap">
                                            <button
                                              onClick={() =>
                                                setDeleteReelTarget({ reelId, submissionId: reel.submissionId! })
                                              }
                                              className="text-xs font-medium px-3 py-1 rounded border border-red-200 text-red-600 bg-white hover:bg-red-50 transition-colors"
                                            >
                                              Delete
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>

                              </td>
                            </tr>
                          );
                        })}

                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ── Reel delete confirmation modal ───────────────────────────────── */}
      {deleteReelTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-lg w-full max-w-sm">
            <div className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Delete this reel?</h2>
              <p className="text-sm text-gray-500 mb-6">This action cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteReelTarget(null)}
                  disabled={deleteReelLoading}
                  className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteReel}
                  disabled={deleteReelLoading}
                  className="text-sm font-medium text-white bg-red-600 border border-red-600 rounded-md px-4 py-2 hover:bg-red-700 transition-colors disabled:opacity-40 flex items-center gap-2"
                >
                  {deleteReelLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Deleting…
                    </>
                  ) : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-lg w-full max-w-sm">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">⚠️</span>
                <h2 className="text-base font-semibold text-gray-900">Confirm Delete</h2>
              </div>
              <div className="mb-5 space-y-1 text-sm text-gray-700">
                <p><span className="font-medium">Creator:</span> {deleteTarget.name}</p>
                <p><span className="font-medium">Phone:</span> +91 {deleteTarget.phone}</p>
              </div>
              <p className="text-sm text-gray-500 mb-6">
                This will permanently delete the creator and all associated reels and data. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteLoading}
                  className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleteLoading}
                  className="text-sm font-medium text-white bg-red-600 border border-red-600 rounded-md px-4 py-2 hover:bg-red-700 transition-colors disabled:opacity-40 flex items-center gap-2"
                >
                  {deleteLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Deleting…
                    </>
                  ) : "Confirm Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Import preview modal ───────────────────────────────────────────── */}
      {(importStage === "preview-ready" || importStage === "executing") && importPreview && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-lg w-full max-w-md">
            <div className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-5">Import Preview</h2>

              <div className="mb-5 space-y-2.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === "merge"}
                    onChange={() => setImportMode("merge")}
                    className="mt-0.5 accent-gray-900"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">Merge &amp; Update</span>
                    <p className="text-xs text-gray-500 mt-0.5">Existing creators and reels updated · New records created</p>
                  </div>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === "create-only"}
                    onChange={() => setImportMode("create-only")}
                    className="mt-0.5 accent-gray-900"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">Create New Records Only</span>
                    <p className="text-xs text-gray-500 mt-0.5">Existing creators and reels skipped · Only new records created</p>
                  </div>
                </label>
              </div>

              <div className="border border-gray-100 rounded-md divide-y divide-gray-100 mb-4 text-sm">
                {[
                  ["Creators to create", importPreview.creatorsToCreate],
                  ["Creators to update", importMode === "merge" ? importPreview.creatorsToUpdate : 0],
                  ["Reels to create",    importPreview.reelsToCreate],
                  ["Reels to update",    importMode === "merge" ? importPreview.reelsToUpdate : 0],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex justify-between px-3 py-2">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium text-gray-900">{val}</span>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-600">Weeks detected</span>
                  <span className="font-medium text-gray-900">{importPreview.weeksDetected.join(", ") || "—"}</span>
                </div>
                {importMode === "create-only" && (
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-gray-600">Rows skipped (existing)</span>
                    <span className="font-medium text-gray-900">
                      {importPreview.creatorsToUpdate + importPreview.reelsToUpdate}
                    </span>
                  </div>
                )}
                {importPreview.fallbackDobCount > 0 && (
                  <div className="flex justify-between px-3 py-2 bg-yellow-50">
                    <span className="text-yellow-700">Rows using fallback DOB</span>
                    <span className="font-medium text-yellow-800">{importPreview.fallbackDobCount}</span>
                  </div>
                )}
                {importPreview.skipped > 0 && (
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-gray-600">Rows skipped</span>
                    <span className="font-medium text-gray-900">{importPreview.skipped}</span>
                  </div>
                )}
              </div>

              {importPreview.errors.length > 0 && (
                <div className="mb-4 bg-red-50 border border-red-100 rounded-md p-3 text-xs text-red-700 space-y-1 max-h-32 overflow-y-auto">
                  {importPreview.errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={cancelImport}
                  disabled={importStage === "executing"}
                  className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={executeImport}
                  disabled={importStage === "executing"}
                  className="text-sm font-medium text-white bg-gray-900 border border-gray-900 rounded-md px-4 py-2 hover:bg-gray-700 transition-colors disabled:opacity-40 flex items-center gap-2"
                >
                  {importStage === "executing" ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Importing…
                    </>
                  ) : "Import"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Import result banner ───────────────────────────────────────────── */}
      {importStage === "done" && importResult && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-lg w-full max-w-sm">
            <div className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Import Complete</h2>
              <div className="text-sm space-y-1 mb-4">
                <p className="text-gray-700">Imported successfully: <span className="font-medium text-gray-900">{importResult.imported} operations</span></p>
                {importResult.skipped > 0 && <p className="text-gray-600">Skipped: {importResult.skipped}</p>}
              </div>
              {importResult.warnings.length > 0 && (
                <div className="mb-3 bg-yellow-50 border border-yellow-100 rounded-md p-3 text-xs text-yellow-700 space-y-1">
                  {importResult.warnings.map((w, i) => <p key={i}>{w}</p>)}
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="mb-3 bg-red-50 border border-red-100 rounded-md p-3 text-xs text-red-700 space-y-1">
                  {importResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
              {importResult.reelsToScrape.length > 0 && (
                <p className="text-xs text-gray-500 mb-4">
                  Scraping {importResult.reelsToScrape.length} reel{importResult.reelsToScrape.length !== 1 ? "s" : ""} in background…
                </p>
              )}
              <div className="flex justify-end">
                <button onClick={cancelImport} className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Import error modal ─────────────────────────────────────────────── */}
      {importStage === "error" && importError && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-lg w-full max-w-sm">
            <div className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Import Failed</h2>
              <p className="text-sm text-red-600 mb-5 whitespace-pre-wrap">{importError}</p>
              <div className="flex justify-end">
                <button onClick={cancelImport} className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
