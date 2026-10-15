"""Employee Attendance & Analytics API
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

# Load .env (real environment variables win)
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
    # 1. Unique index on employees.emp_code
    database.employees.create_index([("emp_code", 1)], unique=True)
    # 2. Index on department + joined_on for headcount and filtering
    database.employees.create_index([("department", 1), ("joined_on", 1)])
    # 3. Unique index on attendance_logs (emp_code, date)
    database.attendance_logs.create_index([("emp_code", 1), ("date", 1)], unique=True)
    # 4. Index for /attendance list sorting (date DESC, emp_code ASC)
    database.attendance_logs.create_index([("date", -1), ("emp_code", 1)])
    # 5. Index for punch-out lookup: latest punch_in for an employee
    database.attendance_logs.create_index([("emp_code", 1), ("punch_in", -1)])
    # 6. Index for monthly/department date-range analytics
    database.attendance_logs.create_index([("date", 1), ("status", 1)])
    yield
    # Shutdown
    if client:
        client.close()


app = FastAPI(
    title="Employee Attendance & Analytics API",
    version="2.0.0",
    lifespan=lifespan,
)


# --- Helper Functions for Time, Derivations, and Rounding ---

def round_half_up(value: Union[float, Decimal, None], decimals: int = 2) -> Optional[float]:
    """R8: Round half-up to specified decimals."""
    if value is None:
        return None
    d = Decimal(str(value))
    exp = Decimal("10") ** -decimals
    return float(d.quantize(exp, rounding=ROUND_HALF_UP))


def to_epoch_ms(dt: Optional[datetime]) -> Optional[int]:
    """Convert BSON datetime (naive or aware) to epoch milliseconds integer."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def to_bson_date(epoch_ms: int) -> datetime:
    """R1: Instant truncated to whole seconds, stored as UTC BSON datetime."""
    ms_truncated = (epoch_ms // 1000) * 1000
    return datetime.fromtimestamp(ms_truncated / 1000.0, tz=timezone.utc)


def current_epoch_ms() -> int:
    """Current time in epoch milliseconds, truncated to seconds."""
    now = datetime.now(timezone.utc)
    ms = int(now.timestamp() * 1000)
    return (ms // 1000) * 1000


def get_attendance_date(punch_in_dt: datetime, shift_start: str, shift_end: str) -> str:
    """
    R1: A record's date is the IST calendar date of its punch_in.
    Exception - overnight shifts (shift_end <= shift_start):
    a punch-in whose IST time is strictly earlier than shift_end belongs to the
    shift that started the previous day.
    """
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
    """Returns (shift_start_dt, shift_end_dt) as timezone-aware IST datetimes."""
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
    """
    R2: Grace period 10 minutes. A punch-in is late only if strictly more than
    10:00 after shift_start.
    When late, late_minutes = floor(minutes elapsed since shift_start).
    Otherwise 0.
    """
    if punch_in_dt.tzinfo is None:
        punch_in_dt = punch_in_dt.replace(tzinfo=timezone.utc)
    shift_start_utc = shift_start_dt.astimezone(timezone.utc)

    diff_seconds = (punch_in_dt - shift_start_utc).total_seconds()
    if diff_seconds > 600:  # strictly > 10:00
        return int(diff_seconds // 60)
    return 0


def compute_overtime_minutes(punch_out_dt: datetime, shift_end_dt: datetime) -> int:
    """
    R3: overtime_minutes = floor(minutes between shift_end and punch_out),
    counted only when >= 30; otherwise 0.
    """
    if punch_out_dt.tzinfo is None:
        punch_out_dt = punch_out_dt.replace(tzinfo=timezone.utc)
    shift_end_utc = shift_end_dt.astimezone(timezone.utc)

    diff_seconds = (punch_out_dt - shift_end_utc).total_seconds()
    if diff_seconds >= 1800:  # >= 30 minutes
        return int(diff_seconds // 60)
    return 0


def compute_work_hours(punch_in_dt: datetime, punch_out_dt: datetime) -> float:
    """R4: (punch_out - punch_in) in seconds / 3600, rounded to 2 decimals half-up."""
    if punch_in_dt.tzinfo is None:
        punch_in_dt = punch_in_dt.replace(tzinfo=timezone.utc)
    if punch_out_dt.tzinfo is None:
        punch_out_dt = punch_out_dt.replace(tzinfo=timezone.utc)

    diff_seconds = (punch_out_dt - punch_in_dt).total_seconds()
    hours = Decimal(str(diff_seconds)) / Decimal("3600")
    return float(hours.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def is_half_day(rounded_work_hours: float) -> bool:
    """R5: half_day = true when rounded work_hours < 4.50."""
    return rounded_work_hours < 4.50


# --- Schemas ---

class EmployeeCreate(BaseModel):
    emp_code: str = Field(..., pattern=r"^EMP\d{4,6}$")
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    department: str = Field(..., min_length=1, max_length=50)
    shift_start: str = Field(default="09:30", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    shift_end: str = Field(default="18:30", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    joined_on: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")

    @model_validator(mode="after")
    def validate_shift_times(self) -> EmployeeCreate:
        if self.shift_start == self.shift_end:
            raise ValueError("shift_start must differ from shift_end")
        return self


class Employee(BaseModel):
    emp_code: str
    name: str
    email: str
    department: str
    shift_start: str
    shift_end: str
    joined_on: str
    created_at: int


class EmployeePage(BaseModel):
    items: List[Employee]
    total: int
    page: int
    page_size: int


class PunchInRequest(BaseModel):
    emp_code: str
    punched_at: Optional[int] = None
    status: Optional[str] = Field(default="PRESENT", pattern=r"^(PRESENT|WFH|ON_DUTY)$")

    @field_validator("punched_at", mode="before")
    @classmethod
    def check_epoch_millis(cls, v: Any) -> Any:
        if v is None:
            return None
        if not isinstance(v, int) or isinstance(v, bool):
            raise ValueError("punched_at must be an integer count of milliseconds")
        if v < 100_000_000_000 or v > 4_102_444_800_000:
            raise ValueError("punched_at out of allowed epoch millis range")
        return v


class PunchOutRequest(BaseModel):
    emp_code: str
    punched_at: Optional[int] = None

    @field_validator("punched_at", mode="before")
    @classmethod
    def check_epoch_millis(cls, v: Any) -> Any:
        if v is None:
            return None
        if not isinstance(v, int) or isinstance(v, bool):
            raise ValueError("punched_at must be an integer count of milliseconds")
        if v < 100_000_000_000 or v > 4_102_444_800_000:
            raise ValueError("punched_at out of allowed epoch millis range")
        return v


class RegularizeRequest(BaseModel):
    status: Optional[str] = Field(None, pattern=r"^(PRESENT|ABSENT|LEAVE|WFH|ON_DUTY)$")
    punch_in: Optional[int] = None
    punch_out: Optional[int] = None
    reason: str = Field(..., min_length=5, max_length=200)
    regularized_by: str = Field(..., min_length=1, max_length=50)

    @field_validator("punch_in", "punch_out", mode="before")
    @classmethod
    def check_epoch_millis(cls, v: Any) -> Any:
        if v is None:
            return None
        if not isinstance(v, int) or isinstance(v, bool):
            raise ValueError("EpochMillis must be an integer count of milliseconds")
        if v < 100_000_000_000 or v > 4_102_444_800_000:
            raise ValueError("EpochMillis out of allowed range")
        return v


class HistoryEntry(BaseModel):
    at: int
    by: str
    reason: str
    changes: Dict[str, Dict[str, Any]]


class AttendanceRecord(BaseModel):
    emp_code: str
    date: str
    status: str
    punch_in: Optional[int]
    punch_out: Optional[int]
    work_hours: Optional[float]
    late_minutes: int
    overtime_minutes: int
    half_day: bool
    history: List[HistoryEntry]


class AttendancePage(BaseModel):
    items: List[AttendanceRecord]
    total: int
    page: int
    page_size: int


class EmployeeMonthly(BaseModel):
    emp_code: str
    month: str
    working_days: int
    present_days: float
    leave_days: int
    late_count: int
    total_late_minutes: int
    total_overtime_minutes: int
    attendance_pct: Optional[float]


class DepartmentSummaryItem(BaseModel):
    department: str
    headcount: int
    present_days: float
    avg_work_hours: Optional[float]
    late_count: int
    total_late_minutes: int
    leave_count: int
    on_duty_count: int


class DepartmentSummary(BaseModel):
    month: str
    items: List[DepartmentSummaryItem]


class LeaderboardItem(BaseModel):
    rank: int
    emp_code: str
    name: str
    department: str
    total_late_minutes: int
    late_count: int


class Leaderboard(BaseModel):
    month: str
    items: List[LeaderboardItem]


class TrendItem(BaseModel):
    date: str
    is_working_day: bool
    headcount: int
    present_count: float
    late_count: int
    attendance_rate: Optional[float]
    moving_avg_7d: Optional[float]


class Trend(BaseModel):
    department: str
    items: List[TrendItem]


def serialize_attendance_doc(doc: Dict[str, Any]) -> AttendanceRecord:
    """Format MongoDB attendance document into AttendanceRecord."""
    history_serialized = []
    for h in doc.get("history", []) or []:
        h_changes = {}
        for field, diff in h.get("changes", {}).items():
            f_val = diff.get("from")
            t_val = diff.get("to")
            if field in ("punch_in", "punch_out"):
                f_val = to_epoch_ms(f_val) if isinstance(f_val, datetime) else f_val
                t_val = to_epoch_ms(t_val) if isinstance(t_val, datetime) else t_val
            h_changes[field] = {"from": f_val, "to": t_val}

        history_serialized.append(
            HistoryEntry(
                at=to_epoch_ms(h.get("at")),
                by=h.get("by"),
                reason=h.get("reason"),
                changes=h_changes,
            )
        )

    return AttendanceRecord(
        emp_code=doc["emp_code"],
        date=doc["date"],
        status=doc["status"],
        punch_in=to_epoch_ms(doc.get("punch_in")),
        punch_out=to_epoch_ms(doc.get("punch_out")),
        work_hours=doc.get("work_hours"),
        late_minutes=doc.get("late_minutes", 0),
        overtime_minutes=doc.get("overtime_minutes", 0),
        half_day=bool(doc.get("half_day", False)),
        history=history_serialized,
    )


# --- Endpoints ---

@app.get("/health", tags=["system"])
def health():
    """Readiness probe. Returns 200 only if MongoDB answers ping, else 503."""
    try:
        database = get_db()
        database.command("ping")
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database unreachable: {str(exc)}",
        )


@app.post("/employees", response_model=Employee, status_code=status.HTTP_201_CREATED, tags=["employees"])
def create_employee(req: EmployeeCreate):
    """Create an employee. emp_code must be unique."""
    database = get_db()
    now_ms = current_epoch_ms()
    now_dt = to_bson_date(now_ms)

    doc = {
        "emp_code": req.emp_code,
        "name": req.name,
        "email": req.email,
        "department": req.department,
        "shift_start": req.shift_start,
        "shift_end": req.shift_end,
        "joined_on": req.joined_on,
        "created_at": now_dt,
    }

    try:
        database.employees.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Employee with emp_code '{req.emp_code}' already exists",
        )

    return Employee(
        emp_code=req.emp_code,
        name=req.name,
        email=req.email,
        department=req.department,
        shift_start=req.shift_start,
        shift_end=req.shift_end,
        joined_on=req.joined_on,
        created_at=now_ms,
    )


@app.get("/employees", response_model=EmployeePage, tags=["employees"])
def list_employees(
    department: Optional[str] = Query(None, description="Exact, case-sensitive match"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List employees sorted by emp_code ascending."""
    database = get_db()
    query_filter: Dict[str, Any] = {}
    if department is not None:
        query_filter["department"] = department

    total = database.employees.count_documents(query_filter)
    skip_count = (page - 1) * page_size
    cursor = database.employees.find(query_filter).sort("emp_code", 1).skip(skip_count).limit(page_size)

    items = [
        Employee(
            emp_code=d["emp_code"],
            name=d["name"],
            email=d["email"],
            department=d["department"],
            shift_start=d["shift_start"],
            shift_end=d["shift_end"],
            joined_on=d["joined_on"],
            created_at=to_epoch_ms(d["created_at"]),
        )
        for d in cursor
    ]

    return EmployeePage(items=items, total=total, page=page, page_size=page_size)


@app.post("/attendance/punch-in", response_model=AttendanceRecord, status_code=status.HTTP_201_CREATED, tags=["attendance"])
def punch_in(req: PunchInRequest):
    """Record a punch-in. Atomic insertion prevents duplicate punches for same day."""
    database = get_db()
    emp = database.employees.find_one({"emp_code": req.emp_code})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{req.emp_code}' not found")

    punch_ms = req.punched_at if req.punched_at is not None else current_epoch_ms()
    punch_dt = to_bson_date(punch_ms)

    att_date = get_attendance_date(punch_dt, emp["shift_start"], emp["shift_end"])
    shift_start_dt, _ = get_shift_datetimes(att_date, emp["shift_start"], emp["shift_end"])
    late_mins = compute_late_minutes(punch_dt, shift_start_dt)

    doc = {
        "emp_code": req.emp_code,
        "date": att_date,
        "status": req.status or "PRESENT",
        "punch_in": punch_dt,
        "punch_out": None,
        "work_hours": None,
        "late_minutes": late_mins,
        "overtime_minutes": 0,
        "half_day": False,
        "history": [],
    }

    try:
        database.attendance_logs.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Attendance record already exists for {req.emp_code} on date {att_date}",
        )

    return serialize_attendance_doc(doc)


@app.post("/attendance/punch-out", response_model=AttendanceRecord, tags=["attendance"])
def punch_out(req: PunchOutRequest):
    """Record a punch-out. Closes most recent punch-in for employee."""
    database = get_db()
    emp = database.employees.find_one({"emp_code": req.emp_code})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{req.emp_code}' not found")

    punch_out_ms = req.punched_at if req.punched_at is not None else current_epoch_ms()
    punch_out_dt = to_bson_date(punch_out_ms)

    # Find the most recent record whose punch_in <= punch_out_dt
    candidate = database.attendance_logs.find_one(
        {"emp_code": req.emp_code, "punch_in": {"$lte": punch_out_dt}},
        sort=[("punch_in", -1)],
    )

    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No punch-in record found for {req.emp_code} before punch_out",
        )

    if candidate.get("punch_out") is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Record is already punched out",
        )

    punch_in_dt = candidate["punch_in"]
    if punch_out_dt <= punch_in_dt:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="punch_out must be strictly after punch_in",
        )

    diff_seconds = (punch_out_dt - punch_in_dt).total_seconds()
    if diff_seconds > 86400:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="punch_out cannot be more than 24 hours after punch_in",
        )

    # Recompute derivations
    att_date = candidate["date"]
    _, shift_end_dt = get_shift_datetimes(att_date, emp["shift_start"], emp["shift_end"])
    overtime_mins = compute_overtime_minutes(punch_out_dt, shift_end_dt)
    work_hrs = compute_work_hours(punch_in_dt, punch_out_dt)
    half = is_half_day(work_hrs)

    # Atomic update ensuring only one simultaneous punch-out succeeds
    updated = database.attendance_logs.find_one_and_update(
        {"_id": candidate["_id"], "punch_out": None},
        {
            "$set": {
                "punch_out": punch_out_dt,
                "work_hours": work_hrs,
                "overtime_minutes": overtime_mins,
                "half_day": half,
            }
        },
        return_document=ReturnDocument.AFTER,
    )

    if not updated:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Record was already punched out concurrently",
        )

    return serialize_attendance_doc(updated)


@app.get("/attendance", response_model=AttendancePage, tags=["attendance"])
def list_attendance(
    emp_code: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status_filter: Optional[str] = Query(None, alias="status", pattern=r"^(PRESENT|ABSENT|LEAVE|WFH|ON_DUTY)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List attendance records sorted by date descending, emp_code ascending."""
    if date_from and date_to and date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date_from must not be greater than date_to",
        )

    database = get_db()
    query: Dict[str, Any] = {}
    if emp_code:
        query["emp_code"] = emp_code
    if status_filter:
        query["status"] = status_filter

    if date_from or date_to:
        date_q: Dict[str, str] = {}
        if date_from:
            date_q["$gte"] = date_from
        if date_to:
            date_q["$lte"] = date_to
        query["date"] = date_q

    total = database.attendance_logs.count_documents(query)
    skip_count = (page - 1) * page_size
    cursor = database.attendance_logs.find(query).sort([("date", -1), ("emp_code", 1)]).skip(skip_count).limit(page_size)

    items = [serialize_attendance_doc(doc) for doc in cursor]
    return AttendancePage(items=items, total=total, page=page, page_size=page_size)


@app.patch("/attendance/{emp_code}/{date}", response_model=AttendanceRecord, tags=["attendance"])
def regularize_attendance(
    emp_code: str = Path(...),
    date: str = Path(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    req: RegularizeRequest = ...,
):
    """Regularize (manually correct) one day's record and append an audit history item."""
    database = get_db()
    emp = database.employees.find_one({"emp_code": emp_code})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{emp_code}' not found")

    record = database.attendance_logs.find_one({"emp_code": emp_code, "date": date})
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Attendance record not found for {emp_code} on {date}",
        )

    # Determine target status
    target_status = req.status if req.status is not None else record.get("status")

    if target_status in ("ABSENT", "LEAVE"):
        if req.punch_in is not None or req.punch_out is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"punch_in and punch_out cannot be supplied when status is {target_status}",
            )
        target_punch_in = None
        target_punch_out = None
        target_work_hours = None
        target_late_mins = 0
        target_overtime_mins = 0
        target_half_day = False
    else:
        # Presence status requires punch_in
        if req.punch_in is not None:
            target_punch_in = to_bson_date(req.punch_in)
        else:
            target_punch_in = record.get("punch_in")

        if target_punch_in is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A presence status requires punch_in",
            )

        # punch_in must stay on the record's attendance date per R1
        calc_date = get_attendance_date(target_punch_in, emp["shift_start"], emp["shift_end"])
        if calc_date != date:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"punch_in maps to attendance date '{calc_date}', but record is for date '{date}'",
            )

        if req.punch_out is not None:
            target_punch_out = to_bson_date(req.punch_out)
        else:
            target_punch_out = record.get("punch_out")

        shift_start_dt, shift_end_dt = get_shift_datetimes(date, emp["shift_start"], emp["shift_end"])
        target_late_mins = compute_late_minutes(target_punch_in, shift_start_dt)

        if target_punch_out is not None:
            if target_punch_out <= target_punch_in:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="punch_out must be strictly after punch_in",
                )
            if (target_punch_out - target_punch_in).total_seconds() > 86400:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="punch_out cannot be more than 24 hours after punch_in",
                )
            target_work_hours = compute_work_hours(target_punch_in, target_punch_out)
            target_overtime_mins = compute_overtime_minutes(target_punch_out, shift_end_dt)
            target_half_day = is_half_day(target_work_hours)
        else:
            target_work_hours = None
            target_overtime_mins = 0
            target_half_day = False

    # Determine diffs for fields that ACTUALLY changed
    changes: Dict[str, Dict[str, Any]] = {}

    old_status = record.get("status")
    if target_status != old_status:
        changes["status"] = {"from": old_status, "to": target_status}

    old_punch_in_ms = to_epoch_ms(record.get("punch_in"))
    new_punch_in_ms = to_epoch_ms(target_punch_in)
    if old_punch_in_ms != new_punch_in_ms:
        changes["punch_in"] = {"from": target_punch_in, "to": target_punch_in, "_old_raw": record.get("punch_in")}

    old_punch_out_ms = to_epoch_ms(record.get("punch_out"))
    new_punch_out_ms = to_epoch_ms(target_punch_out)
    if old_punch_out_ms != new_punch_out_ms:
        changes["punch_out"] = {"from": target_punch_out, "to": target_punch_out, "_old_raw": record.get("punch_out")}

    old_work_hours = record.get("work_hours")
    if target_work_hours != old_work_hours:
        changes["work_hours"] = {"from": old_work_hours, "to": target_work_hours}

    old_late_mins = record.get("late_minutes", 0)
    if target_late_mins != old_late_mins:
        changes["late_minutes"] = {"from": old_late_mins, "to": target_late_mins}

    old_overtime_mins = record.get("overtime_minutes", 0)
    if target_overtime_mins != old_overtime_mins:
        changes["overtime_minutes"] = {"from": old_overtime_mins, "to": target_overtime_mins}

    old_half_day = bool(record.get("half_day", False))
    if target_half_day != old_half_day:
        changes["half_day"] = {"from": old_half_day, "to": target_half_day}

    if not changes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Request made no changes to the attendance record",
        )

    # Format history entry for database (BSON dates for punch_in/out)
    db_changes = {}
    for k, v in changes.items():
        if k in ("punch_in", "punch_out"):
            db_changes[k] = {"from": v["_old_raw"], "to": v["to"]}
        else:
            db_changes[k] = {"from": v["from"], "to": v["to"]}

    now_ms = current_epoch_ms()
    history_entry = {
        "at": to_bson_date(now_ms),
        "by": req.regularized_by,
        "reason": req.reason,
        "changes": db_changes,
    }

    # Concurrent safety: ensure history array length matches current to avoid losing audit trail
    current_history = record.get("history", [])
    updated = database.attendance_logs.find_one_and_update(
        {
            "_id": record["_id"],
            "$expr": {"$eq": [{"$size": {"$ifNull": ["$history", []]}}, len(current_history)]},
        },
        {
            "$set": {
                "status": target_status,
                "punch_in": target_punch_in,
                "punch_out": target_punch_out,
                "work_hours": target_work_hours,
                "late_minutes": target_late_mins,
                "overtime_minutes": target_overtime_mins,
                "half_day": target_half_day,
            },
            "$push": {"history": history_entry},
        },
        return_document=ReturnDocument.AFTER,
    )

    if not updated:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Concurrent update conflict on record regularization; please retry",
        )

    return serialize_attendance_doc(updated)


