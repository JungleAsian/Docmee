-- P02: Appointment booking foundation

CREATE TABLE IF NOT EXISTS services (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  description      TEXT,
  duration_minutes INTEGER     NOT NULL DEFAULT 30,
  price            DECIMAL(10, 2),
  currency         TEXT        NOT NULL DEFAULT 'GTQ',
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  metadata         JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_clinic ON services(clinic_id);
SELECT add_updated_at_trigger('services');

CREATE TABLE IF NOT EXISTS providers (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  full_name          TEXT        NOT NULL,
  email              TEXT,
  specialty          TEXT,
  google_calendar_id TEXT,
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  metadata           JSONB       NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_providers_clinic ON providers(clinic_id);
SELECT add_updated_at_trigger('providers');

CREATE TABLE IF NOT EXISTS provider_availability (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID        NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  clinic_id    UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  day_of_week  INTEGER     NOT NULL,
  start_time   TIME        NOT NULL,
  end_time     TIME        NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT availability_dow_check   CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT availability_time_check  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_provider ON provider_availability(provider_id);
SELECT add_updated_at_trigger('provider_availability');

CREATE TABLE IF NOT EXISTS appointments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  provider_id     UUID        NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  service_id      UUID        REFERENCES services(id) ON DELETE SET NULL,
  conversation_id UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  google_event_id TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending',
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  notes           TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT appointments_status_check    CHECK (status     IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  CONSTRAINT appointments_time_check      CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_appointments_clinic     ON appointments(clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient    ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_provider   ON appointments(provider_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);
SELECT add_updated_at_trigger('appointments');

CREATE TABLE IF NOT EXISTS appointment_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID        NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  clinic_id      UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  actor_id       UUID,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT appt_events_type_check CHECK (event_type IN (
    'created', 'confirmed', 'cancelled', 'rescheduled', 'completed', 'no_show', 'reminder_sent'
  ))
);

CREATE INDEX IF NOT EXISTS idx_appt_events_appointment ON appointment_events(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appt_events_clinic      ON appointment_events(clinic_id);
