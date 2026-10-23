CREATE TABLE IF NOT EXISTS survey_hospitals(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,code TEXT NOT NULL UNIQUE,
 active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS survey_campaigns(
 id TEXT PRIMARY KEY,title TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','open','closed')),
 starts_at INTEGER,ends_at INTEGER,definition TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS survey_one_open ON survey_campaigns(state) WHERE state='open';
CREATE TABLE IF NOT EXISTS survey_deliveries(
 campaign_id TEXT NOT NULL REFERENCES survey_campaigns(id),hospital_id TEXT NOT NULL REFERENCES survey_hospitals(id),
 channel TEXT NOT NULL CHECK(channel IN ('sms','onsite','other')),delivered_at INTEGER NOT NULL,created_by TEXT NOT NULL,
 PRIMARY KEY(campaign_id,hospital_id)
);
CREATE TABLE IF NOT EXISTS survey_responses(
 id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES survey_campaigns(id),hospital_id TEXT NOT NULL REFERENCES survey_hospitals(id),
 submission_id TEXT NOT NULL,answer_hash TEXT NOT NULL,answers TEXT NOT NULL,submitted_at INTEGER NOT NULL,
 UNIQUE(campaign_id,hospital_id)
);
CREATE INDEX IF NOT EXISTS survey_response_dates ON survey_responses(campaign_id,submitted_at);
CREATE TABLE IF NOT EXISTS survey_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at INTEGER NOT NULL);
