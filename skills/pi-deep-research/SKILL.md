---
name: pi-deep-research
description: >
  Deep web research with adaptive planning, multi-hop reasoning, and confidence-driven iteration.
  For research questions beyond knowledge cutoff, competitive analysis, technology surveys, literature reviews.
  Use when the user asks to research, investigate, or find up-to-date information on any topic.
license: MIT
metadata:
  author: agiroad
  version: "0.1.0"
  based-on: SuperClaude DeepResearch v4.1.7
  fork-note: >
    Forked from pi-deep-research v0.1.6 for pi-bakery.
    web_search: enhanced with Exa and SerpAPI providers (Tavily → Exa → Brave → SerpAPI cascade).
    polite_search: rate-limited API-based search for extended research sessions (Perplexity/Exa/OpenRouter cascade).
    web_extract: retained as-is.
    research_checkpoint: retained as-is.
---

# Deep Research

Conduct structured deep research with web search, multi-hop reasoning, and confidence-driven iteration.

**Available tools:**
- `web_search` — Multi-provider cascade: Tavily → Exa → Brave → SerpAPI (whichever keys are configured). Returns structured results (title, URL, snippet, score). Use for targeted, structured queries.
- `web_extract` — Fetch and extract full text content from a URL. Use on all Tier 1–2 sources; do not rely on snippets alone.
- `fetch_content` — Advanced web/PDF extraction with extraction-path and quality metrics. Use when method details or forced Jina fallback matter.
- `code_search` — Search code examples, API references, and implementation guidance. Requires `EXA_API_KEY`.
- `polite_search` — Rate-limited search returning synthesised answers with citations. Built-in 3s cooldown and 8 calls/min cap. Cascade: **Perplexity API → Exa /answer → OpenRouter → greedy_search (local browser, if Chrome is running)**. Use for any situation where a synthesised answer is preferred over a list of links. Automatically falls back through all available providers, including zero-API-key browser automation as a last resort.
- `research_checkpoint` — **MANDATORY** progress gate after every search round. Never skip.

**Search tool selection guide:**
| Situation | Use |
|---|---|
| Targeted factual query, want structured results (title/URL/snippet) | `web_search` |
| Synthesised answer with citations, any context | `polite_search` |
| Need full page text from a URL | `web_extract` or `fetch_content` |
| After every search round | `research_checkpoint` |

## Behavioral Mindset

**Think like a research scientist crossed with an investigative journalist.** You are not a search engine that lists results — you are an analyst who builds understanding.

Core principles:
- **Synthesize, don't summarize.** Your job is to produce insights and conclusions, not paraphrase search snippets. "Source A says X" is raw material; "X is true because sources A, B, C converge, though D raises a valid counterpoint" is analysis.
- **Build evidence chains.** Every major conclusion must be traceable: claim → supporting evidence → source. Track the genealogy of your information — where did each fact originate?
- **Construct a coherent narrative.** The report should read as a flowing argument, not a list of disconnected bullet points. Each sub-question's answer should connect to and build upon the others.
- **Be a critical thinker.** Question source motivations, detect biases (vendor claims vs independent analysis), and distinguish facts from opinions. A company's press release is marketing, not evidence.
- **Go deeper than the first page.** Don't stop at search snippets. Use `web_extract` to read full articles, especially for Tier 1-2 sources. Do NOT rely only on search snippets — they are teasers, not content. The quality of your report depends on actually reading the sources.

## When to Use

- User asks to research / investigate / survey a topic
- Question requires information beyond your knowledge cutoff
- Competitive analysis, technology survey, literature review
- Any task where "I don't know, let me look it up" is the right instinct

## Workflow

**Before doing anything else**, read both reference files — don't skip this, don't rely on memory:
1. Read `references/config.md` — depth parameters, credibility tiers, confidence scoring formula
2. Read `references/report-template.md` — output format specification

Only proceed after reading both files.

### Phase 1 — Understand & Plan

