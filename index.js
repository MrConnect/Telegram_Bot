const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, {polling: true});
const app = express();
const PORT = process.env.PORT || 3000;

// إعداد Express
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// إعداد Multer لرفع الملفات
const upload = multer({
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max
    }
});

// قاعدة البيانات في الذاكرة (سيتم حفظها في ملف لاحقاً)
let botData = {
    main_page: {
        title: "🏠 الصفحة الرئيسية",
        message: "مرحباً بك! اختر من القائمة التالية:",
        buttons: [
            [{text: "📷 الصور", callback_data: "photos_page"}],
            [{text: "📄 المستندات", callback_data: "docs_page"}], 
            [{text: "🎥 الفيديوهات", callback_data: "videos_page"}],
            [{text: "ℹ️ معلومات", callback_data: "info_page"}]
        ]
    },
    photos_page: {
        title: "📷 قسم الصور",
        message: "اختر الصورة التي تريد عرضها:",
        buttons: [
            [{text: "صورة المنتج 1", callback_data: "photo_1"}],
            [{text: "صورة المنتج 2", callback_data: "photo_2"}],
            [{text: "🔙 رجوع", callback_data: "main_page"}]
        ]
    },
    docs_page: {
        title: "📄 قسم المستندات", 
        message: "اختر المستند الذي تريد تحميله:",
        buttons: [
            [{text: "الكتالوج", callback_data: "doc_catalog"}],
            [{text: "قائمة الأسعار", callback_data: "doc_prices"}],
            [{text: "🔙 رجوع", callback_data: "main_page"}]
        ]
    },
    videos_page: {
        title: "🎥 قسم الفيديوهات",
        message: "اختر الفيديو الذي تريد مشاهدته:",
        buttons: [
            [{text: "فيديو تعريفي", callback_data: "video_1"}],
            [{text: "شرح المنتج", callback_data: "video_2"}],
            [{text: "🔙 رجوع", callback_data: "main_page"}]
        ]
    },
    info_page: {
        title: "ℹ️ معلومات",
        message: "معلومات عن البوت:\n\n✅ بوت لعرض المحتوى\n✅ سهل الاستخدام\n✅ محدث باستمرار",
        buttons: [
            [{text: "📞 تواصل معنا", callback_data: "contact"}],
            [{text: "🔙 رجوع", callback_data: "main_page"}]
        ]
    }
};

// بيانات الملفات
let filesData = {};

// الإحصائيات
let stats = {
    users: new Set(),
    messages: 0,
    todayUsers: new Set(),
    todayMessages: 0,
    startDate: new Date(),
    dailyReset: new Date().toDateString()
};

// إعادة تعيين الإحصائيات اليومية
function resetDailyStats() {
    const today = new Date().toDateString();
    if (stats.dailyReset !== today) {
        stats.todayUsers = new Set();
        stats.todayMessages = 0;
        stats.dailyReset = today;
    }
}

// دالة عرض الصفحة
function showPage(chatId, pageKey, messageId = null) {
    const page = botData[pageKey];
    if (!page) return;
    
    const options = {
        reply_markup: {
            inline_keyboard: page.buttons
        }
    };
    
    const message = `${page.title}\n\n${page.message}`;
    
    if (messageId) {
        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup
        }).catch(err => console.log('Edit message error:', err.message));
    } else {
        bot.sendMessage(chatId, message, options);
    }
}

// أمر البداية
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    resetDailyStats();
    
    stats.users.add(chatId);
    stats.todayUsers.add(chatId);
    stats.messages++;
    stats.todayMessages++;
    
    showPage(chatId, 'main_page');
});

// معالجة الأزرار
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.callback_data;
    
    resetDailyStats();
    stats.messages++;
    stats.todayMessages++;
    
    bot.answerCallbackQuery(query.id);
    
    // التعامل مع الملفات
    if (filesData[data]) {
        const file = filesData[data];
        
        if (file.type.startsWith('image/')) {
            bot.sendPhoto(chatId, file.file_id);
        } else if (file.type.startsWith('video/')) {
            bot.sendVideo(chatId, file.file_id);
        } else if (file.type.startsWith('audio/')) {
            bot.sendAudio(chatId, file.file_id);
        } else {
            bot.sendDocument(chatId, file.file_id);
        }
        return;
    }
    
    // التعامل مع الصفحات
    if (botData[data]) {
        showPage(chatId, data, messageId);
    } else if (data === 'contact') {
        bot.editMessageText(
            "📞 للتواصل معنا:\n\n" +
            "📧 البريد الإلكتروني: info@example.com\n" +
            "📱 الهاتف: +20123456789\n\n" +
            "👈 اضغط رجوع للعودة للقائمة",
            {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{text: "🔙 رجوع", callback_data: "main_page"}]]
                }
            }
        );
    }
});

