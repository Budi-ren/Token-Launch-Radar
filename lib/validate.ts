// Radar board checks and summaries.
//
// This module is the entry point's second pair of eyes. The scoring
// model lives elsewhere; what lives here is the question "is the board
// this run produced actually a board a reader can trust?" Every check
// in this file is a plain, mechanical test on the rows themselves, so a
// failure here names the exact row and the exact rule it broke, instead
// of letting a broken board slip through to the dashboard.
//
// Nothing in this file reaches for the network, the clock, or the
// filesystem. It only looks at the board and the snapshot it was built
// from, which keeps its answers the same on every run.

// A board row, as the model hands it over. Only the fields the checks
// need are listed here; a row may carry more, and the extra fields are
// left alone.
export interface RadarBoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

// The slice of the snapshot the checks need: the full protocol list,
// so an invented slug can be caught, and the watchlist, so a missing
// watchlist protocol can be caught.
export interface RadarSnapshotView {
  protocols: Array<{ slug: string }>;
  watchlist: string[];
}

// The compact numbers main.ts prints after a run. `top` is the whole
// first row, not just its name, so the caller can print whichever of
// its fields it likes without a second lookup.
export interface RadarBoardSummary {
  rows: number;
  top: RadarBoardRow | null;
  totalImplied: number;
  watchlistCovered: number;
  earlyCount: number;
}

// The largest implied value the gate allows on a single row, in whole
// dollars. A row above it is not a bigger claim, it is a broken one.
const MAX_IMPLIED_VALUE_USD = 100_000_000_000_000;

// The smallest and largest board sizes the gate accepts.
const MIN_BOARD_ROWS = 100;
const MAX_BOARD_ROWS = 4_000;

// Farm plans are bounded on both sides: too few steps is a slogan,
// too many is padding.
const MIN_FARM_STEPS = 3;
const MAX_FARM_STEPS = 12;
const MIN_STEP_CHARS = 20;
const MAX_STEP_CHARS = 600;

// A slug may not contain whitespace, and it may not be empty.
const SLUG_HAS_WHITESPACE = /\s/;

// ---------------------------------------------------------------------
// Small readers
//
// Board rows arrive as plain objects, so each reader below pulls one
// field out and answers "is this field the shape the gate expects?"
// Keeping the readers separate keeps each check below to one idea.
// ---------------------------------------------------------------------

function isWholePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readImplied(row: RadarBoardRow): number {
  return row.implied_value_usd;
}

function readFarmSteps(row: RadarBoardRow): unknown {
  return row.farm_steps;
}

function rowsSortedByRank(board: RadarBoardRow[]): RadarBoardRow[] {
  return [...board].sort((left, right) => left.rank - right.rank);
}