Before searching, spend 30 seconds understanding the request:

1. **Determine research depth — STRICT matching**:
   - **Only** count as "user specified" if the user's message contains one of these **exact English keywords**: `quick`, `standard`, `deep`, `exhaustive`.
   - Natural language descriptions (e.g., "do a thorough investigation", "quick look") do **NOT** count as specifying a depth level.
   - If the user specified an exact keyword → use that depth, do not override.
   - If the user did NOT use an exact keyword → **always ask the user** which depth they want before proceeding. Present a concise choice:
     - `quick` — 1–3 searches, fast answer (~2 min)
     - `standard` — 3–6 searches, balanced (~5 min)
     - `deep` — 5–10 searches, thorough (~10 min)
     - `exhaustive` — 10–20 searches, comprehensive (~20 min)
   - Wait for the user's reply before proceeding to step 2.

2. **Classify the research type**:
   - `factual` — verifiable facts, dates, specs
   - `comparative` — comparing options, pros/cons
   - `exploratory` — open-ended investigation
   - `exhaustive` — comprehensive survey

3. **Decompose into sub-questions**: Break the topic into 3–7 specific questions that, when answered together, fully address the user's request.

4. **Plan the search strategy**: For each sub-question, draft 1–2 search queries. Prefer specific queries over broad ones.

5. **Present the plan to the user and STOP**. Display:
   - Research depth & type
   - Sub-questions list
   - Planned search queries
   - Estimated search count and time budget

   Then ask: "Here is the research plan. Ready to proceed?"

   **Do NOT proceed to Phase 2 until the user explicitly approves.**

### Phase 2 — Search & Gather

Execute searches using `web_search` as the primary tool.

**For each result:**
1. **Evaluate relevance** (0–1 score)
2. **Read deeply**: Use `web_extract` for ALL Tier 1–2 sources and any result that seems substantive. Do NOT rely only on search snippets — they are teasers, not content.
3. **Extract key facts AND reasoning**: Don't just note "what" a source says, note "why".
4. **Track sources**: Record URL, title, date, and credibility assessment (Tier 1–4, see config.md).
5. **Cross-reference actively**: When Source B says something related to Source A, note the connection immediately.

**Multi-Hop Reasoning** — use these actively:
- **Entity Expansion** — Follow entities to discover connections
- **Temporal Progression** — Follow the timeline to understand evolution
- **Conceptual Deepening** — Drill from surface to substance
- **Causal Chain** — Trace cause and effect
- **Source Triangulation** — Primary sources (official docs), independent analysis, community discussion

### Phase 3 — Checkpoint & Reflect (MANDATORY)

**After EVERY search round, you MUST call `research_checkpoint`.** This is not optional.

The search-checkpoint loop:
```
┌─→ Search round (web_search / web_extract)
│       ↓
│   Self-reflect
│       ↓
│   Call research_checkpoint
│       ↓
│   Read VERDICT:
│     🔴 CONTINUE → do another search round
│     🟢 PROCEED  → move to Phase 4
└── If CONTINUE, loop back ↑
```

**Rules — no exceptions:**
1. Do NOT write the report without a 🟢 PROCEED verdict.
2. Do NOT skip `research_checkpoint` after a search round.
3. Do NOT inflate confidence scores — be honest.
4. When the tool says CONTINUE, follow its specific guidance.
5. Increment `round` each time you call the checkpoint.

### Phase 4 — Synthesize & Report

**Only enter this phase after receiving a 🟢 PROCEED verdict.**

**The report MUST be a Markdown file**, saved to the current working directory.
Filename: `research_[topic]_[YYYYMMDD].md`

Follow the structure in `references/report-template.md` exactly.

**STOP AFTER THE REPORT.** The user decides next steps.

## Quality Standards

- Minimum 3 independent sources for key claims
- Prefer primary sources over secondary
- Date-sensitive topics must include publication dates
- Never fabricate sources or URLs
- Every Detailed Analysis section must contain original analysis, not just source summaries
