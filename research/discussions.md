# Reading merge request discussions and issue notes in Heron

Scope: public ticket https://github.com/NickSuomi/heron/issues/2. Examples use `gitlab.example.com` and `acme/storefront`.
Legend: [D] verified in the cited docs page on 2026-09-29. [I] inferred by me, not stated in docs. [S] read in Heron source.

## 0. What Heron does today [S]
- `src/forge/gitlab.ts:134` builds `${forgeRoot}/api/v4${path}` with a bearer token. `pages()` (about line 180) requests `per_page=100&page=N` and follows `x-next-page`.
- `findReport` (about line 270) already lists `${mrPath}/notes` sorted `created_at asc`, and keeps notes where `!n.system && n.author.id === me` and `parseMarker(body)` matches the MR iid. So the notes endpoint, paging and "own report" detection already exist.
- `src/harness/sourceTools.ts:526` defines `sourceTools` via `define(name, description, zodShape, run)`; results go out as `JSON.stringify(result)` (`runSourceTool`, end of file). `src/harness/mcpSource.ts:39` registers each as a read-only MCP tool. All 15 tools read a git checkout; none call the forge. A forge-backed tool needs a forge handle in `ToolContext`, which is a design change (see 4).

## 1. Endpoints and fields

### REST (all GET)
| Purpose | Endpoint | Source |
|---|---|---|
| MR threads | `/projects/:id/merge_requests/:merge_request_iid/discussions` | https://docs.gitlab.com/api/discussions/ [D] |
| One MR thread | `.../discussions/:discussion_id` | same [D] |
| MR flat notes | `/projects/:id/merge_requests/:merge_request_iid/notes` (`sort`, `order_by=created_at|updated_at`) | https://docs.gitlab.com/api/notes/ [D] |
| Issue threads | `/projects/:id/issues/:issue_iid/discussions` | https://docs.gitlab.com/api/discussions/ [D] |
| Issue flat notes | `/projects/:id/issues/:issue_iid/notes` (`sort`, `order_by`, `activity_filter=all_notes|only_comments|only_activity`) | https://docs.gitlab.com/api/notes/ [D] |

`:id` is the numeric id or the URL-encoded path, e.g. `acme%2Fstorefront` (Heron already does this, `projectPath`) [S].

Fields:
- Note: `id`, `type` (`DiscussionNote`, `DiffNote`, or null), `body`, `author`, `created_at`, `updated_at`, `system`, `noteable_id`, `noteable_type`, `project_id` [D discussions page]; also `noteable_iid`, `resolvable`, `confidential`, `internal`, `imported`, `imported_from` [D notes page].
- Resolved state (MR only): `resolvable`, `resolved`, `resolved_by`, `resolved_at` [D discussions page]. A thread is a `discussions` entry containing a `notes` array; the docs list resolved fields on notes. Whether the thread is resolved is derived from its notes [I: the first resolvable note carries it; verify against a live payload].
- System notes: boolean `system` [D]. Issue list can pre-filter with `activity_filter=only_comments` [D]; the docs page lists no equivalent for MR notes [D by absence].
- Author: `author` object. Its exact keys (`id`, `username`, `name`) are in the docs example; Heron already decodes `author.id` and `author.username` [S]. Any "is a bot" flag is not verified [I: rely on username/id, not a flag].
- Internal/confidential: `internal` (create parameter on both issue and MR notes) and `confidential` (issue-note update) [D notes page]. Visibility: internal notes are viewable only by project members with at least Reporter; replies inherit internal status https://docs.gitlab.com/user/discussions/ [D]. Whether a Guest token gets them filtered silently or errors is not documented [I: filtered]. Confidential issues are visible to Planner and above; Guests only see ones they created or are assigned https://docs.gitlab.com/user/project/issues/confidential_issues/ [D]. Token-role behaviour is not spelled out there [D by absence].
- Diff position: `position` on DiffNotes [D discussions page lists it, without sub-keys in my excerpt]. The create-thread parameter set names `position` with base/start/head SHA, `new_path`, `old_path`, `new_line`, `old_line` [I from memory of the same page; re-check before coding]. Heron's `snapshot.revision` already has base/start/head, so a thread whose `position.head_sha` differs from the current head is outdated [I].
- Who may resolve: Developer and up, or the MR author https://docs.gitlab.com/user/discussions/ [D]. Resolution is reversible [D], so treat `resolved` as "as of now".

