# TypeSafe AI & Jev — Reference Dossier

> **Audience:** Complete novices and the technical team picking this up.
> **Purpose:** A single, self-contained briefing on what TypeSafe and Jev are, how they work, what they're good and bad at, where the opportunities are, and where to dive deeper.
> **Compiled:** September 16, 2026, from live inspection of the TypeSafe console (via browser automation), the official docs at `docs.typesafe.ai`, the TypeSafe marketing site and blog, and the Trust Center.
> **Account context:** Explored under the `Sylin.org` organization on `console.typesafe.ai`. Console badge at capture time: **"Jev V13 System One"**; API default model: `jev-latest` (observed serving version `jev-1.13.x`).

---

## 1. TL;DR (the one-paragraph version)

**TypeSafe AI** is a San Francisco startup that just came out of two years in stealth (public launch: **September 15, 2026**) with a new class of AI model called **System One models**, built to be called by *software* rather than chatted with by humans. Their first and flagship model is **Jev**. Instead of generating text like an LLM (ChatGPT-style), Jev answers **typed questions** — pick-an-option, score-on-a-rubric, is-this-true — and returns **structured answers with calibrated probabilities and confidence scores** that code can branch on directly. Think of it as *"a frontier-intelligence function call: unstructured state in, typed probabilistic decisions out"* (the founder's words). It is roughly **two orders of magnitude faster (70–500 ms end-to-end) and cheaper ($0.042 per million input tokens, output free)** than using a frontier LLM for the same judgment, and because the possible answers are defined by you in advance, it **cannot hallucinate or produce a type error**. The company's bet: large-scale AI automation will be ~99% machine-to-machine, and that interface deserves a purpose-built model.

---

## 2. What TypeSafe and Jev actually are

### 2.1 The problem being solved

Large Language Models (LLMs) are trained to produce text for humans. When software needs a *decision* from them, developers coerce the model into emitting JSON, then parse and validate it. This is fragile:

- The model can wander off format, hallucinate values, or refuse.
- Confidence is unreliable — LLMs asked "how sure are you?" tend to be overconfident and inconsistent.
- Responses take seconds (3–329 s for frontier models per TypeSafe's comparison), which is fine for chat but crippling inside a request path or a loop.
- Sequential token generation makes every extra output token slower and more expensive.

### 2.2 The TypeSafe answer

Jev is **not** a chatbot and **not** "a smaller LLM." It is a new model class with:

- **A new architecture** optimized for decisions, not text generation.
- **A parallel sampler**: all outputs for a request are produced in a single parallel pass, not one token at a time. This is the root of the speed and cost advantage — and why *adding more questions to a request barely changes response time or cost*.
- **A new training algorithm: RLCD** — *Reinforcement Learning for Calibrated Decisions* — which trains the model to return decisions with **calibrated** probabilities (predictions it says are 80% likely should be right ~80% of the time, measured across groups of predictions).

You send it:

1. A **state** — the material to judge (a support message, a JSON object with a ticket + order + policy, anything from a string to nested JSON).
2. A map of **questions** — each a small, typed judgment you define.

You get back one **typed answer per question**, each with probabilities (and confidence for Choice/Score), that your code can `if` on, threshold, sort, or route with. No parsing. No prose. The possible outputs are defined *by you, in advance*, so a wrong format is mathematically impossible.

> **Plain-words analogy:** An LLM is a brilliant freelance writer you must brief and whose essay you must proofread every time. Jev is more like a panel of fast expert graders: you hand them the same dossier (state) and a checklist of questions with an answer key format (criteria), and each grader returns a scorecard with their certainty. You keep the workflow; they supply the judgment.

### 2.3 Where the names come from

- **"System One"** — from Kahneman's *Thinking, Fast and Slow*: System 1 is fast, intuitive judgment; System 2 is slow, deliberate reasoning. Jev is built to be the fast-intuition layer inside software. (The company argues this fast layer can be made *more* reliable than the reasoning-heavy alternative for its scope.)
- **"Jev"** — after **William Stanley Jevons**, the economist behind the Jevons paradox: when a resource gets drastically more efficient, consumption of it *explodes*. TypeSafe expects every order-of-magnitude drop in the cost of intelligence to unlock orders of magnitude more use cases.

### 2.4 The company

- **Founder/CEO: Diogo Almeida** — co-invented **RLHF and InstructGPT** at OpenAI (the research line behind ChatGPT and GPT-4); previously Google Brain. (Note the console badge "RLHF RLCD": the founder literally went from co-inventing RLHF to building its decision-model successor.)
- **COO: Sasha Sheng** — ex-research engineer, Meta/FAIR.
- **CTO: Erik Gafni** — repeat founder (Ravel), early at two unicorns (Invitae, Freenome).
- Team of ex-OpenAI, Google Brain, Meta/FAIR, Stripe, Airbnb, Plaid, Docker people. Backed by top-tier investors (unnamed on the site). In-person, SF (near Embarcadero).
- Public launch **Sep 15, 2026** with the blog post *"Introducing System One Models & Jev."* Currently **early access**, onboarding people off a waitlist. Active Discord community.

---

## 3. How it works: the programming model

### 3.1 The request: state + questions

One HTTP call to `POST https://api.typesafe.ai/v1/systemone`:

```json
{
  "state": "Hi, I've been trying to connect my Stripe account for 3 days and it keeps failing. I'm losing sales. Please help ASAP.",
  "model": "jev-latest",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": {
        "billing": "Payments or subscription issues",
        "technical": "Bugs or integration problems",
        "sales": "Pricing or account questions"
      }
    },
    "is_urgent": { "type": "noul", "instructions": "Does this message convey urgency or time-sensitivity?" },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated the customer appears",
      "criteria": ["Calm, just stating facts", "Frustrated but civil", "Very angry, strong language"]
    }
  }
}
```

- **`state`** can be a string, object, or array. Best practice: structured JSON with named fields, containing everything a competent judge would need — the text, the records, the policy. Questions can reference nested fields with backticked paths like `` `ticket.messages[0].text` ``.
- **`questions`** is a map. You pick the IDs (they're for *your* code — they are not sent to the model). Every question in one request sees the same state and is **evaluated independently and in parallel** — one question's answer never becomes context for another (no "context rot").

### 3.2 The three primitives

| Primitive | Question shape | Returns | Use when |
|---|---|---|---|
| **Choice** | "Which of these options?" | `choice` (selected option), `probabilities` (distribution over *every* option), `confidence` | The answer is one of a known, unordered set: route to team, classify intent, pick a tool. Maps straight onto a `switch` statement. |
| **Score** | "Which level?" | `score` (position along ordered levels — can land *between* levels), `legend`, `probabilities`, `confidence` | The answer sits on a spectrum you can describe level-by-level: severity, frustration, relevance. Maps onto a threshold. |
| **Noul** | "Is this true?" | `noul` — a single probability 0–1 that the answer is yes (no separate confidence) | A clean yes/no where the probability itself is the signal: "does this request a refund?", "is this a jailbreak attempt?". Maps onto an `if`. |

Mix all three in one call. The number of questions per request is bounded only by the shared token budget (~32,000 tokens ≈ 150,000 characters of English across state + questions).

> **Noul vs Score — the classic beginner trap:** a Noul of 0.5 means "yes and no are equally likely," **not** "medium." If you want "medium Python skill," that's a Score with defined levels. If you want "does the résumé say they used Python at work?", that's a Noul.

### 3.3 The response: typed answers + confidence

```json
{
  "model": "jev-latest",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "technical",
      "probabilities": { "billing": 0.159, "technical": 0.84, "sales": 0.001 },
      "confidence": 0.596
    },
    "frustration": {
      "type": "score",
      "score": 1.035,
      "legend": { "0": "Calm, just stating facts", "1": "Frustrated but civil", "2": "Very angry, strong language" },
      "confidence": 0.842
    },
    "is_urgent": { "type": "noul", "noul": 0.999 }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

**Confidence vs probability — the second key distinction:**

- **Probability** answers *"what?"* — the distribution across your options/levels.
- **Confidence** answers *"can I act on this?"* — a 0–1 statistic summarizing how *peaked* the distribution is. Concentrated = confident; spread out = unsure. It's computed from the probabilities for you, and since you get the raw distribution too, you can compute your own.

Confidence is the architectural hook for autonomy. The standard three-band pattern:

- **High confidence → act automatically.**
- **Medium → proceed with caution** (ask the user, flag for review).
- **Low → don't act** (route to a human, or escalate to a reasoning model).

Thresholds should scale with risk: showing a wrong screen can be allowed at 0.7 confidence; executing a wire transfer should demand 0.95+ or human confirmation. TypeSafe's docs stress: start conservative, then calibrate thresholds on your own data.

### 3.4 What I actually ran (live captures, Sep 16 2026)

**Run 1 — the "hotdog" walkthrough (single Noul).**

State:

```json
{
  "food": "Ice cream sandwich",
  "definition": "An ice cream sandwich is a frozen dessert with a layer of ice cream between two cookies, wafers, or thin pieces of cake."
}
```

Questions:

```json
{
  "is_sandwich": {
    "type": "noul",
    "instructions": "Is `food` a sandwich?",
    "criteria": {
      "true": "A sandwich is a food dish where a filling, such as meat, cheese, vegetables, or spread, is placed between structural starches...",
      "false": "The food has no bread enclosing a filling or uses only a single slice of bread, or uses a non-bread wrapper such as a tortilla, wafer, or cookie."
    }
  }
}
```

Result: **`noul: 0.34`** (34% "yes, it's a sandwich") — **117 ms** round-trip. Note the sensibility: an ice-cream sandwich is genuinely a borderline case, and the model prices that ambiguity instead of bluffing.

**Run 2 — helpdesk ticket triage (4 questions in one call, incl. a 200-option Choice).**

State: the ticket text, user role, location, channel, local time. Questions: `priority` (Choice: low/medium/high/critical), `triage` (Choice: 6 teams), `mentions_deadline` (Noul), `tool_to_call` (Choice over **200 tool descriptions**). One call, **150 ms** total:

| Question | Top answer | Distribution highlight | Confidence |
|---|---|---|---|
| `priority` | `medium` 81% | low 18%, high 1% | 74% |
| `triage` | `it_helpdesk` **100%** | — | 100% |
| `mentions_deadline` | — | **5% true** (Noul) | — |
| `tool_to_call` | `ticket-status` 74% | wifi-troubleshoot 24% | 73% |

Read that table twice — it's the whole product in one shot: a wifi follow-up ticket, correctly deprioritized, routed with total certainty, deadline-absence detected, and the right tool out of 200 picked with a usable confidence — for well under $0.0001 and in 150 ms.

### 3.5 Cardinality (how many options a Choice can have)

Per the launch blog: Jev natively supports Choice cardinality **up to 255 options**. Beyond that, the recommended pattern is two-stage — Score/rank candidates independently first, then make an explicit Choice among the top ones. (My playground run shows 200 options handled in one stage without issue.)

### 3.6 Errors & limits

- `401` bad key; `422` malformed request (field-level detail returned); `429` rate limit (SDKs auto-retry with backoff); `529` overloaded.
- Request budget: ~32k tokens shared between state and questions.
- Service currently US-based (West Coast) — published latencies measured from laptops on the West Coast.

---

## 4. Characteristics: the honest scorecard

### Strengths

1. **Type-safe by construction.** Outputs are constrained to options you defined. Zero hallucinated strings, zero schema mismatches — "mathematically impossible," per the founder, since there is no free-form generation at all.
2. **Fast.** 70–500 ms end-to-end; observed 117–150 ms. Fast enough for real-time UX, games, and per-request middleware. (Their Doom demo runs ~10 Jev queries/second.)
3. **Radically cheap.** $0.042/MTok **input**, output **free** ("too cheap to meter"). Compare frontier LLM input at $0.20–$10/MTok plus ~5×-pricier output tokens. Homepage claims 238× lower input price than Claude Fable 5.1; workflow evals claim **193.6× faster / 444.6× cheaper** vs LLMs on System-One-shaped tasks (vendor-run, caveats disclosed — see §9).
4. **Calibrated uncertainty.** Probabilities are trained against outcomes; confidence comes with every Choice/Score. This is the enabler for unattended automation: the model can say "I don't know."
5. **Parallel questions at ~fixed cost.** 13 questions batched into one call: ~11.5–12× cheaper and ~10× faster than 13 separate calls, no change in answers (their cookbook benchmark). Speculative fan-out — asking questions you might not need — is nearly free.
6. **Self-consistency.** LLM answers vary run-to-run; TypeSafe advertises stable probabilities on repeat queries (their self-consistency cookbook demonstrates this on an insurance-claim rubric).
7. **Composable.** Answers are values: branch, threshold, sort, weight, store. Weights and policy live in *your code*, where they're testable and version-controlled.

### Limitations / what it is not

1. **It does not generate text.** No summaries, no emails, no code, no explanations of reasoning. If you need prose, you still need an LLM — ideally with Jev as the router/guardrail around it.
2. **No extended reasoning.** Each question must be a "gut-check" judgment — something a knowledgeable person could answer in seconds given context. Multi-step deliberation must be *decomposed by you* into atomic questions combined in code (that decomposition skill is the real learning curve).
3. **Calibration is a group property.** "80% predictions are right ~80% of the time *across many predictions*" — it does not certify any single answer. Validate in your domain.
4. **Typed ≠ true.** The *interface* is guaranteed; correctness of the selected option is not. Threshold, test, and escalate accordingly.
5. **Early access, single model family.** One flagship model (`jev-latest`, currently V13/1.13.x lineage). Ecosystem, SLAs, and enterprise features are young.
6. **Fixed token budget** (~32k) per request — very large documents need chunking/map-reduce in code.
7. **High-cardinality Choices** (255+) need the two-stage pattern.
8. **Noul confidence nuance:** Noul has no separate confidence — near-0.5 means genuinely ambiguous. (Also: several equally-acceptable options can legitimately spread probability, so low confidence isn't always a bad sign for low-stakes preferences.)

---

## 5. The console (what's where)

At `console.typesafe.ai` (log in with email/Google):

| Page | What it does |
|---|---|
| **Home** | Quickstart (agent-skill install instructions, API key, docs links), usage summary, cookbook/demo cards (Parallel questions, SDE cascade, Self-consistency, Wikirace, Smart home assistant), links to Data Policy / Trust Center / Discord. |
| **Playground** | Two-pane editor (State / Questions as JSON), model picker (`jev-latest`), Run (Ctrl+Enter), pretty-printed response panel with per-question distributions + confidence + latency, shareable URLs. Ships walkthrough lessons (Noul/Choice/Score) and real-life examples: résumé screening, support-agent audit, helpdesk triage. |
| **Usage** | Daily charts of tokens / requests / spend, last 30 days. Stats delayed ~15 min. Footnote: estimated at **$0.042/MTok input · free output**. |
| **API Keys** (`/keys`) | Create/manage keys. Playground runs on session auth, so you can experiment keylessly. |
| **Settings** (user menu) | Profile, **Organization**, Members, Shares, **Billing**. |
| **Billing** | Prepaid credits: **$5.00 monthly free credit** (granted monthly, expires after a month, e.g. Sep 16 → Oct 16), add-funds, auto-recharge (requires card), purchase history, credits table. |

Organizations (like `Sylin.org`) group keys, members, and billing.

---

## 6. Economics: the back-of-envelope math

- Pricing: **$0.042 per 1M input tokens; $0 free output.** ($42 per billion input tokens.)
- A typical request (300–400 input tokens) costs ≈ **$0.000013–0.000017**. My two playground runs totaled 417 tokens — under two hundredths of a cent.
- The homepage side-by-side: a representative workflow call cost **$0.000081 in 0.114 s** on TypeSafe vs **$0.013880 in 8.566 s** on LLMs.
- Their Doom demo: ~10 queries/sec sustained ≈ **$7/hour** of continuous, real-time AI decision-making.
- Monthly free credit of $5 ≈ **~119 million input tokens** — enough for hundreds of thousands of typical calls. Prototyping is effectively free.
- The company states pricing is expected to go **down**, not up, and acknowledges on the blog it can't yet *prove* long-term sustainability ("we can't prove it isn't subsidized").

For scale intuition: batch-judging 1 million support tickets × 5 questions each, ~500 tokens/call ≈ 500M input tokens ≈ **$21**.

---

## 7. Use-case landscape

### 7.1 The five headline categories (from the docs' use-case map)

1. **AI automation software** — code owns control flow; TypeSafe supplies semantic decisions. Run it a million times unattended.
2. **Real-time applications** — 150 ms decisions: in-UI intelligence, games, live moderation.
3. **AI map-reduce over big data** — at 100× lower cost, semantically classify/rank/extract over giant corpora.
4. **Universal verification** — check *other* AIs' prompts, extractions, traces, tool calls, citations for jailbreaks/hallucinations at a fraction of the cost of the LLM call being guarded.
5. **Harness engineering** — smarter agent scaffolding: model routing, semantic context retrieval, error detection, trace classification.

### 7.2 Industry examples in the docs

Search/reranking for RAG; scientific paper screening & citation checks; LLM routing; guardrails; semantic code linting in CI; ML feature extraction; recruiting screen; lead-gen scoring; customer-support triage & audit; insurance claims; financial crime/KYC; legal & compliance checks; e-commerce catalog normalization & policy enforcement; trust & safety moderation; ad brand-safety; gaming moderation & churn signals; risk assessment; demand forecasting signals; knowledge-graph entity alignment.

### 7.3 The ten task shapes

| Shape | When | Examples |
|---|---|---|
| Classification | one known category should win | intent, topic, risk type |
| Detection | probability a property is present | spam, fraud, urgency, jailbreak |
| Scoring | answer sits on a rubric | severity, relevance, quality |
| Routing | category picks the next code path | tool use, escalation, model choice |
| Search | find items matching NL query | semantic search, discovery |
| Retrieval | workflow needs most-relevant context | RAG context, evidence |
| Ranking | order by semantic relevance | results, recommendations |
| Verification | check artifact for failure modes | citation support, policy violation |
| ML feature extraction | downstream model needs semantic signals | purchase intent, churn signals |
| Structured extraction | recover known fields from messy input | attributes, order fields |

### 7.4 Cookbooks (worked examples in the docs — each is a dive-ready topic)

Parallel questions (GDPR regulatory briefing, 12× cheaper/faster) · Self-consistency (nouls & choices) · Reranking (BM25 shortlist → TypeSafe rerank: top-1 5%→18%, top-10 38%→62% on CLERC legal queries) · Line-by-line semantic search (218 GitHub-ToS lines scored in one request) · Structure recovery (rebuild Markdown from mangled text) · **Function calling** (NL trading requests → typed function calls) · Skill suggestion (pick 1 of 182 agent skills, two-stage) · Entity alignment (450 beer-catalogue pairs via one Score whose levels = merge/leave/curate) · Classifying RAG passages (drop injections, flag contradictions) · Citation checking · **LLM guardrails** · SDE cascade (mini → verify → reasoning: big-model quality at small-model cost) · Date extraction · Pre-parsed value extraction (regex candidates → model selects) · Hierarchical classification (beam search through taxonomies) · Autoresearch feature discovery (questions → numeric features → CatBoost) · Confidence-based classification (SEC filings, 75 industry groups).

### 7.5 Demos

- **Wikirace** — traverse Wikipedia links to a target page; Jev made 6 correct decisions in 1.7 s while frontier LLMs wandered/hallucinated/died. Showcases high-cardinality Choices + no hallucination.
- **Doom, played by Jev** — ~10 queries/sec on structured game state, ~$7/hour. Showcases real-time.
- **Smart home assistant** — speculative questions + LLM fallback. Showcases the compose-with-LLM pattern.

---

## 8. Architecture: how to think when building

### 8.1 Three architectures (docs' framing)

1. **Traditional software** — pure decision tree of reliable primitives; no semantics.
2. **LLM agents** — model chooses each step; flexible but every loop can go off the rails; needs a human watching.
3. **AI-powered software (the TypeSafe way)** — **code owns control flow**; the model appears only where programmable common sense is needed, as atomic, constrained decisions. "Smart if-statements."

### 8.2 The four named patterns

| Pattern | Idea | Example |
|---|---|---|
| **Speculative fan-out** | Ask every question you *might* need in one call (they're parallel & nearly free); use the relevant answers | Ask ticket severity even before knowing it's a bug report |
| **Confidence-gated routing** | Answer says *what*; confidence says *whether to act* | Voice banking: <0.6 confidence → human |
| **Composite scoring** | Split a complex judgment into atomic Scores; weight them in code | Résumé screening: separate scores × role-specific weights (change weights, never re-prompt) |
| **Intent routing** | Classify intent → route to deterministic logic / specialist LLM / human | Customer-service front door |

### 8.3 Design rules of thumb (condensed from the docs)

- Keep exact computation, lookups, rules, and execution **in code**. Use Jev only where semantic understanding is needed.
- Ask **one narrow judgment per question**; if it needs weighing multiple factors, decompose and combine with your own weights.
- Send **all state needed** — policies, definitions, records — don't rely on the model's world knowledge for your domain facts.
- Reference nested state fields with backticked paths (`` `ticket.messages[0].text` ``).
- Include a **no-match/`other` option** when the list might not cover every input; check candidate coverage — the model can't choose an option you omitted.
- Ask independent questions **together**; make a second request only when the next question literally couldn't be built without the first answer.
- Exploit probability, not just the top answer: distributions and confidence are the product.

---

## 9. Evaluations & claims (with the vendor's own caveats)

- **Workflow evals:** instead of static benchmarks, TypeSafe built evals where a fixed code workflow ("compute graph") is executed by each model, scored against the average of the smartest external models (GPT-6 Astra + Fable 5.1) as reference. Jev "owns the Pareto frontier for almost two orders of magnitude" on intelligence-per-cost/latency. *Vendor-disclosed caveats:* workflows were authored by their own model-capabilities team (bias possible); reference averaging favors OpenAI/Anthropic models (may *understate* Jev); LLMs were run through TypeSafe's structured wrapper (fairer but slower/pricier than raw LLM calls); home-page 193.6×/444.6× figures come from these and are "on the higher end of real-world gains."
- **Side-by-side demo:** one dense state, many questions; Jev answered in ~0.1 s for $0.000081 vs $0.013880/8.6 s for an LLM. On the recorded run, Jev's only disagreement with GPT-5.6 Terra was a genuinely ambiguous churn-likelihood call. They found GPT-5.6 Terra "most comparable at intelligence to Jev on average."
- **No type errors:** guaranteed by construction, not measured.
- **Speed/cost per call:** verifiable by anyone (I verified: 117–150 ms from a consumer connection).

**Bottom line for skeptics:** the speed, cost, and type-safety claims are directly reproducible and held up in my live testing. The *relative intelligence* claims rest on a novel, vendor-designed eval methodology — directionally credible (founder pedigree, unusual candor in publishing caveats) but not an independent benchmark.

---

## 10. Security, privacy, trust

From `trust.typesafe.ai` (live, updated continuously):

- **SOC 2** (engagement letter available in the Trust Center).
- Control sets: infrastructure security (20 controls incl. unique prod DB auth, restricted encryption-key access), organizational (13, incl. background checks), product security (4, incl. data encryption), internal procedures (33, incl. tested DR/continuity plans), data & privacy (retention procedures, data classification, **customer data deleted upon leaving**).
- **Subprocessors:** AWS (storage/compute, USA); **Modal** (AI compute — "customer AI prompts are processed, but **not stored**"); Slack & Google Workspace (comms only).
- Privacy policy at `typesafe.ai/legal/privacy-policy`; contact `privacy@typesafe.ai`.
- Best practice from the docs: keep API credentials server-side in web apps.

---

## 11. Ecosystem & tooling

- **HTTP API:** `POST https://api.typesafe.ai/v1/systemone` (Bearer auth). Full reference: `docs.typesafe.ai/api`.
- **Python SDK:** `pip install typesafe-sdk` (≥3.10). Sync `TypeSafeClient` / async `AsyncTypeSafeClient`; typed `Choice`, `Noul`, `Score` objects; reads `TYPESAFE_API_KEY` env var; retries with backoff built in.
- **JavaScript/TypeScript SDK:** `typesafe` client with the same shape.
- **Agent skill:** a drop-in SKILL.md for Claude Code, Codex, Cursor, etc. (`claude plugin marketplace add typesafe-ai/skills` + `claude plugin install typesafe@typesafe-ai`, or `npx skills add typesafe-ai/skills --skill typesafe-ai`). Teaches coding agents the batching/decomposition habits they're bad at.
- **Console playground** with shareable links and walkthrough lessons.
- **Discord** community; `hello@typesafe.ai`.

Minimal Python taste:

```python
from typesafe_sdk import Choice, Noul, Score, TypeSafeClient

with TypeSafeClient() as client:
    r = client.system_one(
        state={"ticket": "My flight was cancelled. Can I get a refund?",
               "policy": "Cancelled flights are eligible for a full refund."},
        questions={
            "refund_requested": Noul(instructions="Does `ticket` request a refund?"),
            "request_type": Choice(instructions="What is the main request in `ticket`?",
                criteria={"refund": "wants money returned",
                          "rebooking": "wants a replacement flight",
                          "information": "asking for information only"}),
            "frustration": Score(instructions="How frustrated is the customer in `ticket`?",
                criteria=["Calm and neutral.", "Concerned but civil.", "Very angry."]),
        })
    print(r.answers["refund_requested"].noul)     # e.g. 0.97
    print(r.answers["request_type"].choice)       # "refund"
    print(r.answers["frustration"].score)          # e.g. 0.8
```

---

## 12. Strategic opportunities (if you're picking a topic to dive into)

Ordered roughly by **(value × ease of piloting)** for a small technical team:

1. **LLM guardrails / universal verification (best first project).** Wrap an existing LLM feature with one TypeSafe call per input/output: jailbreak detection, prompt-injection, PII exposure, severity scoring — threshold the probabilities in code. Cheap enough to run on *every* message, fast enough to be invisible. Directly addresses the #1 blocker (safety review) to shipping LLM features. Dive: [guardrails cookbook](https://docs.typesafe.ai/cookbooks/llm_guardrails.md) + [confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing.md).
2. **Support/helpdesk triage & audit.** The canonical use case (my §3.4 run is a working prototype): route, prioritize, detect refund/urgency/churn, audit agent chats against policy. Maps to measurable ops KPIs (misroute rate, first-response time). Dive: [fan-out pattern](https://docs.typesafe.ai/patterns/fan-out.md).
3. **Reranking / semantic search over your own corpus.** Cheap BM25/embedding shortlist → one Choice per query-candidate pair. Their cookbook: top-1 accuracy 5%→18%, top-10 38%→62% on legal queries. Improves any search or RAG you already run. Dive: [rerank cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md).
4. **Cost-replacement cascade for structured extraction.** If you currently pay an LLM to extract typed fields, the SDE cascade (mini → verify → reasoning only when needed) claims big-model quality at a fraction of cost. Dive: [SDE cascade cookbook](https://docs.typesafe.ai/cookbooks/sde_cascade.md).
5. **Feature engineering for classical ML / analytics.** Turn unstructured text (tickets, reviews, sales notes) into calibrated numeric features; feed CatBoost/XGBoost; even auto-propose features ("autoresearch"). Unique angle: the probabilities are stable enough to be features. Dive: [feature discovery cookbook](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md).
6. **Agent harness engineering (if you build agents).** Intent/model routing (send easy prompts to cheap models), skill suggestion out of large tool catalogs (the 182-skill cookbook generalizes to any agent), trace classification. This is where the "100× map-reduce over agent telemetry" opportunity lives.
7. **Real-time product intelligence (moonshot-flavored).** In-UX decisions at 150 ms: live moderation, adaptive UI, interactive experiences (their Doom/Wikirace demos prove the latency budget). Higher product risk, high differentiation.

**Platform bets worth tracking:** pricing trajectory (claimed downward), enterprise features (SSO/SLOs — not yet visible), model family breadth beyond Jev, and independent evals appearing post-launch.

**Risk register (for the dossier's honesty):** very early-stage vendor (launched yesterday, at the time of writing); single-model dependency; novel eval methodology without third-party validation yet; long-term pricing sustainability unproven (disclosed); young SDK/API surface that may still evolve (a v1 migration guide already exists — pin SDK versions).

---

## 13. Suggested dive paths

- **5 minutes:** open the [Playground](https://console.typesafe.ai/playground), load "Helpdesk ticket triage," hit Run. Read the distributions.
- **1 hour:** [Introduction](https://docs.typesafe.ai/introduction.md) → [Primitives](https://docs.typesafe.ai/primitives.md) → [Confidence](https://docs.typesafe.ai/confidence.md) → [Quickstart](https://docs.typesafe.ai/introduction/quickstart.md) (curl your first call with a key from `/keys` — the $5 monthly credit covers ~119M input tokens).
- **Half day:** [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md) + the pattern page for your chosen topic + its cookbook. Install the agent skill into your coding agent and prototype.
- **For evaluation-minded folks:** [AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer.md), [launch blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev) (eval methodology + caveats), [manifesto](https://typesafe.ai/manifesto) (the "composable AI / build prod, not God" thesis).

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **System One model** | TypeSafe's model class: fast, structured decisions for software (vs. LLM text generation). Named for Kahneman's fast/intuitive "System 1." |
| **Jev** | TypeSafe's flagship, first System One model. Named for William Stanley Jevons (Jevons paradox). |
| **State** | The input material being judged — string or JSON you send with each request. |
| **Question** | One typed judgment about the state: Choice / Score / Noul, with `instructions` (+ `criteria`). |
| **Choice** | Primitive: pick one option from your defined set; returns selected option + full probability distribution + confidence. |
| **Score** | Primitive: position on your ordered rubric of levels; returns score (may sit between levels) + legend + distribution + confidence. |
| **Noul** | Primitive: probability (0–1) that a yes/no statement is true; no separate confidence. |
| **Confidence** | 0–1 summary of how peaked a distribution is — "how much to trust this answer," distinct from *what* the answer is. |
| **Calibration** | Property that stated probabilities match observed frequencies across groups of predictions. |
| **RLCD** | Reinforcement Learning for Calibrated Decisions — TypeSafe's training algorithm (vs. RLHF for chat, RLVR for reasoning). |
| **RLHF** | Reinforcement Learning from Human Feedback — produced chatbots; co-invented by TypeSafe's CEO. |
| **Fan-out** | Asking many questions (including speculative ones) in one parallel call. |
| **Machine Native Intelligence** | TypeSafe's umbrella term: AI with software-like properties — structure, reliability, observability, testability, speed, consistency, low cost. |
| **MTok** | Million tokens. Jev: $0.042/MTok input, $0 output. |

---

## 15. Legal snapshot (added Sep 16, 2026)

**Terms of Use** (`typesafe.ai/legal/terms`, dated Sep 14, 2026 — two days pre-launch): there is **no API-specific terms document**; the only ToS is website boilerplate whose "Site" definition includes all subdomains (sweeping in the console and arguably `api.typesafe.ai`). Key clauses:

- §3(a): Site license is "**solely for your personal use**"; §3(b)(vi): no "use of the Site to develop new products and services without express written permission"; §3(b)(ii): no public display of Site Materials (strictly read, covers interface screenshots).
- §3(c): feedback grants unlimited exploitation rights — don't paste confidential material into support/Discord.
- §11(b): liability capped at **$100 aggregate**; §10: no warranties. §12: JAMS binding arbitration + class-action waiver, **30-day postal opt-out** (TypeSafe AI, Inc., 255 California St, Suite 1300, SF, CA 94117). §13(b): Delaware law. §13(g): "intended for visitors located within the United States."
- **Privacy Policy** (explicitly covers the APIs): will **not train/fine-tune on Input**, will not disclose Input except service providers; need-based retention, deletion on request. Trust Center: prompts processed but not stored on Modal; customer data deleted on leaving.
- **Open nuance (community-raised, unanswered as of capture):** inputs are carved out of training, but **outputs may be used for product improvement** — a live question for code-derived workflows (`#support`, Sep 17 ~01:04 UTC).
- **SDKs are MIT** (`@typesafe-ai/sdk` on npm; `typesafe-sdk-python` on GitHub) — bundling/forking in OSS tools is unencumbered.
- Practical remedy for the letter-vs-practice gap: written confirmation from `hello@typesafe.ai` for OSS tooling, commercial deployment, and non-US use.

## 16. Discord community snapshot (captured Sep 16–17, 2026)

Server: `discord.gg/typesafe` — channels: #rules, #introductions, #announcements, #general, #show-and-tell, #support, #memes. Level 3, 20 boosts, active Lounge voice channel.

- **#announcements** holds only two posts (launch blog link + waitlist link, Sep 15). Real announcements live in **pins and staff chat**.
- **Pinned:** Town Hall Sep 16 4pm PST (sasha/COO); Diogo's tweet — goal to clear **≥50% of the waitlist** next day; AMA 4–5:30pm. Observed: access granted within hours (.edu reportedly ~2.5h).
- **Staff activity:** founders answering in real time in #show-and-tell. Erik (CTO) on socials: "*If anyone is posting show and tell stuff on socials, please let me know and i'll have the team amplify!*" — and to a direct "permission to post on socials?": "*Sure haha.*" Public written encouragement from an officer; relevant counter-evidence to a restrictive ToS reading (still send the email for anything commercial).
- **CTO architectural guidance** (from a #show-and-tell exchange): "*the fastest way to get a good system is to keep AI out of the system. Build your workflow in code first... then figure out the exact places where you want to sprinkle in the semantic understanding*" and use Jev "*whenever you need to make a semantic decision (fuzzy rules) instead of a deterministic one.*"
- **Community projects observed:** Jev-driven NPCs in a Sims-like game, a wordle-style game, Minecraft playground, Discord-bot decision trees, trading demo (jarrodwatts), `things.iar.dev`. Asked-about: agent harnesses, chess (staff view: not a good fit), chip design, synthetic data for an autobattler.
- **#support (peer-to-peer, "unofficial"):** console login failures on non-Chromium browsers (auth provider Stytch rejecting fingerprint-blocked clients — works in Chromium/incognito); account-creation errors for some waitlisted users; **BAA/HIPAA requests** from multiple healthcare-adjacent users (SOC 2 exists, HIPAA not yet — flagged as near-term path given zero-data-retention infra); the outputs-training question above.
- One user benchmarked Jev "autoregressively picking letters to form sentences" and called it hype — community correctly routed them: *it's not a chatbot.* A useful reminder that misuse looks like "LLM habits."

## 17. Source index

Live-captured (browser automation, Sep 16 2026): console Home / Playground (incl. two real runs) / Usage / Keys / Settings / Billing; trust.typesafe.ai; Discord (announcements, rules, general + pins, show-and-tell, support) on Sep 16–17; additional playground determinism runs (4× identical result) and a Riemann-hypothesis epistemics probe (Sep 16–17).

Docs (fetched as Markdown into [`docs-cache/`](docs-cache/)): introduction, quickstart, AI primer, System One, State, Primitives (+ Choice/Score/Noul/Advanced), Confidence, How-to-build, Use-case map, Patterns (+ all four pattern pages), API reference, SDK pages (Python/JS), Agent skill, Migration guide, Demos, llms.txt index.

Marketing site: homepage (positioning, pricing banner, FAQ), manifesto, launch blog post (Sep 15, 2026), team page.

Key URLs:

- Console: <https://console.typesafe.ai/home>
- Docs index: <https://docs.typesafe.ai/llms.txt>
- HTTP API: `POST https://api.typesafe.ai/v1/systemone`
- Launch post: <https://typesafe.ai/blog/introducing-system-one-models-and-jev>
- Manifesto: <https://typesafe.ai/manifesto>
- Team: <https://typesafe.ai/team>
- Trust Center: <https://trust.typesafe.ai/>
- Playground: <https://console.typesafe.ai/playground>
- Discord: <https://discord.gg/typesafe>

---

*Artifacts: the `docs-cache/` folder next to this file contains the raw fetched documentation pages, homepage/manifesto/blog/team text extractions, and the FAQ extraction — kept as evidence and for offline reference. Figures labeled "observed" were measured live during capture; all other figures are TypeSafe's published claims with provenance noted.*
