# Escaping model text for a GitLab note: what is needed, what is not

Ticket: https://github.com/NickSuomi/heron/issues/5
Subject: `plainLine` in `src/report.ts` (every ASCII punctuation character gets a backslash and a word joiner U+2060) and the adversarial cases in `test/report-render.test.ts`.
Date of research: 2026-09-29. Examples use `gitlab.example.com`.

Legend. **[V]** verified: read in a primary source, or reproduced by running code (stated which). **[I]** inferred: follows from sources but not observed. Where a claim is verified by running code, the code was upstream comrak 0.48.0-rc.0 (WASM) with GitLab's option set, plus a hand-written model of GitLab's text-node filters (see "How the rule was checked"). It was not a GitLab instance.

## 0. The finding that changes the design

GitLab renders notes in two stages. First a Markdown parser produces HTML. Then "reference filters", the emoji filter and the inline-diff filter rewrite the plain text nodes of that HTML.

1. **Backslash alone does not stop a reference in a generic Markdown parser.** After CommonMark turns `\@all` into the text `@all`, a filter that scans text nodes sees `@all`. That is why the current code adds a joiner. **[V]** CommonMark: backslash-escaped punctuation becomes literal text, https://spec.commonmark.org/0.31.2/#backslash-escapes . The reference filters scan text nodes outside `pre code a style`: https://github.com/gitlabhq/gitlabhq/blob/master/lib/banzai/filter/references/reference_filter.rb (`ignore_ancestor_query`, `query`).
2. **GitLab's current parser closes that hole for the reference characters.** GitLab's Markdown engine is the comrak-based gem, configured with `escaped_char_spans: true` and `only_escape_chars: REFERENCE_CHARS` where `REFERENCE_CHARS = %w[$ % # & @ ! ~ ^ :]`, commented "the GitLab special reference characters". **[V]** https://github.com/gitlabhq/gitlabhq/blob/master/lib/banzai/filter/markdown_engines/glfm_markdown.rb . Comrak's `escaped_char_spans` renders `\@` as `<span data-escaped-char>@</span>`, which splits the text node. **[V]** https://docs.rs/comrak/latest/comrak/options/struct.Render.html#structfield.escaped_char_spans (example `Notify user \\@example` -> `<span data-escaped-char>@</span>example`) and the same example in https://github.com/kivikakk/comrak/blob/main/src/options.rs . I reproduced the split by running it.
3. The public GitLab documentation says the same at user level: "If you don't want #123 to link to an issue, add a leading backslash `\#123`." **[V]** https://docs.gitlab.com/user/markdown/#gitlab-specific-references .
4. **[I]** `only_escape_chars` is a GitLab fork option (it is absent from upstream comrak `main`, checked by grep of `src/`). I read it as "only these characters get a span; other escapes stay plain merged text". The option name and comment say this; I could not read the fork's Rust. Consequence: a backslash in front of any character *outside* the nine (for example `[`, `-`, `.`, `>`, `*`) leaves plain, mergeable text. The verification harness models exactly that, and the design below relies only on this reading.
5. **[I]** Older self-managed GitLab (before this engine) is not covered by what I could read; the mirror has no pre-escape filter file to check (`lib/banzai/filter/markdown_pre_escape_filter.rb` returns 404 on the mirror). If the target instance is older, keep the joiner for the nine characters as a fallback (open question 1).

Consequence for the rule: for `$ % # & @ ! ~ ^ :` a backslash is enough and the joiner is dead weight. Joiners are needed only for the few reference shapes that contain no character in that list.

## 1. What can open a Markdown construct in a GitLab note

GitLab Flavored Markdown = CommonMark + GFM + GitLab extensions. Parser options in use: https://github.com/gitlabhq/gitlabhq/blob/master/lib/banzai/filter/markdown_engines/glfm_markdown.rb (autolink, relaxed_autolinks, footnotes, description_lists, alerts, math_code, math_dollars, multiline_block_quotes, table, strikethrough, tasklist, wikilinks_title_before_pipe, placeholder_detection, `unsafe: true` raw HTML). **[V]** for the option list. Not enabled: superscript, highlight, insert, subscript, spoiler, greentext, front-matter-in-notes.

