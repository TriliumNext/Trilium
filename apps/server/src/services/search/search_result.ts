"use strict";

import beccaService from "../../becca/becca_service.js";
import becca from "../../becca/becca.js";
import fuzzysort from "fuzzysort";

const SCORE_WEIGHTS = {
  NOTE_ID_EXACT_MATCH: 1000,

  TITLE_EXACT_MATCH: 900,
  LABEL_VALUE_EXACT_MATCH: 880,
  TITLE_PREFIX_MATCH: 850,
  LABEL_VALUE_PREFIX_MATCH: 840,
  TITLE_WORD_MATCH: 800,
  LABEL_VALUE_WORD_MATCH: 790,

  LABEL_KEY_EXACT_MATCH: 600,
  LABEL_KEY_PREFIX_MATCH: 580,
  LABEL_KEY_WORD_MATCH: 560,

  TITLE_FUZZY_MATCH: 750,
  LABEL_VALUE_FUZZY_MATCH: 560,
  LABEL_KEY_FUZZY_MATCH: 540,

  TOKEN_EXACT_MATCH: 120,
  TOKEN_PREFIX_MATCH: 110,
  TOKEN_CONTAINS_MATCH: 105,
  TOKEN_FUZZY_MATCH: 100,

  HIDDEN_NOTE_PENALTY: 3,
  MAX_TOTAL_FUZZY_SCORE: 100,
  MAX_FUZZY_SCORE_PER_TOKEN: 3,
  MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER: 3
} as const;

function normalizeSearchText(str?: string | null): string {
  if (!str) return ""; // handle undefined, null, empty
  return str
    .normalize("NFKD")                       // split accents
    .replace(/[\u0300-\u036f]/g, "")         // remove diacritics
    .replace(/[^a-z0-9\s_-]+/gi, " ")        // remove weird chars
    .replace(/\s+/g, " ")                    // collapse spaces
    .trim()
    .toLowerCase();
}

function getTrigrams(str: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < str.length - 2; i++) set.add(str.slice(i, i + 3));
  return set;
}

function trigramJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const tri of a) if (b.has(tri)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

class SearchResult {
  notePathArray: string[];
  score = 0;
  fuzzyScore = 0;

  // 🧩 extra properties Trilium expects
  notePathTitle: string;
  highlightedNotePathTitle?: string;
  contentSnippet: string = "";
  highlightedContentSnippet?: string;
  attributeSnippet: string = "";
  highlightedAttributeSnippet?: string;
  highlightedNoteId?: string;

  constructor(notePathArray: string[]) {
    this.notePathArray = notePathArray;

    // ✅ safe defaults for highlighting / rendering
    this.notePathTitle = beccaService.getNoteTitleForPath(notePathArray) || "";
  }

  get noteId() {
    return this.notePathArray[this.notePathArray.length - 1];
  }

  computeScore(fulltextQuery: string, tokens: string[], enableFuzzyMatching = true) {
    const note = becca.notes[this.noteId];
    const normalizedQuery = normalizeSearchText(fulltextQuery);
    const title = note._normalizedTitle ??= normalizeSearchText(note.title || "");
    const labels = note.getLabels?.() || [];

    this.score = 0;
    this.fuzzyScore = 0;

    // 1️⃣ NOTE ID exact match
    if (note.noteId.toLowerCase() === normalizedQuery) {
      this.score = SCORE_WEIGHTS.NOTE_ID_EXACT_MATCH;
      return this.score;
    }

    // 2️⃣ TITLE deterministic checks
    if (title === normalizedQuery) this.score = SCORE_WEIGHTS.TITLE_EXACT_MATCH;
    else if (title.startsWith(normalizedQuery)) this.score = SCORE_WEIGHTS.TITLE_PREFIX_MATCH;
    else if (title.includes(normalizedQuery)) this.score = SCORE_WEIGHTS.TITLE_WORD_MATCH;

    // 3️⃣ LABEL deterministic checks
    let bestLabelValueScore = 0;
    let bestLabelKeyScore = 0;

    for (const label of labels) {
      const key = label._normalizedKey ??= normalizeSearchText(label.name || "");
      const val = label._normalizedValue ??= normalizeSearchText(label.value || "");

      // Value
      if (val === normalizedQuery)
        bestLabelValueScore = Math.max(bestLabelValueScore, SCORE_WEIGHTS.LABEL_VALUE_EXACT_MATCH);
      else if (val.startsWith(normalizedQuery))
        bestLabelValueScore = Math.max(bestLabelValueScore, SCORE_WEIGHTS.LABEL_VALUE_PREFIX_MATCH);
      else if (val.includes(normalizedQuery))
        bestLabelValueScore = Math.max(bestLabelValueScore, SCORE_WEIGHTS.LABEL_VALUE_WORD_MATCH);

      // Key
      if (key === normalizedQuery)
        bestLabelKeyScore = Math.max(bestLabelKeyScore, SCORE_WEIGHTS.LABEL_KEY_EXACT_MATCH);
      else if (key.startsWith(normalizedQuery))
        bestLabelKeyScore = Math.max(bestLabelKeyScore, SCORE_WEIGHTS.LABEL_KEY_PREFIX_MATCH);
      else if (key.includes(normalizedQuery))
        bestLabelKeyScore = Math.max(bestLabelKeyScore, SCORE_WEIGHTS.LABEL_KEY_WORD_MATCH);
    }

    // 4️⃣ TOKEN deterministic checks
    let bestTokenScore = 0;
    for (const token of tokens) {
      const t = normalizeSearchText(token);
      if (title === t) bestTokenScore = Math.max(bestTokenScore, SCORE_WEIGHTS.TOKEN_EXACT_MATCH);
      else if (title.startsWith(t)) bestTokenScore = Math.max(bestTokenScore, SCORE_WEIGHTS.TOKEN_PREFIX_MATCH);
      else if (title.includes(t)) bestTokenScore = Math.max(bestTokenScore, SCORE_WEIGHTS.TOKEN_CONTAINS_MATCH);
    }

    // combine deterministic phase
    this.score = Math.max(this.score, bestLabelValueScore, bestLabelKeyScore, bestTokenScore);

    // 5️⃣ FUZZY phase (guarded by trigram similarity)
    if (enableFuzzyMatching) {
      const queryTrigrams = getTrigrams(normalizedQuery);
      const titleTrigrams = note._titleTrigrams ??= getTrigrams(title);
      const titlePass = trigramJaccard(queryTrigrams, titleTrigrams) >= 0.25;

      if (titlePass && this.score < SCORE_WEIGHTS.TITLE_PREFIX_MATCH) {
        const fuzzyTitleScore = this.fuzzyScoreFor(title, normalizedQuery, SCORE_WEIGHTS.TITLE_FUZZY_MATCH);
        this.score = Math.max(this.score, fuzzyTitleScore);
      }

      for (const label of labels) {
        const key = label._normalizedKey ??= normalizeSearchText(label.name || "");
        const val = label._normalizedValue ??= normalizeSearchText(label.value || "");

        const keyPass = trigramJaccard(queryTrigrams, getTrigrams(key)) >= 0.25;
        const valPass = trigramJaccard(queryTrigrams, getTrigrams(val)) >= 0.25;

        if (valPass)
          bestLabelValueScore = Math.max(
            bestLabelValueScore,
            this.fuzzyScoreFor(val, normalizedQuery, SCORE_WEIGHTS.LABEL_VALUE_FUZZY_MATCH)
          );
        if (keyPass)
          bestLabelKeyScore = Math.max(
            bestLabelKeyScore,
            this.fuzzyScoreFor(key, normalizedQuery, SCORE_WEIGHTS.LABEL_KEY_FUZZY_MATCH)
          );
      }

      // Token fuzzy
      for (const token of tokens) {
        const t = normalizeSearchText(token);
        const tokenPass = trigramJaccard(queryTrigrams, getTrigrams(t)) >= 0.25;
        if (tokenPass)
          bestTokenScore = Math.max(
            bestTokenScore,
            this.fuzzyScoreFor(title, t, SCORE_WEIGHTS.TOKEN_FUZZY_MATCH)
          );
      }
    }

    // 6️⃣ Final aggregation
    this.score = Math.max(this.score, bestLabelValueScore, bestLabelKeyScore, bestTokenScore);

    // 7️⃣ Hidden penalty
    if (note.isInHiddenSubtree()) this.score /= SCORE_WEIGHTS.HIDDEN_NOTE_PENALTY;

    return this.score;
  }

  // ⚙️ Fuzzysort-based scoring
  private fuzzyScoreFor(target: string, query: string, baseWeight: number): number {
    if (!target || !query || this.fuzzyScore >= SCORE_WEIGHTS.MAX_TOTAL_FUZZY_SCORE) return 0;
    const res = fuzzysort.single(query, target);
    if (!res) return 0;

    const quality = Math.max(0, 1 - Math.min(Math.abs(res.score) / 1000, 1));
    const rawScore = baseWeight * quality;
    const cappedScore = Math.min(
      rawScore,
      SCORE_WEIGHTS.MAX_FUZZY_SCORE_PER_TOKEN * SCORE_WEIGHTS.MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER
    );

    this.fuzzyScore += cappedScore;
    return cappedScore;
  }
}

export default SearchResult;