# --- Analytics Endpoints ---

def get_month_range(month_str: str) -> tuple[str, str, int]:
    """Returns (start_date_str, end_date_str, days_in_month)."""
    year, month = map(int, month_str.split("-"))
    _, days = calendar.monthrange(year, month)
    return f"{month_str}-01", f"{month_str}-{days:02d}", days


def count_working_days(from_date_str: str, to_date_str: str) -> int:
    """R7: Mon-Fri days between from_date and to_date inclusive."""
    cur = datetime.strptime(from_date_str, "%Y-%m-%d").date()
    end = datetime.strptime(to_date_str, "%Y-%m-%d").date()
    if cur > end:
        return 0
    cnt = 0
    while cur <= end:
        if cur.weekday() < 5:  # 0=Mon, 4=Fri
            cnt += 1
        cur += timedelta(days=1)
    return cnt


@app.get("/analytics/employees/{emp_code}/monthly", response_model=EmployeeMonthly, tags=["analytics"])
def employee_monthly_analytics(
    emp_code: str = Path(...),
    month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
):
    """Monthly attendance summary for one employee."""
    database = get_db()
    emp = database.employees.find_one({"emp_code": emp_code})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{emp_code}' not found")

    start_date, end_date, _ = get_month_range(month)
    joined_on = emp["joined_on"]
    eff_start = max(start_date, joined_on)
    working_days = count_working_days(eff_start, end_date)

    # MongoDB aggregation on attendance_logs
    pipeline = [
        {"$match": {"emp_code": emp_code, "date": {"$gte": start_date, "$lte": end_date}}},
        {
            "$project": {
                "date": 1,
                "status": 1,
                "late_minutes": {"$ifNull": ["$late_minutes", 0]},
                "overtime_minutes": {"$ifNull": ["$overtime_minutes", 0]},
                "half_day": {"$ifNull": ["$half_day", False]},
                "day_of_week": {"$dayOfWeek": {"$dateFromString": {"dateString": "$date"}}},
            }
        },
        {
            "$group": {
                "_id": None,
                "leave_days": {"$sum": {"$cond": [{"$eq": ["$status", "LEAVE"]}, 1, 0]}},
                "late_count": {"$sum": {"$cond": [{"$gt": ["$late_minutes", 0]}, 1, 0]}},
                "total_late_minutes": {"$sum": "$late_minutes"},
                "total_overtime_minutes": {"$sum": "$overtime_minutes"},
                "present_days": {
                    "$sum": {
                        "$cond": [
                            {
                                "$and": [
                                    {"$in": ["$status", ["PRESENT", "WFH", "ON_DUTY"]]},
                                    {"$in": ["$day_of_week", [2, 3, 4, 5, 6]]},  # Mon-Fri in Mongo (1=Sun, 2=Mon)
                                ]
                            },
                            {"$cond": ["$half_day", 0.5, 1.0]},
                            0.0,
                        ]
                    }
                },
            }
        },
    ]

    res = list(database.attendance_logs.aggregate(pipeline))
    if res:
        row = res[0]
        present_days = float(row.get("present_days", 0.0))
        leave_days = int(row.get("leave_days", 0))
        late_count = int(row.get("late_count", 0))
        total_late = int(row.get("total_late_minutes", 0))
        total_ot = int(row.get("total_overtime_minutes", 0))
    else:
        present_days = 0.0
        leave_days = 0
        late_count = 0
        total_late = 0
        total_ot = 0

    attendance_pct = None
    if working_days > 0:
        pct = (Decimal(str(present_days)) / Decimal(str(working_days))) * Decimal("100")
        attendance_pct = round_half_up(pct, 2)

    return EmployeeMonthly(
        emp_code=emp_code,
        month=month,
        working_days=working_days,
        present_days=round_half_up(present_days, 2) or 0.0,
        leave_days=leave_days,
        late_count=late_count,
        total_late_minutes=total_late,
        total_overtime_minutes=total_ot,
        attendance_pct=attendance_pct,
    )


