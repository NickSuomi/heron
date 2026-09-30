# Hindsight on a weak CPU host: which calls need an LLM, which local model, what runtime

Date: 2026-09-30. Status legend: [V] verified in primary source I read directly (raw source, docs, HF API, licence text); [W] read through a web-fetch summary of a primary page, not raw; [I] my inference.

Sources (all primary): Hindsight repo https://github.com/vectorize-io/hindsight (raw files under `hindsight-api-slim/hindsight_api/`, `hindsight-docs/docs/developer/`, `docker/docker-compose/local-llm/`), docs https://hindsight.vectorize.io/, retain leaderboard https://benchmarks.hindsight.vectorize.io/leaderboard/retain, llama.cpp server README https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md, Cactus https://github.com/cactus-compute/cactus, Colibri https://github.com/JustVugg/colibri, Anthropic https://code.claude.com/docs/en/legal-and-compliance and https://www.anthropic.com/legal/consumer-terms.

## 1. Which operations call an LLM

| Operation | LLM? | Evidence |
|---|---|---|
| retain, modes `concise` (default), `verbose`, `verbatim`, `custom` | Yes: fact extraction, one call per ~3000-char chunk | [V] `config.py` `DEFAULT_RETAIN_CHUNK_SIZE = 3000`, `DEFAULT_RETAIN_EXTRACTION_MODE = "concise"`; docs `retain.md` mode table ("verbatim: original chunk text preserved, with LLM-extracted metadata") |
| retain, mode `chunks` | **No LLM**: "store chunks as-is with no LLM call or extracted metadata" | [V] `hindsight-docs/docs/developer/retain.md` mode table |
| consolidation (observations), runs automatically after retain | Yes (own LLM lane) unless disabled | [V] `config.py` `DEFAULT_ENABLE_OBSERVATIONS = True`, `DEFAULT_ENABLE_AUTO_CONSOLIDATION = True`; `memory_engine.py` submits `async_consolidation` after retain (line ~6454) |
| reflect, mental-model refresh | Yes | [V] `memory_engine.py` `reflect_async` uses `_reflect_llm_config`; returns HTTP 400 when provider is `none` |
| recall | **No LLM.** Embedding (semantic), BM25, graph, temporal retrieval, then a cross-encoder rerank | [V] `recall_async` (`memory_engine.py` ~8293) contains no LLM config use; its query analyser uses `dateparser`, not a model (`query_analyzer.py` imports); docs retain page and docs summary say recall does not call an LLM |
| Vision on attachments | Optional separate model (`HINDSIGHT_API_VLM_MODEL`) | [V] retain docs |

Can recall run with no LLM at all? Yes. `HINDSIGHT_API_LLM_PROVIDER=none` forces `retain_extraction_mode="chunks"`, disables observations, "Reflect will return HTTP 400" ([V] `config.py` ~4067-4075). Recall is unaffected ([V] docs configuration, `none` mode). You do not need to set the global provider to `none`: extraction mode can also be set per bank via the bank config API (`retain_extraction_mode`) ([V] retain.md line ~302).

Embedding and reranker (no LLM):
- Embeddings: `BAAI/bge-small-en-v1.5`, 33.4M parameters, 384 dims, ~130 MB, MIT; provider `local` (SentenceTransformers) by default, `onnx` (in-process ONNX Runtime) as a lighter option ([V] `config.py` `DEFAULT_EMBEDDINGS_LOCAL_MODEL`; docs configuration line ~886-893; HF API).
- Reranker: `cross-encoder/ms-marco-MiniLM-L-6-v2`, 22.7M parameters, Apache-2.0, provider `local`, `HINDSIGHT_API_RERANKER_LOCAL_MAX_CONCURRENT=4` default; it scores ~300 pairs per recall ([V] `config.py` lines 1273-1285; HF API). Timeout safety valve `HINDSIGHT_API_RERANKER_LOCAL_TIMEOUT=300` s.
- RAM/CPU: the models themselves are tiny (well under 200 MB of weights). The 1.5-2 GB you quoted for the Hindsight process is dominated by the PyTorch/SentenceTransformers runtime [I]; I found no published RSS figure. Switching embeddings to `onnx` and the reranker to a TEI or FlashRank provider are documented options to shrink it [V] docs, but I did not measure them.