function formatDollars(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

// ---------------------------------------------------------------------
// validateBoard
//
// Walks the whole board and returns every problem it finds, as plain
// sentences. An empty list means the board passed. The caller decides
// what a non-empty list means; this function never throws and never
// prints, so it can be reused by a test harness as well as by main.
// ---------------------------------------------------------------------

export function validateBoard(
  board: RadarBoardRow[],
  snapshot: RadarSnapshotView,
): string[] {
  const issues: string[] = [];

  if (!Array.isArray(board)) {
    return ["board is not an array of rows"];
  }

  if (board.length < MIN_BOARD_ROWS) {
    issues.push(
      `board has ${board.length} rows, fewer than the minimum of ${MIN_BOARD_ROWS}`,
    );
  }

  if (board.length > MAX_BOARD_ROWS) {
    issues.push(
      `board has ${board.length} rows, more than the maximum of ${MAX_BOARD_ROWS}`,
    );
  }

  if (board.length === 0) {
    return issues;
  }

  const knownSlugs = new Set(snapshot.protocols.map((entry) => entry.slug));
  const watchlist = snapshot.watchlist ?? [];
  const watchlistSet = new Set(watchlist);

  const seenSlugs = new Set<string>();
  const seenRanks = new Set<number>();
  const seenValues = new Set<number>();

  for (const row of board) {
    const label = isNonEmptyText(row?.slug) ? row.slug : "(row with no slug)";

    // Slug: present, one word, and a protocol the snapshot knows.
    if (!isNonEmptyText(row?.slug)) {
      issues.push(`row ${label}: slug is missing or empty`);
    } else if (SLUG_HAS_WHITESPACE.test(row.slug)) {
      issues.push(`row ${row.slug}: slug contains whitespace`);
    } else if (seenSlugs.has(row.slug)) {
      issues.push(`row ${row.slug}: slug appears more than once on the board`);
    } else {
      seenSlugs.add(row.slug);
    }

    if (isNonEmptyText(row?.slug) && !knownSlugs.has(row.slug)) {
      issues.push(`row ${row.slug}: slug is not in the snapshot's protocols`);
    }

    // Name: a reader must be able to see what the row is.
    if (!isNonEmptyText(row?.name)) {
      issues.push(`row ${label}: name is missing or empty`);
    }

    // Rank: a positive whole number, and no rank used twice.
    if (!isWholePositive(row?.rank)) {
      issues.push(`row ${label}: rank ${String(row?.rank)} is not a positive whole number`);
    } else if (seenRanks.has(row.rank)) {
      issues.push(`row ${label}: rank ${row.rank} appears more than once`);
    } else {
      seenRanks.add(row.rank);
    }

    // Implied value: a positive whole number inside the gate's cap.
    if (!isWholePositive(readImplied(row))) {
      issues.push(
        `row ${label}: implied value ${String(readImplied(row))} is not a positive whole number of dollars`,
      );
    } else {
      if (readImplied(row) > MAX_IMPLIED_VALUE_USD) {
        issues.push(
          `row ${label}: implied value ${formatDollars(readImplied(row))} is above the ${formatDollars(MAX_IMPLIED_VALUE_USD)} cap`,
        );
      }
      seenValues.add(readImplied(row));
    }

    // Farm steps: a list of the right length, with every step a
    // concrete sentence rather than a word or an essay.
    const steps = readFarmSteps(row);
    if (!Array.isArray(steps)) {
      issues.push(`row ${label}: farm_steps is not an array`);
      continue;
    }

    if (steps.length < MIN_FARM_STEPS || steps.length > MAX_FARM_STEPS) {
      issues.push(
        `row ${label}: farm_steps has ${steps.length} steps, outside the ${MIN_FARM_STEPS} to ${MAX_FARM_STEPS} range`,
      );
    }

    const seenSteps = new Set<string>();
    for (const step of steps) {
      if (typeof step !== "string") {
        issues.push(`row ${label}: a farm step is not a string`);
        continue;
      }
      const trimmed = step.trim();
      if (trimmed.length < MIN_STEP_CHARS) {
        issues.push(
          `row ${label}: a farm step is only ${trimmed.length} characters, shorter than the ${MIN_STEP_CHARS} minimum`,
        );
      }
      if (trimmed.length > MAX_STEP_CHARS) {
        issues.push(
          `row ${label}: a farm step is ${trimmed.length} characters, longer than the ${MAX_STEP_CHARS} maximum`,
        );
      }
      if (seenSteps.has(trimmed)) {
        issues.push(`row ${label}: the same farm step appears twice`);
      }
      seenSteps.add(trimmed);
    }
  }

  // Ranks must be exactly 1 through N, each used once. A gap or a
  // duplicate means the ordering the reader sees is not the ordering
  // the model claims.
  const expectedRanks = new Set<number>();
  for (let rank = 1; rank <= board.length; rank += 1) {
    expectedRanks.add(rank);
  }
  for (const rank of seenRanks) {
    if (!expectedRanks.has(rank)) {
      issues.push(`rank ${rank} is outside the 1 to ${board.length} range`);
    }
  }
  if (seenRanks.size !== board.length) {
    issues.push(
      `board has ${board.length} rows but only ${seenRanks.size} distinct ranks`,
    );
  }

  // Value order: walking down the ranks, the implied value must never
  // rise, and it must fall at least once. A board whose values never
  // fall is a list, not a ranking.
  const ordered = rowsSortedByRank(board);
  let fellAtLeastOnce = false;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = readImplied(ordered[index - 1]);
    const current = readImplied(ordered[index]);
    if (typeof previous === "number" && typeof current === "number") {
      if (current > previous) {
        issues.push(
          `implied value rises from rank ${ordered[index - 1].rank} (${formatDollars(previous)}) to rank ${ordered[index].rank} (${formatDollars(current)})`,
        );
      }
      if (current < previous) {
        fellAtLeastOnce = true;
      }
    }
  }
  if (ordered.length > 1 && seenValues.size === 1) {
    issues.push("every row has the same implied value, so the board ranks nothing");
  }
  if (ordered.length > 1 && !fellAtLeastOnce && seenValues.size > 1) {
    issues.push("implied value never falls as rank increases");
  }

  // Watchlist coverage: every slug the snapshot's watchlist names
  // must appear on the board. The missing ones are named, a few at a
  // time, so the message stays readable on a long board.
  const missingWatchlist = watchlist.filter((slug) => !seenSlugs.has(slug));
  if (missingWatchlist.length > 0) {
    const shown = missingWatchlist.slice(0, 5).join(", ");
    const extra = missingWatchlist.length > 5 ? ` and ${missingWatchlist.length - 5} more` : "";
    issues.push(
      `watchlist is not fully covered: missing ${missingWatchlist.length} slug(s): ${shown}${extra}`,
    );
  }

  // The watchlist is a floor, never the whole board: at least sixty
  // rows must name protocols outside it, or the radar found nothing
  // early at all.
  const outsideWatchlist = board.filter((row) => !watchlistSet.has(row.slug)).length;
  if (board.length >= MIN_BOARD_ROWS && outsideWatchlist < 60) {
    issues.push(
      `only ${outsideWatchlist} rows name protocols outside the watchlist, fewer than the 60 the board needs`,
    );
  }

  return issues;
}

