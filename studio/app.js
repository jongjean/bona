const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const axios = require('axios');
const cheerio = require('cheerio');
const webpush = require('web-push');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3042;

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// [Fixed] Image Logic Priority: Serve static files FIRST
// 정적 파일(/studio)을 가장 먼저 처리해야 외부(카톡)에서 이미지 접근 가능
app.use('/studio', express.static(path.join(__dirname, 'public'), { index: false }));

// Other Middleware
app.use(express.static('/var/www/bona', { index: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const downloadImage = async (url, date) => {
    if (!url || url.startsWith('/') || !url.startsWith('http')) return url;
    console.log(`[Image] Downloading: ${url}`);

    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 20000 // 20초 타임아웃
        });

        const filename = `card_${date}.jpg`;
        const dir = path.join(__dirname, 'public/uploads/cards');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const localPath = path.join(dir, filename);

        // 버퍼를 파일로 한 번에 쓰기 (Reliable)
        fs.writeFileSync(localPath, response.data);
        console.log(`[Image] Saved successfully: ${filename}`);

        return `/studio/uploads/cards/${filename}`;

    } catch (e) {
        console.error('[Image Download Error]', e.message);
        // 실패 시 원본 URL 반환 (깨진 파일 생성 방지)
        return url;
    }
};

app.use((req, res, next) => {
    // Caddy handles redirects now
    next();
});

// 정적 파일: Legacy Studio Access를 위해 복구
app.use('/studio', express.static(path.join(__dirname, 'public'), { index: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes: /studio 루트
app.get('/studio', (req, res) => {
    const offset = 1000 * 60 * 60 * 9; // KST
    const today = new Date(Date.now() + offset).toISOString().split('T')[0];

    // 1. 저장된 파일 목록 및 데이터 스캔
    let publishedCards = {};
    try {
        if (fs.existsSync(DATA_DIR)) {
            const files = fs.readdirSync(DATA_DIR);
            files.filter(f => f.startsWith('draft_') && f.endsWith('.json')).forEach(f => {
                const dateStr = f.replace('draft_', '').replace('.json', '');
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f)));

                    // Check for local image first
                    const localImgName = `card_${dateStr}.jpg`;
                    const localImgPath = path.join(__dirname, 'public/uploads/cards', localImgName);

                    let imageUrl = '';
                    if (fs.existsSync(localImgPath)) {
                        imageUrl = `/studio/uploads/cards/${localImgName}`;
                    } else {
                        imageUrl = (content.content && content.content.generated_image_url)
                            || content.generated_image_url
                            || '';
                    }
                    publishedCards[dateStr] = {
                        isPublished: true,
                        imageUrl: imageUrl
                    };
                } catch (e) { }
            });
        }
    } catch (e) { console.error(e); }

    const queryYear = parseInt(req.query.year) || parseInt(today.split('-')[0]);
    const queryMonth = parseInt(req.query.month) || parseInt(today.split('-')[1]);

    const year = queryYear;
    const month = queryMonth;
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0).getDate();
    const startDayOfWeek = firstDay.getDay();

    let prevYear = year;
    let prevMonth = month - 1;
    if (prevMonth === 0) {
        prevMonth = 12;
        prevYear = year - 1;
    }

    let nextYear = year;
    let nextMonth = month + 1;
    if (nextMonth === 13) {
        nextMonth = 1;
        nextYear = year + 1;
    }

    const calendarDays = [];
    for (let i = 0; i < startDayOfWeek; i++) {
        calendarDays.push({ isEmpty: true });
    }

    for (let day = 1; day <= lastDay; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayOfWeek = new Date(year, month - 1, day).getDay();

        calendarDays.push({
            isEmpty: false,
            day: day,
            dateStr: dateStr,
            isToday: dateStr === today,
            dayOfWeek: dayOfWeek,
            isSunday: dayOfWeek === 0,
            isSaturday: dayOfWeek === 6,
            card: publishedCards[dateStr] || null
        });
    }

    res.render('dashboard', {
        title: 'Bona Studio',
        today: today,
        calendarDays: calendarDays,
        currentYear: year,
        currentMonth: month,
        prevYear: prevYear,
        prevMonth: prevMonth,
        nextYear: nextYear,
        nextMonth: nextMonth,
        publishedDates: Object.keys(publishedCards)
    });
});