@app.get("/analytics/departments/summary", response_model=DepartmentSummary, tags=["analytics"])
def department_summary_analytics(
    month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    department: Optional[str] = Query(None),
):
    """Department summary for a month. Headcount includes employees with 0 logs."""
    database = get_db()
    start_date, end_date, _ = get_month_range(month)

    # Base match on employees: joined_on <= end_date (R9)
    emp_match: Dict[str, Any] = {"joined_on": {"$lte": end_date}}
    if department:
        emp_match["department"] = department

    pipeline = [
        {"$match": emp_match},
        {
            "$lookup": {
                "from": "attendance_logs",
                "let": {"emp": "$emp_code"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$emp_code", "$$emp"]},
                                    {"$gte": ["$date", start_date]},
                                    {"$lte": ["$date", end_date]},
                                ]
                            }
                        }
                    },
                    {
                        "$project": {
                            "status": 1,
                            "date": 1,
                            "late_minutes": {"$ifNull": ["$late_minutes", 0]},
                            "work_hours": 1,
                            "half_day": {"$ifNull": ["$half_day", False]},
                            "day_of_week": {"$dayOfWeek": {"$dateFromString": {"dateString": "$date"}}},
                        }
                    },
                ],
                "as": "logs",
            }
        },
        {
            "$project": {
                "department": 1,
                "emp_present_days": {
                    "$sum": {
                        "$map": {
                            "input": "$logs",
                            "as": "l",
                            "in": {
                                "$cond": [
                                    {
                                        "$and": [
                                            {"$in": ["$$l.status", ["PRESENT", "WFH", "ON_DUTY"]]},
                                            {"$in": ["$$l.day_of_week", [2, 3, 4, 5, 6]]},
                                        ]
                                    },
                                    {"$cond": ["$$l.half_day", 0.5, 1.0]},
                                    0.0,
                                ]
                            },
                        }
                    }
                },
                "emp_late_count": {
                    "$sum": {
                        "$map": {
                            "input": "$logs",
                            "as": "l",
                            "in": {"$cond": [{"$gt": ["$$l.late_minutes", 0]}, 1, 0]},
                        }
                    }
                },
                "emp_total_late_minutes": {
                    "$sum": {
                        "$map": {
                            "input": "$logs",
                            "as": "l",
                            "in": "$$l.late_minutes",
                        }
                    }
                },
                "emp_leave_count": {
                    "$sum": {
                        "$map": {
                            "input": "$logs",
                            "as": "l",
                            "in": {"$cond": [{"$eq": ["$$l.status", "LEAVE"]}, 1, 0]},
                        }
                    }
                },
                "emp_on_duty_count": {
                    "$sum": {
                        "$map": {
                            "input": "$logs",
                            "as": "l",
                            "in": {"$cond": [{"$eq": ["$$l.status", "ON_DUTY"]}, 1, 0]},
                        }
                    }
                },
                "emp_work_hours": {
                    "$map": {
                        "input": {
                            "$filter": {
                                "input": "$logs",
                                "as": "l",
                                "cond": {
                                    "$and": [
                                        {"$in": ["$$l.status", ["PRESENT", "WFH", "ON_DUTY"]]},
                                        {"$ne": ["$$l.work_hours", None]},
                                    ]
                                },
                            }
                        },
                        "as": "l",
                        "in": "$$l.work_hours",
                    }
                },
            }
        },
        {
            "$group": {
                "_id": "$department",
                "headcount": {"$sum": 1},
                "present_days": {"$sum": "$emp_present_days"},
                "late_count": {"$sum": "$emp_late_count"},
                "total_late_minutes": {"$sum": "$emp_total_late_minutes"},
                "leave_count": {"$sum": "$emp_leave_count"},
                "on_duty_count": {"$sum": "$emp_on_duty_count"},
                "all_work_hours": {"$push": "$emp_work_hours"},
            }
        },
        {
            "$project": {
                "department": "$_id",
                "headcount": 1,
                "present_days": 1,
                "late_count": 1,
                "total_late_minutes": 1,
                "leave_count": 1,
                "on_duty_count": 1,
                "avg_work_hours": {
                    "$let": {
                        "vars": {
                            "flat_hours": {
                                "$reduce": {
                                    "input": "$all_work_hours",
                                    "initialValue": [],
                                    "in": {"$concatArrays": ["$$value", "$$this"]},
                                }
                            }
                        },
                        "in": {
                            "$cond": [
                                {"$gt": [{"$size": "$$flat_hours"}, 0]},
                                {"$avg": "$$flat_hours"},
                                None,
                            ]
                        },
                    }
                },
            }
        },
        {"$sort": {"department": 1}},
    ]

    cursor = database.employees.aggregate(pipeline)
    items = [
        DepartmentSummaryItem(
            department=row["department"],
            headcount=row["headcount"],
            present_days=round_half_up(row["present_days"], 2) or 0.0,
            avg_work_hours=round_half_up(row["avg_work_hours"], 2),
            late_count=row["late_count"],
            total_late_minutes=row["total_late_minutes"],
            leave_count=row["leave_count"],
            on_duty_count=row["on_duty_count"],
        )
        for row in cursor
        if row["headcount"] > 0
    ]

    return DepartmentSummary(month=month, items=items)


