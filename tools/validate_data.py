#!/usr/bin/env python3
"""Checks data/programs.json and data/changelog.json before they are published.

Run from the repository root:  python3 tools/validate_data.py
Exits with an error (and prints why) if anything is malformed, so a bad edit
never reaches the public page.
"""
import json, re, sys
from urllib.parse import urlparse

errors = []
def need(cond, msg):
    if not cond:
        errors.append(msg)

def is_https(u):
    try:
        p = urlparse(u)
        return p.scheme == "https" and "." in p.netloc
    except Exception:
        return False

doc = json.load(open("data/programs.json", encoding="utf-8"))
meta, programs = doc.get("meta", {}), doc.get("programs", [])
need(re.fullmatch(r"\d{4}-\d{2}-\d{2}", meta.get("data_version", "")), "meta.data_version must be YYYY-MM-DD")
need(re.fullmatch(r"\d{4}-\d{2}", meta.get("last_full_verification", "")), "meta.last_full_verification must be YYYY-MM")
if meta.get("last_weekly_check") is not None:
    need(re.fullmatch(r"\d{4}-\d{2}-\d{2}", meta["last_weekly_check"]), "meta.last_weekly_check must be YYYY-MM-DD")
need(len(programs) >= 10, "fewer than 10 programs: refusing, this looks like accidental data loss")

KEYS = {"id", "name", "type", "city", "state", "state_name", "url", "vslo", "step1", "step2",
        "english_test", "life_support", "application_fee_usd", "tuition_4wk_usd", "notes", "verified",
        "review", "confirmations"}
STATUS = ("required", "not_required", "not_reported")
seen = set()
for p in programs:
    pid = p.get("id", "?")
    need(set(p) == KEYS, f"{pid}: unexpected or missing keys {sorted(set(p) ^ KEYS)}")
    need(re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", str(pid)), f"{pid}: id must be lowercase-with-dashes")
    need(pid not in seen, f"{pid}: duplicate id"); seen.add(pid)
    need(isinstance(p.get("name"), str) and 2 < len(p["name"]) <= 200, f"{pid}: bad name")
    need(p.get("type") in ("medical_school", "hospital"), f"{pid}: type must be medical_school or hospital")
    need(isinstance(p.get("city"), str) and p["city"], f"{pid}: missing city")
    need(re.fullmatch(r"[A-Z]{2}", str(p.get("state"))), f"{pid}: state must be a 2-letter code")
    need(isinstance(p.get("state_name"), str) and p["state_name"], f"{pid}: missing state_name")
    need(is_https(p.get("url", "")), f"{pid}: url must be an https link")
    need(isinstance(p.get("vslo"), bool), f"{pid}: vslo must be true or false")
    for k in ("step1", "step2", "life_support"):
        need(p.get(k) in STATUS, f"{pid}: {k} must be one of {STATUS}")
    et = p.get("english_test")
    need(isinstance(et, dict) and set(et) == {"status", "detail"} and et.get("status") in STATUS
         and (et.get("detail") is None or (isinstance(et["detail"], str) and len(et["detail"]) <= 80
                                           and et.get("status") == "required")),
         f"{pid}: english_test must be {{status: one of {STATUS}, detail: text or null (only when required)}}")
    for k in ("application_fee_usd", "tuition_4wk_usd"):
        v = p.get(k)
        need(v is None or (isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 30000), f"{pid}: {k} must be null or a whole dollar amount")
    need(p.get("notes") is None or (isinstance(p["notes"], str) and len(p["notes"]) <= 300), f"{pid}: notes too long")
    need(re.fullmatch(r"\d{4}-\d{2}", str(p.get("verified"))), f"{pid}: verified must be YYYY-MM")
    rv = p.get("review")
    need(rv is None or (isinstance(rv, dict) and set(rv) == {"since", "reason"}
                        and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(rv.get("since")))
                        and isinstance(rv.get("reason"), str) and len(rv["reason"]) <= 160),
         f"{pid}: review must be null or {{since: YYYY-MM-DD, reason: short text}}")
    need(isinstance(p.get("confirmations"), int) and p["confirmations"] >= 0, f"{pid}: confirmations must be a count")

log = json.load(open("data/changelog.json", encoding="utf-8"))
need(isinstance(log, list) and log, "changelog must be a non-empty list")
for i, c in enumerate(log):
    need(set(c) == {"date", "program_id", "summary", "source_url"}, f"changelog[{i}]: wrong keys")
    need(re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(c.get("date"))), f"changelog[{i}]: date must be YYYY-MM-DD")
    need(c.get("program_id") is None or isinstance(c["program_id"], str), f"changelog[{i}]: bad program_id")
    need(isinstance(c.get("summary"), str) and 0 < len(c["summary"]) <= 400, f"changelog[{i}]: summary missing or too long")
    need(c.get("source_url") is None or is_https(c["source_url"]), f"changelog[{i}]: source_url must be https or null")
dates = [c["date"] for c in log if isinstance(c.get("date"), str)]
need(dates == sorted(dates, reverse=True), "changelog must be newest first")

if errors:
    print("DATA CHECK FAILED")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print(f"Data check passed: {len(programs)} programs, {len(log)} changelog entries.")
