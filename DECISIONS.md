# Engineering Decisions

### 1. Indexes
We created:
- `employees.emp_code` (unique): Enforces strict uniqueness and rapid single-employee lookups.
- `employees.(department, joined_on)`: Supports index-covered headcount calculation and department filtering.
- `attendance_logs.(emp_code, date)` (unique): Enforces the core business rule of at most one attendance record per employee-day and prevents punch-in race conditions.
- `attendance_logs.(date DESC, emp_code ASC)`: Powers sorted pagination for attendance listings without in-memory sorting.
- `attendance_logs.(emp_code, punch_in DESC)`: Rapidly resolves the candidate punch-in record for punch-outs.

*Rejected:* An index on `(emp_code, date, punch_out)`. It is redundant since `(emp_code, date)` is already uniquely indexed and significantly more compact.

### 2. Punch-in Race
Two concurrent punch-in requests calculate the IST date and both execute `insert_one`. MongoDB's unique index on `(emp_code, date)` atomically admits the first write (HTTP 201) and throws a `DuplicateKeyError` on the second. Our error handler catches this and returns HTTP 409 Conflict. There is no vulnerable check-then-insert gap.

### 3. Ties
We implement standard competition ranking (1, 2, 2, 4). The `limit` applies to `rank <= limit`. If two employees tie at rank 10, both qualify, returning 11 items. Ties are deterministically broken in display order by `emp_code` ascending.

### 4. Headcount
The aggregation begins on the `employees` collection (matching `joined_on <= end_date`) and performs a `$lookup` to join attendance logs. Headcount is counted from employees, ensuring staff with zero logs are fully counted.

### 5. Serving 100x Data
At 100x scale (~10 million logs), we would pre-aggregate daily/monthly summaries into materialized rollup documents using change streams, eliminating real-time `$lookup` joins on read requests.
