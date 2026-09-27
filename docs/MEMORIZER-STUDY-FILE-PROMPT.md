# Claude Prompt: High-Yield Medical Unit Generator

Use this prompt when you have a medical PDF or textbook and want Claude to write
a study file for it. Save Claude's reply as a `.md` file and add it with
**Import Study** on Memorizer's home screen (a saved `.html` page is read the
same way).

**What Memorizer takes from the file** (`memorizer/src/studyImport.js`,
checked by `tests/verify-memorizer-studyimport-pure.js`):

- the prose, bullets and table rows under every heading, as the unit's text,
  which the built-in coach, Ask and the on-device AI work from;
- each `- **Term**: explanation` line as a lesson point, and each table as a
  lesson table;
- each question under the quiz heading that has **exactly four options A–D**
  and a `**Correct Answer**:` line, with its explanation and the reasons listed
  under "Why the distractors are wrong". A question with no marked answer is
  left out and counted in the import note, never guessed.

Points, tables and questions then go through the same check as a study pack:
anything carrying a number that the file's own text does not have is flagged.

**What stays in the file only:** ASCII flowcharts (code blocks) and SVG
diagrams are not imported. Keep them for reading the file itself.

---

## THE PROMPT

```
You are a medical educator creating high-yield study materials. Your job is to extract and structure the essential content from a medical text or topic into a single, rich markdown file that a student's app can parse and use for learning.

IMPORTANT: You are NOT copying the original text word-for-word. You are:
1. Identifying the high-yield concepts (exam-level, clinically relevant)
2. Structuring them clearly
3. Creating original analogies and explanations
4. Generating diagrams and flowcharts that illustrate key relationships
5. Writing quiz questions that test understanding, not memorization

---

## TASK

From the provided text/topic on: [UNIT TOPIC], extract and generate:

### A. METADATA (as YAML header)
---
unit: [Topic Name]
source_book: [Book Title, Edition, Chapter if applicable]
source_page_range: [Page numbers or "N/A"]
difficulty_level: [beginner|intermediate|advanced]
estimated_study_time_minutes: [Your estimate, typically 30-60]
prerequisites: [List of prior knowledge needed]
learning_objectives:
  - [Objective 1]
  - [Objective 2]
  - [Objective 3]
---

### B. TEACHING POINTS
Extract 8-12 fundamental teaching points. Format each as:
- **[KEY TERM]**: [Clear 1-2 sentence definition/explanation]

Guidelines:
- Be concise but complete
- Avoid memorization; focus on understanding relationships
- Each point should answer "why" or "how", not just "what"

Example:
- **Cardiac hypertrophy**: Increase in myocyte size in response to chronic overload; initially compensatory but becomes maladaptive over time

### C. MECHANISMS & PATHWAYS
Create a text explanation of how the key concepts relate and progress:

#### Subsection: [Name of cascade/mechanism]
Write a 3-5 step explanation of the mechanism, with each step clearly labeled as "Step 1:", "Step 2:", etc.

Then generate:

#### ASCII Flowchart
Create a clear ASCII diagram showing the progression from stimulus → mechanism → outcome. Use:
- Arrows: ↓, ↑, ↓↓, ↑↑ for direction/severity
- Branches: ├─→, └─→ for divergent paths
- Alternative outcomes in different branches
- Keep text concise; emphasize the flow

Example:
```
Chronic Hypertension
    ↓
Increased LV Afterload
    ├─→ Concentric Hypertrophy (wall thickens)
    └─→ Fibrosis (collagen deposition)
    ↓
Phase 1: Preserved EF + Diastolic Dysfunction
    ├─ Treatment successful? → Stabilization
    └─ Continued stimulus? → Decompensation
    ↓
Phase 2: Systolic Dysfunction (HFrEF)
```

#### SVG Diagram
Generate a detailed SVG diagram (400-600px wide) that illustrates the cellular/molecular mechanism. The SVG should:
- Show key structures (cell membrane, nucleus, organelles, proteins)
- Display signal pathways with labeled cascades
- Use consistent medical illustration style:
  - Soft colors (blues #e8f4f8, greens #d5f4e6, purples #f4e6f7)
  - Clear labels and arrows
  - Professional fonts
- Include a legend if needed
- Be understandable to a medical student (not a PhD biochemist)

Example elements: myocyte, stretch receptors, signaling proteins (MAPK, calcineurin), nucleus, gene activation, protein synthesis.

### D. COMPARISON TABLES
Create 1-3 markdown tables comparing key concepts. Use this format:

| Feature | Option A | Option B | Option C |
|---------|----------|----------|----------|
| **Key aspect 1** | Description | Description | Description |
| **Key aspect 2** | Description | Description | Description |

Examples:
- Eccentric vs Concentric hypertrophy
- Types of the disease (stages, forms)
- Drug classes and their properties
- Normal vs pathologic findings on exam/imaging

### E. MANAGEMENT/CLINICAL PATHWAY
Create a step-by-step clinical decision tree:

#### Step 1: [Diagnostic or Initial Step]
- What to assess / what tests to order
- Expected findings
- Why this step matters

#### Step 2: [Decision Point]
```
Is [condition] present?
├─ YES → [Path 1]
│   ├─ [Action A]
│   └─ [Action B]
└─ NO → [Path 2]
    └─ [Action C]
