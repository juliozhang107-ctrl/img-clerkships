/**
 * Feedback inbox for the clerkship list.
 *
 * Receives the "correct / not correct" votes and the new-program suggestions
 * sent by the website and writes one row per message into the "Feedback" tab
 * of the Google Sheet this script is attached to. Requests for email alerts
 * about an entry go to a separate "Alerts" tab, one row per email and program.
 * Reader reviews go to a "Reviews" tab. A review is shown on the website only
 * after its status cell is changed to "approved".
 *
 * Setup (once): see README.md, section "Connect the feedback inbox".
 *
 * The line below limits this script to the one sheet it is attached to.
 * @OnlyCurrentDoc
 */

var SHEET_NAME = 'Feedback';
var HEADERS = [
  'received_at', 'type', 'program_id', 'program_name', 'fields', 'details',
  'source_url', 'place', 'contact', 'data_version', 'status', 'review_notes', 'handled_at'
];
var ALERT_SHEET = 'Alerts';
var ALERT_HEADERS = ['received_at', 'email', 'program_id', 'program_name', 'data_version', 'status', 'notes'];
var REVIEW_SHEET = 'Reviews';
var REVIEW_HEADERS = ['received_at', 'program_id', 'program_name', 'tags', 'year', 'comment', 'data_version', 'status', 'notes'];
var REVIEW_TAGS = ['letter', 'visa', 'cost_ok', 'cost_more', 'hands_on', 'observing'];
var TYPES = ['confirm', 'report', 'suggest', 'alert', 'review'];
var MAX_PER_DAY = 400; // stops a flood from filling the sheet

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // Hidden field that real visitors never fill in. Bots do. Pretend success.
    if (data.website) return reply({ ok: true });

    if (TYPES.indexOf(data.type) === -1) return reply({ ok: false, error: 'Unknown message type.' });
    if (data.type !== 'suggest' && !clean(data.program_id, 120)) return reply({ ok: false, error: 'Missing program.' });
    if (data.type === 'suggest' && (!clean(data.program_name, 200) || !isUrl(data.source_url))) {
      return reply({ ok: false, error: 'A program name and a link are required.' });
    }
    if (data.type === 'alert' && !isEmail(data.contact)) return reply({ ok: false, error: 'That email does not look right.' });
    var tags = [], comment = '';
    if (data.type === 'review') {
      (Array.isArray(data.tags) ? data.tags : []).forEach(function (t) {
        if (REVIEW_TAGS.indexOf(t) > -1 && tags.indexOf(t) === -1) tags.push(t);
      });
      comment = clean(data.comment, 280);
      if (!tags.length && !comment) return reply({ ok: false, error: 'Please choose at least one item or write a comment.' });
    }
    if (overDailyLimit()) return reply({ ok: false, error: 'Too many messages today. Please try again tomorrow.' });

    if (data.type === 'alert') {
      saveAlert(data);
      return reply({ ok: true });
    }
    if (data.type === 'review') {
      tab(REVIEW_SHEET, REVIEW_HEADERS).appendRow([
        new Date(),
        clean(data.program_id, 120),
        clean(data.program_name, 200),
        tags.join(', '),
        /^(19|20)\d{2}$/.test(String(data.year)) ? String(data.year) : '',
        comment,
        clean(data.data_version, 20),
        'new', ''
      ]);
      return reply({ ok: true });
    }

    var fields = Array.isArray(data.fields) ? data.fields.slice(0, 10).join(', ') : '';
    sheet().appendRow([
      new Date(),
      data.type,
      clean(data.program_id, 120),
      clean(data.program_name, 200),
      clean(fields, 200),
      clean(data.details, 2000),
      isUrl(data.source_url) ? clean(data.source_url, 500) : '',
      clean(data.place, 120),
      clean(data.contact, 200),
      clean(data.data_version, 20),
      'new', '', ''
    ]);
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: 'The message could not be saved. Please try again.' });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

// Opening the web app address in a browser shows that the inbox is alive.
// With ?reviews=1 it gives the website the approved reader reviews.
function doGet(e) {
  if (e && e.parameter && e.parameter.reviews) return reply({ ok: true, reviews: approvedReviews() });
  return reply({ ok: true, service: 'clerkship-feedback' });
}

// Only rows whose status is "approved", newest first, and only the fields the page shows.
// The answer is kept for five minutes, so an approval can take that long to appear.
function approvedReviews() {
  var cache = CacheService.getScriptCache();
  var kept = cache.get('reviews');
  if (kept) return JSON.parse(kept);
  var out = [];
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REVIEW_SHEET);
  if (sh && sh.getLastRow() > 1) {
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, REVIEW_HEADERS.length).getValues();
    for (var i = rows.length - 1; i >= 0 && out.length < 300; i--) {
      var r = rows[i];
      if (String(r[7]).trim().toLowerCase() !== 'approved') continue;
      out.push({
        program_id: String(r[1]),
        tags: String(r[3]).split(',').map(function (t) { return t.trim(); }).filter(function (t) { return REVIEW_TAGS.indexOf(t) > -1; }),
        year: /^(19|20)\d{2}$/.test(String(r[4])) ? String(r[4]) : '',
        comment: String(r[5]).replace(/^'/, '').slice(0, 280)
      });
    }
  }
  try { cache.put('reviews', JSON.stringify(out), 300); } catch (ignore) {}
  return out;
}

function sheet() {
  return tab(SHEET_NAME, HEADERS);
}

function tab(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

// One row per email and program. Asking twice for the same entry does not add a second row.
function saveAlert(data) {
  var sh = tab(ALERT_SHEET, ALERT_HEADERS);
  var email = clean(data.contact, 200).toLowerCase();
  var id = clean(data.program_id, 120);
  var last = sh.getLastRow();
  if (last > 1) {
    var rows = sh.getRange(2, 2, last - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).toLowerCase() === email && String(rows[i][1]) === id) return;
    }
  }
  sh.appendRow([new Date(), email, id, clean(data.program_name, 200), clean(data.data_version, 20), 'active', '']);
}

// Plain text only: trims, limits length, and stops a message from being read as a spreadsheet formula.
function clean(value, max) {
  if (value === null || value === undefined) return '';
  var s = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function isEmail(value) {
  return typeof value === 'string' && value.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isUrl(value) {
  return typeof value === 'string' && /^https?:\/\/[^\s]+\.[^\s]+$/i.test(value.trim());
}

function overDailyLimit() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  var count = props.getProperty('day') === today ? Number(props.getProperty('count') || 0) : 0;
  if (count >= MAX_PER_DAY) return true;
  props.setProperties({ day: today, count: String(count + 1) });
  return false;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
