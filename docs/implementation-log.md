# Authentication implementation log

**Goal for this week:** a patient or staff member can sign in, access their permitted workspace and sign out. **Backend owner:** Alan. **Status:** planned. Alan records the change and evidence as each part is built.

| Work package | What to build | Evidence to add | Status |
| --- | --- | --- | --- |
| Accounts in PostgreSQL | Model users, patient identity, staff roles, clinic membership and account status. Support duplicate detection on patient ID and date of birth. | ERD, migration and duplicate-registration test | Planned |
| Registration and sign-in | Register a patient with name, date of birth, phone, ID and password. Hash passwords. Enforce the backlog’s minimum eight characters and 15-minute lock after five failed logins. | Successful registration and sign-in, duplicate and lockout tests | Planned |
| Redis sessions and sign-out | Start a session on sign-in, restore it on refresh, expire it after inactivity and revoke it on sign-out. | Refresh, expiry and reuse-of-revoked-session tests | Planned |
| Role and record access | Admin creates and deactivates staff accounts. Enforce patient, receptionist, clinician, manager and administrator permissions at the API. Scope patient records and clinic data. | Two-patient ownership test, staff access-denied tests and immediate loss of access after deactivation | Planned |
| Browser integration | Agree the request, response and error formats with the frontend developer. Connect the sign-in flow through to the correct workspace. | Browser walkthrough and linked commits from both repositories | Planned |

**Decisions to record before wiring the screens:** sign-in identifier and idle-session duration. Record the agreed values here separately from the failed-login lockout rule.

## Progress entries

| Date | Developer | Change or decision | Commit or test evidence | Next step |
| --- | --- | --- | --- | --- |
