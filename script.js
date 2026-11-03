// ============================================================
// 공기 신호등 프론트엔드 자바스크립트 로직
// ============================================================

// Vercel 서버리스 프록시 API 엔드포인트 URL입니다.
const API_URL = '/api/dust';

// DOM 요소 참조
const sidoSelect = document.getElementById('sidoSelect');
const trafficLightCard = document.getElementById('trafficLightCard');
const averageRegionName = document.getElementById('averageRegionName');
const latestTime = document.getElementById('latestTime');
const trafficEmoji = document.getElementById('trafficEmoji');
const trafficStatusText = document.getElementById('trafficStatusText');
const averageValue = document.getElementById('averageValue');
const trafficNotice = document.getElementById('trafficNotice');
const chartSection = document.getElementById('chartSection');
const chartRegionName = document.getElementById('chartRegionName');
const topStationsChartCanvas = document.getElementById('topStationsChart');
const stationCount = document.getElementById('stationCount');
const loadingIndicator = document.getElementById('loadingIndicator');
const statusMessage = document.getElementById('statusMessage');
const stationGrid = document.getElementById('stationGrid');

// Chart.js 인스턴스를 보관할 전역 변수
let topStationsChartInstance = null;

// 미세먼지 등급별 설정 객체 (이모지, 라벨, 클래스명, 안내 문구)
const GRADE_MAP = {
  '1': {
    label: '좋음',
    emoji: '🔵',
    className: 'grade-1',
    notice: '공기가 맑고 쾌적해요! 산책이나 야외 활동하기 좋은 날입니다.'
  },
  '2': {
    label: '보통',
    emoji: '🟢',
    className: 'grade-2',
    notice: '무난한 공기질이에요. 일상 활동에 지장 없어요.'
  },
  '3': {
    label: '나쁨',
    emoji: '🟠',
    className: 'grade-3',
    notice: '외출 시 마스크를 챙기세요'
  },
  '4': {
    label: '매우나쁨',
    emoji: '🔴',
    className: 'grade-4',
    notice: '외출 시 마스크를 챙기세요'
  }
};

/**
 * 에어코리아 측정 시각 문자열("2026-11-03 13:00")을
 * "2026년 11월 3일 13시 기준" 형태의 한국어로 변환합니다.
 */
function formatKoreanDateTime(dataTimeStr) {
  if (!dataTimeStr || dataTimeStr === '-' || !dataTimeStr.trim()) {
    return '측정 시각 미확인';
  }

  // YYYY-MM-DD HH:mm 정규식 매칭
  const match = dataTimeStr.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const year = match[1];
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);
    const minuteText = minute > 0 ? ` ${minute}분` : '';
    return `${year}년 ${month}월 ${day}일 ${hour}시${minuteText} 기준`;
  }

  return `${dataTimeStr} 기준`;
}

/**
 * 미세먼지 수치 포맷팅 헬퍼 함수
 */
function formatDustValue(value) {
  if (!value || value.trim() === '-' || isNaN(Number(value))) {
    return '측정 안 됨';
  }
  return `${value} ㎍/㎥`;
}

/**
 * 등급 코드로 등급 정보 객체 반환
 */
function getGradeInfo(grade) {
  if (grade && GRADE_MAP[grade]) {
    return GRADE_MAP[grade];
  }
  return {
    label: '정보 없음',
    emoji: '⚪',
    className: 'grade-none',
    notice: '대기 측정 정보를 확인하고 있습니다.'
  };
}

/**
 * 평균 미세먼지 수치를 기반으로 등급 번호(1~4)를 계산합니다.
 */
function getGradeFromAverage(pm10Avg) {
  if (pm10Avg === null || isNaN(pm10Avg)) {
    return null;
  }
  if (pm10Avg <= 30) return '1';       // 0 ~ 30 : 좋음
  if (pm10Avg <= 80) return '2';       // 31 ~ 80 : 보통
  if (pm10Avg <= 150) return '3';      // 81 ~ 150 : 나쁨
  return '4';                          // 151 ~ : 매우나쁨
}

/**
 * 맨 위 대표 공기 신호등 카드를 갱신합니다.
 */
function updateTrafficLightCard(avg, mostRecentTime) {
  trafficLightCard.classList.remove('grade-1', 'grade-2', 'grade-3', 'grade-4', 'grade-neutral');

  if (mostRecentTime) {
    latestTime.textContent = formatKoreanDateTime(mostRecentTime);
  } else {
    latestTime.textContent = '-';
  }

  if (avg === null || isNaN(avg)) {
    trafficLightCard.classList.add('grade-neutral');
    trafficEmoji.textContent = '⚪';
    trafficStatusText.textContent = '측정 불가';
    averageValue.textContent = '-';
    trafficNotice.textContent = '현재 유효한 대기 측정 수치가 없습니다.';
    return;
  }

  const gradeKey = getGradeFromAverage(avg);
  const gradeInfo = GRADE_MAP[gradeKey];

  trafficLightCard.classList.add(gradeInfo.className);
  trafficEmoji.textContent = gradeInfo.emoji;
  trafficStatusText.textContent = gradeInfo.label;
  averageValue.textContent = avg;
  trafficNotice.textContent = gradeInfo.notice;
}

