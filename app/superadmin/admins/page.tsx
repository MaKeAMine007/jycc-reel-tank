"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import SuperAdminNavbar from "@/app/components/SuperAdminNavbar";

interface AdminRecord {
  id:        string;
  adminId:   string;
  password:  string;
  status:    string;
  createdAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day:   "numeric",
    month: "short",
    year:  "numeric",
  });
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

export default function AdminManagementPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [cAdminId, setCAdminId]   = useState("");
  const [cPassword, setCPassword] = useState("");
  const [cErrors, setCErrors]     = useState<Record<string, string>>({});
  const [creating, setCreating]   = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<AdminRecord | null>(null);
  const [eAdminId, setEAdminId]     = useState("");
  const [ePassword, setEPassword]   = useState("");
  const [eStatus, setEStatus]       = useState("enabled");
  const [eErrors, setEErrors]       = useState<Record<string, string>>({});
  const [saving, setSaving]         = useState(false);

  // Password visibility per row (UUID key)
  const [eyeOpen, setEyeOpen] = useState<Set<string>>(new Set());

  // Per-row status (for inline dropdown auto-save)
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [statusSaving, setStatusSaving] = useState<Set<string>>(new Set());

  async function loadAdmins() {
    setLoading(true);
    try {
      const res  = await fetch("/api/admins");
      const data = await res.json() as AdminRecord[];
      setAdmins(data);
      const s: Record<string, string> = {};
      for (const a of data) s[a.id] = a.status;
      setStatuses(s);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (localStorage.getItem("superAdminLoggedIn") !== "true") {
      router.replace("/superadmin");
      return;
    }
    setAuthed(true);
    loadAdmins();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function toggleEye(id: string) {
    setEyeOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Create admin ───────────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!cAdminId.trim())  errs.adminId  = "Admin ID is required.";
    if (!cPassword.trim()) errs.password = "Password is required.";
    if (Object.keys(errs).length) { setCErrors(errs); return; }
    setCErrors({});
    setCreating(true);
    try {
      const res  = await fetch("/api/admins", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ adminId: cAdminId.trim(), password: cPassword.trim() }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setCErrors({ form: data.error ?? "Failed to create admin." });
        return;
      }
      setCAdminId("");
      setCPassword("");
      await loadAdmins();
    } finally {
      setCreating(false);
    }
  }

  // ── Status inline change ───────────────────────────────────────────────────

  async function handleStatusChange(admin: AdminRecord, newStatus: string) {
    setStatuses((prev) => ({ ...prev, [admin.id]: newStatus }));
    setStatusSaving((prev) => new Set(prev).add(admin.id));
    try {
      await fetch(`/api/admins/${admin.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ adminId: admin.adminId, password: admin.password, status: newStatus }),
      });
      await loadAdmins();
    } finally {
      setStatusSaving((prev) => { const n = new Set(prev); n.delete(admin.id); return n; });
    }
  }

  // ── Edit modal ─────────────────────────────────────────────────────────────

  function openEdit(admin: AdminRecord) {
    setEditTarget(admin);
    setEAdminId(admin.adminId);
    setEPassword(admin.password);
    setEStatus(admin.status);
    setEErrors({});
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    const errs: Record<string, string> = {};
    if (!eAdminId.trim())  errs.adminId  = "Admin ID is required.";
    if (!ePassword.trim()) errs.password = "Password is required.";
    if (Object.keys(errs).length) { setEErrors(errs); return; }
    setEErrors({});
    setSaving(true);
    try {
      const res  = await fetch(`/api/admins/${editTarget.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ adminId: eAdminId.trim(), password: ePassword.trim(), status: eStatus }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setEErrors({ form: data.error ?? "Failed to save." });
        return;
      }
      setEditTarget(null);
      await loadAdmins();
    } finally {
      setSaving(false);
    }
  }

  if (!authed) return null;

  const inputClass = "w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-200 transition-colors";
  const thClass    = "px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left";

  return (
    <div className="min-h-screen bg-gray-50">
      <SuperAdminNavbar />

      <main className="max-w-4xl mx-auto px-6 py-8">

        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-400">JYCC Reel Tank</span>
            <span className="text-xs text-gray-300">›</span>
            <span className="text-xs font-medium text-gray-400">Super Admin</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Admin Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage admin accounts for the system.</p>

          {/* Nav tabs */}
          <div className="flex gap-1 mt-5">
            <a
              href="/superadmin/dashboard"
              className="text-sm font-medium text-gray-500 border border-gray-200 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors"
            >
              Dashboard
            </a>
            <span className="text-sm font-medium text-gray-900 border border-gray-900 bg-gray-900 text-white rounded-md px-4 py-2">
              Admin Panel
            </span>
          </div>
        </div>

        {/* ── Create New Admin ─────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Create New Admin</h2>
          <p className="text-xs text-gray-400 mb-5">Create a new dashboard administrator.</p>

          <form onSubmit={handleCreate} noValidate className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Admin ID</label>
                <input
                  type="text"
                  value={cAdminId}
                  onChange={(e) => setCAdminId(e.target.value)}
                  placeholder="e.g. jycc_team1"
                  autoComplete="off"
                  className={inputClass}
                />
                {cErrors.adminId && <p className="text-xs text-red-500 mt-1">{cErrors.adminId}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="text"
                  value={cPassword}
                  onChange={(e) => setCPassword(e.target.value)}
                  placeholder="Set a password"
                  autoComplete="off"
                  className={inputClass}
                />
                {cErrors.password && <p className="text-xs text-red-500 mt-1">{cErrors.password}</p>}
              </div>
            </div>
            {cErrors.form && <p className="text-xs text-red-500">{cErrors.form}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="text-sm font-medium text-white bg-gray-900 border border-gray-900 rounded-md px-5 py-2 hover:bg-gray-700 transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                {creating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Creating…
                  </>
                ) : "Create Admin"}
              </button>
            </div>
          </form>
        </div>

        {/* ── Existing Admins ──────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Existing Admins</h2>
            <p className="text-xs text-gray-400 mt-0.5">System accounts (admin, superadmin) are not managed here.</p>
          </div>

          {loading ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-gray-400">Loading…</p>
            </div>
          ) : admins.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-gray-400">No admins created yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className={thClass}>Admin ID</th>
                    <th className={thClass}>Password</th>
                    <th className={thClass}>Created On</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {admins.map((admin) => {
                    const isEyeOpen = eyeOpen.has(admin.id);
                    const currentStatus = statuses[admin.id] ?? admin.status;
                    const isSavingStatus = statusSaving.has(admin.id);
                    return (
                      <tr key={admin.id} className="hover:bg-gray-50 transition-colors align-middle">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                          {admin.adminId}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-700 font-mono text-xs">
                              {isEyeOpen ? admin.password : "••••••••"}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleEye(admin.id)}
                              className="text-gray-400 hover:text-gray-700 transition-colors"
                              title={isEyeOpen ? "Hide password" : "Show password"}
                            >
                              <EyeIcon open={isEyeOpen} />
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDate(admin.createdAt)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <select
                            value={currentStatus}
                            disabled={isSavingStatus}
                            onChange={(e) => handleStatusChange(admin, e.target.value)}
                            className={`border rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-500 bg-white transition-colors ${
                              currentStatus === "enabled"
                                ? "border-green-200 text-green-700"
                                : "border-gray-200 text-gray-500"
                            } disabled:opacity-50`}
                          >
                            <option value="enabled">Enabled</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEdit(admin)}
                            className="text-xs font-medium px-3 py-1 rounded border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 transition-colors"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>

      {/* ── Edit Admin modal ──────────────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-lg w-full max-w-sm">
            <div className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-5">Edit Admin</h2>
              <form onSubmit={handleSaveEdit} noValidate className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Admin ID</label>
                  <input
                    type="text"
                    value={eAdminId}
                    onChange={(e) => setEAdminId(e.target.value)}
                    autoComplete="off"
                    className={inputClass}
                  />
                  {eErrors.adminId && <p className="text-xs text-red-500 mt-1">{eErrors.adminId}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="text"
                    value={ePassword}
                    onChange={(e) => setEPassword(e.target.value)}
                    autoComplete="off"
                    className={inputClass}
                  />
                  {eErrors.password && <p className="text-xs text-red-500 mt-1">{eErrors.password}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={eStatus}
                    onChange={(e) => setEStatus(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-200"
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
                {eErrors.form && <p className="text-xs text-red-500">{eErrors.form}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditTarget(null)}
                    disabled={saving}
                    className="text-sm font-medium text-gray-600 border border-gray-300 bg-white rounded-md px-4 py-2 hover:bg-gray-50 transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="text-sm font-medium text-white bg-gray-900 border border-gray-900 rounded-md px-4 py-2 hover:bg-gray-700 transition-colors disabled:opacity-40 flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Saving…
                      </>
                    ) : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
