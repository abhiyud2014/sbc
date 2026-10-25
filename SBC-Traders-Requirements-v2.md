# SBC-LMS — Requirements Document v2: Confirmed Requirements & Build Plan

**Prepared for:** SBC-Traders
**Prepared by:** [Your Name / Company]
**Version:** 2.0 — supersedes v1 questionnaire where noted
**Date:** 16 October 2026
**Source of requirements:** SBC-Traders' written confirmation shared on 16 Oct 2026, plus the attached student list (`students DETAILS.csv`, 31 records)

---

## 1. Purpose of this Document

SBC-Traders has reviewed the v1 questionnaire and confirmed a first set of concrete requirements. This document:

1. **Restates each confirmed requirement precisely** (so we both agree on what "done" means).
2. **Maps each requirement against the current Proof of Concept** — what already works, what is partial, and what must be newly built.
3. **Lists the Phase-1 scope** — including the explicit first deliverable: *one single batch containing all students from the attached list*.
4. **Raises only the remaining ambiguities** that block estimation (Section 6) — everything else is treated as agreed.
5. **Reports data-quality findings** on the attached student list (Section 5).

Items from v1 that SBC-Traders has **not** yet confirmed (payments, certificates, notification channels, AI-bot scope, etc.) are listed in **Section 8 — Deferred/Still Open** and are out of scope for Phase 1.

---

## 2. Confirmed Requirements (Restated)

> Each requirement is given an ID so it can be referenced in testing, invoicing and future discussions. The *"Requirement as stated"* text paraphrases SBC-Traders' message; *"Interpretation"* is our reading, which Section 6 questions will refine where flagged.

### R1 — Login / Authentication

| ID | Requirement as stated | Interpretation |
|---|---|---|
| **R1.1** | Admin (Host) enters only a **static password (no expiry)**, which the Admin can **change whenever required**. | Single admin account. Password never expires. Admin changes it himself from inside the app (not by editing server config). Stored only as a hash. |
| **R1.2** | Student username = **full email ID**. Password = **random 6-character alphanumeric + special characters**, **no expiry**, student **cannot change** it. | Auto-generated credentials at registration time. No self-service password change. No password expiry, no password reset by student. |
| **R1.3** | Student can log in on **only one device (one instance)**. A second-device attempt must show a **message to sign out from the last device**. | One active login session per student at any time. Behaviour on conflict to be confirmed (Q2). |

### R2 — Batch & Student Management

| ID | Requirement as stated | Interpretation |
|---|---|---|
| **R2.1** | Admin can **create / modify / delete a batch**. | Standard batch CRUD (already available in PoC). |
| **R2.2** | Admin can **bulk-upload the student list** in the same 4-column format: `SL NO, NAME, CONTACT NO, EMAIL ID`. | CSV/Excel upload screen with column mapping/validation and a row-by-row result report. |
| **R2.3** | Admin can also **manually register students one by one**. | Single-student add form (already available; will adopt the new password rules). |
| **R2.4** | While registering, the password must be **dynamically generated**. | System generates the password per R1.2 rules; admin does not type it. |
| **R2.5** | Admin (Host) can **send the login details to individual students**. | Delivery mechanism to be confirmed (Q4). |
| **R2.6** | **First requirement: create a single batch and register all students from the attached list.** | Phase-1 headline deliverable: 1 batch + 31 students imported with generated passwords. |

### R3 — Meeting Management

| ID | Requirement as stated | Interpretation |
|---|---|---|
| **R3.1** | **One recurring meeting assigned to one batch.** | A single Zoom meeting *series* (recurring) targeted at one batch; all its students auto-enrolled/registered. |
| **R3.2** | Running **for 45 days, or whatever period the Admin/Host chooses**. | Batch has a validity period (default suggestion 45 days) that the admin can set/override when creating or editing the batch. |
| **R3.3** | **When the batch is over, the meeting link is removed and students cannot log in to the platform.** | On batch expiry: (a) the session/meeting link disappears from student view, and (b) student login is refused. Behaviour details per Q6–Q8. |

---

## 3. Gap Analysis: Requirement vs Current PoC

Status legend: ✅ **Available** (works today) · 🟡 **Partial** (exists but must be modified) · 🔨 **New build** (does not exist at all)

