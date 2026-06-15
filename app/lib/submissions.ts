export interface ReelResult {
  id?: string;
  submissionId?: string;
  url: string;
  status: "pending" | "done" | "failed";
  username?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  thumbnail?: string | null;
  timestamp?: string | null;
  marks?: number;
  remarks?: string;
  week?: number;
  submittedAt?: string | null;
  verificationStatus?: string;
}

export interface Creator {
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
  reels: ReelResult[];
}

export interface Submission {
  id: string;
  phone: string;
  name: string;
  dob: string;
  gender: string;
  city: string;
  isJain: boolean | null;
  isJitoMember: boolean | null;
  reelUrls: string[];
  reels: ReelResult[];
  submittedAt: string;
}

const KEY = "form-submissions";

export function loadSubmissions(): Submission[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Submission[];
  } catch {
    return [];
  }
}

export function saveSubmission(
  data: Omit<Submission, "id" | "submittedAt" | "reels">
): string {
  const existing = loadSubmissions();
  const id = Date.now().toString();
  const entry: Submission = {
    ...data,
    id,
    reels: data.reelUrls.map((url) => ({ url, status: "pending" })),
    submittedAt: new Date().toISOString(),
  };
  localStorage.setItem(KEY, JSON.stringify([entry, ...existing]));
  return id;
}

export function updateSubmissionReels(id: string, reels: ReelResult[]): void {
  const existing = loadSubmissions();
  const updated = existing.map((s) => (s.id === id ? { ...s, reels } : s));
  localStorage.setItem(KEY, JSON.stringify(updated));
}

export function updateReelFields(
  submissionId: string,
  reelIndex: number,
  fields: { marks?: number; remarks?: string }
): void {
  const existing = loadSubmissions();
  const updated = existing.map((s) => {
    if (s.id !== submissionId) return s;
    const reels = [...s.reels];
    reels[reelIndex] = { ...reels[reelIndex], ...fields };
    return { ...s, reels };
  });
  localStorage.setItem(KEY, JSON.stringify(updated));
}
