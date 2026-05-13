#!/usr/bin/env node
// record.ts — issue a list of requests against a base URL and append each
// exchange (request + response) to a JSONL file.
//
// Usage:
//   node dist/record.js --base https://api.old.example.com --requests inputs.jsonl --out recording.jsonl
//
// `inputs.jsonl` is one JSON object per line. Minimum shape:
//   {"name": "list-orders", "method": "GET", "pathAndQuery": "/orders?limit=10"}
// Optional fields: "headers", "body".

import { readFileSync, appendFileSync, existsSync, unlinkSync } from "node:fs";
import { argv, exit } from "node:process";
import type { RecordedExchange, RecordedRequest } from "./types.js";

interface Args {
  base: string;
  requests: string;
  out: string;
  headerFile?: string;
}

function parseArgs(): Args {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        console.error(`error: --${key} requires a value`);
        exit(2);
      }
      out[key] = value;
      i++;
    }
  }
  for (const required of ["base", "requests", "out"]) {
    if (!out[required]) {
      console.error(
        "usage: record --base <url> --requests <file.jsonl> --out <file.jsonl> [--header-file <file.json>]",
      );
      exit(2);
    }
  }
  return out as unknown as Args;
}

function loadRequests(path: string): RecordedRequest[] {
  const text = readFileSync(path, "utf-8");
  const out: RecordedRequest[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      console.error(`error: line ${i + 1} is not valid JSON: ${(e as Error).message}`);
      exit(2);
    }
  }
  return out;
}

async function parseResponseBody(res: Response): Promise<unknown> {
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
  const requests = loadRequests(args.requests);

  let extraHeaders: Record<string, string> = {};
  if (args.headerFile) {
    extraHeaders = JSON.parse(readFileSync(args.headerFile, "utf-8"));
  }

  if (existsSync(args.out)) {
    unlinkSync(args.out);
  }

  let ok = 0;
  let fail = 0;

  for (const req of requests) {
    const url = `${args.base.replace(/\/+$/, "")}${req.pathAndQuery}`;
    const headers = { ...extraHeaders, ...(req.headers ?? {}) };
    const init: RequestInit = {
      method: (req.method || "GET").toUpperCase(),
      headers,
    };
    if (req.body !== undefined && init.method !== "GET" && init.method !== "HEAD") {
      init.body =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (!headers["content-type"] && !headers["Content-Type"]) {
        (init.headers as Record<string, string>)["content-type"] =
          "application/json";
      }
    }

    let exchange: RecordedExchange;
    try {
      const res = await fetch(url, init);
      const body = await parseResponseBody(res);
      const respHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        respHeaders[k] = v;
      });
      exchange = {
        name: (req as RecordedRequest & { name?: string }).name ??
          `${init.method} ${req.pathAndQuery}`,
        request: req,
        response: { status: res.status, headers: respHeaders, body },
        recordedAt: new Date().toISOString(),
      };
      ok++;
    } catch (e) {
      exchange = {
        name: (req as RecordedRequest & { name?: string }).name ??
          `${init.method} ${req.pathAndQuery}`,
        request: req,
        response: { status: 0, headers: {}, body: `error: ${(e as Error).message}` },
        recordedAt: new Date().toISOString(),
      };
      fail++;
    }
    appendFileSync(args.out, JSON.stringify(exchange) + "\n");
  }

  console.log(`recorded ${ok} ok, ${fail} fail to ${args.out}`);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