## 2. Local LLM providers, variables, structured output

Providers that reach a local model [V] docs configuration table line 277 and `models.mdx`:
- `ollama`: `HINDSIGHT_API_LLM_PROVIDER=ollama`, `HINDSIGHT_API_LLM_BASE_URL=http://localhost:11434/v1`, `HINDSIGHT_API_LLM_MODEL=<tag>`. Structured-output calls always use Ollama's native `/api/chat` for schema enforcement; `HINDSIGHT_API_LLM_OLLAMA_NUM_CTX` optionally sets context.
- `lmstudio`: same shape, `http://localhost:1234/v1`.
- `openai` with `HINDSIGHT_API_LLM_BASE_URL` pointing at any OpenAI-compatible server (llama.cpp `llama-server`, vLLM). This is the documented path for Docker, because the published image omits `llama-cpp-python` ([V] `docker/docker-compose/local-llm/README.md`).
- `llamacpp` (built-in managed subprocess): needs `pip install 'hindsight-api-slim[local-llm]'`, not in the published image; vars `HINDSIGHT_API_LLAMACPP_MODEL_PATH`, `_GPU_LAYERS` (set `0` for CPU), `_CONTEXT_SIZE` (8192), `_NO_GRAMMAR`, `_EXTRA_ARGS`. Default model `gemma-4-E2B-it-Q4_K_M` (~3.5 GB).
- Common: `HINDSIGHT_API_LLM_API_KEY` (any dummy for local), `_MAX_CONCURRENT` (default 32; set 1-2 on CPU), `_TIMEOUT` (default 120 s; raise), `_MAX_RETRIES`, `_EXTRA_BODY`, `_REASONING_EFFORT` (`none` removes thinking on self-hosted reasoning models). Per-operation lanes exist: `HINDSIGHT_API_RETAIN_LLM_*`, `HINDSIGHT_API_REFLECT_LLM_*`, `HINDSIGHT_API_CONSOLIDATION_LLM_*` ([V] docs).

Structured output: retain needs a JSON object matching a Pydantic schema, not tool calling. Soft path is "schema-in-prompt + `json_object`"; `HINDSIGHT_API_LLM_STRICT_SCHEMA=true` (per op `..._RETAIN`) switches to grammar-enforced `json_schema strict`, recommended by the docs for weak self-hosted models, and the docs say Ollama and LM Studio soft paths "don't honor" `json_object` reliably, so a small model needs strict ([V] docs configuration line 307). For small models also set `HINDSIGHT_API_RETAIN_OPTIONAL_FACT_DIMENSIONS=true` to avoid invented dates ([V] `config.py` comment lines ~1631-1642). `HINDSIGHT_API_LLM_SUPPORTS_STRING_PATTERN=true` only if the backend accepts JSON-schema `pattern`. llama.cpp server supports `response_format` json_schema and grammar ([V] llama.cpp server README lines 571, 1316). Tool calling is needed only by reflect (agentic loop) [I], which Heron would not use.

## 3. "cactus" and "colibri"

