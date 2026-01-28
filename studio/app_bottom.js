
    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath));
            res.json({ success: true, data });
        } catch (e) {
            res.status(500).json({ success: false, error: 'File Read Error' });
        }
    } else {
        res.status(404).json({ success: false, error: 'Post not found', date });
    }
});

// API: Fetch Daily Gospel from 매일미사
app.get('/studio/api/gospel/:date?', async (req, res) => {
    try {
        let { date } = req.params;

        // 날짜가 없으면 오늘 날짜 사용
        if (!date || date === 'today') {
            const offset = 1000 * 60 * 60 * 9; // KST
            date = new Date(Date.now() + offset).toISOString().split('T')[0];
        }

        // 매일미사 URL (주교회의) - 날짜별 형식: YYYYMMDD
        const dateFormatted = date.replace(/-/g, ''); // 2026-01-28 -> 20260128
        const url = `https://missa.cbck.or.kr/DailyMissa/${dateFormatted}`;

        console.log(`[Gospel API] Fetching from: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(response.data);

        let gospelData = {
            date: date,
            reference: '',
            title: '',
            text: ''
        };

        // h4 태그에서 "복음" 찾기
        let gospelFound = false;
        $('h4').each((i, elem) => {
            const headerText = $(elem).text().trim();

            if (headerText === '복음') {
                console.log('[Gospel API] Found 복음 h4');
                gospelFound = true;

                // 1. 오늘의 말씀 추출: <> 안의 텍스트
                const nextSpan = $(elem).next('span');
                if (nextSpan.length > 0) {
                    const titleText = nextSpan.text().trim();
                    // <> 제거
                    gospelData.title = titleText.replace(/^<|>$/g, '').trim();
                    console.log(`[Gospel API] 오늘의 말씀: ${gospelData.title}`);
                }

                // 2. 성서명과 구절번호 추출
                const parent = $(elem).parent();
                const grandParent = parent.parent();

                let bookName = '';
                let refNumber = '';

                // 전체 문서에서 h5.float-right span 찾기 (복음 섹션 근처)
                console.log(`[Gospel API] Searching for h5.float-right...`);
                $('h5.float-right').each((idx, h5) => {
                    const spanText = $(h5).find('span').text().trim();
                    console.log(`[Gospel API] Found h5.float-right with span: "${spanText}"`);
                    if (spanText.match(/\d+,[\d,-]+/) && !refNumber) {
                        refNumber = spanText;
                        console.log(`[Gospel API] 구절번호: ${refNumber}`);
                    }
                });

                // 성서명 찾기 - 전체 문서에서 검색
                $('div').each((j, div) => {
                    const text = $(div).text().trim();
                    if (text.includes('전한 거룩한 복음입니다') && !bookName) {
                        // "ㅇㅇㅇ가 전한 거룩한 복음입니다" 또는 "ㅇㅇㅇ에서" 패턴
                        // "✠ " 다음부터 "가 전한" 또는 "에서" 앞까지를 성서명으로 추출
                        const match = text.match(/✠\s*([가-힣\s]+?)(?:가\s*전한|에서)/);
                        if (match) {
                            bookName = match[1].trim();
                            console.log(`[Gospel API] 성서명: ${bookName}`);
                        }
                    }
                });

                // headline_ref 조합
                if (bookName && refNumber) {
                    gospelData.reference = `${bookName} ${refNumber}`;
                } else if (refNumber) {
                    gospelData.reference = refNumber;
                }

                console.log(`[Gospel API] headline_ref: ${gospelData.reference}`);



                // 3. 복음 본문 추출: "전한 거룩한 복음입니다" 다음부터 "주님의 말씀입니다" 전까지
                console.log(`[Gospel API] 복음 본문 추출 시작...`);
                let textParts = [];
                let collecting = false;

                $('div').each((j, div) => {
                    const text = $(div).text().trim();

                    // "전한 거룩한 복음입니다"를 찾으면 수집 시작
                    if (text.includes('전한 거룩한 복음입니다')) {
                        collecting = true;
                        console.log(`[Gospel API] 복음 본문 수집 시작`);
                        return; // 이 줄은 건너뛰고 다음부터 수집
                    }

                    if (collecting) {
                        // "주님의 말씀입니다"가 나오면 종료
                        if (text.includes('주님의 말씀입니다')) {
                            console.log(`[Gospel API] 복음 본문 수집 종료`);
                            return false; // break
                        }

                        // 의미있는 텍스트만 추가 (빈 문자열이나 너무 긴 텍스트 제외)
                        if (text.length > 0 && text.length < 1000) {
                            textParts.push(text);
                        }
                    }
                });

                gospelData.text = textParts.join('\n').trim();
                console.log(`[Gospel API] 복음 본문: ${textParts.length}개 절`);

                return false; // break
            }
        });


        if (!gospelFound || !gospelData.reference) {
            console.log('[Gospel API] Gospel not found, dumping structure...');
            $('h4').each((i, elem) => {
                console.log(`H4 ${i}: ${$(elem).text().trim()}`);
            });

            return res.status(404).json({
                success: false,
                error: 'Gospel not found',
                date: date
            });
        }

        console.log(`[Gospel API] Successfully fetched: ${gospelData.reference}`);
        res.json({ success: true, data: gospelData });

    } catch (error) {
        console.error('[Gospel API Error]', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch gospel data',
            details: error.message
        });
    }
});

// API: Subscribe (구독 신청)
app.post('/studio/api/subscribe', (req, res) => {
    const subscription = req.body;
    let subs = [];

    try {
        if (fs.existsSync(SUBS_FILE)) {
            subs = JSON.parse(fs.readFileSync(SUBS_FILE));
        }
        // 중복 체크 (endpoint 기준)
        if (!subs.find(s => s.endpoint === subscription.endpoint)) {
            subs.push(subscription);
            fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
            console.log(`[Subscribe] New subscriber added. Total: ${subs.length}`);
        }
        res.status(201).json({ success: true });
    } catch (e) {
        console.error('[Subscribe Error]', e);
        res.status(500).json({ error: e.message });
    }
});

const ADMIN_SUB_FILE = path.join(DATA_DIR, 'admin_sub.json');

// API: Register Admin Device (관리자 테스트 기기 등록)
app.post('/studio/api/register-admin', (req, res) => {
    const subscription = req.body;
    console.log('[Admin] Registration request received:', !!subscription);
    try {
        fs.writeFileSync(ADMIN_SUB_FILE, JSON.stringify(subscription, null, 2));
        console.log('[Admin] Admin device registered at:', ADMIN_SUB_FILE);
        res.json({ success: true });
    } catch (e) {
        console.error('[Admin Error]', e);
        res.status(500).json({ error: e.message });
    }
});

// API: Publish (저장 및 배포)
app.post('/studio/api/publish', async (req, res) => {
    const data = req.body;
    const isTest = req.query.test === 'true';
    const date = data.date;
    const filePath = path.join(DATA_DIR, `draft_${date}.json`);

    console.log(`[Publish] Processing (Test=${isTest}) for ${date}...`);

    try {
        // 1. 이미지 로컬 저장 (영구 저장)
        if (data.generated_image_url && data.generated_image_url.startsWith('http')) {
            console.log(`[Publish] Downloading image for permanent storage...`);
            const localUrl = await downloadImage(data.generated_image_url, date);
            data.generated_image_url = localUrl;
        }

        // 2. 파일 저장
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        let subs = [];
        let targetName = 'All Subscribers';

        if (isTest) {
            if (fs.existsSync(ADMIN_SUB_FILE)) {
                subs = [JSON.parse(fs.readFileSync(ADMIN_SUB_FILE))];
                targetName = 'Admin Device';
            } else {
                return res.json({ success: false, error: '관리자 기기가 등록되지 않았습니다.' });
            }
        } else {
            if (fs.existsSync(SUBS_FILE)) {
                subs = JSON.parse(fs.readFileSync(SUBS_FILE));
            }
        }

        const notificationPayload = JSON.stringify({
            title: isTest ? '[TEST] Good Morning Bona' : 'Good Morning Bona',
            body: data.one_line_message || '오늘의 묵상이 도착했습니다.',
            icon: '/bona/assets/icon-192.png',
            url: `https://uconai.ddns.net/bona/?date=${date}` // 해당 날짜로 바로 이동
        });

        console.log(`[Push] Sending to ${targetName} (${subs.length})...`);

        const sendPromises = subs.map(sub =>
            webpush.sendNotification(sub, notificationPayload).catch(err => {
                console.error(`[Push Fail] ${err.statusCode}`);
            })
        );

        await Promise.all(sendPromises);
        res.json({ success: true, subscriberCount: subs.length, isTest });

    } catch (e) {
        console.error('[Publish Error]', e);
        res.status(500).json({ success: false, error: e.message });
    }
});


app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Bona Studio] Running on http://0.0.0.0:${PORT}/studio`);
});
