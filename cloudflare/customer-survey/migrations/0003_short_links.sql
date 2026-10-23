CREATE UNIQUE INDEX IF NOT EXISTS survey_hospital_short_code ON survey_hospitals(substr(code,1,32));
