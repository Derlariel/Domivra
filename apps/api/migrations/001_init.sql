CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  username text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('platform','admin','resident')),
  unit_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, username)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_platform_name_unique ON users(username) WHERE role='platform';
CREATE UNIQUE INDEX IF NOT EXISTS users_one_resident_per_unit ON users(unit_id) WHERE role='resident' AND unit_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS properties_org_name_unique ON properties(org_id,name);
CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  building text NOT NULL,
  number text NOT NULL,
  floor integer NOT NULL CHECK (floor >= 0),
  room_type text NOT NULL DEFAULT 'Standard',
  area numeric(10,2) NOT NULL DEFAULT 0 CHECK (area >= 0),
  rent numeric(12,2) NOT NULL DEFAULT 0 CHECK (rent >= 0),
  deposit numeric(12,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  water_meter text NOT NULL DEFAULT '',
  electric_meter text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','maintenance')),
  invite_hash text,
  invite_expires_at timestamptz,
  UNIQUE (org_id, property_id, building, number)
);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_unit_fk') THEN ALTER TABLE users ADD CONSTRAINT users_unit_fk FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL; END IF; END $$;
CREATE TABLE IF NOT EXISTS settings (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (org_id,key)
);
CREATE TABLE IF NOT EXISTS facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  building text NOT NULL DEFAULT '', name text NOT NULL, detail text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL, body text NOT NULL, category text NOT NULL DEFAULT 'ทั่วไป',
  building text NOT NULL DEFAULT '', priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','scheduled')),
  publish_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (announcement_id,user_id)
);
CREATE TABLE IF NOT EXISTS rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL, body text NOT NULL
);
CREATE TABLE IF NOT EXISTS rule_reads (
  rule_id uuid NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (rule_id,user_id)
);
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id), user_id uuid NOT NULL REFERENCES users(id),
  start_date date NOT NULL, end_date date NOT NULL,
  rent numeric(12,2) NOT NULL CHECK (rent >= 0), deposit numeric(12,2) NOT NULL CHECK (deposit >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  sign_mode text NOT NULL DEFAULT 'paper' CHECK (sign_mode IN ('paper','electronic')),
  sign_status text NOT NULL DEFAULT 'pending' CHECK (sign_status IN ('pending','signed')),
  document_key text, document_sha256 text, signed_name text, signed_at timestamptz,
  CHECK (start_date < end_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS contracts_one_active_per_unit ON contracts(unit_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
  document_sha256 text NOT NULL, signer_name text NOT NULL DEFAULT '', ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id), period char(7) NOT NULL,
  rent numeric(12,2) NOT NULL DEFAULT 0, water numeric(12,2) NOT NULL DEFAULT 0,
  electric numeric(12,2) NOT NULL DEFAULT 0, other numeric(12,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) GENERATED ALWAYS AS (rent+water+electric+other) STORED,
  water_previous numeric(12,2), water_current numeric(12,2),
  electric_previous numeric(12,2), electric_current numeric(12,2),
  due date NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paid')),
  UNIQUE (org_id,unit_id,period)
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id), user_id uuid NOT NULL REFERENCES users(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0), evidence_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  note text NOT NULL DEFAULT '', transfer_reference text NOT NULL DEFAULT '', sender text NOT NULL DEFAULT '',
  transferred_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_pending ON payments(invoice_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id), unit_id uuid NOT NULL REFERENCES units(id),
  subject text NOT NULL, detail text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id), property_id uuid NOT NULL REFERENCES properties(id),
  area text NOT NULL, detail text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS moveouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id), user_id uuid NOT NULL REFERENCES users(id),
  move_date date NOT NULL, reason text NOT NULL, contact text NOT NULL,
  preferred_time text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','reviewed','inspection','settlement','completed')),
  inspection_date date, inspector text NOT NULL DEFAULT '',
  water_reading numeric(12,2), electric_reading numeric(12,2),
  cleaning_fee numeric(12,2) NOT NULL DEFAULT 0, damage_fee numeric(12,2) NOT NULL DEFAULT 0,
  other_fee numeric(12,2) NOT NULL DEFAULT 0, settlement_note text NOT NULL DEFAULT '',
  refund_reference text NOT NULL DEFAULT '', acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  filename text NOT NULL, imported integer NOT NULL, skipped integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
