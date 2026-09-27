/* ═══════════════════════════════════════════════════════════════════════════
   importUI.js — Drag-drop interface for importing study units

   Handles file selection, parsing, and import confirmation.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var StudyImport = root.MemStudyImport || (typeof require === 'function' ? require('./studyImport.js') : null);

var api = {};

/**
 * Show import dialog
 */
api.show = function (onImport) {
  var modal = createModal();

  modal.querySelector('#importBtn').addEventListener('click', function () {
    if (modal.currentPack) {
      onImport(modal.currentPack);
      modal.remove();
    }
  });

  modal.querySelector('#cancelBtn').addEventListener('click', function () {
    modal.remove();
  });

  document.body.appendChild(modal);
  setupDragDrop(modal);
};

function createModal() {
  var modal = document.createElement('div');
  modal.className = 'import-modal';
  modal.innerHTML = `
    <div class="import-overlay">
      <div class="import-dialog">
        <div class="import-header">
          <h2>Import Study Unit</h2>
          <button class="close-btn" id="cancelBtn">×</button>
        </div>

        <div class="import-content">
          <!-- Drop zone -->
          <div class="drop-zone" id="dropZone">
            <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <p><strong>Drop your file here</strong></p>
            <p class="hint">Markdown (.md) or HTML (.html)</p>
            <input type="file" id="fileInput" accept=".md,.html,.markdown,.htm" style="display: none;">
            <button class="btn btn-secondary" id="browseBtn">Or browse files</button>
          </div>

          <!-- File info -->
          <div id="fileInfo" class="file-info" style="display: none;">
            <p><strong>File:</strong> <span id="fileName"></span></p>
            <p id="detectionResult" class="detection"></p>
          </div>

          <!-- Summary -->
          <div id="summary" class="import-summary" style="display: none;">
            <h3 id="summaryTitle"></h3>
            <div class="summary-grid">
              <div class="stat">
                <span class="stat-label">Teaching Points</span>
                <span class="stat-value" id="statPoints">0</span>
              </div>
              <div class="stat">
                <span class="stat-label">Questions</span>
                <span class="stat-value" id="statQuestions">0</span>
              </div>
              <div class="stat">
                <span class="stat-label">Tables</span>
                <span class="stat-value" id="statTables">0</span>
              </div>
              <div class="stat">
                <span class="stat-label">Words</span>
                <span class="stat-value" id="statDiagrams">0</span>
              </div>
            </div>
          </div>

          <!-- Status -->
          <div id="status" class="status-message" style="display: none;"></div>
        </div>

        <div class="import-footer">
          <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
          <button class="btn btn-primary" id="importBtn" disabled>Import</button>
        </div>
      </div>
    </div>

    <style>
      .import-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10000;
      }

      .import-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }

      .import-dialog {
        background: var(--surface);
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        width: 100%;
        max-width: 500px;
        display: flex;
        flex-direction: column;
        max-height: 90vh;
        overflow: hidden;
      }

      .import-header {
        padding: 20px;
        border-bottom: 1px solid var(--line);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .import-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--ink);
      }

      .close-btn {
        background: none;
        border: none;
        font-size: 28px;
        color: var(--muted);
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .close-btn:hover {
        color: var(--ink);
      }

      .import-content {
        padding: 24px;
        overflow-y: auto;
        flex: 1;
      }

      .drop-zone {
        border: 2px dashed var(--line);
        border-radius: 8px;
        padding: 40px 20px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s ease;
        background: var(--surface-2);
      }

      .drop-zone:hover {
        border-color: var(--accent);
        background: var(--accent-soft);
      }

      .drop-zone.active {
        border-color: var(--good);
        background: var(--good-soft);
      }

      .upload-icon {
        width: 48px;
        height: 48px;
        color: var(--muted);
        margin-bottom: 12px;
      }

      .drop-zone p {
        margin: 8px 0;
        color: var(--ink);
      }

      .hint {
        font-size: 12px;
        color: var(--muted);
      }

      .file-info {
        margin-top: 16px;
        padding: 12px;
        background: var(--surface-2);
        border-radius: 6px;
        font-size: 14px;
      }

      .detection {
        margin-top: 8px;
        padding: 8px;
        background: var(--accent-soft);
        border-left: 4px solid var(--accent);
        color: var(--ink);
        font-size: 13px;
      }

      .import-summary {
        margin-top: 16px;
        padding: 16px;
        background: var(--good-soft);
        border: 1px solid var(--good);
        border-radius: 8px;
      }

      .import-summary h3 {
        margin: 0 0 12px 0;
        color: var(--good);
        font-size: 14px;
      }

      .summary-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      .stat {
        padding: 8px;
        background: var(--surface);
        border-radius: 4px;
        text-align: center;
      }

      .stat-label {
        display: block;
        font-size: 11px;
        color: var(--good);
        font-weight: 500;
        margin-bottom: 4px;
      }

      .stat-value {
        display: block;
        font-size: 18px;
        font-weight: bold;
        color: var(--good);
      }

      .status-message {
        margin-top: 16px;
        padding: 12px;
        border-radius: 6px;
        font-size: 14px;
        text-align: center;
      }

      .status-message.loading {
        background: var(--accent-soft);
        color: var(--ink);
      }

      .status-message.success {
        background: var(--good-soft);
        color: var(--good);
      }

      .status-message.error {
        background: var(--bad-soft);
        color: var(--bad);
      }

      .import-footer {
        padding: 16px 20px;
        border-top: 1px solid var(--line);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        background: var(--surface-2);
      }

      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .btn-primary {
        background: var(--accent);
        color: var(--accent-ink);
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--accent);
      }

      .btn-primary:disabled {
        background: var(--line);
        color: var(--muted);
        cursor: not-allowed;
      }

      .btn-secondary {
        background: var(--line);
        color: var(--ink);
      }

      .btn-secondary:hover {
        background: var(--line);
      }

      @media (max-width: 600px) {
        .import-overlay {
          padding: 0;
        }

        .import-dialog {
          max-width: none;
          border-radius: 0;
        }
      }
    </style>
  `;

  return modal;
}

