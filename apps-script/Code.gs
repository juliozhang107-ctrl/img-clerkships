/**
 * Feedback inbox for the clerkship list.
 *
 * Receives the "correct / not correct" votes and the new-program suggestions
 * sent by the website and writes one row per message into the "Feedback" tab
 * of the Google Sheet this script is attached to. Requests for email alerts
 * about an entry go to a separate "Alerts" tab, one row per email and program.
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
var TYPES = ['confirm', 'report', 'suggest', 'alert'];
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
    if (overDailyLimit()) return reply({ ok: false, error: 'Too many messages today. Please try again tomorrow.' });

    if (data.type === 'alert') {
      saveAlert(data);
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
function doGet() {
  return reply({ ok: true, service: 'clerkship-feedback' });
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