/**
 * 상위 10개 측정소 미세먼지 수치를 가로 막대그래프로 렌더링합니다.
 * - '측정 안 됨' 제외
 * - 수치 높은 순 정렬 후 상위 10개 슬라이스
 * - 등급 색상(파랑/초록/주황/빨강)을 막대 색상에 반영
 */
function renderTopStationsChart(items, regionName) {
  if (!topStationsChartCanvas || typeof Chart === 'undefined') {
    return;
  }

  if (chartRegionName) {
    chartRegionName.textContent = regionName;
  }

  // 1. '측정 안 됨' 및 유효하지 않은 데이터 제외
  const validStations = items
    .filter((item) => {
      const raw = item.pm10Value;
      return raw && raw.trim() !== '-' && !isNaN(Number(raw)) && Number(raw) >= 0;
    })
    .map((item) => ({
      stationName: item.stationName || '알 수 없음',
      pm10: Number(item.pm10Value)
    }));

  // 유효 측정소가 없으면 차트 숨김
  if (validStations.length === 0) {
    if (chartSection) chartSection.style.display = 'none';
    if (topStationsChartInstance) {
      topStationsChartInstance.destroy();
      topStationsChartInstance = null;
    }
    return;
  }

  // 2. 수치가 높은 순으로 정렬하고 상위 10개만 선택
  validStations.sort((a, b) => b.pm10 - a.pm10);
  const top10 = validStations.slice(0, 10);

  // 차트 영역 표시
  if (chartSection) {
    chartSection.style.display = 'block';
  }

  // 3. 등급 기준에 맞춰 막대 색상 매핑
  const bgColors = [];
  const borderColors = [];

  top10.forEach((item) => {
    const v = item.pm10;
    if (v <= 30) {
      // 🔵 좋음
      bgColors.push('rgba(37, 99, 235, 0.85)');
      borderColors.push('#2563eb');
    } else if (v <= 80) {
      // 🟢 보통
      bgColors.push('rgba(22, 163, 74, 0.85)');
      borderColors.push('#16a34a');
    } else if (v <= 150) {
      // 🟠 나쁨
      bgColors.push('rgba(234, 88, 12, 0.85)');
      borderColors.push('#ea580c');
    } else {
      // 🔴 매우나쁨
      bgColors.push('rgba(220, 38, 38, 0.85)');
      borderColors.push('#dc2626');
    }
  });

  const labels = top10.map((item) => item.stationName);
  const dataValues = top10.map((item) => item.pm10);

  // 기존 차트가 있으면 안전하게 파괴하여 재사용 에러 방지
  if (topStationsChartInstance) {
    topStationsChartInstance.destroy();
  }

  // 4. 가로 막대그래프(indexAxis: 'y') 생성
  const ctx = topStationsChartCanvas.getContext('2d');
  topStationsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: '미세먼지 (PM10)',
          data: dataValues,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1.5,
          borderRadius: 8,
          barThickness: 20
        }
      ]
    },
    options: {
      indexAxis: 'y', // 가로 막대그래프 설정
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          titleFont: { family: 'Pretendard', size: 13, weight: '700' },
          bodyFont: { family: 'Pretendard', size: 12, weight: '600' },
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function (context) {
              const val = context.raw;
              let gradeText = '좋음 🔵';
              if (val > 150) gradeText = '매우나쁨 🔴';
              else if (val > 80) gradeText = '나쁨 🟠';
              else if (val > 30) gradeText = '보통 🟢';
              return ` 미세먼지(PM10): ${val} ㎍/㎥ (${gradeText})`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: {
            color: 'rgba(226, 232, 240, 0.7)'
          },
          ticks: {
            font: { family: 'Pretendard', size: 11, weight: '600' },
            color: '#64748b',
            callback: function (val) {
              return val + ' ㎍/㎥';
            }
          }
        },
        y: {
          grid: {
            display: false
          },
          ticks: {
            font: { family: 'Pretendard', size: 12, weight: '700' },
            color: '#1e293b'
          }
        }
      },
      animation: {
        duration: 700,
        easing: 'easeOutQuart'
      }
    }
  });
}

/**
 * 측정소별 개별 카드 HTML 요소를 생성합니다.
 * (등급 색을 테두리와 배경에 은은하게 반영)
 */
