# SBC-LMS — Proof of Concept: Functional Overview & Detailed Requirements Questionnaire

**Prepared for:** SBC-Traders
**Prepared by:** Manas Rath & Tanmaya Swain

**Version:** 1.0

**Date:** 15 October 2026

**Status:** For review — please complete the requirement sections marked 📝 so we can move from PoC to production specification.

---

## 1. Purpose of this Document

A Proof of Concept (PoC) version of the **SBC-LMS** (Learning Management System for trading education) has been built based on our initial discussion and our own understanding of your operating model.

This document has **two goals**:

1. **Describe exactly what the PoC can do today** — every module, screen, role, and capability, so you can see where we currently stand.
2. **Ask the precise questions whose answers we need from you** — every item marked 📝 is an open requirement. Your answers will become the official Functional Requirements Specification for the next phase.

> Please treat sections marked **📝 Open Requirement** as a questionnaire. Answers may be as short as "Yes / No / Same as PoC" or as detailed as you like — we will follow up on anything ambiguous.

---

## 2. System Snapshot (What the PoC Is Today)

| Aspect | Current State |
|---|---|
| Application name | SBC-LMS (working title; branding to be confirmed) |
| Application type | Web application, runs in any modern browser |
| Platform | Windows/server Locally hosted; accessed by localhost and port |
| Delivery model | Single unified portal — one login screen, role decides what is visible |
| Live classes | Powered by **Zoom** (Zoom cloud account, Server-to-Server API integration) |
| Database | SQLite (single-file database, suitable for PoC; production may move to PostgreSQL/MySQL) |
| Authentication | Admin signs in with a PIN; students sign in with Email + Password |
| Registration | **No self-sign-up** — students are added by the admin only |
| Current scale | Tested with demo batches/students; single-admin operation |
| Data at rest | Students, batches, enrolment, Q&A, knowledge base, materials, chat history, sessions |

### 2.1 What "PoC level" means here

The PoC is a **working, functional system**, but it is intentionally not yet hardened for production. Known PoC limitations are listed openly in **Section 11 (Known Gaps)** so there are no surprises.

---

## 3. Roles & Access Control

The PoC currently supports **two roles**:

| # | Role | How they sign in | Can they do |
|---|---|---|---|
| 1 | **Admin (Host / Mentor / SBC staff)** | PIN code | Everything: dashboard, students, batches, sessions, attendance, recordings, Q&A, materials, AI bot, announcements |
| 2 | **Student (Participant)** | Email + Password | Only: view their own classes & join links, view recordings, view reference material, ask the AI bot |

**Additional behaviour:**

- There is **no self-registration**. Students and batches are created by the Admin.
- The Admin panel has a **"View the app as Student"** preview mode (display only — it does not change actual permissions).
- Students can see **only sessions assigned to batches they are enrolled in**.
- Students can change their own password; the Admin can set or clear an individual student's password.
- A **shared Class Password** exists: if a student has no personal password, they use the class password to log in. Rotating the class password logs out nobody but stops old class-password usage.
- Login sessions expire after **12 hours** and can be revoked by logging out.

### 📝 Open Requirements — Roles

1. **How many distinct roles do you need?** e.g. Super Admin, Admin, Mentor/Trainer, Assistant, Student, Parent/Guardian, Auditor/Viewer?
2. Do **mentors/trainers** need a role that is *different* from the main Admin — e.g. can see only their own batches, cannot see billing or all students?
3. Can **multiple admins** work simultaneously, each with their own credentials? (PoC uses a single shared PIN.)
4. Should students be able to **register themselves** (e.g. after paying a fee), or must every student always be added/approved by staff?
5. Should students be able to **reset a forgotten password** by email, or is manual reset by staff acceptable?
6. Do **parents** need separate logins to monitor a student's attendance/progress?
7. Any need for **multi-level administration** (branch-level admins vs. head-office admin)?

---

## 4. Students — Functional Description & Requirements

### 4.1 What the PoC does today

**Student record fields:** Name, Email, Notes (free-text remarks), Password (optional), Enrolled Batches, created date.

**Admin capabilities:**