@app.get("/analytics/leaderboard/late", response_model=Leaderboard, tags=["analytics"])
def late_leaderboard_analytics(
    month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    limit: int = Query(10, ge=1, le=50),
    department: Optional[str] = Query(None),
):
    """
    Ranks employees by total late_minutes in month (total > 0).
    Standard competition ranking (1, 2, 2, 4).
    limit applies after ranking (rank <= limit).
    """
    database = get_db()
    start_date, end_date, _ = get_month_range(month)

    pipeline = [
        {"$match": {"date": {"$gte": start_date, "$lte": end_date}}},
        {
            "$lookup": {
                "from": "employees",
                "localField": "emp_code",
                "foreignField": "emp_code",
                "as": "emp",
            }
        },
        {"$unwind": "$emp"},
    ]

    if department:
        pipeline.append({"$match": {"emp.department": department}})

    pipeline.extend([
        {
            "$group": {
                "_id": "$emp_code",
                "emp_code": {"$first": "$emp_code"},
                "name": {"$first": "$emp.name"},
                "department": {"$first": "$emp.department"},
                "total_late_minutes": {"$sum": {"$ifNull": ["$late_minutes", 0]}},
                "late_count": {
                    "$sum": {"$cond": [{"$gt": [{"$ifNull": ["$late_minutes", 0]}, 0]}, 1, 0]}
                },
            }
        },
        {"$match": {"total_late_minutes": {"$gt": 0}}},
        {
            "$setWindowFields": {
                "sortBy": {"total_late_minutes": -1},
                "output": {
                    "rank": {"$rank": {}}
                }
            }
        },
        {"$match": {"rank": {"$lte": limit}}},
        {"$sort": {"total_late_minutes": -1, "emp_code": 1}},
    ])

    results = list(database.attendance_logs.aggregate(pipeline))

    ranked_items = [
        LeaderboardItem(
            rank=row["rank"],
            emp_code=row["emp_code"],
            name=row["name"],
            department=row["department"],
            total_late_minutes=row["total_late_minutes"],
            late_count=row["late_count"],
        )
        for row in results
    ]

    return Leaderboard(month=month, items=ranked_items)