// API Routes

// الصفحة الرئيسية - لوحة التحكم
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// احصائيات
app.get('/api/stats', (req, res) => {
    resetDailyStats();
    
    res.json({
        users: stats.users.size,
        messages: stats.messages,
        pages: Object.keys(botData).length,
        files: Object.keys(filesData).length,
        todayUsers: stats.todayUsers.size,
        todayMessages: stats.todayMessages,
        topPage: 'main_page',
        uptime: Math.floor((Date.now() - stats.startDate.getTime()) / 1000 / 60)
    });
});

// جلب جميع الصفحات
app.get('/api/pages', (req, res) => {
    res.json(botData);
});

// جلب صفحة محددة
app.get('/api/pages/:pageId', (req, res) => {
    const pageId = req.params.pageId;
    const page = botData[pageId];
    
    if (!page) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }
    
    res.json(page);
});

// إضافة صفحة جديدة
app.post('/api/pages', (req, res) => {
    const { pageId, pageData } = req.body;
    
    if (!pageId || !pageData) {
        return res.status(400).json({ error: 'بيانات الصفحة مطلوبة' });
    }
    
    if (botData[pageId]) {
        return res.status(400).json({ error: 'هذه الصفحة موجودة بالفعل' });
    }
    
    botData[pageId] = pageData;
    res.json({ success: true, message: 'تم إضافة الصفحة بنجاح' });
});

// تحديث صفحة
app.put('/api/pages/:pageId', (req, res) => {
    const pageId = req.params.pageId;
    const pageData = req.body;
    
    if (!botData[pageId]) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }
    
    botData[pageId] = { ...botData[pageId], ...pageData };
    res.json({ success: true, message: 'تم تحديث الصفحة بنجاح' });
});

// حذف صفحة
app.delete('/api/pages/:pageId', (req, res) => {
    const pageId = req.params.pageId;
    
    if (!botData[pageId]) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }
    
    delete botData[pageId];
    res.json({ success: true, message: 'تم حذف الصفحة بنجاح' });
});

// جلب أزرار صفحة محددة
app.get('/api/pages/:pageId/buttons', (req, res) => {
    const pageId = req.params.pageId;
    const page = botData[pageId];
    
    if (!page) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }
    
    res.json(page.buttons || []);
});

// إضافة زر لصفحة
app.post('/api/pages/:pageId/buttons', (req, res) => {
    const pageId = req.params.pageId;
    const { buttonData, rowIndex } = req.body;
    
    if (!botData[pageId]) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }
    
    if (!botData[pageId].buttons) {
        botData[pageId].buttons = [];
    }
    
    const targetRow = rowIndex !== undefined ? rowIndex : botData[pageId].buttons.length;
    
    if (!botData[pageId].buttons[targetRow]) {
        botData[pageId].buttons[targetRow] = [];
    }
    
    botData[pageId].buttons[targetRow].push(buttonData);
    
    res.json({ success: true, message: 'تم إضافة الزر بنجاح' });
});

// جلب جميع الملفات
app.get('/api/files', (req, res) => {
    res.json(filesData);
});

