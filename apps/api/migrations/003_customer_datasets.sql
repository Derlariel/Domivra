CREATE TABLE IF NOT EXISTS customer_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  filename text NOT NULL,
  headers jsonb NOT NULL,
  row_count integer NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '365 days'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE customer_datasets ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE customer_datasets SET expires_at=created_at+interval '365 days' WHERE expires_at IS NULL;
ALTER TABLE customer_datasets ALTER COLUMN expires_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS customer_datasets_org_time ON customer_datasets(org_id,created_at DESC);
CREATE INDEX IF NOT EXISTS customer_datasets_expiry ON customer_datasets(expires_at);

CREATE TABLE IF NOT EXISTS customer_dataset_rows (
  dataset_id uuid NOT NULL REFERENCES customer_datasets(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  ciphertext text NOT NULL,
  PRIMARY KEY(dataset_id,row_number)
);
