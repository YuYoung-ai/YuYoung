// Synthetic names only. Production directory data is imported separately.
export const names=['기존 병원','테스트 병원','현장 병원','미응답 병원','두 번째 병원','영업팀 병원'].sort();
export function seedDirectory(DB){const insert=DB.raw.prepare('INSERT INTO survey_directory VALUES(?,?)');for(const name of names)insert.run(name,Date.now());}