| ID | Requirement | Status | What exists today | Work required |
|---|---|---|---|---|
| R1.1 | Admin static password, changeable in-app | 🟡 Partial | Admin logs in with a shared PIN stored hashed in the DB; the PIN can currently only be changed by editing a server config file and restarting. | Add an in-app **"Change Admin Password"** screen; enforce a minimum strength; update the stored hash immediately. |
| R1.2 | Student = email + auto-generated password, no self-change | 🟡 Partial | Students already log in with email + password; passwords stored as scrypt hashes; **but** students can currently change their own password, and passwords are set manually. | Add **random password generation** at registration (R2.4); **disable/remove** the student self-change password feature; ensure no expiry exists (already true). |
| R1.3 | One device per student | 🔨 New | Multiple simultaneous logins are currently allowed; no device/session concept. | Enforce **one active session per student**: a new login revokes/invalidates the previous session; the old device is signed out with a clear message. Message wording per Q2. |
| R2.1 | Batch create/modify/delete | ✅ Available | Full batch CRUD exists (name, description, enrolment). | Add **validity period (start/end date)** fields to batches (driven by R3.2). |
| R2.2 | Bulk upload in 4-column CSV format | 🔨 New | Only a developer-run one-off JSON import; no UI. | New **Bulk Upload screen**: accept CSV/Excel with exactly `SL NO, NAME, CONTACT NO, EMAIL ID`, validate each row, show success/error summary, commit in one transaction. |
| R2.3 | Manual student registration | ✅ Available | Add/edit/delete students with notes. | Adopt auto-generated passwords; add **Contact No** field (does not exist in the data model today). |
| R2.4 | Dynamic password generation | 🔨 New | Admin types a password (or students share a class password). | Generator per Q1 (length/charset); show the generated password to the admin at creation; store only the hash. |
| R2.5 | Send login details to student | 🔨 New | No email/SMS is ever sent by the system (v1 gap G6). | Depends on Q4 — minimum: one-click **copy/display** of credentials; optionally email/SMS/WhatsApp integration (third-party cost). |
| R2.6 | Single batch + all 31 students | 🔨 New (operational) | Demo data exists (Batch-A Morning / Batch-B Evening). | Create the production batch, import the 31 validated records, generate passwords, deliver credentials. |
| R3.1 | One recurring meeting ↔ one batch | 🟡 Partial | Single (non-recurring) Zoom meetings can be created and assigned to one or more batches; all students of the target batch are auto-registered with personal join links. | Add **Zoom recurrence** support (e.g. daily/weekday series) in meeting creation and the UI; confirm pattern per Q3. |
| R3.2 | 45-day (admin-defined) validity | 🔨 New | **No concept of validity/expiry anywhere** (v1 gap G1). | Batch `start_date` / `end_date` fields, default 45 days, editable by admin; expiry enforced on login and session visibility (R3.3). |
| R3.3a | Meeting link removed after batch ends | 🔨 New | Links stay visible forever. | On expiry: hide/withdraw all of the batch's session links from student view; admin still keeps history. Decision per Q6. |
| R3.3b | Students cannot log in after batch ends | 🔨 New | Login has no batch awareness. | Access gate: a student whose **only** batch has expired is refused login with a clear message ("Your batch has ended — contact SBC-Traders"). Decision per Q7. |
| — | Contact number field | 🔨 New | Not in the data model. | Add `phone` to the student record; captured on CSV upload and manual entry. |
| — | Admin sees generated passwords / list export | 🔨 New | No credential view. | Admin student list shows the generated password (or a "reveal/copy" action) so it can be sent to the student (Q4). |

**Summary: 2 available, 5 partial, 8 new-build items.**

---

## 4. Phase-1 Scope (Proposed)

### 4.1 In scope

1. **Admin authentication rework** — static in-app changeable password (R1.1).
2. **Student authentication rework** — auto-generated passwords, email-as-username, self-change removed, single-device enforcement (R1.2, R1.3).
3. **Student data model** — add Contact No; keep SL NO as an external reference (Q9).
4. **Bulk Upload screen** — exact 4-column format, validation report, one-batch assignment (R2.2).
5. **Manual student registration with generated password** (R2.3, R2.4).
6. **Credential delivery** — minimum viable: reveal/copy in admin UI; channel option per Q4 (R2.5).
7. **Batch validity** — start/end date (default 45 days), admin editable (R3.2).
8. **Recurring Zoom meeting tied to one batch** — Zoom recurrence support (R3.1).
9. **Expiry enforcement** — meeting links hidden + student login blocked when batch ends (R3.3a, R3.3b).
10. **Pilot data load** — create ONE batch, import all 31 students from `students DETAILS.csv`, generate credentials, hand over the credential sheet (R2.6).