// رفع ملف جديد
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم تحديد ملف' });
        }
        
        // إرسال الملف للبوت للحصول على file_id
        let sentMessage;
        const tempChatId = process.env.ADMIN_CHAT_ID || '123456789'; // ضع chat ID للإدارة
        
        if (req.file.mimetype.startsWith('image/')) {
            sentMessage = await bot.sendPhoto(tempChatId, req.file.buffer, {
                caption: `ملف جديد: ${req.file.originalname}`
            });
        } else if (req.file.mimetype.startsWith('video/')) {
            sentMessage = await bot.sendVideo(tempChatId, req.file.buffer, {
                caption: `ملف جديد: ${req.file.originalname}`
            });
        } else if (req.file.mimetype.startsWith('audio/')) {
            sentMessage = await bot.sendAudio(tempChatId, req.file.buffer, {
                caption: `ملف جديد: ${req.file.originalname}`
            });
        } else {
            sentMessage = await bot.sendDocument(tempChatId, req.file.buffer, {
                caption: `ملف جديد: ${req.file.originalname}`
            });
        }
        
        // الحصول على file_id
        let fileId;
        if (sentMessage.photo) {
            fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
        } else if (sentMessage.video) {
            fileId = sentMessage.video.file_id;
        } else if (sentMessage.audio) {
            fileId = sentMessage.audio.file_id;
        } else if (sentMessage.document) {
            fileId = sentMessage.document.file_id;
        }
        
        // حفظ بيانات الملف
        const fileData = {
            id: Date.now().toString(),
            name: req.file.originalname,
            type: req.file.mimetype,
            size: req.file.size,
            file_id: fileId,
            uploadDate: new Date().toISOString()
        };
        
        filesData[fileData.id] = fileData;
        
        res.json({ 
            success: true, 
            message: 'تم رفع الملف بنجاح',
            fileData: fileData
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'حدث خطأ في رفع الملف' });
    }
});

// حذف ملف
app.delete('/api/files/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    
    if (!filesData[fileId]) {
        return res.status(404).json({ error: 'الملف غير موجود' });
    }
    
    delete filesData[fileId];
    res.json({ success: true, message: 'تم حذف الملف بنجاح' });
});

// معاينة ملف
app.get('/api/files/:fileId/preview', (req, res) => {
    const fileId = req.params.fileId;
    const file = filesData[fileId];
    
    if (!file) {
        return res.status(404).json({ error: 'الملف غير موجود' });
    }
    
    res.json({
        name: file.name,
        type: file.type,
        size: file.size,
        file_id: file.file_id,
        uploadDate: file.uploadDate
    });
});

// إضافة زر مع ملف
app.post('/api/buttons/file', (req, res) => {
    const { pageId, buttonText, fileId } = req.body;
    
    if (!botData[pageId]) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }
    
    if (!filesData[fileId]) {
        return res.status(404).json({ error: 'الملف غير موجود' });
    }
    
    const buttonData = {
        text: buttonText,
        callback_data: fileId
    };
    
    if (!botData[pageId].buttons) {
        botData[pageId].buttons = [];
    }
    
    // إضافة الزر في صف جديد
    botData[pageId].buttons.push([buttonData]);
    
    res.json({ success: true, message: 'تم إضافة الزر مع الملف بنجاح' });
});

// تصدير البيانات
app.get('/api/export', (req, res) => {
    const exportData = {
        botData: botData,
        filesData: filesData,
        stats: {
            totalUsers: stats.users.size,
            totalMessages: stats.messages,
            startDate: stats.startDate
        },
        exportDate: new Date().toISOString()
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=bot-backup.json');
    res.json(exportData);
});

// استيراد البيانات
app.post('/api/import', upload.single('backupFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم تحديد ملف النسخة الاحتياطية' });
        }
        
        const backupData = JSON.parse(req.file.buffer.toString());
        
        if (backupData.botData) {
            botData = backupData.botData;
        }
        
        if (backupData.filesData) {
            filesData = backupData.filesData;
        }
        
        res.json({ success: true, message: 'تم استيراد البيانات بنجاح' });
        
    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ error: 'حدث خطأ في استيراد البيانات' });
    }
});