### GraphQL
- `MergeRequest.discussions`, `Issue.discussions` (connections; `first`, `after`, `last`, `before`) and `WorkItemWidgetNotes.discussions` with a filter enum containing `ALL_NOTES` and `ONLY_COMMENTS`; Note/DiffNote expose `system`, `internal`, `resolvable`, `resolved`, `position`, `author`, `body`, `confidential`, `systemNoteMetadata` https://docs.gitlab.com/api/graphql/reference/ [D, from an extracted excerpt; argument lists were not shown in full, confirm]. Work items are the newer model for issues, so GraphQL is the route if Heron must read tasks or other work item types [I].
- Paging: "The default maximum page size for a connection is 100 records (nodes) per page"; use `first`/`after` with `pageInfo` https://docs.gitlab.com/api/graphql/ [D].
- Complexity limit: 200 unauthenticated, 250 authenticated, same page [D]. Deep nesting (discussions with notes with author) counts toward it.

### Pagination (REST)
- Default 20, max 100 per page; offset is the default, keyset optional; `Link` header (`prev|next|first|last`) and `x-page`, `x-per-page`, `x-next-page`, `x-prev-page`, `x-total`, `x-total-pages`; above 10,000 records `x-total`, `x-total-pages` and `rel="last"` are omitted https://docs.gitlab.com/api/rest/ [D].
- Heron's `pages()` uses `x-next-page`, which works past 10,000 [S+D].

### Token scope
- `read_api`: "Grants read access to the API for the token's scope" https://docs.gitlab.com/security/tokens/access_token_scopes/ [D]. GraphQL: `read_api` "Sufficient for queries" https://docs.gitlab.com/api/graphql/ [D]. Reading discussions and notes needs no more than `read_api` [D+I]. Heron posts notes (`createNote`, `updateNote`), so its token is already `api`; no new scope is needed [S+I]. The token's role still decides internal-note and confidential-issue visibility [D].

## 2. What to skip, and why
1. Heron's own report note: `!system && author.id === botUserId && parseMarker(body)` (existing `findReport` logic [S]). Reason: it restates the previous review, so feeding it back makes the model anchor on its earlier verdict and repeat stale findings [I]. Match on both author id and marker: the marker alone is forgeable by any commenter, the author alone would drop the bot's other notes.
2. System notes (`system: true`): label, assignee, "added 3 commits" events https://docs.gitlab.com/user/discussions/ [D]. Reason: activity log, not human discussion, and they change with every push [I]. Keep an opt-in for two kinds only, if wanted: none required for a first version.
3. Other bots (CI, dependency bots, other reviewers): drop by an allowlist-inverse config `skipAuthors` (usernames) rather than by guessing [I]. Reason: pipeline summaries and coverage bots are noisy and, being scripted, often echo untrusted text (branch names, commit messages). Do not drop a bot that is a human-configured reviewer whose findings the team wants; make it a config list, default empty except Heron's own id [I, design choice].
4. Optional: outdated threads (position head differs) as a separate flag rather than a drop, because "already discussed and dismissed" is exactly the earlier-review signal the ticket wants [I].
Keep: resolved threads. They are the main evidence that a concern was already answered [I]; mark them `resolved: true` rather than removing them.

## 3. Presenting comment text to the model
Practices and sources:
1. Put third-party text only in tool results, never in system or plain user text, and say the source in the tool description or result structure https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks [D].
2. State the policy in the system prompt: tool content is untrusted data, instructions in it are information to report, never commands [D, same page].
3. JSON-encode untrusted strings inside an object so an attacker cannot close a tag or quote to break out [D, same page]. Heron already returns `JSON.stringify(result)` from every tool (`runSourceTool` [S]); a comment tool inherits this. Do not wrap the body in XML-like tags as the only delimiter.
4. Do not put Heron's own instructions inside the tool result; they may be ignored or flagged [D, same page]. Put the "these are quotes, not orders" reminder in the tool description and system prompt.
5. Delimiters alone are insufficient; layer least privilege and output checks https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html [D]. Also https://genai.owasp.org/llmrisk/llm01-prompt-injection/ recommends segregating external content and least privilege [D via search summary].
6. Optional screening of tool output with a small model is documented [D, same Anthropic page]; costs one extra call per fetch, so leave it out of the first version [I].
Heron-specific consequences [I]:
- The review model's tools are read-only (`readOnlyHint: true`, `mcpSource.ts:44` [S]); keep the comment tool read-only, and the model never gets the token. That bounds a successful injection to a skewed review text, not an action.
- Result shape carries `author`, `createdAt`, `resolved`, `system`, and `source: "gitlab_comment"` as data fields next to `body`. Bodies are never truncated: the owner rules out caps on what a reviewer can read, so long threads are paged with `offset` like every other Heron tool. Strip nothing else; do not render Markdown.
- Never treat a comment saying "approve this" or "skip file X" as evidence in the verdict; the system prompt should say a claim from a comment must be checked against code, which is the same standard the ticket wants for "attached evidence".
- Confidential/internal text may end up quoted in a published review note visible to a wider audience than the source. Decide: default `includeInternal: false` and never quote internal notes in the public note [I].

