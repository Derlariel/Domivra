ALTER TABLE units ADD COLUMN IF NOT EXISTS owner_name text NOT NULL DEFAULT '';
ALTER TABLE units ADD COLUMN IF NOT EXISTS owner_phone text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS resident_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nationality text NOT NULL DEFAULT '',
  identity_type text NOT NULL DEFAULT '' CHECK (identity_type IN ('','thai_id','passport')),
  identity_ciphertext text NOT NULL DEFAULT '',
  identity_last4 text NOT NULL DEFAULT '',
  visa_ciphertext text NOT NULL DEFAULT '',
  visa_expiry date,
  phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', line_id text NOT NULL DEFAULT '',
  emergency_name text NOT NULL DEFAULT '', emergency_relationship text NOT NULL DEFAULT '', emergency_phone text NOT NULL DEFAULT '',
  occupants jsonb NOT NULL DEFAULT '[]'::jsonb,
  pets jsonb NOT NULL DEFAULT '[]'::jsonb,
  vehicles jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  authorized_people jsonb NOT NULL DEFAULT '[]'::jsonb,
  move_in_date date, move_out_date date,
  identity_document_key text NOT NULL DEFAULT '',
  authorization_document_key text NOT NULL DEFAULT '',
  consent_at timestamptz, privacy_notice_version text NOT NULL DEFAULT '',
  retention_at timestamptz,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resident_profiles_retention ON resident_profiles(retention_at) WHERE retention_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS resident_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('move_in','move_out','other')),
  inspected_at timestamptz NOT NULL, condition_note text NOT NULL,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resident_inspections_user ON resident_inspections(org_id,user_id,inspected_at DESC);

CREATE TABLE IF NOT EXISTS visitor_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visitor_name text NOT NULL, purpose text NOT NULL DEFAULT '',
  entered_at timestamptz NOT NULL, left_at timestamptz,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visitor_logs_user ON visitor_logs(org_id,user_id,entered_at DESC);

CREATE TABLE IF NOT EXISTS resident_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL, detail text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resident_complaints_user ON resident_complaints(org_id,user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_id uuid REFERENCES users(id) ON DELETE SET NULL,
  method text NOT NULL, route text NOT NULL, status integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS target_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS audit_events_org_time ON audit_events(org_id,created_at DESC);

CREATE TABLE IF NOT EXISTS private_file_deletions (
  key text PRIMARY KEY, queued_at timestamptz NOT NULL DEFAULT now()
);
