self.addEventListener('push', function (event) {
    let data = {};
    if (event.data) {
        data = event.data.json();
    }

    const title = data.title || 'Good Morning Bona';
    const options = {
        body: data.body || '오늘의 말씀이 도착했습니다.',
        icon: data.icon || '/bona/assets/icon-192.png',
        badge: '/bona/assets/icon-192.png',
        data: {
            url: data.url || '/bona/'
        }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