```

Continue through Step 3, 4, 5 as needed for a complete clinical approach.

### F. COMMON MISCONCEPTIONS
Create a table with format:

| Myth | Reality | Why It Matters |
|------|---------|----------------|
| "Myth statement" | Correct understanding | Clinical or exam implication |

Include at least 4-5 myths that students commonly believe. These are the things that trip students up on exams.

### G. DIAGRAMS & FIGURES
For each major diagram/figure:

#### Figure [N]: [Title]
Description: [In 1-2 sentences, describe what the figure shows and its purpose]

Then generate the SVG code directly below, or provide ASCII art if appropriate.

Important: Generate original diagrams that match the source material's style but are your own creation. Do not copy original figures.

### H. QUIZ QUESTIONS
Generate 3-5 high-quality multiple-choice questions. Format:

#### Question [N]: [Topic being tested]
**Stem**: [A realistic clinical scenario or concept question, typically 2-4 sentences]

**Options**:
- A) [Plausible distractor]
- B) [Plausible distractor]
- C) [Correct answer]
- D) [Plausible distractor]

**Correct Answer**: C

**Explanation**: [2-3 sentences explaining why C is correct, referencing the teaching points]

**Why the distractors are wrong**:
- A) [Why this is wrong]
- B) [Why this is wrong]
- D) [Why this is wrong]

**Clinical Pearl**: [A memorable insight, a common mistake, or an important takeaway]

---

## OUTPUT FORMAT

Combine all sections above in a single markdown file with this structure:

```
---
[YAML HEADER]
---

## Teaching Points
[All points]

## Pathophysiology / Mechanisms
[Text explanation + ASCII flowchart + SVG diagram]

## Comparison Tables
[All tables]

## Clinical Management
[Step-by-step pathway]

## Common Misconceptions
[Table of myths vs reality]

## Diagrams & Figures
[Figures 1, 2, 3, ...]

## Practice Questions
[Questions 1-5]

## Essential Summary for Exams
✓ [Key bullet 1]
✓ [Key bullet 2]
✓ [Key bullet 3]
[... 5-7 total bullets summarizing exam-high-yield info]
```

---

## CRITICAL GUIDELINES

1. **Original content**: Do not copy sentences from the source material. Paraphrase, restructure, and explain in your own words.

2. **High-yield focus**: Include only exam and clinically relevant information. Skip historical context, rare variants, and minutiae.

3. **ASCII flowcharts**: Must show clear progression and branching. Test readability by imagining a student reading it once.

4. **SVG diagrams**: Use professional medical illustration style. Colors should be consistent and accessible (not red/green only; accessible in grayscale).

5. **Tables**: Make meaningful comparisons. Every row and column should add information. Avoid tables that just list facts in columns.

6. **Questions**: 
   - Stem should be realistic (a clinical scenario or a concept question)
   - Options should all be plausible (not "none of the above")
   - Test understanding, not memorization
   - Each question targets a different teaching point

7. **Misconceptions**: These are the things students get wrong on exams. Include at least one from each major topic area.

---

## FILE NAME

Save/name the output as:
`[Unit_Name]__[Source_Abbrev]__v1.0.md`

Example:
`Cardiac_Hypertrophy__Braunwald12__v1.0.md`
`Heart_Failure_HFpEF__Remes2024__v1.0.md`

---

## WHAT TO SEND ME

The complete markdown file containing all sections above, ready to paste into a file and import into the app. No additional text; just the file content.
```

---

## HOW TO USE THIS PROMPT

1. **Paste this prompt into Claude** (or copy it)
2. **Replace `[UNIT TOPIC]`** with your medical topic or the title of the chapter/PDF section you want to work from
3. **If you have a PDF**, paste the key content or a summary of it after the prompt
4. **Run it**, and Claude will generate the complete unit file
5. **Copy the output** and save it as a `.md` file
6. **Import into your Memorizer app**

---

## EXAMPLE USAGE

```
[Paste the full prompt above]

[UNIT TOPIC]: Cardiac Hypertrophy
[SOURCE]: Braunwald's Heart Disease, 13th Edition, Chapter 12, pages 234-256

From the chapter, the key concepts are:
- Definition and types (eccentric vs concentric)
- Molecular mechanisms (RAAS, sympathetic, growth factors)
- Pathophysiology cascade (compensation → decompensation)
- Diagnostic findings on echo, ECG, exam
- Management approach
- Complications (diastolic dysfunction, HFpEF, HFrEF)
```

Claude will then generate the complete unit file.

---

## ADVANCED OPTIONS

### Option 1: Custom Emphasis
If the unit is for exam prep (USMLE, board exams), add:
"Prioritize exam-high-yield content. Include 'Clinical Pearl' sections highlighting what examiners test most."

### Option 2: Focus on Mechanisms
If you want deeper molecular detail:
"Include a detailed 'Cellular Mechanisms' section with signaling pathways and gene expression. The target audience is intermediate medical students."

### Option 3: Multi-System Integration
If the topic connects to other systems:
"This unit is part of a series on [System]. Cross-reference other units where relevant (e.g., 'See also: Hypertension, Kidney Function')."

---

## TROUBLESHOOTING

**Q: Claude generated text that's too similar to the source**
A: Add to the prompt: "Paraphrase entirely. Do not use phrases longer than 3 words from the original text."

**Q: The flowchart or diagram is hard to understand**
A: Ask Claude: "Simplify the ASCII flowchart. Remove detail and focus on the main pathway. Add labels to each box."

**Q: Not enough questions for deep learning**
A: Request: "Generate 10 practice questions instead of 5. Vary difficulty from recall to clinical reasoning."

**Q: SVG diagrams look too simplistic**
A: Request: "Make the SVG diagrams more detailed. Add 3-5 labeled structures, colors for different cell compartments, and arrows showing movement/signaling."

