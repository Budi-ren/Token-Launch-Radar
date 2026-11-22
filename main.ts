// Token launch radar: read a sealed snapshot, rank its protocols by
// what a launch would be worth, and write the dashboard's files.
//
// Run it from this repository's root, for example:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts \
//     --input ../token-radar-01-kit/input/snapshot.json
//
// The snapshot is the only input. The program reads it, scores it with
// the model, checks the board it produced, and only then writes
// anything. A run that fails a check writes nothing and says why, so a
// broken board never reaches the dashboard.
//
// The output directory holds board.json, the dashboard's data file, a
// copy of dashboard/ and screenshots/, and dossier.json, written last.
// The dossier is built from the files already in the output directory,
// so it must be the final write of the run.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { boardIssue, buildRadar, dataScript, parseSnapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";
import { formatSummary, summarizeBoard, validateBoard } from "./lib/validate.ts";

// The dossier's text budget and the caps the gate applies to the
// screenshots and the dashboard files. These are the gate's numbers,
// kept in one place so a change to them is a one-line change.
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAP = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAP = { max_files: 400, max_bytes: 4_194_304 };

// How many screenshots a run must find before it writes anything.
const MIN_SCREENSHOTS = 3;

// The snapshot's default home, used when no --input flag is given.
// In the grading sandbox the snapshot sits at this path; locally the
// caller usually passes --input instead.
const DEFAULT_INPUT = "/input/snapshot.json";

// The output directory's default home, used when neither --output nor
// the environment names one.
const DEFAULT_OUTPUT = "/output";

// The folder this file lives in: the repository root, where dashboard/
// and screenshots/ sit beside main.ts.
const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

// A small failure type so the top of the program can print a plain
// message and exit without a stack trace for an expected problem.
class RadarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RadarError";
  }
}

// ---------------------------------------------------------------------
// Command line
//
// Accepted flags, each with a value:
//   --input <path>    snapshot file, or a directory holding snapshot.json
//   --output <path>   output directory
// Either flag also accepts the --flag=value spelling. Anything else on
// the command line is refused, so a typo cannot silently change a run.
// ---------------------------------------------------------------------

interface RunOptions {
  inputPath: string | null;
  outputPath: string | null;
}

function parseCommandLine(argv: string[]): RunOptions {
  const options: RunOptions = { inputPath: null, outputPath: null };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const [flag, inlineValue] = token.split("=", 2);

    const takeValue = (name: string): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = argv[index + 1];
      if (next === undefined) {
        throw new RadarError(`missing a value after ${name}`);
      }
      index += 1;
      return next;
    };

    if (flag === "--input") {
      options.inputPath = takeValue("--input");
    } else if (flag === "--output") {
      options.outputPath = takeValue("--output");
    } else {
      throw new RadarError(`unknown argument: ${token} (expected --input or --output)`);
    }
  }

  return options;
}

// Resolve the snapshot's location. A directory means its snapshot.json;
// a missing file is reported with the exact path that was looked for,
// so the caller can see whether the path or the file is wrong.
function resolveSnapshotPath(given: string | null): string {
  const candidate = given ?? DEFAULT_INPUT;
  const absolute = resolve(candidate);

  if (!existsSync(absolute)) {
    throw new RadarError(
      `snapshot not found: ${absolute} — pass --input <snapshot file or directory>`,
    );
  }

  const info = statSync(absolute);
  if (info.isDirectory()) {
    const inside = join(absolute, "snapshot.json");
    if (!existsSync(inside)) {
      throw new RadarError(
        `snapshot not found: ${inside} — the directory holds no snapshot.json`,
      );
    }
    return inside;
  }

  if (!info.isFile()) {
    throw new RadarError(`snapshot path is neither a file nor a directory: ${absolute}`);
  }

  return absolute;
}

// Resolve the output directory: the --output flag wins, then the
// MAKEFUN_OUTPUT_DIR environment variable, then the default.
function resolveOutputPath(given: string | null): string {
  const candidate = given ?? process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUTPUT;
  return resolve(candidate);
}

// ---------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------

// Copy a whole directory into the output tree, refusing a missing
// source with a plain message instead of a filesystem error.
function copyTree(source: string, destination: string, label: string): void {
  if (!existsSync(source)) {
    throw new RadarError(`${label} not found: ${source}`);
  }
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}

// The image files in a directory, sorted by name, so the count and the
// order are the same on every run.
function imageFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .sort();
}

// ---------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------

function run(): void {
  const options = parseCommandLine(process.argv.slice(2));
  const snapshotPath = resolveSnapshotPath(options.inputPath);
  const outputDir = resolveOutputPath(options.outputPath);

  const snapshotText = readFileSync(snapshotPath, "utf8");
  const snapshot = parseSnapshot(snapshotText);

  const { board, radar } = buildRadar(snapshot);

  // The model's own gate comes first: if it objects to the board, the
  // run stops here and nothing is written.
  const modelIssue = boardIssue(board, snapshot);
  if (modelIssue !== null) {
    throw new RadarError(`board rejected by the model check: ${modelIssue}`);
  }

  // Then this entry's own board checks: descending values, full
  // watchlist coverage, and a farm plan of the right shape on every
  // row. A board that fails any of them is listed, all of it, so one
  // run shows every problem instead of one at a time.
  const boardIssues = validateBoard(board, snapshot);
  if (boardIssues.length > 0) {
    throw new RadarError(
      `board failed validation (${boardIssues.length} issue(s)):\n` +
        boardIssues.map((issue) => `  - ${issue}`).join("\n"),
    );
  }

  const summary = summarizeBoard(board, snapshot);

  // Screenshots are counted before anything is written, so a run
  // short of images fails cleanly instead of half-writing an output.
  const screenshotDir = join(REPO_ROOT, "screenshots");
  const screenshots = existsSync(screenshotDir) ? imageFiles(screenshotDir) : [];
  if (screenshots.length < MIN_SCREENSHOTS) {
    throw new RadarError(
      `only ${screenshots.length} screenshot(s) in ${screenshotDir}, need at least ${MIN_SCREENSHOTS}`,
    );
  }

  // All checks passed: write the output, in this order, so the dossier
  // — built from the files already written — is always last.
  mkdirSync(outputDir, { recursive: true });

  const boardDocument = { rows: board };
  writeFileSync(join(outputDir, "board.json"), `${JSON.stringify(boardDocument, null, 2)}\n`, "utf8");

  writeFileSync(join(outputDir, "data.js"), dataScript(radar), "utf8");

  copyTree(join(REPO_ROOT, "dashboard"), join(outputDir, "dashboard"), "dashboard");
  copyTree(screenshotDir, join(outputDir, "screenshots"), "screenshots");

  const dossierBytes = buildDossier(outputDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAP,
    dashboard: DASHBOARD_CAP,
  });
  writeFileSync(join(outputDir, "dossier.json"), Buffer.from(dossierBytes));

  // The summary, printed once, in the same shape on every run.
  const protocolCount = snapshot.protocols.length;
  const watchlistCount = snapshot.watchlist.length;
  console.log(
    `Token launch radar: ${protocolCount} protocols, ${watchlistCount} on the watchlist, ${summary.rows} board rows written to ${outputDir}`,
  );
  console.log(formatSummary(summary, snapshot));
}

// The top level: a RadarError is an expected failure, printed plainly;
// anything else is unexpected, and its stack is worth seeing.
try {
  run();
} catch (error) {
  if (error instanceof RadarError) {
    console.error(`error: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
