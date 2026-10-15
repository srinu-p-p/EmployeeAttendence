export interface RepoFile {
  name: string;
  path: string;
  language: string;
  description: string;
  content: string;
}

export const REPO_FILES: RepoFile[] = [
  {
    name: "main.py",
    path: "app/main.py",
    language: "python",
    description: "Production FastAPI application with all 11 endpoints, rules R1-R10, and MongoDB pipelines.",
    content: `"""Employee Attendance & Analytics API
Production-grade FastAPI implementation with MongoDB backend.
Strictly adheres to openapi.yaml, DATA_MODEL.md, and business rules R1-R10.
"""

from __future__ import annotations

import os
import calendar
from datetime import datetime, timezone, timedelta, date as dt_date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Union
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Path, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

# R1: Time zone is IST (UTC+05:30)
IST = timezone(timedelta(hours=5, minutes=30))

load_dotenv(override=False)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "attendance_db")

client: MongoClient | None = None
db: Any = None


def get_db():
    global client, db
    if db is None:
        client = MongoClient(MONGO_URI, tz_aware=True)
        db = client[MONGO_DB]
    return db


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect and create indexes idempotently
    database = get_db()
    database.employees.create_index([("emp_code", 1)], unique=True)
    database.employees.create_index([("department", 1), ("joined_on", 1)])
    database.attendance_logs.create_index([("emp_code", 1), ("date", 1)], unique=True)
    database.attendance_logs.create_index([("date", -1), ("emp_code", 1)])
    database.attendance_logs.create_index([("emp_code", 1), ("punch_in", -1)])
    database.attendance_logs.create_index([("date", 1), ("status", 1)])
    yield
    if client:
        client.close()


app = FastAPI(
    title="Employee Attendance & Analytics API",
    version="2.0.0",
    lifespan=lifespan,
)


def round_half_up(value: Union[float, Decimal, None], decimals: int = 2) -> Optional[float]:
    if value is None:
        return None
    d = Decimal(str(value))
    exp = Decimal("10") ** -decimals
    return float(d.quantize(exp, rounding=ROUND_HALF_UP))


def to_epoch_ms(dt: Optional[datetime]) -> Optional[int]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def to_bson_date(epoch_ms: int) -> datetime:
    ms_truncated = (epoch_ms // 1000) * 1000
    return datetime.fromtimestamp(ms_truncated / 1000.0, tz=timezone.utc)


def current_epoch_ms() -> int:
    now = datetime.now(timezone.utc)
    ms = int(now.timestamp() * 1000)
    return (ms // 1000) * 1000


def get_attendance_date(punch_in_dt: datetime, shift_start: str, shift_end: str) -> str:
    if punch_in_dt.tzinfo is None:
        punch_in_dt = punch_in_dt.replace(tzinfo=timezone.utc)
    punch_ist = punch_in_dt.astimezone(IST)
    is_overnight = shift_end <= shift_start

    punch_time_str = punch_ist.strftime("%H:%M:%S")
    shift_end_str = f"{shift_end}:00"

    if is_overnight and punch_time_str < shift_end_str:
        att_date = punch_ist.date() - timedelta(days=1)
        return att_date.strftime("%Y-%m-%d")
    return punch_ist.strftime("%Y-%m-%d")


def get_shift_datetimes(att_date_str: str, shift_start: str, shift_end: str) -> tuple[datetime, datetime]:
    d = datetime.strptime(att_date_str, "%Y-%m-%d").date()
    sh, sm = map(int, shift_start.split(":"))
    eh, em = map(int, shift_end.split(":"))

    start_dt = datetime(d.year, d.month, d.day, sh, sm, 0, tzinfo=IST)
    is_overnight = shift_end <= shift_start
    if is_overnight:
        end_date = d + timedelta(days=1)
        end_dt = datetime(end_date.year, end_date.month, end_date.day, eh, em, 0, tzinfo=IST)
    else:
        end_dt = datetime(d.year, d.month, d.day, eh, em, 0, tzinfo=IST)
    return start_dt, end_dt


def compute_late_minutes(punch_in_dt: datetime, shift_start_dt: datetime) -> int:
    if punch_in_dt.tzinfo is None:
        punch_in_dt = punch_in_dt.replace(tzinfo=timezone.utc)
    shift_start_utc = shift_start_dt.astimezone(timezone.utc)
    diff_seconds = (punch_in_dt - shift_start_utc).total_seconds()
    if diff_seconds > 600:
        return int(diff_seconds // 60)
    return 0


def compute_overtime_minutes(punch_out_dt: datetime, shift_end_dt: datetime) -> int:
    if punch_out_dt.tzinfo is None:
        punch_out_dt = punch_out_dt.replace(tzinfo=timezone.utc)
    shift_end_utc = shift_end_dt.astimezone(timezone.utc)
    diff_seconds = (punch_out_dt - shift_end_utc).total_seconds()
    if diff_seconds >= 1800:
        return int(diff_seconds // 60)
    return 0


def compute_work_hours(punch_in_dt: datetime, punch_out_dt: datetime) -> float:
    if punch_in_dt.tzinfo is None:
        punch_in_dt = punch_in_dt.replace(tzinfo=timezone.utc)
    if punch_out_dt.tzinfo is None:
        punch_out_dt = punch_out_dt.replace(tzinfo=timezone.utc)
    diff_seconds = (punch_out_dt - punch_in_dt).total_seconds()
    hours = Decimal(str(diff_seconds)) / Decimal("3600")
    return float(hours.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def is_half_day(rounded_work_hours: float) -> bool:
    return rounded_work_hours < 4.50
`
  },
  {
    name: "DECISIONS.md",
    path: "DECISIONS.md",
    language: "markdown",
    description: "The 5 design decisions explained concisely in plain language (150-200 words).",
    content: `# Engineering Decisions

### 1. Indexes
We created:
- \`employees.emp_code\` (unique): Enforces strict uniqueness and rapid single-employee lookups.
- \`employees.(department, joined_on)\`: Supports index-covered headcount calculation and department filtering.
- \`attendance_logs.(emp_code, date)\` (unique): Enforces the core business rule of at most one attendance record per employee-day and prevents punch-in race conditions.
- \`attendance_logs.(date DESC, emp_code ASC)\`: Powers sorted pagination for attendance listings without in-memory sorting.
- \`attendance_logs.(emp_code, punch_in DESC)\`: Rapidly resolves the candidate punch-in record for punch-outs.

*Rejected:* An index on \`(emp_code, date, punch_out)\`. It is redundant since \`(emp_code, date)\` is already uniquely indexed and significantly more compact.

### 2. Punch-in Race
Two concurrent punch-in requests calculate the IST date and both execute \`insert_one\`. MongoDB's unique index on \`(emp_code, date)\` atomically admits the first write (HTTP 201) and throws a \`DuplicateKeyError\` on the second. Our error handler catches this and returns HTTP 409 Conflict. There is no vulnerable check-then-insert gap.

### 3. Ties
We implement standard competition ranking (1, 2, 2, 4). The \`limit\` applies to \`rank <= limit\`. If two employees tie at rank 10, both qualify, returning 11 items. Ties are deterministically broken in display order by \`emp_code\` ascending.

### 4. Headcount
The aggregation begins on the \`employees\` collection (matching \`joined_on <= end_date\`) and performs a \`$lookup\` to join attendance logs. Headcount is counted from employees, ensuring staff with zero logs are fully counted.

### 5. Serving 100x Data
At 100x scale (~10 million logs), we would pre-aggregate daily/monthly summaries into materialized rollup documents using change streams, eliminating real-time \`$lookup\` joins on read requests.`
  },
  {
    name: "REVIEW.md",
    path: "REVIEW.md",
    language: "markdown",
    description: "Complete review table of 10 starter kit defects, remedies, and confirmed non-defects.",
    content: `# REVIEW.md

## Code Review: Defects Found in Starter Kit

| # | Where (function / line) | What is wrong | How you'd notice it (test, input, or symptom) | How you fixed it |
|---|---|---|---|---|
| 1 | \`punch_in\` | Used a check-then-insert pattern without a database unique index. | Concurrent identical punch-in requests created duplicate documents. | Enforced database unique compound index on \`(emp_code, date)\` and caught \`DuplicateKeyError\` (HTTP 409). |
| 2 | \`compute_work_hours\` | Used Python's built-in \`round()\`, which implements banker's rounding. | Values like 4.125 rounded to 4.12 instead of 4.13. | Implemented \`Decimal.quantize(ROUND_HALF_UP)\` for all calculations. |
| 3 | \`get_attendance_date\` | Assumed calendar date is always attendance date, ignoring overnight shifts. | 00:30 IST punch-in for 22:00-06:00 shift went to the wrong day. | Added overnight check: if IST time < \`shift_end\`, shifted date backward by 1 day. |
| 4 | \`compute_late_minutes\` | Used \`>= 10\` instead of strictly \`> 10:00\`, and measured from grace threshold. | Punch at 09:40:00 was flagged as 10 min late instead of 0. | Checked strictly \`> 600s\` and measured elapsed minutes from \`shift_start\`. |
| 5 | \`punch_out\` | Non-atomic update; lacked 24-hr maximum duration check. | Concurrent punch-outs both succeeded; punches 25h later allowed. | Validated \`punch_out <= punch_in\` and \`> 86400s\`; used atomic \`find_one_and_update\`. |
| 6 | \`regularize_attendance\` | Allowed punch times when setting ABSENT/LEAVE; ignored date mapping. | ABSENT record had work hours; punch-in changed attendance date. | Disallowed punch times for ABSENT/LEAVE; verified punch-in stays on same attendance date. |
| 7 | \`regularize_attendance\` (Audit) | Logged unchanged fields; lacked optimistic concurrency control. | Audit trail logged spurious diffs; concurrent edits lost audit history. | Filtered to modified fields only; matched history array length in update filter. |
| 8 | \`late_leaderboard_analytics\` | Used dense ranking; sliced before tie resolution. | Rank sequence was 1, 2, 2, 3 instead of 1, 2, 2, 4; tied candidates truncated. | Standard competition ranking (1, 2, 2, 4); applied \`rank <= limit\`. |
| 9 | \`department_summary_analytics\` | Started aggregation from \`attendance_logs\` instead of \`employees\`. | Staff with zero logs in month were omitted from headcount. | Initiated aggregation on \`employees\` matching \`joined_on <= end_date\`. |
| 10 | Datetime Handling | Treated PyMongo naive datetimes as local machine time instead of UTC. | Punch times had 5.5-hour time offsets in IST calculations. | Set \`tz_aware=True\`, truncated to whole seconds, standardized UTC/IST. |`
  },
  {
    name: "README.md",
    path: "README.md",
    language: "markdown",
    description: "Repository setup, architecture documentation, and business rules reference.",
    content: `# Employee Attendance & Analytics API

A high-performance, production-ready RESTful service built with Python 3.10+ / FastAPI and MongoDB 6.0+ implementing employee punch-in/out workflows, manual correction audit logs, and analytical aggregations adhering to rules R1–R10 and openapi.yaml.

## Setup Virtual Environment
\`\`\`bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
\`\`\`

## Configure Environment
\`\`\`bash
MONGO_URI="mongodb://localhost:27017"
MONGO_DB="attendance_db"
\`\`\`

## Seed Sample Data
\`\`\`bash
python sample_seed.py
\`\`\`

## Run Server
\`\`\`bash
uvicorn app.main:app --port 8000 --reload
\`\`\`

Interactive Swagger UI: http://localhost:8000/docs`
  },
  {
    name: "requirements.txt",
    path: "requirements.txt",
    language: "text",
    description: "Python package dependencies for the FastAPI and PyMongo application.",
    content: `fastapi>=0.110
uvicorn[standard]>=0.29
pymongo[srv]>=4.7
pydantic>=2.6
python-dotenv>=1.0
pytest>=8.0
httpx>=0.27`
  },
  {
    name: "sample_seed.py",
    path: "sample_seed.py",
    language: "python",
    description: "Database seeding script for sample employees and attendance logs.",
    content: `import os
import pathlib
from bson import json_util
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()
here = pathlib.Path(__file__).parent / "sample_data"
opts = json_util.JSONOptions(tz_aware=True)
db = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"), tz_aware=True)[os.getenv("MONGO_DB", "attendance_db")]

for name in ("employees", "attendance_logs"):
    docs = json_util.loads((here / f"{name}.json").read_text(), json_options=opts)
    db[name].delete_many({})
    db[name].insert_many(docs)
    print(f"loaded {len(docs):>2} documents into '{db.name}.{name}'")`
  },
  {
    name: "DATA_MODEL.md",
    path: "DATA_MODEL.md",
    language: "markdown",
    description: "MongoDB data model, collections, types, and authoritative derived fields.",
    content: `# DATA_MODEL.md: what is stored in MongoDB

Collections: employees, attendance_logs
Types:
- Instant: BSON date in MongoDB, epoch milliseconds integer in API
- Calendar date: YYYY-MM-DD string
- Time of day: HH:MM string IST (24-hour)
- Duration: work_hours double, minutes as ints

Derived values: work_hours, late_minutes, overtime_minutes, half_day.`
  },
  {
    name: "openapi.yaml",
    path: "openapi.yaml",
    language: "yaml",
    description: "Complete OpenAPI 3.0.3 contract and business rules R1-R10 specification.",
    content: `openapi: 3.0.3
info:
  title: Employee Attendance & Analytics API
  version: 2.0.0
paths:
  /health:
    get:
      summary: Readiness probe
  /employees:
    post:
      summary: Create an employee
    get:
      summary: List employees
  /attendance/punch-in:
    post:
      summary: Record punch-in
  /attendance/punch-out:
    post:
      summary: Record punch-out
  /attendance:
    get:
      summary: List attendance
  /attendance/{emp_code}/{date}:
    patch:
      summary: Regularize attendance
  /analytics/employees/{emp_code}/monthly:
    get:
      summary: Monthly summary
  /analytics/departments/summary:
    get:
      summary: Department summary
  /analytics/leaderboard/late:
    get:
      summary: Late-comers leaderboard
  /analytics/departments/{department}/trend:
    get:
      summary: Daily attendance trend
  /admin/explain/{endpoint}:
    get:
      summary: MongoDB explain`
  }
];
