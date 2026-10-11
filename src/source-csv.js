// 데이터 원본 1: 사이트에 같이 올려둔 CSV 파일 읽기 (3단계에서 구글 시트 원본을 추가할 예정)
// 어떤 원본이든 { drugRows, doseRows } 모양으로만 돌려주면 나머지 코드는 그대로 동작한다.
import { parseCsv } from './data.js';

export async function loadCsvFiles(baseUrl = 'data') {
  const [drugsRes, dosesRes] = await Promise.all([
    fetch(`${baseUrl}/drugs.csv`, { cache: 'no-cache' }),
    fetch(`${baseUrl}/doses.csv`, { cache: 'no-cache' }),
  ]);
  if (!drugsRes.ok || !dosesRes.ok) throw new Error('데이터 파일을 불러오지 못했습니다.');
  return {
    drugRows: parseCsv(await drugsRes.text()),
    doseRows: parseCsv(await dosesRes.text()),
  };
}
