"use client";

import { useState, useEffect } from "react";
import PublicNavbar from "@/app/components/PublicNavbar";
import { WEEK_TOPICS } from "@/app/lib/weekTopics";

type Gender = "Male" | "Female" | "Other" | "";

interface FormData {
  name: string;
  dob: string;
  gender: Gender;
  city: string;
  isJain: boolean | null;
  isJitoMember: boolean | null;
  week: number | null;
  reelUrl: string;
  confirmed: boolean;
}

function calcAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function isValidReelUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "www.instagram.com" || parsed.hostname === "instagram.com") &&
      parsed.pathname.includes("/reel/")
    );
  } catch {
    return false;
  }
}

export default function FormPage() {
  const [phone, setPhone] = useState("");
  const [form, setForm] = useState<FormData>({
    name: "",
    dob: "",
    gender: "",
    city: "",
    isJain: null,
    isJitoMember: null,
    week: null,
    reelUrl: "",
    confirmed: false,
  });
  const [campaignStatus, setCampaignStatus] = useState<"loading" | "active" | "inactive">("loading");
  const [openWeeks, setOpenWeeks]           = useState<number[] | null>(null);
  const [occupiedWeeks, setOccupiedWeeks]   = useState<number[]>([]);
  const [verifyStatus, setVerifyStatus]     = useState<"idle" | "loading" | "found" | "not-found">("idle");
  const [errors, setErrors]                 = useState<Record<string, string>>({});
  const [loading, setLoading]               = useState(false);
  const [submitted, setSubmitted]           = useState(false);

  useEffect(() => {
    fetch("/api/campaign")
      .then((r) => r.json())
      .then((d: { status: string; openWeeks: number[] }) => {
        setCampaignStatus(d.status as "active" | "inactive");
        setOpenWeeks(d.openWeeks ?? []);
      })
      .catch(() => {
        // fail open — backend is the authority
        setCampaignStatus("active");
      });
  }, []);

  async function handleVerify() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) return;
    setVerifyStatus("loading");
    try {
      const res  = await fetch(`/api/submissions/weeks?phone=${encodeURIComponent(digits)}`);
      const data = await res.json() as {
        exists: boolean;
        occupiedWeeks: number[];
        name?: string;
        gender?: string;
        dob?: string;
        city?: string;
        isJain?: boolean | null;
        isJitoMember?: boolean | null;
      };
      const weeks = data.occupiedWeeks ?? [];
      setOccupiedWeeks(weeks);
      if (data.exists) {
        setForm((f) => ({
          ...f,
          name:         data.name         ?? f.name,
          gender:       (data.gender as Gender) ?? f.gender,
          dob:          data.dob          ?? f.dob,
          city:         data.city         ?? f.city,
          isJain:       data.isJain       !== undefined ? (data.isJain       ?? null) : f.isJain,
          isJitoMember: data.isJitoMember !== undefined ? (data.isJitoMember ?? null) : f.isJitoMember,
          week:         f.week !== null && weeks.includes(f.week) ? null : f.week,
        }));
        setVerifyStatus("found");
      } else {
        setVerifyStatus("not-found");
      }
    } catch {
      setOccupiedWeeks([]);
      setVerifyStatus("idle");
    }
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (phone.replace(/\D/g, "").length < 10) e.phone = "Enter a valid 10-digit phone number.";
    if (!form.name.trim()) e.name = "Full name is required.";
    if (!form.dob) {
      e.dob = "Date of birth is required.";
    } else {
      const age = calcAge(form.dob);
      if (age < 18 || age > 36) e.dob = "Age must be between 18 and 36.";
    }
    if (!form.gender) e.gender = "Please select a gender.";
    if (!form.city.trim()) e.city = "City is required.";
    if (form.isJain === null) e.isJain = "Please select an option.";
    if (form.isJain === true && form.isJitoMember === null) e.isJitoMember = "Please select an option.";
    if (form.week === null) e.week = "Please select a week.";
    if (!form.reelUrl.trim()) {
      e.reelUrl = "This field is required.";
    } else if (!isValidReelUrl(form.reelUrl.trim())) {
      e.reelUrl = "Enter a valid Instagram Reel URL.";
    }
    if (!form.confirmed) e.confirmed = "Please confirm the declaration.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function scrapeInBackground(
    submissionId: string,
    reelEntries: { id: string; url: string }[]
  ) {
    await Promise.allSettled(
      reelEntries.map(async ({ id: reelId, url }) => {
        try {
          const res = await fetch("/api/analyze", {
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
                ? {
                    status:    "done",
                    username:  data.username  ?? null,
                    views:     data.views     ?? null,
                    likes:     data.likes     ?? null,
                    comments:  data.comments  ?? null,
                    thumbnail: data.thumbnail ?? null,
                    timestamp: data.timestamp ?? null,
                  }
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          name:          form.name,
          dob:           form.dob,
          gender:        form.gender,
          city:          form.city,
          isJain:        form.isJain,
          isJitoMember:  form.isJain === true ? form.isJitoMember : null,
          week:          form.week,
          reelUrls:      [form.reelUrl],
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setErrors({ form: (err as { error?: string }).error ?? "Submission failed. Please try again." });
        setLoading(false);
        return;
      }
      const { id, reels } = await res.json() as { id: string; reels: { id: string; url: string }[] };
      setLoading(false);
      setSubmitted(true);
      // Fire scraping after showing success — non-blocking
      scrapeInBackground(id, reels);
    } catch {
      setErrors({ form: "Network error. Please try again." });
      setLoading(false);
    }
  }

  if (campaignStatus === "inactive") {
    return (
      <div className="min-h-screen bg-gray-50">
        <PublicNavbar />
        <main className="flex items-center justify-center px-4 py-20">
          <div className="bg-white border border-gray-200 rounded-lg p-10 max-w-sm w-full text-center">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Campaign Closed</h2>
            <p className="text-sm text-gray-500">
              Campaign is currently closed. Please check back later.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PublicNavbar />
        <main className="flex items-center justify-center px-4 py-20">
          <div className="bg-white border border-gray-200 rounded-lg p-10 max-w-sm w-full text-center">
            <p className="text-2xl mb-4">✓</p>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Submission received</h2>
            <p className="text-sm text-gray-500">
              Your registration has been submitted. Our team will follow up shortly.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const fieldClass = (err?: string) =>
    `w-full border rounded-md px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 bg-white ${
      err
        ? "border-red-400 focus:border-red-400 focus:ring-red-200"
        : "border-gray-300 focus:border-gray-500 focus:ring-gray-200"
    }`;

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNavbar />

      <main className="px-4 py-10">
        <div className="max-w-2xl mx-auto">

          {/* Header */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900">Campaign Registration</h1>
            <p className="text-sm text-gray-500 mt-1">Please complete the form below.</p>
          </div>

          <form onSubmit={handleSubmit} noValidate>

            {/* ── Personal Details ─────────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 mb-4">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">Personal Details</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* Phone Number */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone Number <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <span className="flex items-center border border-gray-300 rounded-md px-3 text-sm text-gray-500 bg-gray-50 select-none">
                      +91
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                        setPhone(val);
                        if (verifyStatus !== "idle") {
                          setVerifyStatus("idle");
                          setOccupiedWeeks([]);
                        }
                      }}
                      placeholder="98765 43210"
                      className={`flex-1 ${fieldClass(errors.phone)}`}
                    />
                    <button
                      type="button"
                      onClick={handleVerify}
                      disabled={phone.replace(/\D/g, "").length !== 10 || verifyStatus === "loading"}
                      className="shrink-0 border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-md px-3 text-sm font-medium transition-colors"
                    >
                      {verifyStatus === "loading" ? "Verifying…" : "Verify"}
                    </button>
                  </div>
                  {verifyStatus === "found" && (
                    <p className="text-xs text-green-600 mt-1">✓ Creator found · Details pre-filled</p>
                  )}
                  {verifyStatus === "not-found" && (
                    <p className="text-xs text-gray-500 mt-1">New creator</p>
                  )}
                  {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
                </div>

                {/* Full Name */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Priya Sharma"
                    className={fieldClass(errors.name)}
                  />
                  {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date of Birth <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.dob}
                    onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))}
                    max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split("T")[0]}
                    min={new Date(new Date().setFullYear(new Date().getFullYear() - 36)).toISOString().split("T")[0]}
                    className={fieldClass(errors.dob)}
                  />
                  {errors.dob && <p className="text-xs text-red-500 mt-1">{errors.dob}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Gender <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.gender}
                    onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as Gender }))}
                    className={`${fieldClass(errors.gender)} ${!form.gender ? "text-gray-400" : "text-gray-900"}`}
                  >
                    <option value="" disabled>Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                  {errors.gender && <p className="text-xs text-red-500 mt-1">{errors.gender}</p>}
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="e.g. Mumbai"
                    className={fieldClass(errors.city)}
                  />
                  {errors.city && <p className="text-xs text-red-500 mt-1">{errors.city}</p>}
                </div>

                {/* Are you Jain? */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Are you Jain? <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                      <input
                        type="radio"
                        name="isJain"
                        checked={form.isJain === true}
                        onChange={() => setForm((f) => ({ ...f, isJain: true }))}
                        className="accent-gray-900"
                      />
                      Yes
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                      <input
                        type="radio"
                        name="isJain"
                        checked={form.isJain === false}
                        onChange={() => setForm((f) => ({ ...f, isJain: false, isJitoMember: null }))}
                        className="accent-gray-900"
                      />
                      No
                    </label>
                  </div>
                  {errors.isJain && <p className="text-xs text-red-500 mt-1">{errors.isJain}</p>}
                </div>

                {/* Are you a JITO member? — only when Jain = Yes */}
                {form.isJain === true && (
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Are you a JITO member? <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-6">
                      <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                        <input
                          type="radio"
                          name="isJitoMember"
                          checked={form.isJitoMember === true}
                          onChange={() => setForm((f) => ({ ...f, isJitoMember: true }))}
                          className="accent-gray-900"
                        />
                        Yes
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                        <input
                          type="radio"
                          name="isJitoMember"
                          checked={form.isJitoMember === false}
                          onChange={() => setForm((f) => ({ ...f, isJitoMember: false }))}
                          className="accent-gray-900"
                        />
                        No
                      </label>
                    </div>
                    {errors.isJitoMember && <p className="text-xs text-red-500 mt-1">{errors.isJitoMember}</p>}
                  </div>
                )}
              </div>
            </div>

            {/* ── Instagram Reel Links ─────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 mb-4">
              <h2 className="text-sm font-semibold text-gray-800 mb-1">Instagram Reel Links</h2>
              <p className="text-xs text-gray-400 mb-4">Add at least one public Instagram Reel URL.</p>

              {/* Week selector — topic cards */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Week <span className="text-red-500">*</span>
                </label>
                <div className={`space-y-2 ${errors.week ? "ring-1 ring-red-300 rounded-md" : ""}`}>
                  {[1, 2, 3, 4, 5].map((w) => {
                    const isOpen     = openWeeks === null || openWeeks.includes(w);
                    const isOccupied = occupiedWeeks.includes(w);
                    const hasWeek1   = occupiedWeeks.includes(1);
                    const needsWeek1 = w > 1 && verifyStatus !== "idle" && !hasWeek1;
                    const isDisabled = !isOpen || isOccupied || needsWeek1;
                    const isSelected = form.week === w;
                    const topic      = WEEK_TOPICS[w];
                    return (
                      <button
                        key={w}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => {
                          if (!isDisabled) setForm((f) => ({ ...f, week: w }));
                        }}
                        className={`w-full text-left p-3 rounded-md border transition-colors ${
                          isSelected
                            ? "border-gray-800 bg-gray-50"
                            : isDisabled
                              ? "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                              : "border-gray-200 bg-white hover:border-gray-300 cursor-pointer"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isDisabled ? "text-gray-400" : "text-gray-900"}`}>
                              {topic ? topic.title : `Week ${w}`}
                              {isOccupied ? " 🔒" : !isOpen ? " (closed)" : ""}
                            </p>
                            {topic && isOpen && !isOccupied && (
                              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                                {topic.description}
                              </p>
                            )}
                          </div>
                          {isSelected && (
                            <span className="shrink-0 text-xs font-semibold text-gray-700 mt-0.5">✓</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {errors.week && <p className="text-xs text-red-500 mt-1">{errors.week}</p>}
                {verifyStatus !== "idle" && !occupiedWeeks.includes(1) && (openWeeks === null || openWeeks.some((w) => w > 1)) && (
                  <p className="text-xs text-red-500 mt-1">
                    Week 1 has not been submitted. Future weeks require completing Week 1 first.
                  </p>
                )}
              </div>

              <div>
                <input
                  type="url"
                  value={form.reelUrl}
                  onChange={(e) => setForm((f) => ({ ...f, reelUrl: e.target.value }))}
                  placeholder="https://www.instagram.com/reel/..."
                  className={fieldClass(errors.reelUrl)}
                />
                {errors.reelUrl && (
                  <p className="text-xs text-red-500 mt-1">{errors.reelUrl}</p>
                )}
              </div>
            </div>

            {/* ── Declaration + Submit ─────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.confirmed}
                  onChange={(e) => setForm((f) => ({ ...f, confirmed: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-gray-900 cursor-pointer"
                />
                <span className="text-sm text-gray-600">
                  I confirm that the information provided is accurate and the reel links belong to my Instagram account.
                </span>
              </label>
              {errors.confirmed && (
                <p className="text-xs text-red-500 mt-2 pl-7">{errors.confirmed}</p>
              )}
            </div>

            {errors.form && (
              <p className="text-sm text-red-500 mb-4 text-center">{errors.form}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gray-900 text-white text-sm font-semibold py-3 rounded-md hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Submitting…
                </>
              ) : (
                "Submit Registration"
              )}
            </button>

            <p className="text-center text-xs text-gray-400 mt-4 pb-8">
              Only public Instagram reels are supported.
            </p>

          </form>
        </div>
      </main>
    </div>
  );
}
