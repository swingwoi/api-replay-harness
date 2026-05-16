# api-replay-harness

Record HTTP traffic against one endpoint, replay it against another, and
report only the diffs that matter. Useful when migrating an API to a new
host, rewriting a service, or verifying that a behaviour-preserving refactor
actually preserved behaviour.

Small on purpose: two scripts (record, replay), one diff engine, no
runtime dependencies beyond Node's built-in `fetch`.

## Install

Requires Node 18+.

```bash
git clone https://github.com/swingwoi/api-replay-harness.git
cd api-replay-harness
npm install
npm run build
```

## Quick start

1. Write the requests you want to capture into `inputs.jsonl`, one per line:

   ```json
   {"name":"list-orders","method":"GET","pathAndQuery":"/v1/orders?limit=10"}
   {"name":"get-order","method":"GET","pathAndQuery":"/v1/orders/ord_001"}
   {"name":"create-order","method":"POST","pathAndQuery":"/v1/orders","body":{"total":2500}}
   ```

2. Record against the live (or staging) endpoint:

   ```bash
   npm run record -- \
     --base https://api.old.example.com \
     --requests inputs.jsonl \
     --out recording.jsonl
   ```

3. Replay against the new endpoint and inspect diffs:

   ```bash
   npm run replay -- \
     --base https://api.new.example.com \
     --recording recording.jsonl
   ```

4. Suppress noisy fields (timestamps, server-side IDs) that you know are
   allowed to differ:

   ```bash
   npm run replay -- \
     --base https://api.new.example.com \
     --recording recording.jsonl \
     --ignore-paths "data.timestamp,meta.request_id"
   ```

5. Wire into CI:

   ```bash
   npm run replay -- --base ... --recording ... --fail-on status
   ```

## What gets reported

- **Status diffs.** A request that returned `200` against the old endpoint
  but returns `500` against the new one. Always reported.
- **Body diffs.** Deep structural comparison of JSON response bodies. Paths
  use dotted notation (`data.items[3].id`). Arrays compare positionally and
  length is reported as its own diff. Use `--ignore-paths` for fields you
  know are intentionally non-deterministic.
- **Header diffs.** Currently watches `content-type`, `cache-control`,
  `etag` only. The intent is to catch format regressions, not to compare
  every header.

A summary line at the end tells you how many exchanges were clean and how
many had diffs.

## Example output

```text
list-orders
───────────
  body    data[0].status: expected "paid", got "PAID"
  body    meta.next_cursor: expected "ord_002", got "ord_003"

get-missing-order
─────────────────
  status: expected 404, got 410

1/3 clean. 2 have diffs.
```

## File format

`inputs.jsonl` for `record`:

```typescript
{
  name?: string;           // optional, for diff labelling
  method: string;          // "GET" | "POST" | ...
  pathAndQuery: string;    // "/v1/orders?limit=10"
  headers?: Record<string, string>;
  body?: unknown;          // string or JSON-serializable
}
```

`recording.jsonl` (output of `record`, input of `replay`):

```typescript
{
  name: string;
  request: { method, pathAndQuery, headers?, body? };
  response: { status, headers?, body? };
  recordedAt: string;      // ISO timestamp
}
```

You can also hand-write a `recording.jsonl` if you already have captures
from another tool. See `examples/sample-recording.jsonl`.

## Limitations

- HTTP only. Streaming responses are read fully into memory. Don't point
  this at GB-scale endpoints.
- Body comparison is structural, not semantic. If your API legitimately
  reorders unordered JSON arrays between deploys, this tool will flag
  every reorder as a diff. Add an explicit canonicaliser upstream or use
  `--ignore-paths` to suppress.
- Authentication has to be encoded in the request headers manually (or
  via `--header-file`). The tool does not handle OAuth dances or session
  cookies on your behalf.
- This is a regression harness, not a load test. It runs requests serially.

## License

MIT. See [`LICENSE`](LICENSE).