// Routes: Editor
app.get('/studio/editor/:date', (req, res) => {
    const { date } = req.params;
    let savedData = {};

    // 저장된 파일이 있는지 확인
    const filePath = path.join(DATA_DIR, `draft_${date}.json`);
    if (fs.existsSync(filePath)) {
        try {
            savedData = JSON.parse(fs.readFileSync(filePath));
        } catch (e) { console.error('Load Error:', e); }
    }

    // [New] Check for Local Image Priority
    const localImgName = `card_${date}.jpg`;
    const localImgPath = path.join(__dirname, 'public/uploads/cards', localImgName);
    if (fs.existsSync(localImgPath)) {
        if (savedData.content) savedData.content.generated_image_url = `/studio/uploads/cards/${localImgName}`;
        else savedData.generated_image_url = `/studio/uploads/cards/${localImgName}`;
    }

    res.render('editor', {
        date,
        data: savedData // 저장된 데이터를 View로 전달
    });
});

// Services
const draftService = require('./services/draftService');

// API Routes
app.post('/studio/api/draft', async (req, res) => {
    // (기존 코드 유지) ...
    console.log('[API] Draft Request Received');
    try {
        const { date } = req.body;
        const draft = await draftService.createDailyDraft(date);
        res.json({ success: true, data: draft });
    } catch (e) {
        console.error('[API Error]', e);
        res.status(500).json({ success: false, error: e.message });
    }
});


// Routes: Reader Page (Root) -> Caddy strips /bona -> arrives here as /
app.get('/', async (req, res) => {
    try {
        const offset = 1000 * 60 * 60 * 9; // KST
        let targetDate = req.query.date;
        const customPrayer = req.query.prayer;

        // 날짜 없으면 오늘
        if (!targetDate) {
            targetDate = new Date(Date.now() + offset).toISOString().split('T')[0];
        }

        const filePath = path.join(DATA_DIR, `draft_${targetDate}.json`);
        let staticData = null;
        let metaData = {
            title: 'Good Morning Bona',
            description: '(가톨릭) 매일아침 매일미사 복음묵상',
            image: 'https://uconai.ddns.net/bona/logo.png', // 기본 로고
            url: `https://uconai.ddns.net/bona/?date=${targetDate}`
        };

        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const draft = JSON.parse(raw);
            const content = draft.content || draft; // 구조 호환

            if (content.one_line_message) {
                staticData = content;

                // Build Meta for OG
                metaData.title = content.one_line_message;
                // 커스텀 기도문이 있으면 설명에 넣음, 없으면 묵상 본문 앞부분
                metaData.description = customPrayer || (content.meditation_body ? content.meditation_body.substring(0, 80) + '...' : '(가톨릭) 매일아침 매일미사 복음묵상');

                if (content.generated_image_url) {
                    let imgUrl = content.generated_image_url;
                    if (imgUrl.startsWith('/studio/')) imgUrl = 'https://uconai.ddns.net/bona' + imgUrl;
                    metaData.image = imgUrl; // 카드 이미지
                }
            }
        }

        res.render('reader', {
            vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
            staticData: staticData,
            metaData: metaData // [New] Pass meta for SEO/OG
        });
    } catch (e) {
        console.error('[Reader Render Error]', e);
        res.render('reader', {
            vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
            staticData: null,
            metaData: {
                title: 'Good Morning Bona',
                description: 'Service Unavailable',
                image: 'https://uconai.ddns.net/bona/logo.png',
                url: 'https://uconai.ddns.net/bona/'
            }
        });
    }
});

// PWA & File System Setup
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