function setupDragDrop(modal) {
  var dropZone = modal.querySelector('#dropZone');
  var fileInput = modal.querySelector('#fileInput');
  var browseBtn = modal.querySelector('#browseBtn');

  // Drag and drop
  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('active');
  });

  dropZone.addEventListener('dragleave', function () {
    dropZone.classList.remove('active');
  });

  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('active');
    if (e.dataTransfer.files.length > 0) {
      handleFile(modal, e.dataTransfer.files[0]);
    }
  });

  // Click to browse
  browseBtn.addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) {
      handleFile(modal, fileInput.files[0]);
    }
  });
}

function handleFile(modal, file) {
  var dropZone = modal.querySelector('#dropZone');
  var fileInfo = modal.querySelector('#fileInfo');
  var fileName = modal.querySelector('#fileName');
  var detection = modal.querySelector('#detectionResult');
  var summary = modal.querySelector('#summary');
  var status = modal.querySelector('#status');
  var importBtn = modal.querySelector('#importBtn');

  dropZone.style.display = 'none';

  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var content = e.target.result;
      var result = StudyImport.parseStudyFile(content, file.name);

      if (result.success) {
        modal.currentPack = result.study;

        fileName.textContent = file.name;
        detection.textContent = '✓ Format: ' + result.format.toUpperCase();
        detection.style.display = 'block';
        fileInfo.style.display = 'block';

        // Show summary
        var summary_data = result.summary;
        modal.querySelector('#summaryTitle').textContent = summary_data.unit;
        modal.querySelector('#statPoints').textContent = summary_data.teaching_points;
        modal.querySelector('#statQuestions').textContent = summary_data.questions;
        modal.querySelector('#statTables').textContent = summary_data.tables;
        modal.querySelector('#statDiagrams').textContent = summary_data.words;
        summary.style.display = 'block';

        status.textContent = '✓ Ready to import' + (summary_data.unanswered ? ' — ' + summary_data.unanswered + ' question(s) have no marked answer and will be left out' : '');
        status.className = 'status-message success';
        status.style.display = 'block';

        importBtn.disabled = false;
      } else {
        status.textContent = '✗ ' + (result.error || 'Failed to parse file');
        status.className = 'status-message error';
        status.style.display = 'block';
        fileInfo.style.display = 'block';
      }
    } catch (error) {
      status.textContent = '✗ Error: ' + error.message;
      status.className = 'status-message error';
      status.style.display = 'block';
    }
  };

  reader.readAsText(file);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (root) {
  root.MemImportUI = api;
}
})(typeof window !== 'undefined' ? window : global);
