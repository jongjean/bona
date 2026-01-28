self.addEventListener('push', function (event) {
    const data = event.data.json();
    const title = 'Good Morning Bona';
    const options = {
        body: data.message || '오늘의 말씀이 도착했습니다.',
        icon: 'https://cdn-icons-png.flaticon.com/512/2913/2913584.png', // 십자가 아이콘
        badge: 'https://cdn-icons-png.flaticon.com/512/2913/2913584.png',
        data: { url: '/bona' } // 클릭 시 이동 주소
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