const DATA_DIR = path.join(__dirname, '../data');
const SUBS_FILE = path.join(DATA_DIR, 'subs.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// API: Get Post Data (For Client)
app.get('/studio/api/post/:date', (req, res) => {
    let { date } = req.params;

    // 'today' 요청 시 오늘 날짜로 변환
    if (date === 'today') {
        const offset = 1000 * 60 * 60 * 9; // KST
        date = new Date(Date.now() + offset).toISOString().split('T')[0];
    }

    const filePath = path.join(DATA_DIR, `draft_${date}.json`);

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

// API: Get VAPID Key (Frontend needs this for subscription)
app.get('/studio/api/vapid-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// API: Get Subscribers (관리자용)
app.get('/studio/api/subscribers', (req, res) => {
    try {
        let subs = [];
        if (fs.existsSync(SUBS_FILE)) {
            subs = JSON.parse(fs.readFileSync(SUBS_FILE));
        }
        res.json({ success: true, count: subs.length, list: subs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
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
    const isSaveOnly = req.query.saveOnly === 'true'; // [New] 저장 전용 모드
    const date = data.date;
    const filePath = path.join(DATA_DIR, `draft_${date}.json`);

    console.log(`[Publish] Processing (Test=${isTest}, SaveOnly=${isSaveOnly}) for ${date}...`);

    try {
        // 1. 이미지 로컬 저장 (영구 저장)
        if (data.generated_image_url && data.generated_image_url.startsWith('http')) {
            console.log(`[Publish] Downloading image for permanent storage...`);
            const localUrl = await downloadImage(data.generated_image_url, date);
            data.generated_image_url = localUrl;
        }

        // 2. 파일 저장
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        // [New] 저장 전용이면 여기서 종료
        if (isSaveOnly) {
            console.log(`[Publish] Saved draft only. No notifications sent.`);
            return res.json({ success: true, message: 'Draft saved successfully.' });
        }

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
            // icon은 서버에 실제 파일이 있을 때만 사용 (PC 크롬 404 차단 방지)
            url: `https://uconai.ddns.net/bona/?date=${date}`
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


// --- Scheduler: Daily 6:00 AM Auto-Publish ---
let lastAutoPublishDate = ''; // 중복 발송 방지용

setInterval(async () => {
    // 한국 시간(KST) 기준 계산: UTC + 9
    const now = new Date(Date.now() + (9 * 60 * 60 * 1000));
    const hours = now.getUTCHours();
    const minutes = now.getUTCMinutes();
    const dateStr = now.toISOString().split('T')[0];

    // 매일 06시 00분에 실행
    if (hours === 6 && minutes === 0) {
        if (lastAutoPublishDate === dateStr) return; // 이미 오늘 보냈으면 패스

        console.log(`[Scheduler] Checking for auto-publish: ${dateStr}`);

        try {
            const draftFile = path.join(DATA_DIR, `draft_${dateStr}.json`);
            if (fs.existsSync(draftFile)) {
                // 초안이 존재하면 발송 시도
                const draft = JSON.parse(fs.readFileSync(draftFile));
                const content = draft.content || draft; // 구조 호환성

                // 구독자 로드
                let subs = [];
                if (fs.existsSync(SUBS_FILE)) {
                    subs = JSON.parse(fs.readFileSync(SUBS_FILE));
                }

                if (subs.length > 0) {
                    const payload = JSON.stringify({
                        title: content.one_line_message || '오늘의 묵상',
                        body: content.meditation_body ? content.meditation_body.substring(0, 30) + '...' : '오늘의 말씀이 도착했습니다.',
                        icon: '/bona/assets/icon-192.png',
                        url: `/bona/?date=${dateStr}`
                    });

                    console.log(`[Scheduler] Auto-publishing to ${subs.length} subscribers...`);

                    let successCount = 0;
                    const promises = subs.map(sub =>
                        webpush.sendNotification(sub, payload)
                            .then(() => successCount++)
                            .catch(err => {
                                // 만료된 구독자는 무시 (로그만)
                                console.error('[AutoPublish] Failed to send:', err.statusCode);
                            })
                    );

                    await Promise.all(promises);
                    console.log(`[Scheduler] Auto-publish complete. Success: ${successCount}/${subs.length}`);
                } else {
                    console.log('[Scheduler] No subscribers to send to.');
                }

                // 발송 완료 마킹
                lastAutoPublishDate = dateStr;
            } else {
                console.log(`[Scheduler] No draft found for ${dateStr}. Skipping.`);
                lastAutoPublishDate = dateStr; // 파일 없어도 재시도 멈춤 (내일 다시)
            }
        } catch (e) {
            console.error('[Scheduler Error]', e);
        }
    }
}, 60000); // 1분마다 체크

// --- URL Shortener Service ---
const SHORT_LINKS_FILE = path.join(DATA_DIR, 'short_links.json');

// Helper: Generate Random ID (6 chars)
function generateShortId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// API: Create Short Link
app.post('/studio/api/shorten', (req, res) => {
    try {
        const { date, prayer } = req.body;

        // [Fix] 날짜가 없으면 KST 오늘 날짜 사용
        const offset = 1000 * 60 * 60 * 9;
        const kstDate = new Date(Date.now() + offset).toISOString().split('T')[0];
        const targetDate = date || kstDate;

        if (!prayer) {
            return res.json({ success: true, shortUrl: `https://uconai.ddns.net/bona/studio/?date=${targetDate}` });
        }

        let links = {};
        if (fs.existsSync(SHORT_LINKS_FILE)) {
            links = JSON.parse(fs.readFileSync(SHORT_LINKS_FILE));
        }

        // 중복 콘텐츠 체크 (이미 같은 기도문이면 기존 ID 재활용 - 최적화)
        // (간단하게 구현하기 위해 생략하거나, 매번 생성해도 무방함. 여기선 매번 생성)

        const id = generateShortId();
        links[id] = { date, prayer, createdAt: new Date().toISOString() };

        fs.writeFileSync(SHORT_LINKS_FILE, JSON.stringify(links, null, 2));

        // 반환 URL (Caddy 설정을 고려하여 /bona/studio/s/ID)
        res.json({
            success: true,
            id: id,
            shortUrl: `https://uconai.ddns.net/bona/studio/s/${id}`
        });

    } catch (e) {
        console.error('[Shortener Error]', e);
        res.status(500).json({ success: false, error: 'Link generation failed' });
    }
});

// Route: Handle Short Link Redirect AND Render (for OG Tags)
app.get('/studio/s/:id', (req, res) => {
    const { id } = req.params;
    try {
        if (fs.existsSync(SHORT_LINKS_FILE)) {
            const links = JSON.parse(fs.readFileSync(SHORT_LINKS_FILE));
            const data = links[id];

            if (data) {
                const targetDate = data.date;
                const customPrayer = data.prayer;

                const filePath = path.join(DATA_DIR, `draft_${targetDate}.json`);

                let staticData = null;
                let metaData = {
                    title: 'Good Morning Bona',
                    description: customPrayer || '(가톨릭) 매일아침 매일미사 복음묵상',
                    image: 'https://uconai.ddns.net/bona/logo.png',
                    url: `https://uconai.ddns.net/bona/studio/s/${id}`
                };

                if (fs.existsSync(filePath)) {
                    const raw = fs.readFileSync(filePath, 'utf8');
                    const draft = JSON.parse(raw);
                    const content = draft.content || draft;

                    if (content.one_line_message) {
                        staticData = { ...content };
                        if (customPrayer) {
                            staticData.prayer_line = customPrayer;
                            metaData.description = customPrayer;
                        }

                        metaData.title = content.one_line_message;
                        if (content.generated_image_url) {
                            let imgUrl = content.generated_image_url;
                            if (imgUrl.startsWith('/studio/')) imgUrl = 'https://uconai.ddns.net/bona' + imgUrl;

                            // [Cache Busting]
                            imgUrl += `?t=${new Date().getTime()}`;
                            metaData.image = imgUrl;
                        }
                    }
                }

                return res.render('reader', {
                    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
                    staticData: staticData,
                    metaData: metaData
                });
            }
        }
        res.redirect('/bona/');
    } catch (e) {
        console.error(e);
        res.redirect('/bona/');
    }
});

// [New] Stateless Share Endpoint (No DB, SSR for OG Tags)
app.get('/studio/share', (req, res) => {
    try {
        const { date, prayer } = req.query;

        // [Fix] 날짜 자동 보정 (KST 기준)
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0];
        const targetDate = date || kstDate;

        // [Fix] 밑줄(_) 또는 인코딩된 문자 모두를 위해 복원 로직 강화
        let customPrayer = null;
        if (prayer) {
            try {
                customPrayer = decodeURIComponent(prayer).replace(/_/g, ' ');
            } catch (e) {
                customPrayer = prayer.replace(/_/g, ' ');
            }
        }

        const filePath = path.join(DATA_DIR, `draft_${targetDate}.json`);

        let staticData = null; // [Fixed] 선언 누락 수정
        let metaData = {
            title: 'Good Morning Bona',
            description: customPrayer || '(가톨릭) 매일아침 매일미사 복음묵상',
            image: 'https://uconai.ddns.net/bona/logo.png',
            url: `https://uconai.ddns.net/bona/studio/share?date=${targetDate}`
        };

        // [Fix] og:url 에는 반드시 인코딩된 값을 넣어야 함
        if (prayer) {
            metaData.url += `&prayer=${encodeURIComponent(prayer)}`;
        }

        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const draft = JSON.parse(raw);
            const content = draft.content || draft;

            if (content.one_line_message) {
                staticData = { ...content };
                if (customPrayer) {
                    staticData.prayer_line = customPrayer;
                    metaData.description = customPrayer;
                }

                metaData.title = content.one_line_message;
                if (content.generated_image_url) {
                    let imgUrl = content.generated_image_url;
                    if (imgUrl.startsWith('/studio/')) imgUrl = 'https://uconai.ddns.net/bona' + imgUrl;

                    // [Cache Busting]
                    imgUrl += `?t=${new Date().getTime()}`;
                    metaData.image = imgUrl;
                }
            }
        }

        res.render('reader', {
            vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
            staticData: staticData,
            metaData: metaData
        });

    } catch (e) {
        console.error('[Share SSR Error]', e);
        res.redirect('/bona/');
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Bona Studio] Running on http://0.0.0.0:${PORT}/studio`);
});
