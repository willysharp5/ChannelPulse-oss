import {
  blankInterviewTemplate,
  type InterviewTemplate,
} from "./templates";
import {
  CATEGORY_LABELS,
  type BankQuestion,
  type QuestionCategory,
} from "./question-bank";
import { formatBankQuestion } from "./format-bank-text";

/** Max questions in one bank practice session (matches template limit). */
export const MAX_BANK_PRACTICE = 10;

/** Build a practice template from explicitly selected bank questions. */
export function buildBankPracticeTemplate(opts: {
  id: string;
  title: string;
  roleLevel: string;
  questions: BankQuestion[];
  notes?: string;
}): InterviewTemplate | null {
  const slice = opts.questions.slice(0, MAX_BANK_PRACTICE);
  if (slice.length === 0) return null;

  const designSession = slice.every((q) => q.category === "system_design");
  const codingSession =
    !designSession && slice.every((q) => q.category === "coding");

  const categoryHint = ((): QuestionCategory | "mixed" => {
    const set = new Set(slice.map((q) => q.category));
    if (set.size === 1) return slice[0].category;
    return "mixed";
  })();

  const base = blankInterviewTemplate();
  return {
    ...base,
    id: opts.id,
    title: opts.title,
    category: "engineering",
    roleLevel: opts.roleLevel,
    focusAreas: designSession
      ? ["system design", "scalability", "architecture"]
      : codingSession
        ? ["coding", "algorithms", "problem solving"]
        : base.focusAreas,
    notes:
      opts.notes ??
      (designSession
        ? "System design practice from the question bank."
        : codingSession
          ? "Coding practice from the question bank."
          : categoryHint === "mixed"
            ? "Mixed-category practice from the question bank."
            : `Practice ${CATEGORY_LABELS[categoryHint]} questions from the question bank.`),
    customQuestions: slice.map((q) => formatBankQuestion(q.question)),
    customModelAnswers: slice.map((q) => q.model_answer || ""),
    customQuestionCategories: slice.map((q) => q.category),
    bankQuestionIds: slice.map((q) => q.id),
    answerMode: designSession
      ? "system_design"
      : codingSession
        ? "coding"
        : "spoken",
    builtIn: false,
  };
}
