#!/usr/bin/env node
/*
 * What the fellow is told when the model provider refuses a request — src/core/providererror.js.
 *
 *   node tests/verify-providererror-pure.js
 *
 * Pure Node, no browser and no build. The module decides one thing: given a status, a header and a body
 * nobody here controls, which sentence is shown. It has no fetch and no clock, so each response here is
 * an invented status with an invented body, and each expected sentence is the one the fellow can act on.
 *
 * What is measured, rather than assumed:
 *   - errMsg() finds the provider's words in each shape a body takes, and says nothing rather than
 *     "[object Object]" or "undefined" for a body with none;
 *   - a refusal from this site's own relay is told as the site's, never as "re-enter your key": there is
 *     no key of the fellow's in that request;
 *   - a rejected key, a blocked key and a permission the project lacks are three different sentences;
 *   - a 429 is read for what kind it is before anything is said: a daily quota, no allowance at all, or a
 *     rate limit with a wait, the wait taken from the Retry-After header (seconds or a date) and
 *     otherwise from the body's RetryInfo, and no reset is invented when neither gives one;
 *   - a retired model points at Connect, which rebuilds the menu, not at the menu;
 *   - the provider's words are escaped before they are written into the sentence, wherever they are;
 *   - the response is read as little as before the move: the header only on the rate-limit branch, the
 *     clock only for a Retry-After date, and whether it came from the relay is asked of the page's own
 *     function, with the response it was given;
 *   - the page's apiError() is the call into this, with the page's viaRelay, e and Date.now.
 *
 * The browser half is tests/verify-gemini.js, which calls apiError() in the built page with real
 * Response objects.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const P = require('../src/core/providererror.js').ProviderError;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
/* A check that the module does not throw has to say FAIL when it does, not end the run. */
const safely = fn => { try { return fn(); } catch (_) { return false; } };

/* The page's escaper, as the page declares it (verify-md-pure holds the page's to this). */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);

/* One refused response. Everything the module may read of it is counted, so a check can say what was
   read as well as what was said. */
function refused(status, body, opts) {
  opts = opts || {};
  const seen = { header: 0, relay: 0, now: 0, relayArg: null };
  const r = { status, url: opts.relay ? 'https://study.example/api/apex/gemini/stream' : 'https://provider.example/v1' };
  if (!opts.noHeaders) r.headers = { get: name => { seen.header++; return name === 'retry-after' && opts.retryAfter !== undefined ? opts.retryAfter : null; } };
  const viaRelay = x => { seen.relay++; seen.relayArg = x; return !!opts.relay; };
  const now = () => { seen.now++; return opts.now === undefined ? 0 : opts.now; };
  /* A module that throws is a module that says the wrong thing: each check that asked says FAIL, and the run goes on. */
  let text;
  try { text = P.message(r, opts.provider === undefined ? 'gemini' : opts.provider, body === undefined ? null : body, viaRelay, opts.esc || esc, now); }
  catch (e) { text = 'THREW: ' + e.message; }
  return { text, seen, r };
}
const say = (status, body, opts) => refused(status, body, opts).text;
const err = (message, details) => ({ error: Object.assign({ message }, details ? { details } : {}) });
const RETRY = s => [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: s }];

head('the provider\'s own words, out of whichever shape the body took');
{
  ok('Gemini\'s shape: {error:{message}}', P.errMsg({ error: { message: 'Quota exceeded' } }) === 'Quota exceeded');
  ok('a message at the top level', P.errMsg({ message: 'top' }) === 'top');
  ok('a detail at the top level', P.errMsg({ detail: 'fine print' }) === 'fine print');
  ok('the first that is there wins: error.message, then message, then detail',
     P.errMsg({ error: { message: 'first' }, message: 'second', detail: 'third' }) === 'first' && P.errMsg({ message: 'second', detail: 'third' }) === 'second');
  ok('an empty error.message is still the answer, not a reason to look further',
     P.errMsg({ error: { message: '' }, message: 'second' }) === '', JSON.stringify(P.errMsg({ error: { message: '' }, message: 'second' })));
  ok('an object where a string was expected is written as JSON, never "[object Object]"',
     P.errMsg({ detail: { code: 7, why: 'x' } }) === '{"code":7,"why":"x"}', P.errMsg({ detail: { code: 7, why: 'x' } }));
  ok('and is cut at 300 characters', P.errMsg({ message: { long: 'y'.repeat(900) } }).length === 300, String(P.errMsg({ message: { long: 'y'.repeat(900) } }).length));
  ok('a body with no words says nothing', P.errMsg({}) === '' && P.errMsg({ error: {} }) === '' && P.errMsg({ error: { message: null } }) === '');
  ok('and so does a body that is not an object', safely(() => P.errMsg(null) === '' && P.errMsg(undefined) === '' && P.errMsg('a string') === '' && P.errMsg(42) === ''));
  const loop = {}; loop.self = loop;
  ok('a value that cannot be written as JSON says nothing rather than throwing', safely(() => P.errMsg({ message: loop }) === ''));
}

