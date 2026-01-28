const OpenAI = require('openai');
require('dotenv').config();

class AiService {
    constructor() {
        // 유저가 "dskr에 등록되어 있어"라고 했으므로
        // 환경변수 DEEPSEEK_API_KEY를 찾되, 없으면 기본값(혹은 다른 변수)을 시도
        const apiKey = process.env.DEEPSEEK_API_KEY || process.env.DSKR_API_KEY;

        if (apiKey) {
            this.openai = new OpenAI({
                baseURL: 'https://api.deepseek.com',
                apiKey: apiKey
            });
        } else {
            console.warn('[AI] DEEPSEEK_API_KEY is missing in .env');
        }
    }

    async generateDraft(missaText) {
        if (!this.openai) {
            return {
                meditation_body: "DeepSeek API 키가 설정되지 않았습니다. (.env 확인 필요)",
                image_prompt_scenery: ""
            };
        }

        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            attempts++;
            console.log(`[AI] Generation attempt ${attempts}/${maxAttempts}...`);

            try {
                const prompt = `
                다음 가톨릭 복음 말씀을 읽고 묵상 자료를 작성하라.
                
                [입력 텍스트]
                ${missaText}

                [지시사항]
                1. meditation_body: 복음 내용을 묵상하여 '정확히 6행의 시(Poem)'로 작성하라.
                   - **반드시** \n으로 구분된 행이 정확히 6개여야 함.
                   - 빈 줄을 포함하지 말고, 의미 있는 텍스트가 담긴 6개의 행을 작성하라.
                   - 각 행은 간결하고 시적이어야 함.
                   - 예시:
                     "첫 번째 행입니다\n두 번째 행입니다\n세 번째 행입니다\n네 번째 행입니다\n다섯 번째 행입니다\n여섯 번째 행입니다"
                
                2. prayer_line: 복음의 핵심 메시지를 담은 '한 문장의 짧은 기도'를 작성하라.
                   - **공백 포함 총 40자 이내**로 작성 (절대 엄수).
                   - 간결하고 명료한 한 문장으로 작성.
                
                3. image_prompt_scenery: 이 복음의 분위기를 잘 나타내는 성화 스타일의 영어 프롬프트.

                [제약조건]
                - meditation_body: Exactly 6 lines.
                - prayer_line: Under 40 characters (including spaces).

                [응답 포맷]
                JSON 형식으로만 출력:
                {
                    "meditation_body": "...",
                    "prayer_line": "...",
                    "image_prompt_scenery": "..."
                }
                `;

                const completion = await this.openai.chat.completions.create({
                    messages: [
                        { role: "system", content: "You are a Catholic meditation poet. You create JSON content with exactly 6 lines of meditation and a prayer under 40 characters. No markdown backticks, just raw JSON." },
                        { role: "user", content: prompt }
                    ],
                    model: "deepseek-chat",
                    temperature: 0.7
                });

                let content = completion.choices[0].message.content;
                content = content.replace(/```json/g, '').replace(/```/g, '').trim();

                const result = JSON.parse(content);

                // --- Validation ---
                let isValid = true;
                let errorMsg = "";

                // 1. Meditation Lines Validation
                const lines = result.meditation_body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length !== 6) {
                    isValid = false;
                    errorMsg += `Lines expected 6, got ${lines.length}. `;
                } else {
                    // Normalize to exactly 6 lines joined by \n
                    result.meditation_body = lines.join('\n');
                }

                // 2. Prayer Length Validation
                if (result.prayer_line && result.prayer_line.length > 40) {
                    isValid = false;
                    errorMsg += `Prayer length expected <= 40, got ${result.prayer_line.length}. `;
                }

                if (isValid) {
                    console.log(`[AI] Generation successful on attempt ${attempts}`);
                    return result;
                } else {
                    console.warn(`[AI] Validation failed on attempt ${attempts}: ${errorMsg}`);
                    if (attempts === maxAttempts) {
                        // Last attempt failed, try to fix manually or throw
                        console.log(`[AI] Attempting final fix for attempt ${attempts}`);
                        if (lines.length > 6) result.meditation_body = lines.slice(0, 6).join('\n');
                        if (result.prayer_line && result.prayer_line.length > 40) {
                            result.prayer_line = result.prayer_line.substring(0, 37) + "...";
                        }
                        return result;
                    }
                }

            } catch (error) {
                console.error(`[AI] Attempt ${attempts} failed:`, error.message);
                if (attempts === maxAttempts) throw error;
            }
        }
    }

    // DALL-E 3 Image Generation (Placeholder / Implementation)
    // IMAGE GENERATION (Pollinations AI - No Key Required)
    async generateImage(imagePrompt) {
        console.log('[AI] Generating image with Pollinations:', imagePrompt);
        try {
            // Encode prompt for URL
            const safePrompt = encodeURIComponent(imagePrompt + ", detailed, masterpiece, religious art, golden light, oil painting style");
            // Pollinations.ai URL format: https://image.pollinations.ai/prompt/{prompt}
            const imageUrl = `https://image.pollinations.ai/prompt/${safePrompt}?width=1024&height=576&model=flux&nologo=true`;

            // Validate availability (Optional, but good practice)
            // Pollinations returns the image directly, so the URL itself is the source
            return imageUrl;

        } catch (error) {
            console.error('[AI] Image Generation failed:', error);
            // Fallback
            return `https://source.unsplash.com/random/1024x576/?religious,art`;
        }
    }
}

module.exports = new AiService();