- Add a single student, edit details, delete a student.
- Set or clear an individual student's personal password.
- View all students in one list with **CSV export**.
- Add free-text notes per student (e.g. "attends only weekend sessions").
- See, per student: batches enrolled, attendance roster, Q&A history, personal Zoom join links.
- Bulk import currently only via a one-off JSON file (developer task, not a UI feature).

### 📝 Open Requirements — Students

8. **Which student fields are mandatory?** For example:
   - Full name, email, phone/WhatsApp, city, age/DOB, occupation, trading experience level, referred-by, payment status, photo, ID proof?
9. Is **email mandatory** for every student? (Attendance/session joining in the PoC relies on email for Zoom registration.)
10. Do you need **bulk student import** (CSV/Excel upload) in the UI?
11. Do you need **student categories/tags** (e.g. "Free trial", "Premium", "Beginner", "Advanced")?
12. Should a student be able to see their **own attendance %, session history, and progress** in a personal dashboard?
13. Do you need a **student profile photo**? Any KYC/document upload?
14. **Duplicate handling** — what should happen if the same email is added twice?
15. Do you need **bulk actions** (bulk delete, bulk assign to batch, bulk password reset)?
16. Should the Admin be able to **deactivate** a student without deleting them?

---

## 5. Batches — Functional Description & Requirements

### 5.1 What the PoC does today

**Batch record fields:** Name, Description, created date.

**Admin capabilities:**

- Create, rename, edit, delete batches.
- Enrol/unenrol students into batches (many-to-many — a student can belong to several batches).
- Assign a batch (or multiple batches) as the **target audience of a Zoom session** — only students in the targeted batches see that session and get auto-registered for it.
- Remove a student from a batch: they will not be registered for future sessions; past attendance stays in the roster.
- View an attendance roster per batch and export it.

**Demo data shipped with the PoC:** `Batch-A Morning` and `Batch-B Evening`.

### 📝 Open Requirements — Batches

17. **How is a batch defined in your business?** Is it:
    - A group of students joining on the same date?
    - A course/cohort (e.g. "Basics of Futures", "Price Action Level 2")?
    - A time-slot grouping (Morning batch / Evening batch)?
    - Something else?
18. **Batch properties needed — please confirm/add:**

    | Property | Needed? (Y/N) | Notes |
    |---|---|---|
    | Batch name | | |
    | Batch code / ID (e.g. SBC-2026-01) | | |
    | Description / syllabus | | |
    | **Start date** | | |
    | **End date / duration** | | |
    | Strength / seat cap (max students) | | |
    | Assigned mentor/trainer | | |
    | Fee / price of the batch | | |
    | Batch status (Upcoming / Active / Completed / Cancelled) | | |
    | Course/curriculum attached | | |
    | Time slot (e.g. 7:00 AM – 8:00 AM IST) | | |
    | Recurring days (Mon–Fri, etc.) | | |
    | Language of instruction | | |
    | Other: ___________ | | |

19. **Batch hierarchy** — do you need: *Course → Batch → Session*? Or is a flat list of batches sufficient?
20. Can a student belong to **multiple batches simultaneously**? (PoC: yes.)
21. Can a student be **moved from one batch to another**? What happens to their past attendance?
22. Do you need to see a batch **capacity/waitlist** (max students, waitlist when full)?
23. Should batches be **auto-created** (e.g. every month a new batch is generated)?
24. Can a batch contain **sub-groups** (e.g. a batch split into two discussion rooms)?
25. Who is allowed to create/edit batches — Admin only, or Mentors too?

---

## 6. Batch Validity — 📝 Open Requirements (Critical)

> **Current state:** The PoC has **no concept of batch validity or expiry**. A batch exists until someone deletes it, and a student's access never expires. This is one of the most important requirements we need from you.

26. **Does a batch have a validity period?**
    - [ ] Yes — defined by Start Date + End Date
    - [ ] Yes — defined by a duration (e.g. 3 months) from an enrolment/start date
    - [ ] Yes — defined by a number of sessions (e.g. 24 sessions)
    - [ ] No — batches are open-ended
27. **What happens when a batch's validity ends?** (Select all that apply)
    - [ ] Students can no longer log in
    - [ ] Students can log in but see no sessions
    - [ ] Students can still see recordings/materials, but not live sessions
    - [ ] Everything remains accessible; the batch is just marked "Completed"
    - [ ] Other: ___________
