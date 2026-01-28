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

// --- 0. PATH CONFIGURATION ---
const DATA_DIR = path.join(__dirname, '../data');
const SUBS_FILE = path.join(DATA_DIR, 'subs.json');
const ADMIN_SUB_FILE = path.join(DATA_DIR, 'admin_sub.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- 1. Push Notification Setup ---
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// --- 2. Middleware & View Engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/studio', express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve sw.js at root and /bona for legacy compatibility
app.get(['/sw.js', '/bona/sw.js'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public/sw.js'));
});

// --- 3. Routes ---
app.get('/studio', (req, res) => {
    const offset = 1000 * 60 * 60 * 9;
    const today = new Date(Date.now() + offset).toISOString().split('T')[0];
    let publishedCards = {};
    try {
        const files = fs.readdirSync(DATA_DIR);
        files.filter(f => f.startsWith('draft_') && f.endsWith('.json')).forEach(f => {
            const dateStr = f.replace('draft_', '').replace('.json', '');
            try {
                const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f)));
                const imageUrl = (content.content && content.content.generated_image_url) || content.generated_image_url || '';
                publishedCards[dateStr] = { isPublished: true, imageUrl: imageUrl };
            } catch (e) { }
        });
    } catch (e) { }

    const queryYear = parseInt(req.query.year) || parseInt(today.split('-')[0]);
    const queryMonth = parseInt(req.query.month) || parseInt(today.split('-')[1]);

    const firstDay = new Date(queryYear, queryMonth - 1, 1);
    const lastDay = new Date(queryYear, queryMonth, 0).getDate();
    const startDayOfWeek = firstDay.getDay();

    let prevYear = queryYear;
    let prevMonth = queryMonth - 1;
    if (prevMonth === 0) { prevMonth = 12; prevYear = queryYear - 1; }
    let nextYear = queryYear;
    let nextMonth = queryMonth + 1;
    if (nextMonth === 13) { nextMonth = 1; nextYear = queryYear + 1; }

    const calendarDays = [];
    for (let i = 0; i < startDayOfWeek; i++) calendarDays.push({ isEmpty: true });
    for (let day = 1; day <= lastDay; day++) {
        const dateStr = `${queryYear}-${String(queryMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        calendarDays.push({ isEmpty: false, day, dateStr, isToday: dateStr === today, dayOfWeek: new Date(queryYear, queryMonth - 1, day).getDay(), card: publishedCards[dateStr] || null });
    }

    res.render('dashboard', { title: 'Bona Studio', today, calendarDays, currentYear: queryYear, currentMonth: queryMonth, prevYear, prevMonth, nextYear, nextMonth, publishedDates: Object.keys(publishedCards) });
});

app.get('/studio/editor/:date', (req, res) => {
    const { date } = req.params;
    let savedData = {};
    const filePath = path.join(DATA_DIR, `draft_${date}.json`);
    if (fs.existsSync(filePath)) {
        try { savedData = JSON.parse(fs.readFileSync(filePath)); } catch (e) { }
    }
    res.render('editor', { date, data: savedData });
});

const draftService = require('./services/draftService');
app.post('/studio/api/draft', async (req, res) => {
    try {
        const { date } = req.body;
        const draft = await draftService.createDailyDraft(date);
        res.json({ success: true, data: draft });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/', (req, res) => res.render('reader', { vapidPublicKey: process.env.VAPID_PUBLIC_KEY }));

app.get('/studio/api/post/:date', (req, res) => {
    let { date } = req.params;
    if (date === 'today') date = new Date(Date.now() + 1000 * 60 * 60 * 9).toISOString().split('T')[0];
    const filePath = path.join(DATA_DIR, `draft_${date}.json`);
    if (fs.existsSync(filePath)) {
        try { res.json({ success: true, data: JSON.parse(fs.readFileSync(filePath)) }); } catch (e) { res.status(500).json({ success: false, error: 'Read Error' }); }
    } else res.status(404).json({ success: false, error: 'Not found' });
});

app.post('/studio/api/register-admin', (req, res) => {
    try {
        fs.writeFileSync(ADMIN_SUB_FILE, JSON.stringify(req.body, null, 2));
        console.log('[Admin] Registered at:', ADMIN_SUB_FILE);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/studio/api/publish', async (req, res) => {
    const data = req.body;
    const isTest = req.query.test === 'true';
    const filePath = path.join(DATA_DIR, `draft_${data.date}.json`);
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        let subs = [];
        if (isTest) {
            if (fs.existsSync(ADMIN_SUB_FILE)) subs = [JSON.parse(fs.readFileSync(ADMIN_SUB_FILE))];
            else return res.json({ success: false, error: '관리자 기기 정보가 없습니다.' });
        } else {
            subs = fs.existsSync(SUBS_FILE) ? JSON.parse(fs.readFileSync(SUBS_FILE)) : [];
        }
        const payload = JSON.stringify({
            title: isTest ? '[TEST] Bona' : 'Good Morning Bona',
            body: data.one_line_message || '묵상이 도착했습니다.',
            icon: '/bona/assets/icon-192.png',
            url: `https://uconai.ddns.net/bona/?date=${data.date}`
        });
        await Promise.all(subs.map(s => webpush.sendNotification(s, payload).catch(e => console.error('[Push Fail]', e.statusCode))));
        res.json({ success: true, subscriberCount: subs.length, isTest });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`[Bona Studio] Running on port ${PORT}`));