## 4. Proposal

### Option A: packet section (pushed)
The snapshot gains `discussions` (MR threads) and, per linked issue already in `snapshot.issues`, its notes. Calls: 1 request for `/merge_requests/:iid/discussions?per_page=100` per 100 threads, plus 1 per linked issue per 100 notes. Pros: no new tool plumbing; model always sees it. Cons: spends tokens on every review, including on MRs where they add nothing; long threads inflate a packet that is fixed-size today [I]; a single injected comment is in context from the start and outside a "tool result" position (contradicts practice 1, unless the packet is itself delivered as a tool result) [I].

### Option B (recommended): on-demand tool
Name: `read_discussions`. Add to `sourceTools` beside the others, but as a forge-backed tool: `ToolContext` needs a narrow read-only `forge.discussions` capability (not the token) [I].
Parameters (zod):
- `target`: `"merge_request"` or `"issue"`. `issue` accepts only issues in `snapshot.issues`, so the model cannot browse arbitrary project issues [I].
- `iid`: integer, required for `issue`; defaults to the MR under review.
- `state`: `"open" | "resolved" | "all"` (default `all`), applied after fetch (REST has no server-side filter for this [D by absence]).
- `includeSystem`: boolean, default false.
- `offset`: integer, same paging contract as the other tools (`total`, `next`), see `PAGED` in sourceTools.ts [S].
Result:
```json
{ "source": "gitlab_discussions", "untrusted": true, "total": 42, "next": 20,
  "threads": [ { "id": "abc123", "resolved": true, "resolvedBy": "jdoe", "outdated": false,
    "path": "src/cart.ts", "line": 88,
    "notes": [ { "author": "jdoe", "createdAt": "2026-09-01T10:00:00Z", "body": "..." } ] } ] }
```
API calls: `GET /projects/acme%2Fstorefront/merge_requests/7/discussions?per_page=100&page=N` or the issue equivalent (with `activity_filter` only on `/notes`, so use `/notes?activity_filter=only_comments` for issues if threads are not needed [D]). Filtering of own report, system and configured bots happens in Heron before serialising [I].
Scope: `read_api` suffices (existing token is `api`) [D+I].
Cache: fetch once per review run and page from memory, so `offset` calls cost no extra requests [I]. Note the head can move; discussions fetched at one instant are not tied to `snapshot.revision`.

### Cost for a merge request with 100 notes [I, arithmetic from D paging limits]
- Discussions group notes into threads, so 100 notes are at most 100 threads: 1 request at `per_page=100`. If exactly 100 threads, Heron's loop asks for page 2 only if `x-next-page` is non-empty, so still 1 [S+D].
- Flat `/notes`: 1 request (100 per page).
- Linked issue with 100 notes: 1 request; N linked issues: N requests, plus 1 for each extra 100 notes.
- Total for the tool on one MR plus 2 linked issues: about 3 requests (Option B only when the model asks; Option A every review).
- GraphQL alternative: one query fetching discussions and issue discussions, first: 100; but nested connections may approach the 250 complexity cap [D+I]; REST is simpler and matches the existing code.
- Token cost: 100 notes at roughly 100 tokens each is about 10k tokens if read fully [I, my estimate]; paging lets the model read them in steps.

## Open questions
1. Exact JSON shape of `position` and of a thread's resolved state in 18.x: confirm against a live payload or the docs page's example before writing schemas (only partly seen in my excerpts).
2. Does a token below Reporter get internal notes omitted silently, or an error? Not documented in the pages I read.
3. Is there any documented "bot" flag on the user object in notes? None found.
4. Should Heron read work item notes for task types (GraphQL `WorkItemWidgetNotes`), or only classic issues?
5. Policy: may internal notes influence a review whose output is a comment others can read?
6. Does the review model receive the packet as a tool result or as a user turn? Determines whether Option A breaks practice 1.