### 4.2 Explicitly out of scope for Phase 1

- Payments/fees, certificates, automated email/SMS notifications (unless Q4 selects them), AI-bot upgrade, mobile apps, reports beyond what the PoC already has, multi-admin accounts, self-registration.
- These remain tracked from v1 (Section 8).

### 4.3 What Phase 1 does NOT change

- Existing modules keep working: Dashboard, Zoom Sessions, Meeting Activity/Attendance, Cloud Recordings, Q&A Log, Reference Hub, AI Knowledge Bot (demo), student "My Classes" view.

---

## 5. Student List Intake Report (`students DETAILS.csv`)

**Source file:** `C:\Users\Manas.Rath\Downloads\students DETAILS.csv` (received 16 Oct 2026)
**Format:** CSV, header `SL NO, NAME, CONTACT NO, EMAIL ID`
**Records:** 31 students (SL NO 1–31)

### 5.1 Validation results

| Check | Result |
|---|---|
| Rows present | ✅ 31 |
| Columns match agreed format | ✅ 4/4 columns exact |
| Missing email (would break login) | ✅ none |
| Duplicate email IDs | ✅ none |
| Duplicate contact numbers | ✅ none |
| Contact numbers = 10 digits | ✅ all valid |
| Email format valid | ⚠️ **1 invalid** — SL 22 `omprakashsahoo7847@gmail.vom` (`.vom` is a typo; likely `.com`) |
| Leading/trailing/double spaces in NAME or EMAIL | ⚠️ **8 rows** need trimming — SL 18, 20, 22, 23, 25, 27, 28, 30 |

### 5.2 Actions proposed

- **Auto-fix:** trim spaces on import (no data lost).
- **Needs client confirmation (Q10):** correct SL 22's email to `...@gmail.com`? An undeliverable email means that student cannot log in / cannot receive credentials.
- The cleaned file will be re-imported on every retry safely — the import will be **idempotent** (re-uploading the same file will update, not duplicate).

---

## 6. Remaining Clarifications (Blocking Questions)

> These are the only open questions for Phase 1. Please answer inline (Yes/No or a short choice).

**Q1 — Generated password format.** "Random 6 alphanumeric with special characters" — please confirm one:
- (a) **6 characters total**, guaranteed to include ≥1 letter, ≥1 digit, ≥1 special character (as literally stated — short for security), or
- (b) 6 alphanumeric **plus** a special character (7+ total), or
- (c) recommended: **8 characters** with mixed types (still short, significantly harder to guess).
Also: must the special characters be limited to a safe set (e.g. `!@#` only) to avoid issues when typing on mobile?

**Q2 — Single-device behaviour.** Which exact behaviour when a student logs in on a second device?
- **Option A (recommended):** the **new device logs in** and the **old device is signed out automatically**, showing "You have signed in on another device."
- **Option B:** the **new device is blocked**, showing "Please sign out from your last device first."
SBC Traders' wording ("a message should pop up to sign out from the last device") sounds like **Option B** — please confirm.

**Q3 — Recurring meeting pattern.** For the 45-day series:
- Which **days** (e.g. Mon–Fri, or all 7 days, or specific days)?
- One **fixed time** per day? What is the session **duration** (e.g. 60 min)?
- Should the series be created automatically for the whole validity period in one go? (Proposed: yes.)

**Q4 — How should the admin "send login details" to a student?** Choose the Phase-1 level:
- **(a) Manual (no cost):** admin clicks "Show credentials" and copies/sends them personally (WhatsApp/email by hand).
- **(b) Automatic email:** system emails the credentials — requires SMTP/mail service setup and a sending domain (small monthly cost).
- **(c) SMS/WhatsApp:** requires a paid gateway (Twilio/DigitalSmS/WATI etc.) — additional cost and approval.
Recommended for Phase 1: **(a)**, with **(b)** as a Phase-2 option.

**Q5 — Password recovery.** Students cannot change their password — so when a student forgets/loses it, the **admin regenerates and re-sends** it. Confirm this is acceptable (no self-service reset ever).

**Q6 — When the batch ends, what happens to the meeting link?**
- **(a) Hidden from students only** (admin still sees the series and its history/recordings) — recommended;
- **(b) The Zoom meeting series is actually deleted** (irreversible — not recommended; attendance history would be orphaned).

