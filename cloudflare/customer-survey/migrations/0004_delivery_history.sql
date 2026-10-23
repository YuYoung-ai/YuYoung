CREATE TABLE IF NOT EXISTS survey_delivery_events(
 id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES survey_campaigns(id),
 hospital_id TEXT NOT NULL REFERENCES survey_hospitals(id),
 channel TEXT NOT NULL CHECK(channel IN ('sms','onsite','other')),
 delivered_at INTEGER NOT NULL,created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS survey_delivery_history ON survey_delivery_events(campaign_id,hospital_id,delivered_at DESC,id);
INSERT INTO survey_delivery_events(id,campaign_id,hospital_id,channel,delivered_at,created_by)
 SELECT 'initial:'||d.campaign_id||':'||d.hospital_id,d.campaign_id,d.hospital_id,d.channel,d.delivered_at,d.created_by
 FROM survey_deliveries d WHERE NOT EXISTS(
 SELECT 1 FROM survey_delivery_events e WHERE e.campaign_id=d.campaign_id AND e.hospital_id=d.hospital_id);
