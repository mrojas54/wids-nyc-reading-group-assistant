-- migrations/001_initial_schema.sql
-- WiDS NYC AI Reading Group Assistant — initial schema
-- Apply via: paste into Supabase SQL Editor and run, or `supabase db push`.

BEGIN;

CREATE TABLE members (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  email     TEXT NOT NULL UNIQUE,
  phone     TEXT,
  whatsapp  TEXT,
  active    BOOLEAN NOT NULL DEFAULT true,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'operator')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_operator ON members(role) WHERE role='operator';

CREATE TABLE topics (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  weight INT NOT NULL DEFAULT 1
);

CREATE TABLE papers (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  url           TEXT,
  abstract      TEXT,
  authors       TEXT[],
  venue         TEXT,
  year          INT,
  pdf_drive_url TEXT,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE paper_topics (
  paper_id INT REFERENCES papers(id) ON DELETE CASCADE,
  topic_id INT REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (paper_id, topic_id)
);

CREATE TABLE meetings (
  id                  SERIAL PRIMARY KEY,
  type                TEXT NOT NULL CHECK (type IN ('admin', 'reading_group')),
  status              TEXT NOT NULL CHECK (status IN ('prep','scheduled','done','cancelled','guide_failed')),
  scheduled_at        TIMESTAMPTZ,
  location            TEXT,
  planned_by_admin_id INT REFERENCES meetings(id),
  leader_id           INT REFERENCES members(id),
  paper_id            INT REFERENCES papers(id),
  form_url            TEXT,
  drive_folder_url    TEXT,
  packets_sent_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE volunteers (
  id           SERIAL PRIMARY KEY,
  meeting_id   INT NOT NULL REFERENCES meetings(id),
  member_id    INT NOT NULL REFERENCES members(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, member_id)
);

CREATE TABLE availability (
  id          SERIAL PRIMARY KEY,
  meeting_id  INT NOT NULL REFERENCES meetings(id),
  member_id   INT NOT NULL REFERENCES members(id),
  range_start TIMESTAMPTZ NOT NULL,
  range_end   TIMESTAMPTZ NOT NULL,
  CHECK (range_end > range_start)
);

CREATE TABLE meeting_attendance (
  id           SERIAL PRIMARY KEY,
  meeting_id   INT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id    INT NOT NULL REFERENCES members(id),
  rsvp_status  TEXT NOT NULL CHECK (rsvp_status IN ('attending','declined','tentative','no_response')) DEFAULT 'no_response',
  responded_at TIMESTAMPTZ,
  notes        TEXT,
  UNIQUE(meeting_id, member_id)
);

CREATE TABLE paper_suggestions (
  id            SERIAL PRIMARY KEY,
  meeting_id    INT NOT NULL REFERENCES meetings(id),
  paper_id      INT NOT NULL REFERENCES papers(id),
  suggested_by  INT REFERENCES members(id),
  source        TEXT NOT NULL CHECK (source IN ('member','agent','leader')),
  notes         TEXT,
  suggested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, paper_id)
);

CREATE TABLE command_log (
  id      SERIAL PRIMARY KEY,
  ran_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source  TEXT NOT NULL CHECK (source IN ('slash_command', 'scheduled_task')),
  name    TEXT NOT NULL,
  status  TEXT NOT NULL CHECK (status IN ('success', 'failure', 'no_action')),
  summary TEXT,
  error   TEXT
);

-- helpful indexes for common queries
CREATE INDEX idx_meetings_status_type ON meetings(status, type);
CREATE INDEX idx_meetings_scheduled_at ON meetings(scheduled_at);
CREATE INDEX idx_volunteers_meeting ON volunteers(meeting_id);
CREATE INDEX idx_availability_meeting ON availability(meeting_id);
CREATE INDEX idx_meeting_attendance_meeting ON meeting_attendance(meeting_id);
CREATE INDEX idx_paper_suggestions_meeting ON paper_suggestions(meeting_id);
CREATE INDEX idx_command_log_ran_at ON command_log(ran_at);

COMMIT;
