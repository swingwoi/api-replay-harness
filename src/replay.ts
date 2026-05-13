#!/usr/bin/env node
// replay.ts — replay a recorded JSONL of exchanges against a different base URL
// and report only the diffs that matter.
//
// Usage:
//   node dist/replay.js --base https://api.new.example.com --recording recording.jsonl
//   node dist/replay.js --base https://api.new.example.com --recording recording.jsonl --ignore-paths "data.timestamp,meta.request_id"
//   node dist/replay.js --base https://api.new.example.com --recording recording.jsonl --format json > diffs.json

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { buildIgnoreSet, diffJson } from "./diff.js";
import type {
  DiffReport,
  HeaderDiff,
  RecordedExchange,
} from "./types.js";

interface Args {
  base: string;
  recording: string;
  ignorePaths?: string;
  format: "text" | "json";
  failOn: "any" | "status" | "never";
}

function parseArgs(): Args {
  const out: Record<string, string> = { format: "text", failOn: "any" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = camel(a.slice(2));
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        console.error(`error: --${a.slice(2)} requires a value`);
        exit(2);
      }
      out[key] = value;
      i++;
    }
  }
  for (const required of ["base", "recording"]) {
    if (!out[required]) {
      console.error(
        "usage: replay --base <url> --recording <file.jsonl> [--ignore-paths <a,b,c>] [--format text|json] [--fail-on any|status|never]",
      );
      exit(2);
    }
  }
  if (out.format !== "text" && out.format !== "json") {
    out.format = "text";
  }
  return out as unknown as Args;
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function loadRecording(path: string): RecordedExchange[] {
  const text = readFileSync(path, "utf-8");
  const out: RecordedExchange[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t) out.push(JSON.parse(t));
  }
  return out;
}

function diffHeaders(
  recorded: Record<string, string> | undefined,
  actual: Record<string, string> | undefined,
  watch: string[],
): HeaderDiff[] {
  const out: HeaderDiff[] = [];
  for (const name of watch) {
    const expected = recorded?.[name];
    const got = actual?.[name];
    if (expected !== got) {
      out.push({ name, expected, actual: got });
    }
  }
  return out;
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return await res.text();
}

async function main(): Promise<void> {
  const args = parseArgs();
  const ignorePaths = buildIgnoreSet(
    (args.ignorePaths ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const watchedHeaders = ["content-type", "cache-control", "etag"];
  const recording = loadRecording(args.recording);

  const reports: DiffReport[] = [];

  for (const ex of recording) {
    const url = `${args.base.replace(/\/+$/, "")}${ex.request.pathAndQuery}`;
    const init: RequestInit = {
      method: ex.request.method,
      headers: ex.request.headers ?? {},
    };
    if (
      ex.request.body !== undefined &&
      ex.request.method !== "GET" &&
      ex.request.method !== "HEAD"
    ) {
      init.body =
        typeof ex.request.body === "string"
          ? ex.request.body
          : JSON.stringify(ex.request.body);
    }

    let actualStatus = 0;
    let actualBody: unknown = null;
    let actualHeaders: Record<string, string> = {};
    try {
      const res = await fetch(url, init);
      actualStatus = res.status;
      res.headers.forEach((v, k) => {
        actualHeaders[k] = v;
      });
      actualBody = await parseBody(res);
    } catch (e) {
      actualBody = `error: ${(e as Error).message}`;
    }

    const bodyDiffs = diffJson(
      ex.response.body,
      actualBody,
      ignorePaths,
    );
    const headerDiffs = diffHeaders(
      ex.response.headers,
      actualHeaders,
      watchedHeaders,
    );

    reports.push({
      exchange: ex.name,
      statusMatch: actualStatus === ex.response.status,
      recordedStatus: ex.response.status,
      actualStatus,
      bodyDiffs,
      headerDiffs,
    });
  }

  if (args.format === "json") {
    console.log(JSON.stringify({ count: reports.length, reports }, null, 2));
  } else {
    printText(reports);
  }

  const anyDiff = reports.some(
    (r) => !r.statusMatch || r.bodyDiffs.length > 0 || r.headerDiffs.length > 0,
  );
  const anyStatus = reports.some((r) => !r.statusMatch);

  if (args.failOn === "any" && anyDiff) exit(1);
  if (args.failOn === "status" && anyStatus) exit(1);
}

function printText(reports: DiffReport[]): void {
  let cleanCount = 0;
  for (const r of reports) {
    const clean =
      r.statusMatch && r.bodyDiffs.length === 0 && r.headerDiffs.length === 0;
    if (clean) {
      cleanCount++;
      continue;
    }
    console.log(`\n${r.exchange}`);
    console.log("─".repeat(Math.min(80, r.exchange.length)));
    if (!r.statusMatch) {
      console.log(`  status: expected ${r.recordedStatus}, got ${r.actualStatus}`);
    }
    for (const h of r.headerDiffs) {
      console.log(`  header  ${h.name}: expected ${h.expected ?? "(none)"}, got ${h.actual ?? "(none)"}`);
    }
    for (const b of r.bodyDiffs) {
      console.log(`  body    ${b.path}: expected ${fmt(b.expected)}, got ${fmt(b.actual)}`);
    }
  }
  console.log(`\n${cleanCount}/${reports.length} clean. ${reports.length - cleanCount} have diffs.`);
}

function fmt(v: unknown): string {
  if (v === undefined) return "(missing)";
  const s = JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 57) + "..." : s;
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
