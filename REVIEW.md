# REVIEW.md

## Code Review: Defects Found in Starter Kit

| # | Where (function / line) | What is wrong | How you'd notice it (test, input, or symptom) | How you fixed it |
|---|---|---|---|---|
| 1 | `punch_in` | Used a check-then-insert pattern (`find_one` then `insert_one`) without relying on a database-enforced unique index. | Concurrent identical punch-in requests created duplicate documents for the same employee and date, violating schema invariants. | Enforced database-level unique compound index on `(emp_code, date)` and caught `DuplicateKeyError` to return HTTP 409 Conflict. |
| 2 | `compute_work_hours` | Used Python's built-in `round(hours, 2)`, which implements banker's rounding (round-half-to-even) instead of arithmetic half-up rounding. | Values like 4.125 rounded to 4.12 instead of 4.13, causing discrepancies with test suites and business rule R4. | Implemented `Decimal.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)` for all duration and rate computations. |
| 3 | `get_attendance_date` & overnight shifts | Assumed punch-in calendar date is always the attendance date, ignoring overnight shifts (e.g. 22:00-06:00). | A punch-in at 00:30 IST for an overnight shift was assigned to the next day instead of the shift's starting day (rule R1). | Added logic checking if `shift_end <= shift_start` and whether IST punch time is `< shift_end`, shifting date backward by 1 day when true. |
| 4 | `compute_late_minutes` | Used `>= 10` minutes instead of strictly `> 10:00` for the grace period, and measured elapsed time from the grace threshold instead of shift start. | A punch-in at 09:40:00 on a 09:30 shift was flagged as 10 minutes late instead of 0 minutes late (rule R2). | Checked `diff_seconds > 600` strictly, and computed `floor(diff_seconds / 60)` from `shift_start_dt`. |
| 5 | `punch_out` | Used non-atomic check and update, and lacked validation for 24-hour maximum duration and punch-out before punch-in. | Concurrent punch-outs both succeeded; punch-outs earlier than punch-in were accepted; punches 25 hours later were accepted. | Added strict 422 validations for `punch_out <= punch_in` and `> 86400s`, and used atomic `find_one_and_update({"punch_out": None})`. |
| 6 | `regularize_attendance` | Allowed updating `punch_in`/`punch_out` when setting status to `ABSENT` or `LEAVE`; did not verify that new `punch_in` stays on same attendance date. | An employee on LEAVE could retain punch hours; a regularized punch-in could silently belong to a different date. | Enforced 422 if punch times are supplied for ABSENT/LEAVE; verified new punch-in IST date matches record date; required presence status to have punch_in. |
| 7 | `regularize_attendance` (Audit Trail) | Logged all schema fields into `changes` regardless of whether they actually changed; lacked optimistic concurrency control. | Audit trail recorded false changes (`from == to`); concurrent regularizations overwrote each other's history arrays. | Filtered `changes` to only modified fields; matched on history array length in `find_one_and_update` to prevent lost updates (409 Conflict). |
| 8 | `late_leaderboard_analytics` | Used row index / dense ranking instead of standard competition ranking; applied `limit` before resolving ties. | If two employees tied at rank 2, the next was ranked 3 instead of 4; tied candidates at rank 10 were truncated. | Computed competition ranks (1, 2, 2, 4); applied `limit` on `rank <= limit` so all tied employees at the cutoff are returned. |
| 9 | `department_summary_analytics` | Started aggregation from `attendance_logs` instead of `employees`. | Departments or employees with zero attendance records in the month were omitted from `headcount` (violating rule R9). | Initiated aggregation on `employees` matching `joined_on <= end_date`, then used `$lookup` to join attendance records. |
| 10 | Datetime Handling | Treated PyMongo naive datetimes as local machine time instead of UTC, causing 5.5-hour time offsets in IST calculations. | Punch times were off by 5 hours and 30 minutes in responses and hour calculations. | Configured `tz_aware=True` on `MongoClient`, truncated epoch milliseconds to whole seconds, and standardized on UTC/IST conversions. |

---

## Items Reviewed and Confirmed NOT a Defect

1. **Storing Calendar Dates as Strings (`YYYY-MM-DD`)**:
   - *Consideration:* Storing dates as string rather than ISODate might seem unidiomatic for MongoDB.
   - *Conclusion:* Verified this is an intentional design choice in `DATA_MODEL.md`. Calendar dates are timezone-independent domain identifiers. Storing them as ISODate forces arbitrary UTC offsets and invites timezone bugs during date comparisons.

2. **Leaving Legacy Records Without `half_day` or `history`**:
   - *Consideration:* Querying records that omit `half_day` or `history` could raise KeyError.
   - *Conclusion:* Not a data corruption defect; `DATA_MODEL.md` explicitly specifies that legacy records may omit these fields. We safely default `half_day` to `False` and `history` to `[]` using `.get()` and `$ifNull` in MongoDB queries.

3. **Returning HTTP 409 for Race Losers**:
   - *Consideration:* Could the loser of a concurrent punch-in or punch-out request be silently merged?
   - *Conclusion:* Not a defect. The OpenAPI specification explicitly specifies: "concurrent duplicate creates must yield exactly one 201 and the rest 409", and "two simultaneous punch-outs must yield exactly one 200 and the other 409". HTTP 409 is the intended behavior.
