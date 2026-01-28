const fs = require('fs').promises;
const path = require('path');
const crawlerService = require('./crawlerService');
const aiService = require('./aiService');

// 데이터 저장 경로: /home/ucon/bona/data/
const DATA_DIR = path.join(__dirname, '../../data');

class DraftService {

    // 1. 매일미사 크롤링 + AI 초안 생성
    async createDailyDraft(inputDate) {
        const offset = 1000 * 60 * 60 * 9; // KST
        const today = inputDate || new Date(Date.now() + offset).toISOString().split('T')[0];

        console.log(`[Draft] Creating new draft for ${today}...`);

        let draft = {
            date: today,
            status: 'draft',
            content: {
                headline_ref: "",
                one_line_message: "",
                meditation_body: "묵상 글을 불러오는 중입니다...",
                image_prompt_scenery: ""
            },
            raw_text_summary: ""
        };

        let gospelText = "";
        try {
            // A. 크롤링 수행
            const missaData = await crawlerService.fetchDailyMissa(today);
            if (missaData) {
                if (missaData.headline_ref) draft.content.headline_ref = missaData.headline_ref;
                if (missaData.one_line_message) draft.content.one_line_message = missaData.one_line_message;
                gospelText = missaData.gospel_text || "";
                draft.raw_text_summary = gospelText.substring(0, 100);
            }
        } catch (e) {
            console.error('[Draft] Crawler Error:', e.message);
            draft.content.headline_ref = "데이터 로딩 실패";
        }

        try {
            // B. AI 생성 수행
            if (gospelText.length > 10) {
                // 1. Text Generation
                const aiRes = await aiService.generateDraft(gospelText);
                if (aiRes) {
                    draft.content.meditation_body = aiRes.meditation_body || "";
                    draft.content.prayer_line = aiRes.prayer_line || "";
                    draft.content.image_prompt_scenery = aiRes.image_prompt_scenery || "";

                    // 2. Image Generation (Parallel or Sequential)
                    if (draft.content.image_prompt_scenery) {
                        try {
                            const imgUrl = await aiService.generateImage(draft.content.image_prompt_scenery);
                            if (imgUrl) {
                                draft.content.generated_image_url = imgUrl; // Save URL
                            }
                        } catch (imgErr) {
                            console.error('[Draft] Image Gen Failed:', imgErr);
                        }
                    }
                }
            } else {
                draft.content.meditation_body = "복음 내용을 찾을 수 없어 묵상을 작성하지 못했습니다.";
            }
        } catch (e) {
            console.error('[Draft] AI Generation Error:', e.message);
            draft.content.meditation_body = `AI 묵상 생성 실패 (${e.message})`;
        }

        // C. 결과 저장 (중간 저장)
        await this.saveDraft(today, draft);
        return draft;
    }

    async saveDraft(date, data) {
        try {
            await fs.mkdir(DATA_DIR, { recursive: true });
            const filePath = path.join(DATA_DIR, `draft_${date}.json`);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2)); // 보기 좋게 저장
        } catch (error) {
            console.error('[Draft] Save Error:', error);
        }
    }

    async getDraft(date) {
        try {
            const filePath = path.join(DATA_DIR, `draft_${date}.json`);
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            return null; // 파일 없으면 null 리턴
        }
    }
}

module.exports = new DraftService();
