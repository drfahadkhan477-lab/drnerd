# HTML Study Import Guide

## Overview

You can now import your existing HTML study artifacts from TOPAL, course exports, or any web-based learning platform directly into Memorizer. The HTML parser automatically extracts all content and converts it to the same study pack format.

---

## What Gets Extracted

| HTML Element | What It Becomes | Parser Looks For |
|--------------|-----------------|------------------|
| `<dl>` (definition lists) | Teaching points | `<dt>` + `<dd>` pairs |
| `<table>` | Comparison tables | Any `<table>` with headers |
| `<svg>` | Diagrams | Inline SVG code |
| `<figure>` | Figures with captions | `<figcaption>` + image/SVG |
| `.question` / `[data-question]` | Quiz questions | Question divs with options |
| `<form>` with fieldsets | Multiple choice | Radio/checkbox inputs |
| Misconception sections | Myths vs reality | `.misconception`, `.myth` classes |
| `<h1>, <h2>` | Metadata | Page title, unit name |

---

## Supported HTML Structures

### 1. Teaching Points (Definition List)

**HTML:**
```html
<dl>
  <dt><strong>Cardiac Hypertrophy</strong></dt>
  <dd>Increase in myocyte size in response to chronic overload; initially compensatory but becomes maladaptive over time.</dd>
  
  <dt><strong>Eccentric Pattern</strong></dt>
  <dd>Volume overload causes cavity to dilate while wall thickens. Seen in aortic regurgitation and mitral regurgitation.</dd>
</dl>
```

**OR with divs:**
```html
<div class="teaching-point">
  <strong>Cardiac Hypertrophy:</strong> Increase in myocyte size in response to chronic overload...
</div>

<div class="teaching-point">
  <strong>Eccentric Pattern:</strong> Volume overload causes cavity to dilate...
</div>
```

**OR with list:**
```html
<ul>
  <li><strong>Cardiac Hypertrophy:</strong> Increase in myocyte size in response...</li>
  <li><strong>Eccentric Pattern:</strong> Volume overload causes cavity...</li>
</ul>
```

---

### 2. Comparison Tables

**HTML:**
```html
<table>
  <thead>
    <tr>
      <th>Feature</th>
      <th>Eccentric</th>
      <th>Concentric</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Stimulus</td>
      <td>Volume overload</td>
      <td>Pressure overload</td>
    </tr>
    <tr>
      <td>LV Cavity</td>
      <td>DILATES</td>
      <td>Normal/Small</td>
    </tr>
  </tbody>
</table>
```

The parser automatically detects tables and extracts all rows and headers.

---

### 3. Diagrams & Figures

**Option A: SVG Inline**
```html
<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
  <title>Myocyte Response to Stretch</title>
  <rect x="50" y="50" width="100" height="100" fill="#e8f4f8" stroke="#2c5aa0"/>
  <!-- SVG content -->
</svg>
```

**Option B: Figure with Caption**
```html
<figure>
  <figcaption>Figure 1: Cellular Mechanisms of Hypertrophy</figcaption>
  <svg><!-- SVG content --></svg>
</figure>
```

**Option C: Image Reference**
```html
<figure class="diagram">
  <figcaption>Figure 2: Echo Views Showing LVH</figcaption>
  <img src="images/echo-lvh.png" alt="Echo showing hypertrophy">
</figure>
```

**Option D: Div-based Diagram**
```html
<div class="diagram" data-figure="true">
  <h3>Flowchart: Hypertension to Heart Failure</h3>
  <svg><!-- Flowchart SVG --></svg>
</div>
```

---

### 4. Quiz Questions

**Option A: Question Divs**
```html
<div class="question">
  <div class="stem">
    A 58-year-old man with a 15-year history of hypertension 
    comes for annual physical. Echocardiography shows a thickened 
    interventricular septum (14 mm) and thickened posterior wall (13 mm), 
    with a normal LV cavity diameter (48 mm). His ejection fraction is 
    preserved at 62%. Which pattern of hypertrophy is present?
  </div>
  
  <div class="option">
    <strong>A)</strong> Eccentric hypertrophy
  </div>
  <div class="option">
    <strong>B)</strong> Concentric hypertrophy
  </div>
  <div class="option">
    <strong>C)</strong> Dilated cardiomyopathy
  </div>
  <div class="option">
    <strong>D)</strong> Restrictive hypertrophy
  </div>
  
  <div class="answer">B</div>
  <div class="explanation">
    The hallmark of concentric hypertrophy is increased wall thickness 
    relative to cavity size...
  </div>
</div>
```