28. **Is validity per-batch or per-student?** E.g. Batch runs 3 months, but one student paid for 6 months — should an individual student's access window be independently settable?
29. Should the system **warn before expiry** (to admin and/or student) — e.g. "Batch expires in 7 days"?
30. Is there a **grace period** after expiry? If yes, how long?
31. Can validity be **extended/renewed** (paid renewal)? If yes, by whom and with what effect on old data?
32. Is validity **tied to payment** (access = payment cleared) or purely to dates?
33. Should an expired batch automatically become **read-only** (no new sessions can be scheduled on it)?
34. Do sessions themselves have validity — e.g. **recording available for only N days** after the class?

---

## 7. Student Data Retention After Batch Completion — 📝 Open Requirements (Critical)

> **Current state:** The PoC **never deletes or archives anything automatically**. When a batch finishes, students, their details, attendance, Q&A and chat history remain in the system indefinitely (unless manually deleted).

35. **Should the platform keep student details after a batch completes?**
    - [ ] Yes — keep permanently (student remains in the system)
    - [ ] Yes — keep for a defined retention period (e.g. 12 months), then archive/purge
    - [ ] Yes — student record remains, but they are moved to an "Alumni/Completed" state
    - [ ] No — data should be deleted on completion
36. If retained, **which data must remain accessible?**
    - [ ] Contact details
    - [ ] Attendance records
    - [ ] Q&A history
    - [ ] Chat/AI-bot history
    - [ ] Recordings they watched / session join links
    - [ ] Payment history
    - [ ] Notes/remarks
37. Should a completed-batch student be able to **log in again** after the batch ends? If yes, what should they see?
38. Can a completed student be **re-enrolled into a new batch** with their existing record (history preserved), or must a fresh record be created?
39. Do you need an **archive** view (completed batches & students hidden from the active list but retrievable)?
40. **Deletion policy:** when the admin deletes a student, should:
    - [ ] The record be hard-deleted (gone forever)?
    - [ ] The record be soft-deleted/anonymised (attendance stats retained, personal details removed)?