**Q7 — When the batch ends, what does the blocked student see?**
- Login refused with message: *"Your batch has ended. Please contact SBC-Traders to continue."`? (proposed)
- Any **grace period** (e.g. 3 days) before blocking? (default: none)
- If the batch is later **extended**, access returns automatically — confirm.

**Q8 — What defines "45 days"?**
- From a **batch start date** set by the admin (proposed — one date for all students), or
- From **each student's own enrolment date** (students joining late get 45 days each)?
Also confirm the default: new batches default to **45 days** but the admin can type any duration.

**Q9 — SL NO column.** Should the system store the client's SL NO (1–31) as a reference number on each student, or ignore it and generate its own IDs? (Proposed: store it as "Client Ref".)

**Q10 — SL 22 email correction.** Confirm changing `omprakashsahoo7847@gmail.vom` → `omprakashsahoo7847@gmail.com`?

**Q11 — Contact number use.** The phone number will be stored on the student record. Is it needed for anything in Phase 1 beyond record-keeping (e.g. used later by an SMS/WhatsApp channel in Q4)?

**Q12 — Student visibility.** With one batch for now: every student sees **only their own batch's** recurring session (proposed — this is current behaviour). Any need for students to see **past recordings/materials of their batch after expiry** even though login is blocked? *(Note: R3.3b blocks login entirely, so post-expiry recordings would be unreachable — confirm that is intended.)*

---

## 7. Acceptance Criteria (How Phase 1 Will Be Tested)

| ID | Acceptance criterion |
|---|---|
| AC1 | Admin can log in with the configured static password; can change it from the UI; the new password works on next login everywhere; old password no longer works. |
| AC2 | Bulk-uploading a file with the 4 agreed columns creates students with **Contact No** stored, **SL NO kept as reference**, spaces trimmed, and rejects/reports invalid rows (e.g. SL 22 email). |
| AC3 | Every created student has a **unique, system-generated password** meeting the Q1 format; password visible/copyable by admin only; stored hashed (never plaintext in DB or logs). |
| AC4 | Student **cannot** find any password-change function in the UI or API. |
| AC5 | Student logging in on device B signs out / is blocked per the Q2 choice, with the exact agreed message shown. |
| AC6 | A batch with start + end date (default 45 days) can be created/edited by admin. |
| AC7 | The recurring Zoom meeting appears once, recurs on the agreed Q3 days/time for the validity period, and is assigned to exactly one batch; all its students hold personal join links. |
| AC8 | **After the batch end date passes:** (a) the session/link is no longer visible to students; (b) student login is refused with the agreed message; (c) admin still sees all data. |
| AC9 | Extending the batch end date immediately restores login and session visibility. |
| AC10 | One batch exists containing **all 31 students** from the attached list, and the admin receives the credential sheet for handover. |
| AC11 | Existing PoC modules (Dashboard, Recordings, Materials, Q&A, My Classes) continue to work with no regression (existing 44-test suite passes). |

---

## 8. Deferred / Still Open from v1 (Not in Phase 1)

Awaiting SBC-Traders' input from the v1 document — will be scheduled in a later phase:

- Payments/fees/invoicing & GST receipts (v1 §9.11)
- Certificates & completion criteria (v1 §9.12)
- Automated notification engine beyond Q4's choice (reminders, broadcasts) (v1 §9.9, §9.14)
- AI Knowledge Bot upgrade from rule-based demo to a real LLM (v1 §9.8)
- Reports: PDF, scheduled reports, engagement analytics (v1 §9.13)
- Roles beyond Admin/Student (mentor role, multiple admins) (v1 §3)
- Security hardening backlog: login rate-limiting, audit log, one access-control fix in "My Classes" (v1 G11, G13)
- Branding decision (SBC-LMS vs SBC Traders name/logo/domain) (v1 §230)

---

## 9. Immediate Next Steps

1. SBC-Traders answers **Q1–Q12** (short answers are fine).
2. We confirm the **fix for SL 22's email** and re-validate the list.
3. Fixed **Phase-1 estimate + timeline** issued against the confirmed scope (Section 4).
4. On approval: build in the order *Auth (R1) → Bulk upload (R2) → Validity + recurrence (R3) → Pilot data load (R2.6)*.
5. Pilot handover: 1 batch, 31 students, credential sheet, acceptance run against Section 7.

---

*End of document — please return answers to Q1–Q12 to lock the Phase-1 specification.*