**Option B: HTML Form**
```html
<form>
  <fieldset>
    <legend>Which pattern of hypertrophy is present?</legend>
    
    <label>
      <input type="radio" name="q1" value="a"> Eccentric hypertrophy
    </label>
    <label>
      <input type="radio" name="q1" value="b"> Concentric hypertrophy
    </label>
    <label>
      <input type="radio" name="q1" value="c"> Dilated cardiomyopathy
    </label>
  </fieldset>
</form>
```

**Option C: List-based**
```html
<div class="question" data-question="true">
  <p><strong>Stem:</strong> A 58-year-old man with hypertension...</p>
  <ol>
    <li>Eccentric hypertrophy</li>
    <li>Concentric hypertrophy</li>
    <li>Dilated cardiomyopathy</li>
    <li>Restrictive hypertrophy</li>
  </ol>
</div>
```

---

### 5. Misconceptions (Myths vs Reality)

**Option A: Table**
```html
<table class="misconceptions">
  <thead>
    <tr>
      <th>Myth</th>
      <th>Reality</th>
      <th>Why It Matters</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>"Hypertrophied heart = strong heart"</td>
      <td>Hypertrophied myocytes are WEAKER; wall is STIFFER</td>
      <td>Explains diastolic dysfunction before systolic fails</td>
    </tr>
  </tbody>
</table>
```

**Option B: Misconception Divs**
```html
<div class="misconception">
  <div class="myth">
    <strong>Myth:</strong> Hypertrophied heart = strong heart
  </div>
  <div class="reality">
    <strong>Reality:</strong> Hypertrophied myocytes are WEAKER; wall is STIFFER
  </div>
  <div class="why">
    <strong>Why:</strong> Explains diastolic dysfunction before systolic fails
  </div>
</div>
```

---

## Metadata Extraction

The parser looks for unit metadata in several places:

**Option 1: Meta Tags**
```html
<head>
  <title>Cardiac Hypertrophy</title>
  <meta name="description" content="Braunwald's Heart Disease, Chapter 12">
</head>
```

**Option 2: Data Attributes**
```html
<body data-unit="Cardiac Hypertrophy" 
      data-source="Braunwald's Heart Disease, Ch. 12"
      data-difficulty="intermediate"
      data-time="45">
```

**Option 3: First Heading**
```html
<h1>Cardiac Hypertrophy</h1>
```

---

## Learning Objectives

**Option A: List with specific class**
```html
<ul class="objectives">
  <li>Understand pathophysiology of cardiac hypertrophy</li>
  <li>Differentiate eccentric vs concentric patterns</li>
  <li>Recognize clinical presentations and management</li>
</ul>
```

**Option B: Section with data attribute**
```html
<div data-objectives="true">
  <h2>Learning Objectives</h2>
  <ol>
    <li>Understand pathophysiology...</li>
    <li>Differentiate eccentric...</li>
  </ol>
</div>
```

---

## Mechanisms & Pathways

**ASCII Flowchart in `<pre>`**
```html
<h3>Flowchart: Hypertension to Heart Failure</h3>
<pre>
Chronic Hypertension
    ↓
Increased LV Afterload
    ├─→ Concentric Hypertrophy (wall thickens)
    └─→ Fibrosis (collagen deposition)
    ↓
Phase 1: Preserved EF + Diastolic Dysfunction
</pre>
```

The parser recognizes ASCII flowcharts by looking for arrow symbols (↑↓←→├└│─).

---

## How to Export Your TOPAL Artifacts

### From TOPAL (or similar platform):

1. **View the study artifact**
2. **Right-click → Save As → Save as HTML** (or use browser "Save Page Complete")
3. **Or:** Use browser DevTools → Copy the `<html>` element → Paste into file

### Cleaning Up (Optional):

If the exported HTML has lots of extra styling or junk:
1. Copy just the content section (main body)
2. Wrap in minimal HTML:
```html
<!DOCTYPE html>
<html>
<head>
  <title>Unit Name</title>
</head>
<body>
  <!-- Your content here -->
</body>
</html>
```

---

## Importing into Memorizer

### Using the UI:

1. **In Memorizer**, click **"Import Study Unit"**
2. **Drag and drop** your `.html` or `.md` file
3. Parser **auto-detects format** and extracts content
4. See **import summary**:
   - ✓ Teaching points: 12
   - ✓ Tables: 3
   - ✓ Diagrams: 2
   - ✓ Questions: 5
5. Click **"Import to Memorizer"**
6. Unit appears in your library

### Programmatically:

```javascript
const importer = new UnifiedStudyImporter();
const content = await file.text(); // File from input or drop
const result = await importer.parseFile(content, file.name);

if (result.success) {
  const studyPack = result.studyPack;
  await saveToMemorizer(studyPack);
  console.log(`Imported: ${studyPack.metadata.unit}`);
}
```

---

## Extraction Validation

After import, you'll see stats:

