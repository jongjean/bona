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

// Middleware (Explicit /studio Prefix)
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
app.get('/', (req, res) => {
    res.render('reader', {
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY
    });
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