@app.get("/analytics/departments/{department}/trend", response_model=Trend, tags=["analytics"])
def department_trend_analytics(
    department: str = Path(...),
    from_date: str = Query(..., alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    to_date: str = Query(..., alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    """Daily attendance trend for a department. One row per calendar day."""
    start_d = datetime.strptime(from_date, "%Y-%m-%d").date()
    end_d = datetime.strptime(to_date, "%Y-%m-%d").date()

    if end_d < start_d:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'to' must be greater than or equal to 'from'",
        )

    num_days = (end_d - start_d).days + 1
    if num_days > 92:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Date range cannot exceed 92 days",
        )

    database = get_db()
    # Check if department exists
    dept_emp_count = database.employees.count_documents({"department": department})
    if dept_emp_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Department '{department}' not found",
        )

    pipeline = [
        {"$match": {"department": department}},
        {"$limit": 1},
        {
            "$project": {
                "dates": {
                    "$map": {
                        "input": {"$range": [0, num_days]},
                        "as": "d",
                        "in": {
                            "$dateToString": {
                                "format": "%Y-%m-%d",
                                "date": {
                                    "$dateAdd": {
                                        "startDate": datetime(start_d.year, start_d.month, start_d.day, tzinfo=timezone.utc),
                                        "unit": "day",
                                        "amount": "$$d",
                                    }
                                },
                            }
                        },
                    }
                }
            }
        },
        {"$unwind": "$dates"},
        {"$project": {"date": "$dates"}},
        {
            "$lookup": {
                "from": "employees",
                "let": {"cur_date": "$date"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$department", department]},
                                    {"$lte": ["$joined_on", "$$cur_date"]},
                                ]
                            }
                        }
                    },
                    {"$count": "count"},
                ],
                "as": "hc_docs",
            }
        },
        {
            "$lookup": {
                "from": "attendance_logs",
                "let": {"cur_date": "$date"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$date", "$$cur_date"]},
                                ]
                            }
                        }
                    },
                    {
                        "$lookup": {
                            "from": "employees",
                            "localField": "emp_code",
                            "foreignField": "emp_code",
                            "as": "emp",
                        }
                    },
                    {"$unwind": "$emp"},
                    {"$match": {"emp.department": department}},
                ],
                "as": "logs",
            }
        },
        {
            "$project": {
                "date": 1,
                "day_of_week": {
                    "$dayOfWeek": {"$dateFromString": {"dateString": "$date"}}
                },
                "headcount": {"$ifNull": [{"$arrayElemAt": ["$hc_docs.count", 0]}, 0]},
                "present_count": {
                    "$sum": {
                        "$map": {
                            "input": "$logs",
                            "as": "l",
                            "in": {
                                "$cond": [
                                    {"$in": ["$$l.status", ["PRESENT", "WFH", "ON_DUTY"]]},
                                    {"$cond": ["$$l.half_day", 0.5, 1.0]},
                                    0.0,
                                ]
                            },
                        }
                    }
                },
                "late_count": {
                    "$sum": {
                        "$map": {
                            "input": "$logs",
                            "as": "l",
                            "in": {"$cond": [{"$gt": [{"$ifNull": ["$$l.late_minutes", 0]}, 0]}, 1, 0]},
                        }
                    }
                },
            }
        },
        {
            "$project": {
                "date": 1,
                "is_working_day": {"$in": ["$day_of_week", [2, 3, 4, 5, 6]]},
                "headcount": 1,
                "present_count": 1,
                "late_count": 1,
                "attendance_rate": {
                    "$cond": [
                        {
                            "$and": [
                                {"$in": ["$day_of_week", [2, 3, 4, 5, 6]]},
                                {"$gt": ["$headcount", 0]},
                            ]
                        },
                        {"$divide": ["$present_count", "$headcount"]},
                        None,
                    ]
                },
            }
        },
        {
            "$setWindowFields": {
                "sortBy": {"date": 1},
                "output": {
                    "moving_avg_7d": {
                        "$avg": "$attendance_rate",
                        "window": {
                            "documents": [-6, "current"]
                        }
                    }
                }
            }
        },
        {"$sort": {"date": 1}},
    ]

    cursor = database.employees.aggregate(pipeline)
    items = [
        TrendItem(
            date=row["date"],
            is_working_day=row["is_working_day"],
            headcount=row["headcount"],
            present_count=round_half_up(row["present_count"], 2) or 0.0,
            late_count=row["late_count"],
            attendance_rate=round_half_up(row["attendance_rate"], 4),
            moving_avg_7d=round_half_up(row["moving_avg_7d"], 4),
        )
        for row in cursor
    ]

    return Trend(department=department, items=items)


