# Employee Attendance & Analytics API

A high-performance, production-ready RESTful service built with **Python 3.10+ / FastAPI** and **MongoDB 6.0+** implementing employee punch-in/out workflows, manual correction audit logs, and analytical aggregations adhering to rules R1–R10 and `openapi.yaml`.

---

## Deliverables in This Repository

| File | Purpose |
|---|---|
| `app/main.py` | Complete FastAPI implementation with all endpoints, models, rules, and MongoDB aggregations. |
| `requirements.txt` | Minimal Python dependencies for running the API. |
| `REVIEW.md` | Detailed review of defects identified in the starter kit and explanations for non-defects. |
| `DECISIONS.md` | Concise explanations of architectural decisions (indexes, races, ties, headcount, scaling). |
| `DATA_MODEL.md` | MongoDB schema specifications and sample documents. |
| `openapi.yaml` | OpenAPI 3.0.3 API contract and business rules (R1–R10). |
| `sample_seed.py` | Database seeding script for sample employees and attendance logs. |
| `sample_data/` | Extended JSON sample documents for seeding. |

---

## Prerequisites & Installation

- Python 3.10+
- MongoDB 6.0+ (Local Docker container or MongoDB Atlas M0 cluster)

### Setup Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Configure Environment

Create a `.env` file in the root directory (or export environment variables directly):

```bash
MONGO_URI="mongodb://localhost:27017"
MONGO_DB="attendance_db"
```

### Seed Sample Data

```bash
python sample_seed.py
```

### Run Server

```bash
uvicorn app.main:app --port 8000 --reload
```

Interactive Swagger documentation is available at:
`http://localhost:8000/docs`

---

## Key Features & Business Rules Implementation

- **R1 Timezone & Attendance Date**: Full IST (`UTC+05:30`) support with overnight shifts (e.g., 22:00–06:00) mapped to the shift starting date. Instants truncated to whole seconds.
- **R2 Grace Period & Late Minutes**: Grace period of 10:00 (strictly > 10:00 late). `late_minutes` computed as floor minutes since `shift_start`.
- **R3 Overtime Calculation**: Whole minutes >= 30 between `shift_end` and `punch_out`.
- **R4 Work Hours**: `Decimal` arithmetic with `ROUND_HALF_UP` (preventing floating point inaccuracies and banker's rounding).
- **R5 Half-Day**: Work hours < 4.50 flagged as `half_day: true` (counts as 0.5 present day).
- **R6 Presence**: `PRESENT`, `WFH`, `ON_DUTY` count as present; `ABSENT` and `LEAVE` do not.
- **R7 Working Days**: Mon–Fri working days calendar computed dynamically per employee join date (`joined_on`).
- **R8 Rounding**: Decimal half-up rounding (2 decimals for hours/percentages, 4 decimals for rates).
- **R9 Headcount**: Employees who joined on or before the end of the period are always counted, even with zero logs.
- **R10 Pagination & Concurrency**: Atomic MongoDB operations (`find_one_and_update`, compound unique indexes) eliminate check-then-insert race conditions.
