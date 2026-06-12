"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [id, setId]           = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res  = await fetch("/api/superadmin/auth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id: id.trim(), password }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) {
        localStorage.setItem("superAdminLoggedIn", "true");
        router.push("/superadmin/dashboard");
      } else {
        setError(data.error ?? "Invalid credentials.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-gray-900">JYCC Reel Tank</h1>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mt-1">Super Admin</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Admin ID
              </label>
              <input
                type="text"
                autoComplete="username"
                value={id}
                onChange={(e) => setId(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:border-gray-500 focus:ring-gray-200 bg-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:border-gray-500 focus:ring-gray-200 bg-white"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500 text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !id.trim() || !password}
              className="w-full bg-gray-900 text-white text-sm font-semibold py-2.5 rounded-md hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors mt-2"
            >
              {loading ? "Verifying…" : "Login"}
            </button>

          </form>
        </div>

      </div>
    </div>
  );
}
