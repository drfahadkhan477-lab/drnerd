/* Build reusable search indexes in a short-lived worker. The standalone
   build embeds its existing pure source; no network or separate asset. */
(function (root) {
'use strict';
var source = /* @memorizer-index-worker */ null;
var timeoutMs = 30000;
function build(docs) {
  if (!source || !root.Worker) return Promise.resolve().then(function () { return root.MemAsk.build(docs); });
  return new Promise(function (resolve, reject) {
    var url, worker, timer, settled = false;
    function finish(e, value) {
      if (settled) return; settled = true;
      if (timer) clearTimeout(timer); if (worker) worker.terminate(); if (url) URL.revokeObjectURL(url);
      if (e) reject(e); else resolve(value);
    }
    try {
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); worker = new root.Worker(url);
      worker.onmessage = function (e) { finish(e.data.error ? new Error(e.data.error) : null, e.data.index); };
      worker.onerror = function () { finish(new Error('Search indexing worker could not run.')); };
      timer = setTimeout(function () { finish(new Error('Search indexing took too long.')); }, timeoutMs);
      worker.postMessage(docs);
    } catch (e) { finish(e); }
  }).catch(function () { return root.MemAsk.build(docs); });
}
root.MemIndexer = { build: build };
})(typeof window !== 'undefined' ? window : this);