// إعادة تشغيل البوت
app.post('/api/restart', (req, res) => {
    res.json({ success: true, message: 'جاري إعادة تشغيل البوت...' });
    
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

// مسح جميع البيانات
app.post('/api/clear-all', (req, res) => {
    botData = {
        main_page: {
            title: "🏠 الصفحة الرئيسية",
            message: "مرحباً بك! اختر من القائمة التالية:",
            buttons: []
        }
    };
    
    filesData = {};
    
    stats = {
        users: new Set(),
        messages: 0,
        todayUsers: new Set(),
        todayMessages: 0,
        startDate: new Date(),
        dailyReset: new Date().toDateString()
    };
    
    res.json({ success: true, message: 'تم مسح جميع البيانات بنجاح' });
});

// البحث في البيانات
app.get('/api/search', (req, res) => {
    const query = req.query.q?.toLowerCase() || '';
    
    if (!query) {
        return res.json({ pages: [], files: [] });
    }
    
    // البحث في الصفحات
    const matchingPages = Object.keys(botData).filter(pageId => {
        const page = botData[pageId];
        return page.title.toLowerCase().includes(query) || 
               page.message.toLowerCase().includes(query) ||
               pageId.toLowerCase().includes(query);
    }).map(pageId => ({
        id: pageId,
        title: botData[pageId].title,
        type: 'page'
    }));
    
    // البحث في الملفات
    const matchingFiles = Object.keys(filesData).filter(fileId => {
        const file = filesData[fileId];
        return file.name.toLowerCase().includes(query) ||
               file.type.toLowerCase().includes(query);
    }).map(fileId => ({
        id: fileId,
        name: filesData[fileId].name,
        type: 'file'
    }));
    
    res.json({
        pages: matchingPages,
        files: matchingFiles
    });
});

// الحصول على سجل الأنشطة
app.get('/api/activity-log', (req, res) => {
    // سجل بسيط للأنشطة (يمكن تطويره أكثر)
    const activities = [
        {
            id: 1,
            type: 'user_interaction',
            description: 'مستخدم جديد انضم للبوت',
            timestamp: new Date().toISOString(),
            details: { users: stats.users.size }
        },
        {
            id: 2,
            type: 'page_view',
            description: 'تم عرض الصفحة الرئيسية',
            timestamp: new Date().toISOString(),
            details: { page: 'main_page' }
        }
    ];
    
    res.json(activities);
});

// إحصائيات مفصلة
app.get('/api/detailed-stats', (req, res) => {
    resetDailyStats();
    
    const now = new Date();
    const uptime = now - stats.startDate;
    
    res.json({
        overview: {
            totalUsers: stats.users.size,
            totalMessages: stats.messages,
            totalPages: Object.keys(botData).length,
            totalFiles: Object.keys(filesData).length,
            uptime: {
                milliseconds: uptime,
                seconds: Math.floor(uptime / 1000),
                minutes: Math.floor(uptime / (1000 * 60)),
                hours: Math.floor(uptime / (1000 * 60 * 60)),
                days: Math.floor(uptime / (1000 * 60 * 60 * 24))
            }
        },
        today: {
            users: stats.todayUsers.size,
            messages: stats.todayMessages
        },
        pages: Object.keys(botData).map(pageId => ({
            id: pageId,
            title: botData[pageId].title,
            buttonsCount: (botData[pageId].buttons || []).flat().length
        })),
        files: Object.keys(filesData).map(fileId => ({
            id: fileId,
            name: filesData[fileId].name,
            type: filesData[fileId].type,
            size: filesData[fileId].size
        }))
    });
});

// معلومات البوت
app.get('/api/bot-info', async (req, res) => {
    try {
        const botInfo = await bot.getMe();
        res.json({
            success: true,
            botInfo: {
                id: botInfo.id,
                username: botInfo.username,
                first_name: botInfo.first_name,
                can_join_groups: botInfo.can_join_groups,
                can_read_all_group_messages: botInfo.can_read_all_group_messages,
                supports_inline_queries: botInfo.supports_inline_queries
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: 'فشل في الحصول على معلومات البوت' 
        });
    }
});

// تحديث أوامر البوت
app.post('/api/bot-commands', async (req, res) => {
    try {
        const commands = [
            { command: 'start', description: 'بدء استخدام البوت' },
            { command: 'help', description: 'المساعدة' },
            { command: 'about', description: 'معلومات عن البوت' }
        ];
        
        await bot.setMyCommands(commands);
        
        res.json({ 
            success: true, 
            message: 'تم تحديث أوامر البوت بنجاح' 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: 'فشل في تحديث أوامر البوت' 
        });
    }
});

// HealthCheck endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        botConnected: bot.isPolling()
    });
});

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`🚀 البوت يعمل على البورت ${PORT}`);
    console.log(`📊 لوحة التحكم متاحة على: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT}`);
    console.log(`🤖 البوت متصل ويعمل بانتظار الرسائل...`);
});

// معالجة الأخطاء
bot.on('error', (error) => {
    console.log('خطأ في البوت:', error.message);
});

bot.on('polling_error', (error) => {
    console.log('خطأ في الاتصال:', error.message);
});

process.on('uncaughtException', (error) => {
    console.log('خطأ غير متوقع:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.log('رفض غير معالج:', error.message);
});

// إغلاق نظيف للبوت
process.on('SIGINT', () => {
    console.log('إيقاف البوت...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('إنهاء البوت...');
    bot.stopPolling();
    process.exit(0);
});
