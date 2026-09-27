/* ═══════════════════════════════════════════════════════════════════════════
   studyImport.js — Import study units from Markdown or HTML files

   Converts both .md and .html files to Memorizer's pack format.
   Works with:
     • Claude-generated markdown files (unit files)
     • Exported TOPAL/web artifacts (HTML)

   Stores imported packs in IndexedDB alongside book-based packs.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var Store = root.MemStore || (typeof require === 'function' ? require('./store.js') : null);

/* ── Markdown Parser ──────────────────────────────────────────────────────── */
function parseMarkdown(text) {
  var result = {
    metadata: {},
    teachingPoints: [],
    mechanisms: {},
    tables: [],
    diagrams: [],
    questions: [],
    misconceptions: []
  };

  // Extract YAML header
  var yamlMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (yamlMatch) {
    var yamlText = yamlMatch[1];
    var lines = yamlText.split('\n');
    lines.forEach(function (line) {
      if (!line.includes(':')) return;
      var parts = line.split(':');
      var key = parts[0].trim();
      var value = parts.slice(1).join(':').trim();
      result.metadata[key] = value;
    });
  }

  // Extract teaching points (bold terms followed by definitions)
  var teachMatch = text.match(/## Teaching Points\n([\s\S]*?)(?=## |\Z)/);
  if (teachMatch) {
    var teachText = teachMatch[1];
    var pointRegex = /^[\s]*[-*]\s+\*\*([^*]+)\*\*:\s+(.+)$/gm;
    var match;
    while ((match = pointRegex.exec(teachText)) !== null) {
      result.teachingPoints.push({
        term: match[1],
        definition: match[2]
      });
    }
  }

  // Extract tables
  var tableRegex = /\|[\s\S]*?\|(?=\n\n|\n[^|]|\Z)/g;
  var tableMatch;
  var tableIdx = 0;
  while ((tableMatch = tableRegex.exec(text)) !== null) {
    var tableText = tableMatch[0];
    var rows = tableText.split('\n').filter(function (r) { return r.startsWith('|'); });
    if (rows.length >= 3) {
      var table = parseMarkdownTable(rows, tableIdx);
      if (table) {
        result.tables.push(table);
        tableIdx++;
      }
    }
  }

  // Extract SVG diagrams
  var svgRegex = /<svg[\s\S]*?<\/svg>/g;
  var svgMatch;
  var svgIdx = 0;
  while ((svgMatch = svgRegex.exec(text)) !== null) {
    result.diagrams.push({
      id: 'figure-svg-' + svgIdx,
      type: 'svg',
      content: svgMatch[0]
    });
    svgIdx++;
  }

  // Extract quiz questions
  var qRegex = /^### Question (\d+):\s+(.+?)$\n([\s\S]*?)(?=^### Question |\Z)/gm;
  var qMatch;
  while ((qMatch = qRegex.exec(text)) !== null) {
    var q = parseQuestion(qMatch[1], qMatch[2], qMatch[3]);
    if (q) result.questions.push(q);
  }

  return result;
}

function parseMarkdownTable(rows, index) {
  try {
    var headers = rows[0]
      .split('|')
      .slice(1, -1)
      .map(function (h) { return h.trim(); });

    var dataRows = rows.slice(2).map(function (row) {
      return row
        .split('|')
        .slice(1, -1)
        .map(function (cell) { return cell.trim(); });
    });

    if (headers.length === 0 || dataRows.length === 0) return null;

    return {
      id: 'table-' + index,
      headers: headers,
      rows: dataRows
    };
  } catch (e) {
    return null;
  }
}

function parseQuestion(num, title, content) {
  try {
    var stemMatch = content.match(/^\*\*Stem\*\*:\s+(.+?)(?=\*\*|$)/s);
    var stem = stemMatch ? stemMatch[1].trim() : '';

    var optionRegex = /^-\s+([A-D])\)\s+(.+)$/gm;
    var options = [];
    var match;
    while ((match = optionRegex.exec(content)) !== null) {
      options.push({
        letter: match[1],
        text: match[2].trim()
      });
    }

    var answerMatch = content.match(/^\*\*Correct Answer\*\*:\s+([A-D])/m);
    var answer = answerMatch ? answerMatch[1] : '';

    var explainMatch = content.match(/^\*\*Explanation\*\*:\s+(.+?)(?=\*\*|$)/s);
    var explanation = explainMatch ? explainMatch[1].trim() : '';

    if (stem && options.length >= 2 && answer) {
      return {
        id: 'q-' + num,
        num: parseInt(num),
        stem: stem,
        options: options,
        answer: answer,
        explanation: explanation
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/* ── HTML Parser ──────────────────────────────────────────────────────────── */
function parseHTML(htmlText) {
  var result = {
    metadata: {},
    teachingPoints: [],
    mechanisms: {},
    tables: [],
    diagrams: [],
    questions: [],
    misconceptions: []
  };

  // Parse HTML
  var parser = new DOMParser();
  var doc = parser.parseFromString(htmlText, 'text/html');

  // Extract metadata
  var titleEl = doc.querySelector('title');
  result.metadata.unit = titleEl ? titleEl.textContent.trim() : 'Untitled Unit';

  var h1 = doc.querySelector('h1');
  if (h1) result.metadata.unit = h1.textContent.trim();

  // Extract teaching points from definition lists or divs
  var dlItems = doc.querySelectorAll('dl');
  dlItems.forEach(function (dl) {
    var dts = dl.querySelectorAll('dt');
    var dds = dl.querySelectorAll('dd');
    for (var i = 0; i < dts.length; i++) {
      var term = dts[i].textContent.trim();
      var def = dds[i] ? dds[i].textContent.trim() : '';
      if (term && def) {
        result.teachingPoints.push({ term: term, definition: def });
      }
    }
  });

  // Extract tables
  var tables = doc.querySelectorAll('table');
  tables.forEach(function (table, idx) {
    var headers = [];
    var headerCells = table.querySelectorAll('thead th, thead td');
    headerCells.forEach(function (cell) {
      headers.push(cell.textContent.trim());
    });

    if (headers.length === 0) {
      var firstRow = table.querySelector('tr');
      if (firstRow) {
        firstRow.querySelectorAll('th, td').forEach(function (cell) {
          headers.push(cell.textContent.trim());
        });
      }
    }

    var rows = [];
    var tbody = table.querySelector('tbody') || table;
    tbody.querySelectorAll('tr').forEach(function (tr, trIdx) {
      if (trIdx === 0 && !table.querySelector('thead')) return; // Skip header row
      var rowData = [];
      tr.querySelectorAll('td').forEach(function (cell) {
        rowData.push(cell.textContent.trim());
      });
      if (rowData.length > 0) rows.push(rowData);
    });

    if (headers.length > 0 && rows.length > 0) {
      result.tables.push({
        id: 'table-' + idx,
        headers: headers,
        rows: rows
      });
    }
  });

  // Extract SVG diagrams
  var svgs = doc.querySelectorAll('svg');
  svgs.forEach(function (svg, idx) {
    result.diagrams.push({
      id: 'figure-svg-' + idx,
      type: 'svg',
      content: svg.outerHTML
    });
  });

  // Extract questions
  var questionDivs = doc.querySelectorAll('.question, [data-question]');
  questionDivs.forEach(function (qDiv, idx) {
    var stem = qDiv.querySelector('.stem, [data-stem]');
    var stemText = stem ? stem.textContent.trim() : qDiv.querySelector('p')?.textContent?.trim() || '';

    var optionEls = qDiv.querySelectorAll('.option, [data-option], li');
    var options = [];
    optionEls.forEach(function (opt, oIdx) {
      var text = opt.textContent.trim();
      if (text) {
        var match = text.match(/^[A-D][\)\.\:\-\s]/);
        var letter = match ? text[0] : String.fromCharCode(65 + oIdx);
        var cleanText = text.replace(/^[A-D][\)\.\:\-\s]/, '').trim();
        options.push({ letter: letter, text: cleanText });
      }
    });

    if (stemText && options.length >= 2) {
      result.questions.push({
        id: 'q-' + idx,
        num: idx + 1,
        stem: stemText,
        options: options,
        answer: ''
      });
    }
  });

  return result;
}

/* ── Unified Importer ─────────────────────────────────────────────────────── */
var api = {
  /**
   * Detect file format
   */
  detectFormat: function (filename, content) {
    if (filename.endsWith('.md') || filename.endsWith('.markdown')) return 'markdown';
    if (filename.endsWith('.html') || filename.endsWith('.htm')) return 'html';
    if (content.trim().startsWith('---') && content.includes('---\n')) return 'markdown';
    if (content.includes('<h1') || content.includes('<table') || content.includes('<svg')) return 'html';
    return 'markdown';
  },

  /**
   * Parse study file and convert to pack format
   */
  parseStudyFile: function (content, filename) {
    try {
      var format = this.detectFormat(filename, content);
      var parsed = format === 'html' ? parseHTML(content) : parseMarkdown(content);

      // Convert to pack format
      var pack = this.convertToPack(parsed);

      return {
        success: true,
        format: format,
        pack: pack,
        summary: this.getSummary(pack)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Convert parsed study data to Memorizer pack format
   */
  convertToPack: function (parsed) {
    var unitName = parsed.metadata.unit || parsed.metadata.title || 'Imported Unit';
    var docId = 'import-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    // Create a single section with all content
    var section = {
      section: 1,
      title: unitName,
      points: parsed.teachingPoints.map(function (pt, idx) {
        return {
          num: idx + 1,
          text: pt.term + ': ' + pt.definition
        };
      }),
      questions: parsed.questions.map(function (q, idx) {
        return {
          num: idx + 1,
          stem: q.stem,
          options: q.options.map(function (opt) { return opt.text; }),
          answer: q.answer ? q.answer.charCodeAt(0) - 65 : 0, // Convert A-D to 0-3
          explanation: q.explanation || '',
          page: 1,
          why: []
        };
      }),
      mechanism: '',
      distinctions: [],
      pearls: [],
      cases: [],
      tables: parsed.tables.map(function (t) {
        return {
          title: t.headers.join(' | '),
          columns: t.headers,
          rows: t.rows,
          page: 1
        };
      }),
      mnemonics: [],
      analogies: [],
      flowchart: ''
    };

    // Add SVG diagrams as flowchart if available
    if (parsed.diagrams.length > 0) {
      section.flowchart = parsed.diagrams.map(function (d) { return d.content; }).join('\n');
    }

    return {
      id: docId,
      name: unitName,
      source: 'imported',
      addedAt: new Date().toISOString(),
      sections: {
        1: section
      }
    };
  },

  /**
   * Get summary of imported content
   */
  getSummary: function (pack) {
    var section = pack.sections[1] || {};
    return {
      unit: pack.name,
      teaching_points: (section.points || []).length,
      questions: (section.questions || []).length,
      tables: (section.tables || []).length,
      diagrams: section.flowchart ? 1 : 0
    };
  },

  /**
   * Save pack to store
   */
  savePack: function (pack) {
    if (!Store) return Promise.reject(new Error('Store not available'));

    return Store.put('packs', {
      id: pack.id,
      sections: pack.sections,
      at: new Date().toISOString()
    }).then(function () {
      return Store.put('docs', {
        id: pack.id,
        name: pack.name,
        addedAt: pack.addedAt,
        source: 'imported',
        pages: 0,
        scanned: [],
        clusters: []
      });
    });
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (root) {
  root.MemStudyImport = api;
}
})(typeof window !== 'undefined' ? window : global);
