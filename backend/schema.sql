-- ============================================================
-- Offline-First AI Attendance System — PostgreSQL Schema
-- University of Ilorin | Candidate: 22/01DL068
-- ============================================================

-- ── Users (Admin / Lecturer / Student accounts) ─────────────
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(200) UNIQUE NOT NULL,
    password_hash   VARCHAR(200) NOT NULL,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'lecturer', 'student')),
    full_name       VARCHAR(200) NOT NULL,
    linked_matric   VARCHAR(20),                   -- only for student role
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Courses ──────────────────────────────────────────────────
CREATE TABLE courses (
    course_code                 VARCHAR(20) PRIMARY KEY,
    course_title                VARCHAR(200) NOT NULL,
    lecturer_id                 INT REFERENCES users(id),
    expected_count              INT,                        -- official registered student count (set by admin)
    matric_list                 TEXT[],                     -- official matric numbers allowed to self-enroll
    enrollment_link_token       VARCHAR(64) UNIQUE,         -- course-level self-enrollment link token
    enrollment_link_expires_at  TIMESTAMPTZ,                -- link expiry
    over_enrollment_flagged     BOOLEAN DEFAULT FALSE,      -- TRUE when enrolled > expected_count
    created_at                  TIMESTAMPTZ DEFAULT now()
);

-- ── One-time enrollment tokens issued by admin/lecturer ──────
-- Retained for legacy/individual token support
CREATE TABLE enrollment_tokens (
    token           VARCHAR(64) PRIMARY KEY,
    course_code     VARCHAR(20) REFERENCES courses(course_code),
    matric_number   VARCHAR(20),
    used            BOOLEAN DEFAULT FALSE,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ
);

-- ── Students ─────────────────────────────────────────────────
-- embedding: 1024-dim Float array produced by @vladmandic/human FaceRes model
-- iris_embedding: 512-dim iris descriptor (human.js iris pipeline)
-- behavioural_profile: DeviceMotion + touch vector profile for twin disambiguation
CREATE TABLE students (
    matric_number           VARCHAR(20) PRIMARY KEY,
    full_name               VARCHAR(200) NOT NULL,
    embedding               FLOAT8[] NOT NULL,          -- 1024-dim FaceRes descriptor
    iris_embedding          FLOAT8[],                   -- 512-dim iris descriptor
    enrolled_at             TIMESTAMPTZ DEFAULT now(),
    consent_given_at        TIMESTAMPTZ NOT NULL,
    consent_version         VARCHAR(10) NOT NULL,
    high_similarity_flag    BOOLEAN DEFAULT FALSE,
    flagged_pair_matric     VARCHAR(20),
    behavioural_profile     JSONB
);

-- ── Course Enrolments ─────────────────────────────────────────
CREATE TABLE course_enrollments (
    matric_number   VARCHAR(20) REFERENCES students(matric_number),
    course_code     VARCHAR(20) REFERENCES courses(course_code),
    enrolled_at     TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (matric_number, course_code)
);

-- ── Attendance Sessions (QR-gated) ───────────────────────────
CREATE TABLE sessions (
    session_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_code         VARCHAR(20) REFERENCES courses(course_code),
    lecturer_id         INT REFERENCES users(id),
    qr_token            VARCHAR(64) UNIQUE NOT NULL,
    qr_signature        VARCHAR(128) NOT NULL,
    started_at          TIMESTAMPTZ DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    ended_at            TIMESTAMPTZ,
    active              BOOLEAN DEFAULT TRUE,
    -- Batch scan tracking
    batch_scan_done     BOOLEAN DEFAULT FALSE,          -- TRUE after lecturer runs batch scan
    batch_scanned_at    TIMESTAMPTZ,
    batch_matched_count INT DEFAULT 0,
    -- Fallback QR release
    fallback_released   BOOLEAN DEFAULT FALSE,          -- TRUE when lecturer releases fallback QR
    fallback_released_at TIMESTAMPTZ,
    fallback_expires_at TIMESTAMPTZ                     -- time-bound window for fallback QR
);

-- ── Attendance Records ───────────────────────────────────────
-- method: 'batch_face' | 'fallback_qr' | 'manual_override'
-- liveness_ear_score: Eye Aspect Ratio average across blink frames
-- liveness_rppg_score: rPPG frequency-domain confidence 0–1
CREATE TABLE attendance_records (
    id                      SERIAL PRIMARY KEY,
    matric_number           VARCHAR(20) REFERENCES students(matric_number),
    session_id              UUID REFERENCES sessions(session_id),
    matched_at              TIMESTAMPTZ DEFAULT now(),
    similarity_distance     FLOAT8 NOT NULL,            -- cosine distance; lower = better match
    liveness_ear_score      FLOAT8,                     -- EAR blink liveness 0–1
    liveness_rppg_score     FLOAT8,                     -- rPPG liveness 0–1
    iris_distance           FLOAT8,                     -- iris match distance (twin disambiguation)
    method                  VARCHAR(30) DEFAULT 'batch_face',  -- batch_face | fallback_qr | manual_override
    confidence_band         VARCHAR(10),                -- 'high' | 'uncertain' | 'reject'
    synced_from_client      BOOLEAN DEFAULT FALSE,       -- TRUE if synced from offline queue
    client_uuid             VARCHAR(64),                 -- device ID of originating PWA node
    UNIQUE (matric_number, session_id)
);

-- ── Offline Sync Log ─────────────────────────────────────────
CREATE TABLE sync_log (
    id              SERIAL PRIMARY KEY,
    client_uuid     VARCHAR(64) NOT NULL,
    synced_at       TIMESTAMPTZ DEFAULT now(),
    record_count    INT NOT NULL,
    session_id      UUID REFERENCES sessions(session_id)
);

-- ── Indexes ──────────────────────────────────────────────────
-- Course-scoped enrollment lookup (Section 3.5.2 — matching scoped to enrolled course only)
CREATE INDEX idx_enrollments_course ON course_enrollments(course_code);
-- Fast attendance query per session
CREATE INDEX idx_attendance_session ON attendance_records(session_id);
-- Fast student lookup by similarity flag
CREATE INDEX idx_students_flag ON students(high_similarity_flag) WHERE high_similarity_flag = TRUE;
-- Over-enrollment flag lookup for admin dashboard
CREATE INDEX idx_courses_flag ON courses(over_enrollment_flagged) WHERE over_enrollment_flagged = TRUE;
-- Enrollment link token lookup
CREATE INDEX idx_courses_link ON courses(enrollment_link_token);