# --- Admin Explain Endpoint ---

@app.get("/admin/explain/{endpoint}", tags=["admin"])
def explain_endpoint(
    endpoint: str = Path(..., pattern=r"^(attendance_list|employee_monthly|department_summary|late_leaderboard|department_trend)$"),
    emp_code: Optional[str] = Query(None),
    month: Optional[str] = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    department: Optional[str] = Query(None),
    limit: Optional[int] = Query(10, ge=1, le=50),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    page: Optional[int] = Query(1),
    page_size: Optional[int] = Query(20),
):
    """Returns MongoDB explain output with executionStats for the endpoint's main query."""
    database = get_db()

    if endpoint == "attendance_list":
        query: Dict[str, Any] = {}
        if emp_code:
            query["emp_code"] = emp_code
        if status_filter:
            query["status"] = status_filter
        if date_from or date_to:
            date_q: Dict[str, str] = {}
            if date_from:
                date_q["$gte"] = date_from
            if date_to:
                date_q["$lte"] = date_to
            query["date"] = date_q
        cursor = database.attendance_logs.find(query).sort([("date", -1), ("emp_code", 1)])
        explain_doc = cursor.explain()
        return {"endpoint": endpoint, "collection": "attendance_logs", "explain": explain_doc}

    elif endpoint == "employee_monthly":
        if not emp_code or not month:
            raise HTTPException(status_code=422, detail="emp_code and month are required")
        start_d, end_d, _ = get_month_range(month)
        pipeline = [
            {"$match": {"emp_code": emp_code, "date": {"$gte": start_d, "$lte": end_d}}},
            {"$group": {"_id": None, "count": {"$sum": 1}}},
        ]
        explain_doc = database.command(
            "explain",
            {"aggregate": "attendance_logs", "pipeline": pipeline, "cursor": {}},
            verbosity="executionStats",
        )
        return {"endpoint": endpoint, "collection": "attendance_logs", "explain": explain_doc}

    elif endpoint == "department_summary":
        if not month:
            raise HTTPException(status_code=422, detail="month is required")
        _, end_d, _ = get_month_range(month)
        emp_match: Dict[str, Any] = {"joined_on": {"$lte": end_d}}
        if department:
            emp_match["department"] = department
        pipeline = [
            {"$match": emp_match},
            {"$group": {"_id": "$department", "headcount": {"$sum": 1}}},
        ]
        explain_doc = database.command(
            "explain",
            {"aggregate": "employees", "pipeline": pipeline, "cursor": {}},
            verbosity="executionStats",
        )
        return {"endpoint": endpoint, "collection": "employees", "explain": explain_doc}

    elif endpoint == "late_leaderboard":
        if not month:
            raise HTTPException(status_code=422, detail="month is required")
        start_d, end_d, _ = get_month_range(month)
        pipeline = [
            {"$match": {"date": {"$gte": start_d, "$lte": end_d}}},
            {"$group": {"_id": "$emp_code", "total_late_minutes": {"$sum": "$late_minutes"}}},
        ]
        explain_doc = database.command(
            "explain",
            {"aggregate": "attendance_logs", "pipeline": pipeline, "cursor": {}},
            verbosity="executionStats",
        )
        return {"endpoint": endpoint, "collection": "attendance_logs", "explain": explain_doc}

    elif endpoint == "department_trend":
        dept = department
        if not dept or not from_date or not to_date:
            raise HTTPException(status_code=422, detail="department, from, and to are required")
        pipeline = [
            {"$match": {"department": dept}},
            {"$group": {"_id": "$department", "count": {"$sum": 1}}},
        ]
        explain_doc = database.command(
            "explain",
            {"aggregate": "employees", "pipeline": pipeline, "cursor": {}},
            verbosity="executionStats",
        )
        return {"endpoint": endpoint, "collection": "employees", "explain": explain_doc}

    raise HTTPException(status_code=422, detail=f"Unknown endpoint '{endpoint}'")
