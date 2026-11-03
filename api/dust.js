/**
 * Vercel 서버리스 함수: 에어코리아 시도별 실시간 대기오염 측정정보 프록시 API
 * 엔드포인트: /api/dust?sido=시도명
 */
export default async function handler(req, res) {
  // CORS 및 응답 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // GET 요청만 허용
  if (req.method !== 'GET') {
    return res.status(405).json({
      message: '허용되지 않는 HTTP 메소드입니다. GET 요청만 가능합니다.'
    });
  }

  // 환경변수에서 에어코리아 API 인증키 읽기 (코드 내 하드코딩 금지)
  const apiKey = process.env.AIRKOREA_KEY;
  if (!apiKey) {
    return res.status(500).json({
      message: '서버 환경변수(AIRKOREA_KEY)가 설정되지 않았습니다. .env.local 파일 또는 Vercel 프로젝트 환경변수를 확인해주세요.'
    });
  }

  // 주소 쿼리로 sido(시도 이름)를 받으며, 없으면 기본값은 '서울'
  let sido = (req.query?.sido || '서울').trim();
  try {
    sido = decodeURIComponent(sido);
  } catch {
    // 디코딩 에러 시 원본 유지
  }

  try {
    // 환경변수에 인코딩 키가 들어오든 디코딩 키가 들어오든 이중 인코딩 없이 안전하게 처리
    let encodedKey = apiKey;
    try {
      encodedKey = encodeURIComponent(decodeURIComponent(apiKey));
    } catch {
      encodedKey = encodeURIComponent(apiKey);
    }
    const encodedSido = encodeURIComponent(sido);

    // 에어코리아 API 호출 URL 생성
    const targetUrl = `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?serviceKey=${encodedKey}&returnType=json&numOfRows=100&pageNo=1&sidoName=${encodedSido}&ver=1.3`;

    // 공공데이터포털 API 호출
    const apiResponse = await fetch(targetUrl);
    const rawText = await apiResponse.text();

    // 응답이 JSON이 아니라 XML 에러(예: 인증키 불일치 등)로 올 경우 대비
    if (rawText.trim().startsWith('<')) {
      return res.status(400).json({
        message: '인증키 또는 요청값을 확인해주세요.',
        errorDetail: rawText
      });
    }

    // JSON 파싱 시도
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseError) {
      return res.status(400).json({
        message: '인증키 또는 요청값을 확인해주세요.',
        errorDetail: rawText
      });
    }

    // 응답 본문 안의 resultCode 검사 ('00'이 성공)
    const header = data?.response?.header;
    const resultCode = header?.resultCode;
    const resultMsg = header?.resultMsg;

    if (!header || resultCode !== '00') {
      let koreanMsg = '공공데이터 API 요청에 실패했습니다.';

      if (resultCode === '01') koreanMsg = '어플리케이션 오류가 발생했습니다.';
      else if (resultCode === '02') koreanMsg = '데이터베이스 오류가 발생했습니다.';
      else if (resultCode === '03') koreanMsg = '조회된 데이터가 없습니다.';
      else if (resultCode === '10' || resultCode === '11') koreanMsg = '요청 파라미터가 올바르지 않습니다.';
      else if (resultCode === '20' || resultCode === '30' || resultCode === '31') koreanMsg = '인증키가 유효하지 않거나 등록되지 않았습니다.';
      else if (resultCode === '22') koreanMsg = '일일 API 호출 한도를 초과했습니다.';
      else if (resultMsg) koreanMsg = `API 오류 발생 (${resultMsg})`;

      return res.status(400).json({
        message: `[API 오류] ${koreanMsg} (코드: ${resultCode || '알 수 없음'})`,
        resultCode,
        resultMsg,
        data
      });
    }

    // 정상 응답일 경우 데이터 반환
    return res.status(200).json(data);
  } catch (error) {
    // 네트워크 연결 실패 등 서버 내부 오류 처리
    return res.status(500).json({
      message: '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      error: error.message
    });
  }
}

