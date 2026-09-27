# Memorizer: Complete Study App with Import Features

Welcome! Your complete Memorizer app with **Markdown and HTML study import** is ready to use.

---

## What You Can Do

### 1. **Import Study Units from Markdown** (Claude-generated)
- Use the **Claude prompt** to generate study files from any medical PDF you own
- Files include teaching points, diagrams, flowcharts, tables, quiz questions
- Import directly into the app

### 2. **Import Study Units from HTML** (TOPAL or web exports)
- Export your TOPAL artifacts as HTML
- App auto-detects format and extracts all content
- Works with any web-based learning platform

### 3. **Study with AI Coach**
- On-device AI tutors you through mistakes
- Socratic questions grounded in your study content
- Teach-back marking against your learning points
- Local-only (no cloud, fully private)

---

## Quick Start

### Opening the App
1. Open `index.html` in your web browser (works offline after first load)
2. Click **"Import Study"** on the home screen (the 📄 button)

### Importing a Study Unit

#### From Markdown (Claude-generated):
1. Go to Claude or your preferred AI
2. Paste the **Claude prompt** (see files below)
3. Add your topic/PDF summary
4. Claude generates a `.md` file
5. Save the file: `Unit_Name__Source__v1.0.md`
6. Drag it into the "Import Study" dialog in Memorizer
7. Click **Import** → Done!

#### From HTML (TOPAL):
1. Open your TOPAL artifact in a web browser
2. Right-click → **Save As → HTML** (or use browser save-page-complete)
3. Save the file: `unit-name.html`
4. Drag it into the "Import Study" dialog in Memorizer
5. Click **Import** → Done!
6. The app auto-detects HTML and extracts teaching points, tables, questions, diagrams

### Using a Study Unit
1. Click **"Jump back in"** or find the unit in your list
2. Click **"Start"** or **"Continue"**
3. Follow the lesson → drill → review flow
4. Use the **Coach** (bottom right) for AI help
5. Ask **Socratic questions** to deepen understanding

---

## Files in This Package

### App File
- **`index.html`** — The complete Memorizer app (1 file, works offline)

### Documentation & Guides
- **`QUICKSTART.md`** — This file
- **`IMPORT_GUIDE.md`** — Full guide to both import methods
- **`CLAUDE_PROMPT.md`** — Ready-to-use prompt for generating study files

### Images
- Study card example screenshots (for reference)

---

## Generating Study Files from PDFs

### Using Claude (Recommended)

1. **Copy the Claude Prompt** from `CLAUDE_PROMPT.md`
2. **Open Claude** (claude.ai or your Claude integration)
3. **Paste the prompt**
4. **Specify your topic:**
   ```
   [UNIT TOPIC]: Cardiac Hypertrophy
   [SOURCE]: Braunwald's Heart Disease, Chapter 12, pages 234-256
   ```
5. **Paste key concepts** from your PDF
6. **Click send** — Claude generates a complete study file (1-2 minutes)
7. **Save the output** as: `Cardiac_Hypertrophy__Braunwald12__v1.0.md`
8. **Drag into Memorizer**

### What Claude Generates

A single markdown file with:
- ✓ Teaching points (core concepts)
- ✓ Mechanisms & flowcharts (ASCII + SVG diagrams)
- ✓ Comparison tables
- ✓ Management pathways (step-by-step clinical approaches)
- ✓ Common misconceptions (what students get wrong)
- ✓ Practice quiz questions with explanations
- ✓ Diagrams & figures (SVG illustrations)

**Example output file:**
```
---
unit: Cardiac Hypertrophy
source_book: Braunwald's Heart Disease, Chapter 12
difficulty_level: intermediate
estimated_study_time_minutes: 45
---

## Teaching Points
- **Cardiac hypertrophy**: Increase in myocyte size...
[more content]
```

---

## Importing Existing TOPAL Artifacts

### Step 1: Export from TOPAL
1. Open your study artifact
2. Right-click → **Save Page As** or use **Ctrl+S** / **Cmd+S**
3. Choose **HTML format**
4. Save with a clear name: `cardiac_hypertrophy.html`