head('a refusal from this site\'s own relay is the site\'s, not the fellow\'s key');
{
  const words = 'This deployment cannot check who is asking: ACCESS_TEAM_DOMAIN and ACCESS_AUD are not set.';
  const m403 = say(403, err(words), { relay: true });
  ok('a 403 from the relay says what the site said', m403 === 'This site refused to pass the request to Gemini: ' + words, m403);
  ok('and so does a 401', say(401, err(words), { relay: true }) === m403);
  ok('never "re-enter your key": no key of the fellow\'s was in that request', !/re-enter|rejected/i.test(m403) && !/re-enter|rejected/i.test(say(401, err(words), { relay: true })));
  ok('with no words from the site it still ends as a sentence', say(403, null, { relay: true }) === 'This site refused to pass the request to Gemini.', say(403, null, { relay: true }));
  ok('the same statuses straight from the provider are about the key',
     /rejected/.test(say(401, err(words))) && /Google denied permission/.test(say(403, err(words))));
  const cfg = say(503, err('This deployment has no GEMINI_API_KEY set.'), { relay: true });
  ok('a relay that is misconfigured is the site owner\'s to repair', /relay needs attention/.test(cfg) && /site owner/.test(cfg) && /personal key is not required/.test(cfg), cfg);
  ok('each of the relay\'s own faults reads that way',
     ['GEMINI_API_KEY', 'ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'APEX_MODELS', 'signing keys'].every(w => /relay needs attention/.test(say(500, err('fault: ' + w), { relay: true }))));
  ok('the same words from the provider itself are not the site\'s fault', /temporarily unavailable/.test(say(503, err('This deployment has no GEMINI_API_KEY set.'))));
  ok('a relay fault it does not know is an outage like any other', /Gemini is temporarily unavailable/.test(say(502, err('upstream closed'), { relay: true })));
  const limit = say(429, err('Too many requests in a minute.'), { relay: true });
  ok('the site\'s own request limit is said to be the site\'s', /This site’s request limit was reached/.test(limit) && /replacing your Gemini key will not fix/.test(limit), limit);
  ok('and the same words from the provider are the provider\'s rate limit', /Gemini’s quota or rate limit/.test(say(429, err('Too many requests in a minute.'))));
}

head('a key that was refused, a key that was blocked, a permission the project lacks');
{
  const REJECTED = 'Your API key was rejected. Tap the settings icon to re-enter it.';
  ok('a 401 is a rejected key', say(401, err('whatever')) === REJECTED);
  ok('a 400 that says the key is not valid is a rejected key too', say(400, err('API key not valid. Please pass a valid API key.')) === REJECTED);
  const blocked = say(403, err('API key not valid. Please pass a valid API key.'));
  ok('a 403 that says the key is not valid is rejected or blocked, and points at AI Studio', /rejected or blocked/.test(blocked) && /Google AI Studio/.test(blocked), blocked);
  ok('and so is a key reported blocked, leaked or revoked',
     ['This key has been blocked', 'the key was leaked', 'key is revoked'].every(w => /rejected or blocked/.test(say(403, err(w)))));
  const denied = say(403, err('Permission denied'));
  ok('any other 403 is a permission, and says a new key in the same project may not help', /Google denied permission/.test(denied) && /new key in the same project may not resolve/.test(denied), denied);
  ok('a 400 about anything else is not called a rejected key', say(400, err('Invalid JSON payload')) !== REJECTED && /^API error 400\. /.test(say(400, err('Invalid JSON payload'))));
}

head('billing');
{
  ok('a 402 says to check billing, for the project whose key it is', /Check billing, prepaid balance and spending limits for your key’s project/.test(say(402, err('Payment required'))));
  ok('and for the hosted key\'s project when the relay sent it', /for the hosted key’s project/.test(say(402, err('Payment required'), { relay: true })));
  ok('a 400 about credit is an account out of credit', say(400, err('Your credit balance is too low')) === 'Your Gemini account is out of credit.');
}

head('a 429 is read for what kind it is before anything is said');
{
  const daily = say(429, err('Quota exceeded', [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDay' }] }]));
  ok('a daily quota, found in the details, is said to reset at midnight Pacific', /daily quota was reached for your key’s project/.test(daily) && /midnight Pacific/.test(daily), daily);
  ok('and found in the message', /daily quota/.test(say(429, err('You exceeded your daily limit'))) && /daily quota/.test(say(429, err('requests per day'))));
  ok('a daily quota on the hosted key names that project', /daily quota was reached for the hosted key’s project/.test(say(429, err('per-day quota'), { relay: true })));
  const none = say(429, err('Quota exceeded for metric, limit: 0'));
  ok('a limit of zero is no allowance, not a wait', /no available allowance/.test(none) && !/Wait at least/.test(none), none);
  ok('and so is a 429 about billing, credit or balance', ['enable billing', 'out of credit', 'balance is empty'].every(w => /no available allowance/.test(say(429, err(w)))));
  ok('a limit of 10 is not a limit of 0', !/no available allowance/.test(say(429, err('limit: 10'))));
  const plain = say(429, err('You exceeded your current quota, please check your plan.'));
  ok('an unspecified quota invents neither a daily reset nor a wait',
     /quota or rate limit was reached for your key’s project/.test(plain) && !/daily|midnight|Wait at least/.test(plain) && /Check the active limit before retrying/.test(plain), plain);
  ok('and says that keys in one project share it', / Multiple keys in one project share quota\.$/.test(plain));
}

head('how long to wait, from the header first and the body second');
{
  const wait = t => (t.match(/Wait at least (\d+) seconds before trying again\./) || [])[1];
  ok('Retry-After in seconds', wait(say(429, err('slow down'), { retryAfter: '12' })) === '12');
  ok('rounded up, never down', wait(say(429, err('slow down'), { retryAfter: '0.2' })) === '1' && wait(say(429, err('slow down'), { retryAfter: '12.01' })) === '13');
  const at = Date.parse('Wed, 21 Oct 2026 07:28:30 GMT');
  ok('Retry-After as a date is the seconds from now to then', wait(say(429, err('slow down'), { retryAfter: 'Wed, 21 Oct 2026 07:28:30 GMT', now: at - 30000 })) === '30');
  ok('a date already past is no wait, and none is invented', !wait(say(429, err('slow down'), { retryAfter: 'Wed, 21 Oct 2026 07:28:30 GMT', now: at + 5000 })) && /Check the active limit/.test(say(429, err('slow down'), { retryAfter: 'Wed, 21 Oct 2026 07:28:30 GMT', now: at + 5000 })));
  ok('a header that is neither is no wait', !wait(say(429, err('slow down'), { retryAfter: 'soon' })));
  ok('with no header, the body\'s RetryInfo', wait(say(429, err('slow down', RETRY('45s')))) === '45' && wait(say(429, err('slow down', RETRY('1.5s')))) === '2');
  ok('the header wins when both are there', wait(say(429, err('slow down', RETRY('45s')), { retryAfter: '7' })) === '7');
  ok('a RetryInfo that is not seconds is no wait', !wait(say(429, err('slow down', RETRY('soon')))) && !wait(say(429, err('slow down', RETRY('')))));
  ok('a zero wait is no wait', !wait(say(429, err('slow down'), { retryAfter: '0' })) && !wait(say(429, err('slow down', RETRY('0s')))));
  ok('details that are not a list, or hold a null, do not throw', /quota or rate limit/.test(say(429, { error: { message: 'x', details: 'none' } })) && /quota or rate limit/.test(say(429, err('x', [null, 7]))),
     say(429, { error: { message: 'x', details: 'none' } }).slice(0, 60) + ' | ' + say(429, err('x', [null, 7])).slice(0, 60));
  ok('a response with no headers at all is read without them', /Check the active limit/.test(say(429, err('slow down'), { noHeaders: true })), say(429, err('slow down'), { noHeaders: true }).slice(0, 60));
}

head('a model that is gone, a provider that is down, and anything else');
{
  const gone = say(404, err('models/gemini-1.0-pro is not found for API version v1beta'));
  ok('a retired model points at Connect, which rebuilds the menu', /press <b>Connect<\/b> again/.test(gone) && !/pick a different one in settings/.test(gone), gone);
  ok('for a provider that is not Gemini a 404 points at the menu', /pick a different one in settings/.test(say(404, err('x'), { provider: 'other' })));
  ok('a 5xx is an outage, said as one', say(500, null) === 'Gemini is temporarily unavailable. Try again shortly, or choose another available model in Apex settings.' && say(503, err('overloaded')) === say(500, null));
  ok('anything else gives the status and the provider\'s words', say(418, err('I am a teapot')) === 'API error 418. I am a teapot', say(418, err('I am a teapot')));
  ok('and with no words, the status alone', say(418, null) === 'API error 418. ');
  ok('a body that was not JSON is read as no words, on every branch', [400, 401, 402, 403, 404, 418, 429, 500].every(s => say(s, null).length > 10 && !/^THREW/.test(say(s, null))),
     [400, 401, 402, 403, 404, 418, 429, 500].map(s => say(s, null)).filter(t => /^THREW/.test(t))[0] || '');
}

head('the provider\'s words are escaped before they are written');
{
  const attack = '<img src=x onerror=alert(1)> & "more"';
  const fallback = say(418, err(attack));
  ok('in the fallback sentence', fallback === 'API error 418. &lt;img src=x onerror=alert(1)&gt; &amp; &quot;more&quot;', fallback);
  const relay = say(403, err(attack), { relay: true });
  ok('and in the relay\'s refusal', relay === 'This site refused to pass the request to Gemini: &lt;img src=x onerror=alert(1)&gt; &amp; &quot;more&quot;', relay);
  /* Guard on the guard: with an escaper that does nothing the same checks must see the tag. */
  ok('with an escaper that does nothing the tag gets through, so the two checks above measure something',
     say(418, err(attack), { esc: String }).includes('<img') && say(403, err(attack), { relay: true, esc: String }).includes('<img'));
  ok('no sentence that is fixed text carries the provider\'s words at all',
     [[401, {}], [402, {}], [404, {}], [429, {}], [500, {}], [403, {}]].every(([s, o]) => !say(s, err(attack), o).includes('img')));
}

head('the response is read as little as it was');
{
  const a = refused(500, err('down'));
  ok('the header is not read off the rate-limit branch', a.seen.header === 0 && refused(404, null).seen.header === 0 && refused(401, null).seen.header === 0, `${a.seen.header} reads on a 500`);
  ok('and is read once on it', refused(429, err('slow down'), { retryAfter: '3' }).seen.header === 1);
  ok('but not when the 429 is a daily quota or no allowance, which return first', refused(429, err('daily'), { retryAfter: '3' }).seen.header === 0 && refused(429, err('billing'), { retryAfter: '3' }).seen.header === 0);
  ok('the clock is read only for a Retry-After date', refused(429, err('slow down'), { retryAfter: '3' }).seen.now === 0 && refused(429, err('slow down', RETRY('4s'))).seen.now === 0 && refused(500, null).seen.now === 0
     && refused(429, err('slow down'), { retryAfter: 'Wed, 21 Oct 2026 07:28:30 GMT' }).seen.now === 1);
  const b = refused(403, err('x'), { relay: true });
  ok('whether it came from the relay is asked of the page\'s function, with the response itself', b.seen.relay > 0 && b.seen.relayArg === b.r);
}

head('the page\'s apiError() is the call into this');
{
  /* The module decides; the page reads the body and says where the response came from. The page is
     read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const CALL = 'async function apiError(r,provider){\n  let j=null; try{ j=await r.json(); }catch(_){}\n  return ProviderError.message(r,provider,j,viaRelay,e,Date.now);\n}';
  ok('apiError() reads the body, then hands the module the page\'s viaRelay, e and Date.now',
     page.split(CALL).length - 1 === 1 && page.split('function apiError(').length - 1 === 1,
     `${page.split(CALL).length - 1} of those lines, ${page.split('function apiError(').length - 1} apiError() in the page`);
  const slot = page.indexOf('@@SLOT[src:src/core/providererror.js]@@');
  ok('and the module is written into the page once, above it', slot >= 0 && slot < page.indexOf(CALL) && page.indexOf('@@SLOT[src:src/core/providererror.js]@@', slot + 1) < 0, slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('the page keeps no second copy of the decision', !/function errMsg\(/.test(page) && page.split('Your API key was rejected').length - 1 === 0,
     `${page.split('Your API key was rejected').length - 1} of its sentences still in the page`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