"Line start" below means the first character of a block's content: the start of an output line, and also the start of the text after a list marker `- ` that Heron writes. Up to 3 spaces of indent are allowed before block markers, and Heron trims lines, so leading whitespace is out of scope. Text after an inline code span in the same line is **not** a line start.

### Block level (position: line start)

| Construct | Opens with | Source |
|---|---|---|
| ATX heading | `#`..`######` then space, tab or end of line | https://spec.commonmark.org/0.31.2/#atx-headings **[V]** |
| Setext heading / thematic break | a line made only of `=` or `-` (setext underline); `***`, `---`, `___` (with optional spaces) | https://spec.commonmark.org/0.31.2/#setext-headings , https://spec.commonmark.org/0.31.2/#thematic-breaks **[V]** |
| Bullet list, task list | `-`, `+` or `*` followed by space/tab/end of line; task item is `[ ]` after the marker | https://spec.commonmark.org/0.31.2/#lists , https://github.github.com/gfm/#task-list-items-extension- **[V]** |
| Ordered list | 1-9 digits then `.` or `)` then space/end of line | https://spec.commonmark.org/0.31.2/#ordered-list-marker style rules in https://spec.commonmark.org/0.31.2/#list-items **[V]** |
| Block quote, alert, multi-line quote | `>`; alert is `> [!note]`; GitLab's `>>>` line | https://spec.commonmark.org/0.31.2/#block-quotes , https://docs.gitlab.com/user/markdown/#alerts **[V]** |
| Fenced code | three or more backticks or tildes; a backtick fence's info string may not contain a backtick | https://spec.commonmark.org/0.31.2/#fenced-code-blocks **[V]** |
| Indented code | 4+ leading spaces (cannot interrupt a paragraph) | https://spec.commonmark.org/0.31.2/#indented-code-blocks **[V]** |
| HTML block | `<` followed by a tag/comment/`?`/`!`/`/` shape | https://spec.commonmark.org/0.31.2/#html-blocks **[V]** |
| Link reference definition | `[label]: destination` | https://spec.commonmark.org/0.31.2/#link-reference-definitions **[V]** |
| Footnote definition | `[^label]: text` | https://docs.gitlab.com/user/markdown/#footnotes **[V]** |
| Description list | a line starting `:` after a term paragraph | https://docs.rs/comrak/latest/comrak/options/struct.Extension.html#structfield.description_lists **[V]** docs; GitLab enables it **[V]** |
| Table | a header row plus a delimiter row of `-` and optional `:`, cells split on unescaped `|` | https://github.github.com/gfm/#tables-extension- **[V]**. Whether a header row can follow a paragraph line is **[I]**; escaping every `|` closes both cases |
| Math block | `$$` line, or a ```` ```math ```` fence | https://docs.gitlab.com/user/markdown/#math-equations **[V]** |
| Front matter (`---` block) and `::include{...}` | only at the top of Markdown *files* and wiki pages; "not the other places where Markdown formatting is supported" | https://docs.gitlab.com/user/markdown/#front-matter , https://docs.gitlab.com/user/markdown/#includes **[V]** |
| `[[_TOC_]]`, `[TOC]` | "you can't add one to notes or comments" | https://docs.gitlab.com/user/markdown/#table-of-contents **[V]** |
| Quick action | `/` at column 0 of a line, see section 2 | |

### Inline level (position: anywhere unless stated)

| Construct | Opens with | Source |
|---|---|---|
| Backslash escape, hard break | `\`; a `\` at end of line is a hard break | https://spec.commonmark.org/0.31.2/#backslash-escapes , https://spec.commonmark.org/0.31.2/#hard-line-breaks **[V]** |
| Code span | a backtick run, closed by a run of equal length; Heron's own fence can pair with a stray backtick, so plain text must not carry one | https://spec.commonmark.org/0.31.2/#code-spans **[V]** |
| Emphasis, strong | `*` anywhere; `_` only when flanking rules allow (never between two alphanumerics) | https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis **[V]** |
| Strikethrough | `~` or `~~` | https://github.github.com/gfm/#strikethrough-extension- **[V]** |
| Link, image, reference link, footnote reference, wikilink | `[`, `![`, `[^`, `[[` (a `]` matters only when Heron has an unclosed `[`, i.e. inside its own link label) | https://spec.commonmark.org/0.31.2/#links , https://spec.commonmark.org/0.31.2/#images **[V]** |
| Raw HTML, angle autolink | `<` followed by letter, `/`, `!` or `?` | https://spec.commonmark.org/0.31.2/#raw-html , https://spec.commonmark.org/0.31.2/#autolinks **[V]** |
| Entity | `&name;`, `&#N;`, `&#xH;` | https://spec.commonmark.org/0.31.2/#entity-and-numeric-character-references **[V]** |
| Extended autolinks | `www.` + domain, `http://`/`https://` + domain, `mailto:`/`xmpp:` + address, bare `user@host.tld`; each only at line start, after whitespace or after `* _ ~ (`. GitLab adds `relaxed_autolinks` and documents "almost any URL" (`scheme://`) | https://github.github.com/gfm/#autolinks-extension- , https://docs.gitlab.com/user/markdown/#url-auto-linking **[V]** |
| Inline math | `$...$` and `` $`...`$ `` | https://docs.gitlab.com/user/markdown/#math-equations **[V]** |
| Emoji shortcode | `:name:` on a text node | https://github.com/gitlabhq/gitlabhq/blob/master/lib/banzai/filter/emoji_filter.rb (`POTENTIAL_EMOJI_PATTERN = /:[a-z0-9_+-][a-z0-9_-]*:/i`) **[V]** |
| Inline diff | `[+x+]`, `{+x+}`, `[-x-]`, `{-x-}` on a text node | https://github.com/gitlabhq/gitlabhq/blob/master/lib/banzai/filter/inline_diff_filter.rb **[V]**; cosmetic only (a green or red span) |
| Placeholders | `%{...}` (option `placeholder_detection`; the docs and gate are behind a project feature flag) | glfm_markdown.rb **[V]** option; behaviour **[I]** |

Sanitization: raw HTML is parsed (`unsafe: true`) and then sanitized, so an unescaped `<` reaches HTML: https://github.com/gitlabhq/gitlabhq/blob/master/lib/banzai/pipeline/gfm_pipeline.rb (SanitizationFilter after the parser) **[V]**, allowed tags https://docs.gitlab.com/user/markdown/#inline-html **[V]**.

Not a hazard in notes: Gollum `[[tag]]` filter only runs for AsciiDoc (`return doc if context[:pipeline] != :ascii_doc`, https://github.com/gitlabhq/gitlabhq/blob/master/lib/banzai/filter/gollum_tags_filter.rb) **[V]**; `AutolinkFilter` serves pipelines that do not use the Markdown parser (its own header comment) **[V]**.

## 2. References, mentions, quick actions

### References and mentions

The doc table: https://docs.gitlab.com/user/markdown/#gitlab-specific-references **[V]**. Patterns read from source (mirror of the GitLab repository, https://github.com/gitlabhq/gitlabhq/blob/master/):

| Form | Pattern facts | Source file | What breaks it |
|---|---|---|---|
| `@user`, `@group`, `@all` | `(?<!\w)@` + namespace path. Notifies people. | `app/models/user.rb` `reference_pattern` **[V]** | `\@` (span split, section 0) |
| `#123`, `group/project#123`, `GL-123`, `[issue:123]` | `#` or `GL-` or `[issue:` then digits | `app/models/issue.rb` `reference_pattern`, `lib/gitlab/regex.rb` `issue` **[V]** | `\#`; for `GL-123` and `[issue:` see below |
| `!123`, `ns/proj!123` | `!` + digits | merge request filter (same shape) **[I]** for the file, doc table **[V]** | `\!` |
| `~label`, `~"two words"`, `~123` | `~` + name/id | `app/models/label.rb` **[V]** | `\~` |
| `%milestone`, `%"a b"`, `%1` | `%` + name/id | `app/models/milestone.rb` **[V]** | `\%` |
| `$123` snippet, `1$123` personal snippet | `$` + digits | doc table **[V]** | `\$` |
| `&123` epic | `&` + digits | doc table **[V]** | `\&` |
| `^alert#123` | `^` + `alert#`... | `app/models/alert_management/alert.rb` **[V]** | `\^` (and `\#`) |
| `*iteration:"x"`, `*iteration:9` | `*iteration:` | doc table **[V]** | the `:` after `iteration` (in the nine characters) |
| `[vulnerability:5]`, `[epic:1]`, `[work_item:..]`, `[feature_flag:..]`, `[cadence:..]`, `[contact:..]`, `[wiki_page:..]` | `[` + type + `:` | doc table **[V]** | the `:` (in the nine characters). `\[` alone does **not** (not in the nine) |
| `ns/proj@sha`, `ns/proj@sha...sha` | `@`, then 7-40 hex characters | `app/models/commit.rb` **[V]** | `\@` |
| bare commit hash `9ba12248` | `\b` + 7-40 hex + `\b`, no sigil | `app/models/commit.rb` `WHOLE_WORD_COMMIT_SHA_PATTERN` **[V]** | nothing in the rule; existing accepted residual (Heron's own comment says so). Side effect: a "mentioned in" link on the commit, no notification |
| `namespace/project>` | path then `>`; links to a project | `app/models/project.rb` `markdown_reference_pattern` **[V]** | a boundary before the `>`; `\>` alone does not (not in the nine). Link only, no notification: **[I]** |
| Jira-style `PROJ-123` | `(?<![A-Za-z0-9_])[A-Z][A-Z_0-9]+-\d+`, active only when the project has an external tracker | `lib/gitlab/regex.rb` `jira_issue_key_regex` **[V]** | a boundary after the `-`. A custom `jira_issue_regex` set by the project owner cannot be predicted (open question 5) |
| `[[Home]]` wiki | wiki page filters | doc table **[V]** | `\[` stops the *Markdown* wikilink parse; the text-level `[wiki_page:` form needs the `:` escape |
| GitLab URLs (`https://gitlab.example.com/group/app/-/issues/9`) | autolinked, then rewritten to a reference by the link filters | `abstract_reference_filter.rb` (`link_pattern`) **[V]** | not being autolinked: `\:` after the scheme (a text node split, same mechanism as above) |
| `+` and `+s` suffixes (`#123+`) | expand a reference | doc **[V]** | irrelevant once `#123` cannot match |

Reference text inside `pre`, `code`, `a` is skipped, which is why Heron's code spans need no escaping: `ignore_ancestor_query` in reference_filter.rb **[V]**. Emoji filter and inline-diff filter skip `pre code tt` **[V]** (their `IGNORED_ANCESTOR_TAGS`).

### Quick actions

- The doc: "Each command starts with a forward slash (/) and must be entered on a separate line", run when a description or comment is saved: https://docs.gitlab.com/user/project/quick_actions/ **[V]**.
- Mechanism from source **[V]** (https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/gitlab/quick_actions/extractor.rb and, on the mirror, `lib/banzai/filter/quick_action_filter.rb`, `lib/banzai/pipeline/quick_action_pipeline.rb`):
  1. GitLab renders the note and keeps only **top-level** `<p>` nodes whose text has a line starting with `/`. A paragraph inside a list item or block quote is not examined.
  2. For those paragraphs it applies `^\/(cmd)(?: (arg))?(?:\s*\n|$)` to the **raw source lines**, and skips inline code and HTML blocks.
- So a quick action needs `/` at column 0 of a raw source line. The rendered text can start with `/` and be harmless, because the check is on the source. A leading backslash (`\/approve`), a leading space or a leading joiner all defeat it. Heron's current `\/` + joiner does; the joiner is not needed.
- Rule for the function: a `/` at the start of an output line is escaped. A `/` elsewhere is inert (`^` is a line anchor, and the text is never at column 0 mid-line). Heron joins lines with a hard break (`  \n`), so every model line is a source line start.

## 3. The smallest rule

### Specification

`plain(text, position)` where `text` is one model line already trimmed, with no newline, `position` is `{ lineStart: boolean, label: boolean }`.

- `lineStart` is true for the first plain span of an output line and for the plain span after a list marker; false for a plain span that follows a code span.
- `label` is true when the text sits inside Heron's `[label](url)`.
- Output: the same text with a backslash inserted before selected characters, and rarely one word joiner.
- Let `c` be the character, `next` the following character (or none), `sp` mean `next` is none or whitespace.

Escape with a backslash:

| Character | When | Why (section) |
|---|---|---|
| `\` `` ` `` `*` `<` `|` `~` `[` | always | escape / code span / emphasis + iteration / HTML, angle autolink / table / strikethrough + label ref / link, footnote, wikilink, `[type:` text form (part) |
| `]` | only if `label` | closes Heron's `[`; otherwise inert |
| `_` | unless both neighbours are `[A-Za-z0-9]` | mid-word `_` cannot emphasise |
| `&` `@` `$` `%` `^` `:` | unless `sp` | entity/epic; mention, commit, email; math, snippet; milestone, placeholder; alert; emoji, URL scheme, `mailto:`, `[type:`, `*iteration:` |
| `!` | if `next` is a digit | merge request; `![` is already dead because `[` is escaped |
| `#` | if `lineStart` at index 0, or `next` is a digit | heading; issue, epic |
| `:` | also when `lineStart` at index 0 (even if `sp`) | description list |
| `/` `-` `+` `=` `>` | only at index 0 of a `lineStart` span | quick action; list, thematic break, setext; list; setext; block quote |
| `.` or `)` | only when everything before it in a `lineStart` span is 1-9 digits | ordered list marker |

Insert one word joiner U+2060 only in these four shapes (all other characters get none):

| Shape | Joiner goes | Why |
|---|---|---|
| `[A-Za-z0-9_]-` followed by a digit (`GL-12`, `PROJ-9`) | after the `-` | `GL-` and Jira key patterns contain no escapable sigil |
| `www` followed by `.` (case-insensitive) | before the `.` | GFM `www.` autolink |
| `>` preceded by `[\w.\-/]` (mid-line) | before the `>` | `namespace/project>` reference; also `Array<string>` |
| `[` or `{` followed by `+` or `-` | after it | inline diff on a text node (cosmetic) |

Everything else is emitted unchanged, including `( ) . , ; ? ' " { } = + - / >` in mid-line positions.

Is the joiner still needed? Yes, in exactly the four shapes above and nowhere else. Two of the four (`>` and inline diff) are the lowest stakes: a link to a project the reader could see anyway, and a coloured span. The first two are the ones with a consequence: `GL-12` creates a cross-reference note on issue 12, `www.host` makes a live external link. Any other invisible character is unnecessary.

What the joiner is no longer needed for: `\@` `\#` `\!` `\~` `\%` `\$` `\&` `\^` `\:` (all nine spans), and `/`.

Also unchanged and outside this function: Heron's code spans, `paragraphLine`'s joiner in front of a line that begins with a backtick fence (keeps the note independent of the info-string rule; https://spec.commonmark.org/0.31.2/#fenced-code-blocks), and `tableCell`'s `|` handling.

### Reference implementation used in the check (JavaScript)

```js
export const plain = (text, { lineStart = true, label = false } = {}) => {
  const isAlnum = (c) => c !== undefined && /[A-Za-z0-9]/.test(c)
  const isSpace = (c) => c === undefined || /\s/.test(c)
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i], prev = text[i - 1], next = text[i + 1]
    const atStart = lineStart && i === 0
    let esc = false, before = false, after = false
    switch (c) {
      case "\\": case "`": case "*": case "<": case "|": case "~": case "[": esc = true; break
      case "]": esc = label; break
      case "_": esc = !(isAlnum(prev) && isAlnum(next)); break
      case "&": case "@": case "$": case "%": case "^": esc = !isSpace(next); break
      case ":": esc = !isSpace(next) || atStart; break
      case "!": esc = next !== undefined && /[0-9]/.test(next); break
      case "#": esc = atStart || (next !== undefined && /[0-9]/.test(next)); break
      case "/": case "-": case "+": case "=": esc = atStart; break
      case ">": esc = atStart; before = !atStart && /[\w.\-/]/.test(prev ?? ""); break
      case ".": case ")": esc = lineStart && /^\d{1,9}$/.test(text.slice(0, i)); break
    }
    if (c === "-" && /[A-Za-z0-9_]/.test(prev ?? "") && /[0-9]/.test(next ?? "")) after = true
    if (c === "." && /^www$/i.test(text.slice(Math.max(0, i - 3), i))) before = true
    if ((c === "[" || c === "{") && (next === "+" || next === "-")) after = true
    out += (before ? "⁠" : "") + (esc ? "\\" + c : c) + (after ? "⁠" : "")
  }
  return out
}
```

Examples (new / current):

- `See https://x.test/a.ts#L12?a=1&b=2%20 then` -> `See https\://x.test/a.ts#L12?a=1\&b=2\%20 then` (current: every punctuation character in that string gets a backslash and a joiner, 14 pairs).
- `Note: fixes GL-12 and #34 at 12:30` -> `Note: fixes GL-<WJ>12 and \#34 at 12\:30`.
- `**Keyboard** is fine` (after Heron drops `**`) is unaffected; `3 * 4` -> `3 \* 4`.
- `/approve` -> `\/approve`; `1. first` -> `1\. first`; `- item` -> `\- item`.

### How the rule was checked (what is verified, what is not)

Scratch harness (not in any repository): comrak 0.48.0-rc.0 WASM from npm with GitLab's extension set and `escapedCharSpans`, then a model of GitLab's text-node filters. To model GitLab's `only_escape_chars` I unwrapped every escaped-char span except the nine reference characters, then tested each remaining text node (skipping `code` and `a`) against the reference/emoji/inline-diff/Jira/`GL-`/email/`name>` patterns above, checked that the only tags in the output are `p br ul li code` plus the escaped-char span, that no `<a>` appears, and that no source line starts with `/`. Each case ran as a paragraph line and as a bullet item; a second run put the text after a code span; a third put it inside a link label.

Results **[V]** for the harness, **[I]** for its fidelity to GitLab:

| Variant | Failing checks (of 264 case-positions) |
|---|---|
| no escaping (control) | 183 |
| current rule (backslash + joiner after each) | 22, all the `name>` project-reference shape: `\>` then joiner leaves `proj>` adjacent, so **the current rule does not break the project reference `group/project>`** in this model (link only) |
| backslash on every punctuation, no joiner (control) | 28 |
| proposed rule | 0 |
| proposed rule, text after a code span | 0 of 132 |
| proposed rule, inside a link label | 0 of 132 |

Ablation (remove one clause, count failures): drop the `GL-` joiner -> 2 failing (the `GL-12` cases); drop the `www` joiner -> 4 (live links); drop the inline-diff joiner -> 2 (cosmetic); drop the `>` joiner -> 24 (project-reference shape only); stop escaping `:` before non-space -> 38 (autolinks, emoji, `[type:` forms). Every clause of the rule is therefore load-bearing for at least one case.

Not verified: behaviour on a real GitLab instance (no access; not attempted); the fork's exact `only_escape_chars` semantics; older engines.

## 4. The existing adversarial cases

Source: `hostile` in https://github.com/NickSuomi/heron/blob/main/test/report-render.test.ts (80 strings, each run as a complete and an incomplete report). Every one passed under the proposed rule in the harness above (both paragraph and bullet positions). Grouped:

| Group | Cases | Kept safe by | Verdict |
|---|---|---|---|
| Code-span abuse, HTML in code | `` \``A`B @all <img..> C`` ``, ``a ` b\nc ` @all <b>x</b> ` ``, `` `@all` `<b>x</b>` `#12` ... ``, `` `https://x.test/@all` `<https://x.test>` ``, `` `</code><img ...>` ``, `` `<!--` @all `-->` ``, `` `` a ``` b `` ``, `` ``` `x` ```\n@all ``, ``` `` ` `` @all ` #12 ```, `` `a\` @all `b` ``, `` \`@all` ``, `` $`x`$ @all ``, `` **`@all`** **#12** ``, `` `|` a | b ``, `` `/approve` ``, ``x\n`/approve` ``, `` - `/approve` `` | `` ` `` and `\` escaped; Heron's fence unchanged; text outside spans escaped | safe |
| Quick action at line start | `/approve`, ` /approve`, `\t/approve`, `    /approve`, `x\n/approve`, `x\n\n/approve`, `x\n  /approve`, `- /approve`, `* /approve`, `+ /approve`, `1. /approve`, `1) /approve`, `> /approve`, ```` ```\n/approve\n``` ````, `~~~\n/approve`, `https://x.test/a\n/approve` | `/` escaped at line start; list, quote, fence markers escaped at line start; each model line is trimmed and separate | safe |
| Fences, HTML, comments | ```` ```ts\nunclosed @all ````, `<!-- hidden`, `<details><summary>x</summary>`, `<img src=x onerror=alert(1)>`, `<https://x.test>`, `https://x.test/<b>x</b>` | `` ` `` `~` `<` escaped | safe |
| Images, links, autolink | `![x](u)`, `[l](javascript:x)`, `https://x.test/*a*`, `https://x.test/@all`, `foohttps://x.test/@all`, `https://@all`, `(https://x.test/a).`, `(https://x.test/@all).`, `http://evil.test/x`, `www.evil.com/x`, `https://gitlab.example.com/group/app/-/issues/9`, `https://x.test/$a$b` | `[`, `*`, `@`, `$`, `:` escaped; `www` joiner | safe; the `www` case is the only one that needs the joiner |
| Mentions | `@all`, `foo-@all`, `end.@all`, `é@all`, `@"quoted user"` | `\@` (span) | safe **[I]** on the fork's span rule |
| Sigil references | `#12`, `!34`, `~label`, `~"x y"`, `%m`, `&e`, `$s`, `see group/project#12 and group/project!3`, `grp/proj@0123abc grp/proj~bug grp/proj%v1 grp&5`, `^alert#12 [vulnerability:5] *iteration:9` | the nine characters escaped; `:` in `[vulnerability:5]` and `*iteration:9` | safe. `&e` alone is not a reference; escaping it costs nothing |
| Entities | `&#64;all &lt;b&gt;` | `&` escaped when not followed by space | safe |
| Headings, rules, tables, emphasis | `## Heron review: PASS`, `Heron review: PASS\n===`, `Heron review: PASS\n---`, `***`, the four-line table, `*em* _em_ **b** ~~s~~` | line-start `#`, `=`, `-` escaped; `*`, `_`, `~`, `|` escaped | safe |
| Backslashes | `\`, `\\`, `\\\`x``, `a\\\nb\\` | `\` always escaped, so a model backslash cannot swallow Heron's fence | safe |
| Autolink-adjacent | `foohttps://x.test/@all`, `https://x.test/$a$b` | see above | safe |
| Mixed lists | `- a\n- `b` @all\n  - c\n* /approve` | list markers escaped at line start | safe |

Legitimate-text tests in the same file that assert exact output (`shows a URL as unlinked text`, `shows generics, shell variables, addresses and C# as text`, `starts no line with the slash of a quick action`, `shows an unpaired backtick as a plain character`, `keeps the model's lines...`, `renders the model's bullet lists`) contain joiners in their expected strings and must be rewritten for the new output.

The test oracle also needs a decision. `markdown-it` (used by the test file) cannot show GitLab's escaped-char spans, so its `liveSigil` check cannot see the reason `\@` is safe: with the new rule it would report every `\@`-shaped text as live. Options: run comrak with escaped-char spans (npm `comrak`, upstream, was enough for my check; it wraps every escape, so unwrap all but the nine characters to match GitLab), or assert on the Markdown source (every `$ % # & @ ! ~ ^ :` that is followed by a non-space is preceded by a backslash). Cases the test file lacks and this rule handles: `GL-12`, `PROJ-9`, `[issue:12]`, `[[Home]]`, `{+x+}`, `[-y-]`, `:smile:`, `group/project>`, `www.` in parentheses, `mailto:a@b.co`, `1.` inside a bullet, `: definition`, `$$`.

## Open questions

1. Which GitLab version does the target instance run? Section 0 rests on the comrak engine's escaped-char spans, verified only on the current mirror. If an older engine is in use, keep the joiner after the nine characters until the instance is upgraded, or accept the gap.
2. A live smoke test on a throwaway merge request would turn the [I] marks on section 0 item 4 into [V] (one note containing `\@bot-name-that-does-not-exist \#1 \:smile\: GL\-1 www.x.test`, then read the rendered HTML). This posts to a tracker, so I did not do it.
3. `only_escape_chars` fork semantics: worth one read of the gem source (https://gitlab.com/gitlab-org/ruby/gems/gitlab-glfm-markdown) that I could not fetch (bot challenge on gitlab.com).
4. Should the cosmetic tier (inline diff, `name>` project link, emoji) be blocked at all? Proposed: keep inline diff and `>` (four rare characters), drop nothing else; the choice is the maintainer's.
5. A project can set a custom Jira issue regex; no fixed rule blocks an arbitrary expression. Current rule (joiner everywhere) blocks it by accident; the proposed rule blocks only the default shape. Accept, or keep the joiner after every `-` between an alphanumeric and a digit.
6. Bare commit hashes remain linkable (as today). Blocking needs a joiner inside every 7+ hex run, which changes copy-paste of hashes; not proposed.
7. `_` uses ASCII alphanumerics for the mid-word test; a non-ASCII letter neighbour gets an escape (safe direction).

## Primary sources

- CommonMark 0.31.2: https://spec.commonmark.org/0.31.2/
- GitHub Flavored Markdown spec: https://github.github.com/gfm/
- GitLab Flavored Markdown: https://docs.gitlab.com/user/markdown/
- GitLab quick actions: https://docs.gitlab.com/user/project/quick_actions/
- GitLab source (read from the public mirror https://github.com/gitlabhq/gitlabhq/tree/master, and, for the extractor, https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/gitlab/quick_actions/extractor.rb): `lib/banzai/filter/markdown_engines/glfm_markdown.rb`, `lib/banzai/pipeline/gfm_pipeline.rb`, `lib/banzai/filter/references/reference_filter.rb`, `lib/banzai/filter/references/abstract_reference_filter.rb`, `lib/banzai/filter/emoji_filter.rb`, `lib/banzai/filter/inline_diff_filter.rb`, `lib/banzai/filter/gollum_tags_filter.rb`, `lib/banzai/filter/quick_action_filter.rb`, `lib/banzai/pipeline/quick_action_pipeline.rb`, `lib/gitlab/quick_actions/extractor.rb`, `lib/gitlab/regex.rb`, `app/models/{user,issue,label,milestone,project,commit,commit_range}.rb`, `app/models/alert_management/alert.rb`
- comrak: https://docs.rs/comrak/latest/comrak/ and https://github.com/kivikakk/comrak

## Live check on GitLab 18.11 (controller, 2026-09-29)

The controller rendered all 132 hostile cases (the ones in `test/report-render.test.ts` plus the extra cases above) through a self-managed GitLab 18.11 instance's `POST /api/v4/markdown` endpoint with `gfm: true` and a real project, which renders the way notes do without posting anything. Each line was trimmed first, as Heron does. A case failed if the HTML held any element other than `p`, `br`, `code` or an escaped-character `span`.

| Rule | Failures of 132 |
| --- | --- |
| Current: backslash before every ASCII punctuation mark, word joiner after it | 0 |
| Backslash before every ASCII punctuation mark, no word joiner | 4 |
| The candidate rule proposed above | 10 |

What the live renderer did, which the model in this document did not predict:
- `\!\[x\]\(u\)` still became a link to a repository file: GitLab's later filters see the text inside the escaped-character spans.
- `GL\-12` still became a reference to issue #12 through the project's external issue pattern.
- `\{\+x\+\}` still became an inline-diff addition.
- The candidate rule also let through an image, setext headings, lists, a description list, a multi-line quote and `[TOC]`.

So a backslash alone does not stop GitLab 18.11's reference and link filters. The word joiner is what breaks them. The `group/project>` gap reported above did not reproduce live under the current rule.