41. Are there any **legal/compliance retention obligations** (e.g. Indian DPDP Act, SEBI-related record keeping) we must honour?
42. Do you need a **data export** (download a student's complete data) or **data deletion request** (right-to-be-forgotten) workflow?

---

## 8. Sessions (Live Classes) — Functional Description & Requirements

### 8.1 What the PoC does today

- Admin creates a **Zoom meeting/session** from the UI: topic, date/time, duration, description.
- Admin can **enable registration** for the session and assign **one or more target batches**.
- All students in the targeted batches are **auto-registered**, producing a **personal join link per student**.
- Students see only their own sessions under **"My Classes"**, with a Join button that opens Zoom.
- Sessions are classified as **Upcoming** or **Previous** (based on start/end time) — there is no other time-slot logic.
- Admin can view/edit/delete sessions, change targets, and view registrant status (approved/waitlisted/declined).
- **Past session data** is pulled live from Zoom: participants who joined, Q&A, meeting summary, attendance, cloud recordings.
- Upcoming sessions are shown on the Dashboard; there is **no scheduler/cron job** and **no automatic reminders**.

### 📝 Open Requirements — Sessions

43. **Morning / Evening sessions — please clarify your operating model:**
    - [ ] Yes, you run Morning sessions, Evening sessions, **and** students may join **both**
    - [ ] Yes, but a student may join **only the slot they enrolled for**
    - [ ] Only one slot per day currently
    - [ ] Other: ___________
44. If multiple slots exist:
    - Is the slot a property of the **batch** (Batch A = Morning, Batch B = Evening) or of the **session** (each session individually scheduled)?
    - Can a student enrolled in a Morning batch **attend an Evening session** (and vice-versa)? Who authorises this — automatic, or by admin approval?
    - Are the **same contents** taught in both slots, or different tracks?
45. Should the system define **fixed time windows** per slot (e.g. Morning = 06:00–09:00, Evening = 18:00–21:00) and warn when a session is scheduled outside its slot?
46. **Session fields required — please confirm/add:**

    | Property | Needed? (Y/N) |
    |---|---|
    | Topic / title | |
    | Date & start time | |
    | Duration | |
    | Description / agenda | |
    | Attached batch(es) | |
    | Assigned mentor | |
    | Topic/module covered (syllabus tag) | |
    | Recurring pattern (daily/weekly) | |
    | Session type (Live class, Doubt session, Webinar, Test) | |
    | Join open/close time | |
    | Max participants | |
    | Password/PIN for joining | |

47. Do you need **recurring sessions** (e.g. "Mon–Fri 7 AM for 12 weeks" auto-generated)?
48. Do you need **conflict detection** (warn when two sessions overlap, or a mentor is double-booked)?
49. Should students receive **automatic reminders** before a session (email / SMS / WhatsApp)? If yes, how long before (e.g. 30 min, 1 hour, 1 day)?
50. Should sessions be **cancelled/postponed** with a student notification flow?
51. Do you need **session-level admission control** — e.g. late-join cut-off, waiting room, only enrolled students allowed?
52. Do you allow **guest/one-off students** to join a single session without being in a batch?
53. Should **attendance be auto-marked** from Zoom join/leave times with a minimum-duration rule (e.g. present if joined ≥ 20 minutes)? Please define thresholds.
54. Do you need **attendance status categories** — Present / Late / Absent / Partial / On-leave?
55. Should students be able to **mark themselves on leave** in advance for a session?
56. Is **in-app joining** required (Zoom running inside your website), or is opening the Zoom app acceptable? *(Note: in-app Zoom requires a separate Zoom Meeting SDK licence and JWT — a cost/licence decision for you.)*

---

## 9. Modules — Detailed Walkthrough

Below is each module in the PoC, what it does, and what we need from you.

### 9.1 📊 Admin Dashboard
**Today:** Headline metrics, upcoming sessions, previous sessions, live activity feed.

📝 **Requirements:** Which KPIs matter to you? (Active students, sessions this week, attendance %, new enrolments, fees collected, students at risk of dropping out, etc.) Do you want a **date-range filter** and a **per-mentor view**?

---

### 9.2 🗓 Zoom Sessions
Covered in Section 8.

---

### 9.3 📋 Meeting Activity & Attendance
**Today:** For a past meeting — list of participants with join/leave/duration, Q&A captured in the meeting, auto-summary, dashboard reports (participants seen, total class hours, average sessions per student), date-window filters, cache with "Rescan", **CSV export**.

📝 **Requirements:**
57. What attendance **reports** do you need? (Per student / per batch / per session / per date range / mentor-wise)
58. Do you need **PDF reports**, or is CSV/Excel sufficient?
59. Minimum-duration rule for "Present" (see Q53)?
60. Do you need a **student attendance certificate/report card** showing %?
61. Should reports include **total hours** (in-market hours for a trading program)?

---

### 9.4 🎥 Cloud Recordings
**Today:** Lists Zoom cloud recordings; each recording gets a short-lived, secure download link refreshed on every page load. Accessible to both Admin and Students.

📝 **Requirements:**
62. Who may access recordings — all students, or only the batch that attended the session?
63. Should recordings be **auto-shared** after a session, or only after admin approval?
64. Any **retention period** for recordings (e.g. delete after 30 days due to Zoom storage limits)?
65. Do you need **in-app playback** (stream inside the portal) vs. download?
66. Should recording access **expire with batch validity** (see Section 6)?
67. Do you need **recording categories** (e.g. by course/module) and search?

---

### 9.5 👨‍🎓 Students & Batches
Covered in Sections 4 and 5.

---

### 9.6 ❓ Q&A Log
**Today:** Captures questions from two sources: the AI Knowledge Bot and Zoom in-meeting Q&A. Admin can review, **edit/correct** answers, add a topic tag, and **promote** a Q&A pair into the permanent Knowledge Base (which trains the bot).

📝 **Requirements:**
68. Is **Q&A capture during live sessions** important to your workflow? Who monitors it — mentor or an assistant?
69. Should students be able to see **answered questions from others** (a FAQ/knowledge library), or only their own?
70. Do you need **approval workflow** for publishing answers to students?
71. Do you need **question categories/topics** beyond free text?
72. Should promoted knowledge entries be **versioned/auditable** (who changed what, when)?

---

### 9.7 📚 Reference Hub (Materials)
**Today:** CRUD for learning materials — title, category, type (PDF/Video/Link/Other), URL, description, bookmark flag, timestamps. Visible to students.

📝 **Requirements:**
73. Do you need **file uploads** (store PDFs/notes on your server), or is linking to external URLs (Google Drive/YouTube) enough?
74. Do materials need **batch-scoping** (only certain batches see certain material)? *(Currently all students see all materials.)*
75. Should materials be **time-released** (unlocked session-by-session)?
76. Do you need **download tracking / progress tracking** (who read/downloaded what)?
77. Bookmarks — should students have **personal bookmarks/favourites**?
78. Do you need **folders/structure** (Course → Module → Lesson) rather than a flat list?

---

### 9.8 🤖 AI Knowledge Bot
**Today (be transparent):** The PoC bot is a **rule-based demo**, not a true AI/LLM. It answers from a small local knowledge base (seeded from promoted Q&A) and falls back to canned responses. It keeps a per-student chat history (last 60 messages) plus one admin chat.

📝 **Requirements:**
79. What should the bot actually do in production?
    - [ ] Answer trading/curriculum questions from your materials
    - [ ] Give batch/session schedules
    - [ ] Explain concepts (needs a real LLM — OpenAI/Azure/Gemini or similar; ongoing API cost)
    - [ ] Take attendance/queries
    - [ ] Collect leads
    - [ ] Other: ___________
80. If a real LLM is used: do you have a preference, and is there a **budget for API usage**?
81. Which **languages** must the bot support (English, Hindi, Hinglish, Odia, others)?
82. Should the bot have **guardrails** (never give financial advice / only answer from approved material)?
83. Should chat history be **retained, and for how long**? Should admins be able to read student chats? *(Privacy implication.)*
84. Do you need **handoff to a human** when the bot cannot answer?

---

### 9.9 📢 Broadcast / Announcements
**Today (be transparent):** The announcement composer **only opens your own email client** with a pre-filled message. **No email/SMS/WhatsApp is actually sent by the system.** There is no automated notification engine.

📝 **Requirements:**
85. Which **channels** do you need — Email, SMS, WhatsApp, Telegram, In-app notification?
86. Targeting: all students / specific batch(es) / specific student(s) / mentors?
87. Do you need **scheduled announcements** (send at a future time)?
88. Do you need **delivery reports** (who received/opened it)?
89. Do you need **transactional notifications** — welcome on enrolment, password changed, session reminder, session cancelled, batch expiring, recording available, attendance warning?
90. Are you willing to bear the **third-party costs** (WhatsApp Business API, SMS gateway, SendGrid/Mailgun)?

---

### 9.10 🔐 Authentication & Security
**Today:** Admin PIN login; student email+password login; scrypt password hashing; bearer tokens stored only as SHA-256 hashes; 12-hour session expiry; logout revocation; default-deny access rules (students can only reach their own limited read endpoints).

📝 **Requirements:**
91. Admin login: **shared PIN** (current) vs. **individual accounts** (recommended for audit)?
92. Is **OTP/2FA** required for admins?
93. Password policy — minimum length/complexity? Auto-generated student passwords?
94. Should students log in with **phone number + OTP** instead of email + password? (Common in India.)
95. Do you need an **audit log** (who changed what and when)?
96. Any **data residency** requirement (data must stay in India)?
97. Is the platform to be served over **HTTPS on your own domain** (e.g. learn.sbctraders.com)? Who owns the hosting/domain?

---

### 9.11 💰 Payments, Fees & Invoicing — 📝 Currently NOT built
**Current state:** The PoC has **no payment, fee, invoicing, or subscription features at all.**

98. Do you want fee collection **inside the platform**? If yes:
    - [ ] Integration with a gateway (Razorpay / InstaStripe / PayU / PhonePe / Cashfree / UPI)
    - [ ] Manual entry only ("student paid ₹X on date Y — record it")
    - [ ] Both
99. Do you need **fee plans** per batch (full payment, instalments, early-bird, referral discount)?
99. Do you need **invoices/receipts** (with GST details, invoice number series)?
100. Do you need **payment reminders** and **due/overdue tracking**?
101. Should access be **gated on payment** (student can log in only when instalment 2 is cleared)?
102. Do you need a **revenue dashboard** (collected vs. pending, batch-wise earnings)?
103. Refunds — any workflow required?
104. Who is your accountant/bookkeeper — do we need **export to Tally/Excel**?

---

### 9.12 🏆 Certificates & Completion — 📝 Currently NOT built
**Current state:** No certificate, completion, or grading features exist.

105. Do you issue a **certificate on batch completion**? If yes:
    - Criteria for issue — attendance % + duration + exam, or manual issue by admin?
    - Should the certificate have a **unique verification code / QR code** (public verification page)?
    - Custom template with your logo, mentor signature, seal?
    - PDF download for student, and a bulk-issue action for admin?
106. Do you need **assessments/quizzes** (score tracking) as a completion prerequisite?
107. Do you need a **progress/completion %** per student per batch?
108. Should certificates also be issued for **individual courses/modules**?

---

### 9.13 📈 Reports & Analytics
**Today:** Zoom dashboard reports, attendance reports, CSV exports (students, attendees), date filters, cache age with manual rescan.

📝 **Requirements:** Which of these reports do you need?
109. Attendance report (batch-wise / student-wise / session-wise)?
110. Batch completion report?
111. Student engagement report (sessions attended, recordings watched, materials downloaded, bot queries)?
112. Drop-out / at-risk report (students with falling attendance)?
113. Fee collection report (if payments are added)?
114. Mentor/teacher activity report?
115. Export formats — CSV / Excel / PDF?
116. Do you need **scheduled reports** (e.g. weekly summary emailed to management every Monday)?

---

### 9.14 🔔 Reminders & Scheduling
**Today:** No background scheduler, no cron, no automatic reminders. Everything happens on user action.

📝 **Requirements:** Which automated jobs do you need?
117. Session reminder (to students) — timing?
118. Session reminder (to mentor)?
119. Daily/weekly digest to admin?
120. Batch expiry warning?
121. Payment due reminder?
122. Attendance shortfall alert ("you attended only 50% — warning")?
123. Post-session: auto-share recording + attendance + Q&A summary?

---

## 10. Non-Functional Requirements — 📝

124. **Expected scale:** How many **concurrent students**? Total students per year? Batches running simultaneously?
125. **Availability:** Is 24×7 uptime required? What downtime is acceptable?
126. **Support hours:** Do you need support outside business hours (live sessions may run early morning/late night)?
127. **Devices:** Desktop, mobile browser, Android app, iOS app? *(PoC is responsive web only. Is a native mobile app required?)*
128. **Browser support:** Chrome/Edge/Safari/Firefox — any specific?
129. **Branding:** Final product name, logo, colour scheme, and domain. *(Currently the UI inconsistently shows "SBC-LMS", "Apex Trading Academy", "SBC Traders" — we will standardise once you confirm.)*
130. **Zoom account:** Who owns the Zoom account/licences? Is Zoom Pro/Business licensed per mentor? Do you need **webinar** mode for large audiences?
131. **Data migration:** Do you have existing student data (Excel/Google Sheets/another tool) that must be imported?
132. **Timeline:** Target date for production launch?
133. **Budget band** for the next phase (development + third-party running costs)?
134. **Compliance:** Any regulatory constraints on trading-education advertising, DISC disclosures in recordings, or student data (DPDP Act 2023)?

---

## 11. Known Gaps in the PoC (Transparency Section)

These are known limitations of the current PoC. They are listed so you can prioritise them in your requirements.

| # | Gap | Impact | Priority from you |
|---|---|---|---|
| G1 | No batch validity / expiry logic | Cannot enforce course durations | 🔴 |
| G2 | No data retention/archive policy for completed batches | Data grows indefinitely | 🔴 |
| G3 | Morning/Evening exists only as a **naming convention** (batch names), not a scheduling rule | No time-slot enforcement | 🔴 |
| G4 | No payments/fees/invoicing | Manual accounting only | 🔴 |
| G5 | No certificates/completion tracking | Manual certificates | 🟡 |
| G6 | No automated notifications (only a mail-client shortcut) | Students must be informed manually | 🔴 |
| G7 | AI bot is a rule-based demo, not a real LLM | Limited answer quality | 🟡 |
| G8 | No recurring-session scheduler or conflict detection | Manual session creation each time | 🟡 |
| G9 | No self-registration or password-reset flow | Admin must onboard everyone | 🟡 |
| G10 | Single shared admin PIN (no individual admin accounts) | No audit trail per staff member | 🟡 |
| G11 | No audit log | Cannot trace changes | 🟡 |
| G12 | Zoom attendance is fetched live, not mirrored locally | Dependent on Zoom API availability; some history may be lost | 🟡 |
| G13 | Security hardening pending (no rate-limiting on login; one access-control check needs tightening for "My Classes") | To be fixed before production | 🔴 |
| G14 | No mobile apps | Web-only access | 🟢 |
| G15 | No reports scheduled by email; CSV export only, no PDF | Reporting is manual | 🟡 |
| G16 | Inconsistent branding across screens | Cosmetic | 🟢 |

---

## 12. Suggested Next Steps

1. **SBC-Traders reviews** this document and answers the numbered questions (📝 sections). Answers can be inline in this file or in a call.
2. We hold a **requirements walkthrough meeting** (60–90 min) to resolve ambiguities — especially Sections 6, 7, 8 and 9.11.
3. We issue a **prioritised backlog**: *Must-have (Phase 1)* / *Should-have (Phase 2)* / *Later*.
4. We issue a **formal Functional Requirements Specification + fixed estimate + timeline** for Phase 1.
5. After sign-off, development begins against a staging environment you can access.

---

## 13. Appendix A — Quick Answer Template

Copy this block and fill it in for a fast response:

```text
ROLES
- Roles needed: 
- Self-registration for students: Yes / No
- Password reset by email: Yes / No

STUDENTS
- Mandatory fields: 
- Bulk import needed: Yes / No
- Retention after batch completion: Permanent / N months / Delete / Other

BATCHES
- A batch is: 
- Start date / End date: Yes / No
- Duration or session-count based: 
- Max students per batch: 
- Statuses needed: 

VALIDITY
- Batch validity: Yes (dates) / Yes (duration) / Yes (sessions) / No
- On expiry: 
- Renewal: Yes / No
- Warning before expiry: 

SESSIONS
- Slots: Morning / Evening / Both
- Can a student attend the other slot: Yes / No / On approval
- Recurring sessions needed: Yes / No
- Attendance rule (min minutes to be "Present"): 
- Reminders: Email / SMS / WhatsApp / In-app, timings:

PAYMENTS
- In-platform payments: Gateway / Manual only / No
- GST invoices: Yes / No
- Access gated on payment: Yes / No

CERTIFICATES
- Required: Yes / No
- Criteria: 
- QR/verification code: Yes / No

NOTIFICATIONS
- Channels: 
- Automated events needed: 

REPORTS
- Required reports: 
- Formats: CSV / Excel / PDF

NON-FUNCTIONAL
- Concurrent students: 
- Mobile app needed: Yes / No
- Branding / domain: 
- Target launch date: 
```

---

## 14. Appendix B — Current Module Map (for your reference)

**Admin sees:**
Dashboard · Zoom Sessions · Meeting Activity · Cloud Recordings · Students & Batches · Q&A Log · Reference Hub · AI Knowledge Bot · Broadcast/Announcements

**Student sees:**
My Classes (their sessions + personal join links) · Cloud Recordings · Reference Hub · AI Knowledge Bot

**Data the platform stores:**
Students · Batches · Enrolments · Session targets · Zoom registrations (incl. personal join links) · Q&A & Knowledge Base · AI chat history · Learning materials · Login sessions & admin credentials · Settings (class password)

**Data fetched live from Zoom (not stored):**
Meeting lists · Registrant status · Past participants · In-meeting Q&A · Meeting summaries · Cloud recordings · Attendance/dashboard reports

---

*End of document — please return your answers or book the walkthrough meeting so we can finalise the detailed requirements.*