### Step 2: Import into Memorizer
1. Click **"Import Study"** (📄 button on home)
2. Drag the HTML file into the dialog
3. App shows you what was found:
   - ✓ 12 teaching points
   - ✓ 3 tables
   - ✓ 2 diagrams
   - ✓ 5 questions
4. Click **"Import"** → Done!

The app converts everything to its internal format automatically.

---

## How the Coach Works

### AI Tutoring (On-Device)
- **Learns from your study content** — reads teaching points, tables, questions
- **No internet required** — runs locally on your device
- **Fully private** — nothing leaves your device

### Three Ways to Use It

1. **"Explain my mistake"** (when you answer wrong)
   - AI explains why your answer was wrong
   - Uses your exact study materials

2. **"Ask me a follow-up"** (Socratic questions)
   - AI asks "why" or "how" questions
   - Digs deeper into the concept
   - Grounded in what you're studying

3. **Review mode**
   - AI rewords questions using your study notes
   - Tests deeper understanding
   - Adapts to what you missed

---

## Example: Complete Workflow

### Scenario: Learning Cardiac Hypertrophy

```
Step 1: You have Braunwald Chapter 12 (PDF)
  ↓
Step 2: Paste Claude prompt + chapter summary into Claude
  ↓
Step 3: Claude generates: Cardiac_Hypertrophy__Braunwald12__v1.0.md
  ↓
Step 4: Open Memorizer → Click "Import Study"
  ↓
Step 5: Drag the .md file → Click "Import"
  ↓
Step 6: Unit appears in "Jump back in"
  ↓
Step 7: Student clicks "Start" → Lesson with diagrams + teaching points
  ↓
Step 8: Drill mode → AI-powered quiz questions
  ↓
Step 9: Miss a question → Click "Explain my mistake"
  ↓
Step 10: AI explains using the study material
  ↓
Step 11: Ask for Socratic follow-up → Deepen understanding
  ↓
Step 12: Review → See all mistakes + misconceptions flagged
```

**Time**: ~5-10 minutes to generate file + import + start studying

---

## Storage & Privacy

### Where Data Lives
- **On your device only** (IndexedDB database)
- **Nothing uploaded** to any server
- **Works offline** after opening once
- **Private** — only you can see your study progress

### Data Stored
- Study units you import
- Your session progress (lessons, drills, exams)
- Review cards (spaced repetition)
- Study streak & statistics

### No Account Required
- No login
- No account
- No tracking
- No ads

---

## Troubleshooting

### "Import button not appearing"
- Make sure JavaScript is enabled
- Try refreshing the page (F5)
- Check that you're using a modern browser (Chrome, Safari, Firefox, Edge)

### "File not recognized"
- Check filename extension (.md or .html)
- Make sure HTML file is complete (starts with `<!DOCTYPE` or `<html>`)
- Try re-exporting the file

### "No content extracted"
- For Markdown: Check structure (## Teaching Points, ## Quiz, etc.)
- For HTML: Ensure tables have `<thead>` and questions have class `.question`
- See IMPORT_GUIDE.md for supported structures

### "App not saving my progress"
- Check browser settings (IndexedDB must be enabled)
- Try private/incognito mode (may not persist)
- Clear browser cache if data disappeared

### "AI coach not responding"
- Check that WebLLM model loaded (see dev tools console)
- First-time setup takes a minute to download the model
- Works offline after download

---

## Next Steps

1. **Read** `IMPORT_GUIDE.md` for detailed import instructions
2. **Copy** `CLAUDE_PROMPT.md` and paste into Claude
3. **Generate** your first study file (takes ~2 minutes)
4. **Import** into Memorizer
5. **Start learning** with AI-powered tutoring

---

## Questions?

See the detailed guides:
- **IMPORT_GUIDE.md** — Full import documentation
- **CLAUDE_PROMPT.md** — Prompt for generating files

Or check the README in your repo for more context.

---

## Version Info

- **App**: Memorizer (integrated with study import)
- **Build**: 4dbcfa086ab3
- **Features**: PDF books, study packs, AI coaching, spaced repetition, on-device AI
- **Size**: 988 KB (single HTML file)
- **Works**: Modern browsers, offline, no server required

Enjoy your studies! 🧠📚
