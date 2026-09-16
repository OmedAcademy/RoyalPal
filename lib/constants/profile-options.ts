export const ENGLISH_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export const ENGLISH_LEVEL_LABELS: Record<(typeof ENGLISH_LEVELS)[number], string> = {
  A1: "A1 — Beginner",
  A2: "A2 — Elementary",
  B1: "B1 — Intermediate",
  B2: "B2 — Upper Intermediate",
  C1: "C1 — Advanced",
  C2: "C2 — Proficient",
};

export const SPECIALIZATIONS = [
  "IELTS",
  "TOEFL",
  "Business English",
  "Conversation",
  "Kids",
  "Academic Writing",
  "Grammar",
  "Pronunciation",
  "Exam Prep",
  "General English",
] as const;

export type Specialization = (typeof SPECIALIZATIONS)[number];
