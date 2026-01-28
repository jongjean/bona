const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const axios = require('axios');
const cheerio = require('cheerio');
const webpush = require('web-push');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3042; // Studio는 3042번 포트 사용

// View Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Middleware to serve static files (sw.js, images, etc.) - index.html 자동 서빙 방지
app.use(express.static('/var/www/bona', { index: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const downloadImage = async (url, date) => {
    if (!url || url.startsWith('/') || !url.startsWith('http')) return url;
    console.log(`[Image] Downloading: ${url}`);

    try {
        const response = await axios({
            url: url,
            method: 'GET',
            responseType: 'stream',
            timeout: 15000 // 15초 타임아웃
        });

        const filename = `card_${date}.jpg`;
        const dir = path.join(__dirname, 'public/uploads/cards');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const localPath = path.join(dir, filename);
        const writer = fs.createWriteStream(localPath);

        return new Promise((resolve) => {
            response.data.pipe(writer);

            let finished = false;

            writer.on('finish', () => {
                if (!finished) {
                    finished = true;
                    console.log(`[Image] Saved: ${filename}`);
                    resolve(`/studio/uploads/cards/${filename}`);
                }
            });

            writer.on('error', (err) => {
                if (!finished) {
                    finished = true;
                    console.error('[Image Writer Error]', err.message);
                    writer.close();
                    resolve(url);
                }
            });

            response.data.on('error', (err) => {
                if (!finished) {
                    finished = true;
                    console.error('[Image Response Error]', err.message);
                    writer.close();
                    resolve(url);
                }
            });

            // 안전장치: 20초 후 강제 종료
            setTimeout(() => {
                if (!finished) {
                    finished = true;
                    console.warn('[Image] Download timeout, using original URL');
                    writer.close();
                    resolve(url);
                }
            }, 20000);
        });
    } catch (e) {
        console.error('[Image Download Catch Error]', e.message);
        return url;
    }
};

app.use((req, res, next) => {
    // Caddy handles redirects now
    next();
});

// 정적 파일: Legacy Studio Access를 위해 복구
app.use('/studio', express.static(path.join(__dirname, 'public')));
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
                    // Support both nested content structure and flat structure
                    const imageUrl = (content.content && content.content.generated_image_url)
                        || content.generated_image_url
                        || '';
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
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
        const filePath = path.join(DATA_DIR, `draft_${today}.json`);
        let staticData = null;

        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const draft = JSON.parse(raw);
            if (draft.one_line_message) {
                staticData = draft;
            }
        }

        res.render('reader', {
            vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
            staticData: staticData
        });
    } catch (e) {
        console.error('[Reader Render Error]', e);
        res.render('reader', {
            vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
            staticData: null
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
