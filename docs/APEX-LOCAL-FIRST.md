# Local-first Apex

The conversation panel offers direct device actions for reference-note search,
question-bank search, recorded progress and the existing review queue. They do
not need a model or an API key. Review is enabled only when cards are due;
the established review queue may also introduce new cards. The actions are
blocked during generation and mock exams, preserving the current interaction.
Search uses the library already on the device; this change does not download
missing reader assets or introduce semantic embeddings.

These are explicit buttons, not inferred commands: an ordinary message still
uses the selected cloud model. No credentials or chat storage formats change.
The actions sit inside the conversation's scroll area so they do not reduce
its allocated height. They are also offered beside setup in standalone builds
without a configured key.

Next increments: reduce ordinary explanations to a single evidence-backed
request where appropriate; classify provider failures with actionable cooldowns;
and evaluate source-versioned explanation caching. Those changes need separate
coverage of grounded evidence, state-changing tools and invalidation. No cloud
fallback provider or browser model is introduced by this increment.