// ---------------------------------------------------------------------
// summarizeBoard
//
// Boils a valid board down to the five numbers main.ts prints. The
// top row is the row at rank 1, found by rank rather than by array
// position, so a board stored in any order still summarises the same.
// ---------------------------------------------------------------------

export function summarizeBoard(
  board: RadarBoardRow[],
  snapshot?: RadarSnapshotView,
): RadarBoardSummary {
  if (!Array.isArray(board) || board.length === 0) {
    return { rows: 0, top: null, totalImplied: 0, watchlistCovered: 0, earlyCount: 0 };
  }

  const ordered = rowsSortedByRank(board);
  const top = ordered[0] ?? null;

  let totalImplied = 0;
  for (const row of board) {
    if (typeof readImplied(row) === "number" && Number.isFinite(readImplied(row))) {
      totalImplied += readImplied(row);
    }
  }

  let watchlistCovered = 0;
  if (snapshot && Array.isArray(snapshot.watchlist)) {
    const watchlistSet = new Set(snapshot.watchlist);
    for (const row of board) {
      if (watchlistSet.has(row.slug)) {
        watchlistCovered += 1;
      }
    }
  }

  const earlyCount = board.length - watchlistCovered;

  return {
    rows: board.length,
    top,
    totalImplied,
    watchlistCovered,
    earlyCount,
  };
}

// ---------------------------------------------------------------------
// formatSummary
//
// Turns a summary into the lines main.ts prints. The shape is fixed:
// one line per fact, in the same order every run, so two runs of the
// same snapshot print the same text.
// ---------------------------------------------------------------------

export function formatSummary(
  summary: RadarBoardSummary,
  snapshot?: RadarSnapshotView,
): string {
  const lines: string[] = [];
  lines.push(`Board rows: ${summary.rows}`);
  lines.push(`Watchlist covered: ${summary.watchlistCovered} of ${snapshot?.watchlist?.length ?? summary.watchlistCovered}`);
  lines.push(`Early rows (outside the watchlist): ${summary.earlyCount}`);
  lines.push(`Total implied value: ${formatDollars(summary.totalImplied)}`);

  if (summary.top) {
    lines.push(
      `Top row: ${summary.top.name} (${summary.top.slug}) at ${formatDollars(readImplied(summary.top))}`,
    );
  } else {
    lines.push("Top row: none — the board is empty");
  }

  return lines.join("\n");
}