- **Cactus** (https://github.com/cactus-compute/cactus): "hybrid edge-cloud AI engine for mobile devices & wearables"; ARM NEON SIMD kernels, Apple/Samsung/Pixel targets, own quantisation and model format (`cactus convert`) ([V] README, kernels row). It has `cactus serve [model]`, an "OpenAI-compatible local HTTP server" (`--backend cpu|metal`, default port 8080) and Linux (Ubuntu/Debian) setup instructions ([V] README). Published speeds are Apple silicon and iPhone only (e.g. Gemma4-E2B example 168 tok/s decode on the demo device) ([V] README). I found **no x86 or AVX statement and no CPU-server benchmark** ([V] grep of README found none), so x86 Linux performance is unproven. **Licence is not open source**: free only for individuals, non-commercial use, organisations under 2 million USD funding AND revenue, educational and 501(c)(3) bodies; everyone else needs a paid licence ([V] LICENSE; GitHub reports `NOASSERTION`). Structured-output/JSON-schema support on its server is undocumented in the README [V, absence]. Verdict: not a fit.
- **Colibri** (https://github.com/JustVugg/colibri, Apache-2.0): a pure-C engine for *giant Mixture-of-Experts models* (744B-2.8T; smallest is OLMoE 7B) streaming experts from disk; has `coli serve` with an OpenAI-compatible API; README says it supports MoE with routed experts only, not dense models, and quotes 0.05-6.8 tok/s ([W] fetch summary, README numbers partly confirmed [V]: "Qwen3.6 on a CPU box: ... 2.9 tok/s"). It is built for the opposite problem (huge models on small RAM), so it is slower than llama.cpp for anything that fits in memory. Verdict: not a fit. Assumption: the owner's "colibri" means this project [I]; there is no other small-model engine of that name that I found.
- **llama.cpp / Ollama**: `llama-server` gives an OpenAI-compatible `/v1/chat/completions`, `--threads`, `--parallel`, prompt-prefix KV cache on by default (`cache_prompt`), GBNF/JSON-schema constrained decoding ([V] llama.cpp server README lines 38, 151, 176, 220, 587, 1316). Ollama wraps llama.cpp, adds model management and native schema-constrained `format` ([V] Ollama structured-outputs doc); the third-party claim that llama.cpp is 10-20% faster than Ollama on a Pi 5 comes from a blog [W, not primary].

## 4. Small models for retain on CPU

Hindsight's own leaderboard (retain, dataset `locomo_3k_50`: 50 chunks of ~3000 chars, concurrency 4, self-hosted on a cloud GPU host; raw JSON in the page) ([V] https://benchmarks.hindsight.vectorize.io/leaderboard/retain, parsed from the page payload): 

| Model | Quality (leaderboard scale, opaque) | JSON valid | Note |
|---|---|---|---|
| Granite 4.2 3B (`ibm-granite/granite-4.2-3b`, Apache-2.0, 3.66B params; Q4_K_M GGUF 2.24 GB) | 56.3 | 48/50 success, 96% | 85 completion tokens/fact, 9.5 s avg on GPU |
| Gemma 4 E4B | 37.5 | 50/50 | 13.4 s |
| Gemma 4 12B | 47.0 | 94% | |
| Granite 4.2 8B | 25.0 | 74% | |
| gpt-oss 20B (low reasoning) | 56.3 | 98% | too big for this host |

I cannot verify how the "quality" number is defined [unknown]; treat it as relative ranking only. Granite 4.2 3B is the best small open model on that board and fits the RAM. Gemma 4 E2B (Hindsight's built-in default) was not on the board I parsed; Hindsight's own compose README says on CPU it "runs at ~2-3 tokens/sec... the retain pipeline ... will time out against Hindsight's default LLM timeout. For any real use, run on a GPU" ([V] local-llm README, hardware unstated).

Cost shape per retain chunk from the benchmark payload [V]: ~4,500 prompt tokens (mostly a fixed extraction system prompt) and ~1,300 completion tokens (about 19 facts) for a 3000-char chunk. Published CPU speed for a comparable 3B Q4_K_M model on a 4-core ARM board is roughly 3-6 tok/s generation ([W] aggregated blog results, not primary; x86 4-core will differ). [I] arithmetic: 1,300 tokens / 4-6 tok/s = 3.5-5.5 minutes of decode per full chunk, plus prefill of the prompt (much reduced by llama.cpp prefix cache after the first call). A `@heron learn` rule is one or two sentences, so completion is far smaller (~100-300 tokens, [I]) giving roughly 30-90 s. No published number for 4-core x86 exists in what I found; this needs measuring.

## 5. Recommendation

1. **Do not run a local LLM at all for the Heron loop.** Human-approved rules and dismissals are already curated text. Create the memory bank with `retain_extraction_mode=chunks` (or `HINDSIGHT_API_LLM_PROVIDER=none`), and set `HINDSIGHT_API_ENABLE_OBSERVATIONS=false`. Then retain is embedding-only (bge-small, milliseconds to low seconds on CPU [I]), recall is embedding + BM25 + rerank (MiniLM, 22.7M params; docs state ~300 pairs scored per recall; no published latency, expect well under a couple of seconds [I]), and no LLM RAM is needed. Trade-off: no automatic fact extraction, entity linking beyond what chunks mode gives, or observations; retrieval quality then rests on how the rule text is phrased, which Heron controls when it writes the `retain` content. Verified: mode exists, recall unaffected. Unverified: recall quality with chunks-only banks.
2. **If extraction is later wanted:** `llama-server` (plain llama.cpp, not Cactus or Colibri) as a sidecar, `HINDSIGHT_API_LLM_PROVIDER=openai`, `..._BASE_URL=http://127.0.0.1:8080/v1`, model `granite-4.2-3b-Q4_K_M.gguf` (2.24 GB file), `--threads 4 --parallel 1 -c 8192`, `HINDSIGHT_API_LLM_STRICT_SCHEMA_RETAIN=true`, `HINDSIGHT_API_RETAIN_OPTIONAL_FACT_DIMENSIONS=true`, `HINDSIGHT_API_LLM_MAX_CONCURRENT=1`, `HINDSIGHT_API_LLM_TIMEOUT=600`, consolidation off or on the same lane knowing it doubles LLM work. Run retain as a queued background job, never in the review path.
3. **RAM budget** [I, weights from HF API]: model 2.24 GB + KV cache for 8k context (order of 0.5-1 GB, unmeasured) ≈ 3 GB; plus Hindsight 1.5-2 GB, Postgres ~1 GB = 5.5-6 GB of 8 GB, leaving 2-2.5 GB for 2-3 parallel review processes, the OS and page cache. That is tight; and while a retain extraction runs it takes all 4 cores, so reviews stall. With option 1 the budget is Hindsight + Postgres ≈ 3 GB, which comfortably holds 2-3 reviews. Recommend option 1 on the 8 GB host; run extraction elsewhere only if it proves necessary.

## Can Hindsight use a Claude subscription (Claude Code OAuth) instead of an API key?

Technically yes: provider `claude-code` drives the Claude Agent SDK / CLI with `claude auth login` credentials, no API key ([V] `providers/claude_code_llm.py` docstring; docs `models.mdx` line ~525). Hindsight's own docs label it "intended for local, personal development use only. Do not use it in production deployments or shared environments" and advise the `anthropic` provider with an API key for production or team use ([V] `models.mdx` lines ~528-551). Anthropic: OAuth is "intended exclusively for purchasers of Claude ... subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications"; developers building products, "including those using the Agent SDK, should use API key authentication"; Anthropic "does not permit third-party developers to ... route requests through Free, Pro, or Max plan credentials on behalf of their users"; advertised Pro/Max limits "assume ordinary, individual usage" ([V] https://code.claude.com/docs/en/legal-and-compliance, "Authentication and credential use"). Consumer Terms section 3 also bars automated or non-human access "except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it", and sharing account credentials ([W] fetch of https://www.anthropic.com/legal/consumer-terms). Conclusion: a shared, unattended service that calls Hindsight from CI is not the ordinary individual use those terms describe; use an API key, or the local/none option above. This is my reading, not legal advice.

## Open questions

- Measured tokens/s and RSS of Granite 4.2 3B Q4_K_M on the actual 4-core host (nothing published for it).
- Does chunks-only recall give acceptable review-time relevance; needs a small A/B on real rules.
- RSS of Hindsight with `onnx` embeddings vs default SentenceTransformers (not published).
- Whether the leaderboard quality metric is meaningful for short rule-sized inputs.