function createStationCard(item) {
  const stationName = item.stationName || '알 수 없음';
  const pm10Display = formatDustValue(item.pm10Value);
  const pm25Display = formatDustValue(item.pm25Value);
  const koreanTime = formatKoreanDateTime(item.dataTime);
  const gradeInfo = getGradeInfo(item.pm10Grade);

  const card = document.createElement('div');
  card.className = `station-card ${gradeInfo.className}`;

  card.innerHTML = `
    <!-- 카드 상단: 측정소 이름 및 등급 뱃지 -->
    <div class="card-header">
      <span class="station-name">${stationName}</span>
      <span class="grade-badge">${gradeInfo.emoji} ${gradeInfo.label}</span>
    </div>
    <!-- 카드 본문: 미세먼지 및 초미세먼지 수치 -->
    <div class="card-body">
      <div class="info-row">
        <span class="info-label">미세먼지 (PM10)</span>
        <span class="info-value">${pm10Display}</span>
      </div>
      <div class="info-row">
        <span class="info-label">초미세먼지 (PM2.5)</span>
        <span class="info-value">${pm25Display}</span>
      </div>
    </div>
    <!-- 카드 하단: 한국어 측정 시각 표시 -->
    <div class="card-footer">
      <span>${koreanTime}</span>
    </div>
  `;

  return card;
}

/**
 * 선택된 시도의 실시간 대기오염 정보를 서버리스 API로 조회하는 비동기 함수
 */
async function fetchAirQuality(sidoName) {
  averageRegionName.textContent = sidoName;

  // 로딩 상태 시작: '불러오는 중...' 표시 및 기존 차트 숨김
  loadingIndicator.style.display = 'flex';
  statusMessage.style.display = 'none';
  stationGrid.innerHTML = '';
  stationCount.textContent = '불러오는 중...';

  if (chartSection) {
    chartSection.style.display = 'none';
  }
  if (topStationsChartInstance) {
    topStationsChartInstance.destroy();
    topStationsChartInstance = null;
  }

  // 신호등 카드 로딩 상태로 초기화
  trafficLightCard.classList.remove('grade-1', 'grade-2', 'grade-3', 'grade-4');
  trafficLightCard.classList.add('grade-neutral');
  trafficEmoji.textContent = '⚪';
  trafficStatusText.textContent = '불러오는 중...';
  averageValue.textContent = '-';
  latestTime.textContent = '불러오는 중...';
  trafficNotice.textContent = `${sidoName} 지역의 실시간 공기 상태를 불러오는 중입니다...`;

  try {
    const response = await fetch(`${API_URL}?sido=${encodeURIComponent(sidoName)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `서버 에러가 발생했습니다. (상태 코드: ${response.status})`);
    }

    const items = data?.response?.body?.items;

    if (!items || items.length === 0) {
      loadingIndicator.style.display = 'none';
      statusMessage.style.display = 'block';
      statusMessage.textContent = `${sidoName} 지역의 측정소 데이터가 없습니다.`;
      stationCount.textContent = '측정소 0곳';
      updateTrafficLightCard(null, null);
      return;
    }

    // 유효 수치 합계 계산 및 최신 측정시각 탐색
    let validSum = 0;
    let validCount = 0;
    let mostRecentTime = null;

    items.forEach((item) => {
      const rawVal = item.pm10Value;
      if (rawVal && rawVal.trim() !== '-' && !isNaN(Number(rawVal))) {
        validSum += Number(rawVal);
        validCount += 1;
      }
      if (!mostRecentTime && item.dataTime) {
        mostRecentTime = item.dataTime;
      }
    });

    const average = validCount > 0 ? Math.round(validSum / validCount) : null;

    // 1. 대표 공기 신호등 카드 갱신
    updateTrafficLightCard(average, mostRecentTime);

    // 2. 상위 10개 측정소 가로 막대그래프 렌더링 (Chart.js)
    renderTopStationsChart(items, sidoName);

    // 3. 로딩 상태 종료 및 측정소 카드 렌더링
    loadingIndicator.style.display = 'none';
    stationCount.textContent = `총 ${items.length}개 측정소`;

    items.forEach((item) => {
      const card = createStationCard(item);
      stationGrid.appendChild(card);
    });
  } catch (error) {
    console.error('대기오염 데이터 조회 오류:', error);
    loadingIndicator.style.display = 'none';
    statusMessage.style.display = 'block';
    statusMessage.textContent = error.message || '데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    stationCount.textContent = '조회 실패';
    updateTrafficLightCard(null, null);
  }
}

// 시도 변경 이벤트 리스너
sidoSelect.addEventListener('change', (e) => {
  fetchAirQuality(e.target.value);
});

// 페이지 준비 완료 시 초기 로드 (서울)
document.addEventListener('DOMContentLoaded', () => {
  fetchAirQuality(sidoSelect.value);
});
