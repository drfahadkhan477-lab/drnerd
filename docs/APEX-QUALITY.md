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
