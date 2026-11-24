-- ============================================================
-- Migration 002 — LLM-assisted presence review
-- ============================================================
-- LLM output is advisory; lecturers approve, override, or reject it.

CREATE TABLE IF NOT EXISTS llm_presence_reviews (
    id                BIGSERIAL PRIMARY KEY,
    session_id        UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    matric_number     VARCHAR(20) NOT NULL REFERENCES students(matric_number),
    recommended_status VARCHAR(20) NOT NULL CHECK (
                          recommended_status IN ('present', 'left_early', 'absent', 'exempted', 'pending_review')
                      ),
    confidence        NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    reason_summary    TEXT NOT NULL,
    entities          JSONB NOT NULL DEFAULT '{}'::jsonb,
    draft_message     TEXT NOT NULL,
    model             VARCHAR(100) NOT NULL,
    prompt_version    VARCHAR(50) NOT NULL,
    fallback_used     BOOLEAN NOT NULL DEFAULT FALSE,
    fallback_reason   TEXT,
    raw_response      JSONB,
    created_by        INT REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_reviews_session
    ON llm_presence_reviews (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_reviews_student
    ON llm_presence_reviews (session_id, matric_number, created_at DESC);

CREATE TABLE IF NOT EXISTS llm_review_decisions (
    id            BIGSERIAL PRIMARY KEY,
    review_id     BIGINT NOT NULL REFERENCES llm_presence_reviews(id) ON DELETE CASCADE,
    session_id    UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    matric_number VARCHAR(20) NOT NULL REFERENCES students(matric_number),
    action        VARCHAR(20) NOT NULL CHECK (action IN ('approve', 'override', 'reject')),
    final_status  VARCHAR(20) CHECK (
                      final_status IN ('present', 'left_early', 'absent', 'exempted', 'pending_review')
                  ),
    note          TEXT,
    decided_by    INT NOT NULL REFERENCES users(id),
    decided_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_decisions_review
    ON llm_review_decisions (review_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS llm_review_audit (
    id            BIGSERIAL PRIMARY KEY,
    review_id     BIGINT REFERENCES llm_presence_reviews(id) ON DELETE SET NULL,
    session_id    UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
    matric_number VARCHAR(20),
    action        VARCHAR(40) NOT NULL,
    actor_id      INT REFERENCES users(id),
    detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_audit_session
    ON llm_review_audit (session_id, created_at DESC);