```
HTML Extraction Stats: {
  metadata: 5,
  teaching_points: 12,
  tables: 3,
  diagrams: 2,
  questions: 5,
  misconceptions: 6
}
```

**If extraction looks wrong:**

1. **Check class names** — use standard CSS classes (`.question`, `.teaching-point`, `.diagram`, etc.)
2. **Use data attributes** — `data-question="true"`, `data-diagram="true"`
3. **Use semantic HTML** — `<dl>`, `<table>`, `<figure>`, `<form>`
4. **Validate structure** — ensure tables have `<thead>` with `<th>` elements

---

## Unsupported But Graceful

If the HTML has:
- **Comments** → Ignored
- **Scripts/CSS** → Stripped
- **Images without alt text** → Referenced but not shown in pack (use captions instead)
- **Nested tables** → Parser grabs outer table
- **Missing answer keys** → Questions show without answer

**None of these break the import** — parser extracts what it can and continues.

---

## Examples

### Example 1: Simple TOPAL Export

**Input HTML:**
```html
<h1>Cardiac Hypertrophy</h1>
<p><meta name="source" content="Braunwald Chapter 12"></p>

<h2>Teaching Points</h2>
<dl>
  <dt>Cardiac Hypertrophy</dt>
  <dd>Increase in myocyte size...</dd>
</dl>

<h2>Mechanism</h2>
<pre>
Hypertension ↓ LV Hypertrophy ↓ HF
</pre>

<h2>Quiz</h2>
<div class="question">
  <p>A patient with HTN has...?</p>
  <ol>
    <li>Eccentric</li>
    <li>Concentric</li>
  </ol>
</div>
```

**Extracted Pack:**
```
✓ Unit: Cardiac Hypertrophy
✓ Source: Braunwald Chapter 12
✓ Teaching points: 1
✓ Flowcharts: 1 (ASCII)
✓ Questions: 1
```

---

### Example 2: Complex HTML with SVG

**Input:** Full TOPAL artifact with styling, embedded SVG diagrams, multiple tables

**Extraction:** Parser strips styling, keeps SVG, extracts tables, identifies questions by class or structure

**Result:** Clean study pack with all content preserved

---

## Troubleshooting

### Problem: Questions not extracted

**Check:**
- Do question elements have class `.question` or attribute `data-question`?
- Does each option have clear text (not just empty divs)?
- Is there a stem text before the options?

**Fix:**
```html
<!-- Good -->
<div class="question">
  <div class="stem">Question text here?</div>
  <div class="option">A) Option</div>
</div>

<!-- Bad -->
<div>
  <p>Question text here?</p>
  <p>A) Option</p>  <!-- Parser may miss this -->
</div>
```

### Problem: Table not recognized

**Check:**
- Does the table have `<thead>` and `<tbody>`?
- Are headers in `<th>` tags?

**Fix:**
```html
<!-- Good -->
<table>
  <thead>
    <tr><th>Header 1</th><th>Header 2</th></tr>
  </thead>
  <tbody>
    <tr><td>Data</td><td>Data</td></tr>
  </tbody>
</table>
```

### Problem: SVG not displaying

**Check:**
- Is the SVG complete (has closing `</svg>` tag)?
- Does it have width/height attributes?
- Are there unescaped characters (< > &)?

**Fix:**
```html
<!-- Good -->
<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="50" height="50"/>
</svg>

<!-- Bad (unescaped) -->
<svg>
  <text>5 < 10 & 20 > 15</text>
</svg>
```

---

## Best Practices

1. **Keep HTML clean** — Remove extra divs, unused classes
2. **Use semantic tags** — `<table>`, `<figure>`, `<dl>` preferred over divs
3. **Add data attributes** — `data-question`, `data-diagram` help parser find content
4. **Include captions** — Figures with `<figcaption>` extract better
5. **Test export** — Export a small artifact first, check extraction stats
6. **Validate before import** — Import preview shows what was found

---

## File Size Limits

HTML files are typically **larger than markdown** due to styling:
- Minimal HTML: **10-30 KB** (no styling)
- Full TOPAL export: **100-500 KB** (with CSS, scripts)
- Parser only cares about content (ignores CSS/JS): Extracts **15-25 KB** of actual study material

**Keep your exports under 1 MB** for smooth import.

---

## Next Steps

1. **Export a TOPAL artifact** as HTML
2. **Test import** into Memorizer
3. **Check extraction stats** (teaching points, tables, questions found?)
4. **Review the imported pack** in the app
5. **Edit or regenerate** if needed

You now have a **unified workflow:**
- **Markdown**: Use Claude prompt to generate from PDFs
- **HTML**: Import your existing TOPAL/web artifacts

Both feed the same on-device AI coach and Socratic questioning system.

