const axios = require('axios');
const cheerio = require('cheerio');

class CrawlerService {
    async fetchDailyMissa(date) {
        try {
            let url = 'https://missa.cbck.or.kr/DailyMissa';
            if (date) {
                const dateFormatted = date.replace(/-/g, '');
                url = `${url}/${dateFormatted}`;
            }
            const { data } = await axios.get(url);
            const $ = cheerio.load(data);

            // 1. 전체 텍스트 확보 (공백 압축)
            // HTML 태그와 상관없이 텍스트 흐름만 가져옴
            const rawBody = $('body').text().trim().replace(/\s+/g, ' ');

            let headlineRef = "";
            let oneLineMessage = "";
            let gospelText = "";

            // ---------------------------------------------------------
            // 2. Headline 추출 (Regex: 가장 강력하고 확실한 방법)
            // ---------------------------------------------------------
            // 예: "✠ 루카가 전한 거룩한 복음입니다. 10,1-9"
            // Tip: ✠ 기호가 없을 수도 있으니 "가 전한 거룩한 복음입니다" 패턴도 고려?
            // 하지만 카톨릭 사이트는 ✠를 씀. debug 결과 확인함.
            const headlineRegex = /✠\s*([가-힣]+)가\s*전한.*?(\d+[,:\-]\d+[\d,\-]*)/;
            const headMatch = rawBody.match(headlineRegex);

            if (headMatch) {
                headlineRef = `${headMatch[1]} ${headMatch[2]}`; // 예: "루카 10,1-9"
            } else {
                // 장절을 못 찾은 경우 저자라도
                const authorOnly = rawBody.match(/✠\s*([가-힣]+)가\s*전한/);
                if (authorOnly) headlineRef = `${authorOnly[1]} 복음`;
                else headlineRef = "오늘의 복음";
            }

            // ---------------------------------------------------------
            // 3. Message 추출 (DOM 탐색 + Fallback)
            // ---------------------------------------------------------
            // 부제(<...>)는 구조적으로 제목 옆에 붙어 있으므로 DOM이 더 정확할 수 있음
            $('h4').each((i, el) => {
                if ($(el).text().trim() === '복음') {
                    const span = $(el).parent().find('span');
                    if (span.length > 0) {
                        oneLineMessage = span.text().trim().replace(/^<|>$/g, '');
                        return false; // break
                    }
                }
            });

            if (!oneLineMessage) {
                // DOM 실패시 Regex: "복음 <...>" 패턴 시도
                // 공백 압축된 rawBody에서 "복음 <" 패턴 검색
                const msgMatch = rawBody.match(/복음\s*<([^>]+)>/);
                if (msgMatch) {
                    oneLineMessage = msgMatch[1].trim();
                } else {
                    oneLineMessage = "오늘의 말씀";
                }
            }

            // ---------------------------------------------------------
            // 4. Gospel Text 추출 (Keyword based)
            // ---------------------------------------------------------
            // 시작점: "복음입니다" (headline 근처) 또는 headMatch 인덱스
            // 끝점: "주님의 말씀입니다"

            let startIdx = -1;
            if (headMatch && headMatch.index) {
                // headline이 발견된 곳 이후부터 본문
                startIdx = headMatch.index + headMatch[0].length;
            } else {
                // headline 없으면 "복음" + oneLineMessage 뒤쪽 찾기
                startIdx = rawBody.indexOf(oneLineMessage) + oneLineMessage.length;
            }

            if (startIdx > -1) {
                const endKeywords = ["주님의 말씀입니다", "주님의 말씀 입니다", "영성체송"];
                let endIdx = -1;

                for (const kw of endKeywords) {
                    const idx = rawBody.indexOf(kw, startIdx);
                    if (idx !== -1 && (endIdx === -1 || idx < endIdx)) {
                        endIdx = idx;
                    }
                }

                if (endIdx !== -1) {
                    gospelText = rawBody.substring(startIdx, endIdx).trim();
                } else {
                    // 끝을 못 찾으면 대충 2000자
                    gospelText = rawBody.substring(startIdx, startIdx + 2000).trim();
                }
            }

            // 만약 그래도 비어있으면 Fallback
            if (!gospelText || gospelText.length < 10) {
                // 그냥 전체 덤프 (앞부분 자르고)
                gospelText = rawBody.substring(0, 5000);
            }


            console.log('[Crawler] Deep Analysis Result:', { headlineRef, oneLineMessage });

            return {
                date_str: new Date().toISOString().split('T')[0],
                gospel_text: gospelText,
                headline_ref: headlineRef,
                one_line_message: oneLineMessage
            };

        } catch (error) {
            console.error('[Crawler] Fatal Error:', error);
            // 죽지 말고 빈 객체 리턴
            return {
                gospel_text: "",
                headline_ref: "크롤링 오류",
                one_line_message: "잠시 후 다시 시도"
            };
        }
    }
}

module.exports = new CrawlerService();
