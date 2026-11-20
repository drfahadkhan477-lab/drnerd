# Apex answer quality and grounding

Grounded mode must retrieve the owner's reference notes independently of the
question bank. Bank answers are outside that mode's evidence, so their search
scores must not decide which notes survive the relevance cutoff or result
limit. Both the initial prompt context and the follow-up search tool use the
same notes-only ranking. Open mode keeps its combined bank-and-notes search.

The regression in `tests/verify-apexctx-pure.js` uses the application's actual
index and search code over an invented bank. Strong bank matches suppress a
weaker matching note in mixed search. Grounded context and tool results must
still return that note, with its reference identifier and without bank answer
material. Both assertions failed before the fix. Browser grounding and boundary
suites additionally inspect provider requests with mocked responses.

These checks establish what evidence Apex receives. They do not establish that
every model answer follows its instructions or is clinically correct.

Further quality work should evaluate actual answers against invented reference
sets: citations supporting each claim, insufficient evidence, conflicting notes,
qualifying clauses in long passages, and separation of library evidence from
open-mode knowledge. Keep these evaluations separate from transport and UI
checks, and never use licensed content in public fixtures or logs.

Follow-up grounded searches use the same evidence formatter as the initial
prompt: note title, source and tags travel with the excerpt inside its nonce
fence. A clipped excerpt is marked as incomplete; Apex must not treat the
omitted material as supplied evidence. The requested note limit and the total
context budget still apply, and citation metadata includes only notes whose
blocks were actually supplied. A long note is still an excerpt, not a promise
that every qualification in the original document was retrieved.

Invented-note regressions cover a qualification beyond the former tool excerpt,
source attribution, explicit truncation, the requested note limit, and the
match between budgeted evidence and citations. Each regression has been seen
failing under its corresponding injected defect.

## Repeatable answer evaluations

`tests/fixtures/apex-grounding/cases.json` contains invented reference sets and
claim-level review criteria for supported answers, an empty library, unsupported
outcome claims, conflicting sources, and a late exception. They are fictional
protocols, not clinical guidance. The rubric is independent of any model answer.

Prepare requests using the real app's prompt and context assembly:

```sh
node scripts/synthetic-export.js build/apex-eval/export.html
node scripts/assemble-app.js build/apex-eval/export.html --refs build/apex-eval/refs --ref-images build/apex-eval/refs-images --out build/apex-eval/systole.html
node scripts/prepare-apex-eval.js build/apex-eval/systole.html build/apex-eval/requests.json
```

The preparer requires a marked synthetic build, uses a fresh browser context for
each case, intercepts provider requests locally, and blocks other HTTP traffic.
It reads no credentials and calls no model. It refuses to overwrite an existing
report. Its placeholder response is not saved as an evaluated answer: every
case starts with `answer: null` and `verdict: "unmeasured"`.

To evaluate a live model, use these same invented notes and questions in a
separate Apex test session with a configured provider. Record the actual model
identifier, date, full final answer, citations, and any tool exchanges. The
captured request is a reproducibility aid, not a live request ready to send:
its model is a placeholder and its headers contain no credentials. Review each
rubric criterion against the supplied note passages. A title citation by itself
does not establish support for the associated claim. Mark missing evaluations
unmeasured, never passed; fail an answer if it invents evidence, omits the
relevant exception, or silently reconciles contradictory sources. Keep live
answer results separate from browser/transport test counts.

The wire-level boundary regression also supplies long, conflicting notes through
a real mocked tool exchange. It verifies complete fences and the final opposing
statement on the outgoing request. Grounded search has already budgeted complete
note blocks, so the send loop must not cut it again with the generic tool-result
character cap. Other tools retain that cap.

## Score saved answers offline

Review each answer against the invented passages and the rubric in
`tests/fixtures/apex-grounding/cases.json`. For a positive criterion, check the
specific claim and its citation against the supplied passage. For a prohibition,
mark it supported when the answer respects it. Record why, pointing to the
answer and the relevant passage where applicable. Omit criteria you could not
assess and omit cases without an answer.

Generate an editable review from the captured requests. This checks the questions,
notes and rubrics against the current fixtures and fills in each criterion.

```sh
node scripts/score-apex-eval.js --template build/apex-eval/requests.json build/apex-eval/review.json
```

Fill in the run metadata and paste each saved answer into its case. Leave a
missing answer `null` and a pending criterion `unmeasured` with a `null` reason.
Keep the request capture alongside the review to see exactly what Apex sent.

Save one review JSON per model, date, and answer source. Use the exact model
identifier for a live run and label hand-written examples `synthetic`. Copy the
criterion text verbatim so an edited rubric cannot silently inherit a verdict.

```json
{
  "fixtureVersion": 1,
  "answerSource": "synthetic",
  "model": "hand-written-example",
  "date": "2026-11-20",
  "cases": [
    {
      "id": "empty-library",
      "answer": "Your reference library does not cover the fictional Lumen protocol.",
      "criteria": [
        {
          "criterion": "Clearly state that the notes do not cover the question.",
          "verdict": "supported",
          "reason": "The library is empty and the answer explicitly says it has no coverage."
        }
      ]
    }
  ]
}
```

```sh
node scripts/score-apex-eval.js build/apex-eval/review.json build/apex-eval/results.json
```

The scorer validates and aggregates reviewer decisions locally. It records the
full saved answers and every fixture criterion. A case fails on any unsupported
criterion and passes when all criteria are supported. Everything else remains
unmeasured, including the partially reviewed example above. The command
refuses to overwrite a result. Preserve the capture and any live tool exchanges
with the review so the evidence can be audited. Keep these reports under
`build/` and outside Git.

Run the standalone synthetic regression with
`node tests/verify-apex-eval-offline.js`.
