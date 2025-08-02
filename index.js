const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const multer = require('multer');
const fs = require('fs').promises; // Use fs.promises for async file operations
const path = require('path');

// Load environment variables (e.g., BOT_TOKEN, ADMIN_CHAT_ID, RENDER_EXTERNAL_URL)
require('dotenv').config();

const token = process.env.BOT_TOKEN;
// Validate BOT_TOKEN presence
if (!token) {
    console.error('Error: BOT_TOKEN is not defined in your .env file. Please set it to start the bot.');
    process.exit(1); // Exit if no token is found
}

// Get the public URL from Render's environment variables
// This is crucial for Webhooks as Telegram needs to know where to send updates
const publicUrl = process.env.RENDER_EXTERNAL_URL;
if (!publicUrl) {
    console.error("Error: RENDER_EXTERNAL_URL environment variable is not set. Webhooks require this URL.");
    console.error("Please ensure your Render service has this environment variable automatically provided or set manually.");
    process.exit(1); // Exit if no public URL
}

// Initialize bot with Webhook mode
const bot = new TelegramBot(token, { polling: false }); // Set polling to false
const app = express();
const PORT = process.env.PORT || 3000;

// --- Express Middleware to parse request bodies ---
app.use(express.json()); // To parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded request bodies
// --- End of middleware ---

// Set up the Webhook
// Telegram will send updates to this URL: YOUR_RENDER_URL/bot<YOUR_BOT_TOKEN>
const webhookUrl = `${publicUrl}/bot${token}`;
bot.setWebHook(webhookUrl).then(() => {
    console.log(`Webhook set successfully to: ${webhookUrl}`);
}).catch(e => {
    console.error('Error setting webhook:', e.message);
    // Even if webhook setting fails, we try to proceed, but bot might not receive updates
});

// Telegram Webhook route
// This is where Telegram sends updates to your bot
app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body); // Process the incoming Telegram update
    res.sendStatus(200); // Important: Acknowledge receipt to Telegram
});


// File paths for persistent storage
const DATA_FILE = 'bot_data.json';
const FILES_FILE = 'files_data.json';
const STATS_FILE = 'stats_data.json';

// In-memory databases - these will be loaded from files
let botData = {}; // Stores page data
let filesData = {}; // Stores file metadata (including Telegram file_id)
let stats = { // Stores bot usage statistics
    users: new Set(),
    messages: 0,
    todayUsers: new Set(),
    todayMessages: 0,
    startDate: new Date(),
    dailyReset: new Date().toDateString()
};

// --- Data Persistence Functions ---

// Load data from JSON files
async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        botData = JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('No bot_data.json found, starting with empty bot data.');
            botData = {}; // Initialize as empty object if file doesn't exist
        } else {
            console.error('Error loading bot data:', err);
        }
    }

    try {
        const data = await fs.readFile(FILES_FILE, 'utf8');
        filesData = JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('No files_data.json found, starting with empty files data.');
            filesData = {}; // Initialize as empty object if file doesn't exist
        } else {
            console.error('Error loading files data:', err);
        }
    }

    try {
        const data = await fs.readFile(STATS_FILE, 'utf8');
        const loadedStats = JSON.parse(data);
        // Reconstruct Sets from arrays as JSON doesn't directly support Sets
        stats.users = new Set(loadedStats.users || []);
        stats.messages = loadedStats.messages || 0;
        stats.todayUsers = new Set(loadedStats.todayUsers || []);
        stats.todayMessages = loadedStats.todayMessages || 0;
        stats.startDate = loadedStats.startDate ? new Date(loadedStats.startDate) : new Date();
        stats.dailyReset = loadedStats.dailyReset || new Date().toDateString();
        resetDailyStats(); // Ensure daily stats are reset if day has changed
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('No stats_data.json found, starting with default stats.');
            stats = { // Initialize with default values if file doesn't exist
                users: new Set(),
                messages: 0,
                todayUsers: new Set(),
                todayMessages: 0,
                startDate: new Date(),
                dailyReset: new Date().toDateString()
            };
        } else {
            console.error('Error loading stats data:', err);
        }
    }
}

// Save all data to JSON files
async function saveData() {
    try {
        // Convert Sets to Arrays for JSON serialization
        const statsToSave = {
            users: Array.from(stats.users),
            messages: stats.messages,
            todayUsers: Array.from(stats.todayUsers),
            todayMessages: stats.todayMessages,
            startDate: stats.startDate.toISOString(), // Save date as ISO string
            dailyReset: stats.dailyReset
        };
        await fs.writeFile(DATA_FILE, JSON.stringify(botData, null, 2));
        await fs.writeFile(FILES_FILE, JSON.stringify(filesData, null, 2));
        await fs.writeFile(STATS_FILE, JSON.stringify(statsToSave, null, 2));
    } catch (err) {
        console.error('Error saving data:', err);
    }
}

// --- Bot Logic ---

// Reset daily stats
function resetDailyStats() {
    const today = new Date().toDateString();
    if (stats.dailyReset !== today) {
        stats.todayUsers = new Set();
        stats.todayMessages = 0;
        stats.dailyReset = today;
        saveData(); // Save changes to stats after reset
    }
}

// Function to display a page to the user
function showPage(chatId, pageKey, messageId = null) {
    const page = botData[pageKey];
    if (!page) {
        bot.sendMessage(chatId, "⚠️ هذه الصفحة غير موجودة.");
        return;
    }

    // Ensure buttons are in the correct Telegram format (array of arrays)
    const inlineKeyboard = page.buttons ? page.buttons.map(row =>
        row.map(button => {
            if (button.url) {
                return { text: button.text, url: button.url };
            } else {
                // For callback_data, ensure it's a string
                return { text: button.text, callback_data: String(button.callback_data) };
            }
        })
    ) : [];

    const options = {
        reply_markup: {
            inline_keyboard: inlineKeyboard
        },
        parse_mode: 'Markdown' // Allow basic Markdown in messages
    };

    const message = `${page.title}\n\n${page.message}`;

    if (messageId) {
        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
            parse_mode: options.parse_mode
        }).catch(err => console.log('Edit message error (could be message too old or identical):', err.message));
    } else {
        bot.sendMessage(chatId, message, options);
    }
}

// Start Command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    resetDailyStats(); // Check and reset daily stats

    stats.users.add(chatId);
    stats.todayUsers.add(chatId);
    stats.messages++;
    stats.todayMessages++;
    saveData(); // Save stats changes

    if (Object.keys(botData).length === 0) {
        bot.sendMessage(chatId, "🤖 مرحباً بك في البوت!\n\nلا توجد صفحات متاحة حالياً.\nيمكن للمشرف إضافة صفحات من لوحة التحكم.");
    } else {
        // Try to show 'main_page' first, otherwise the first available page
        const initialPage = botData['main_page'] ? 'main_page' : Object.keys(botData)[0];
        if (initialPage) {
            showPage(chatId, initialPage);
        } else {
             bot.sendMessage(chatId, "🤖 مرحباً بك في البوت!\n\nلا توجد صفحات متاحة حالياً.\nيمكن للمشرف إضافة صفحات من لوحة التحكم.");
        }
    }
});

// Callback Query Handler (for inline buttons)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = String(query.callback_data); // Ensure data is a string

    resetDailyStats();
    stats.messages++;
    stats.todayMessages++;
    saveData(); // Save stats changes

    await bot.answerCallbackQuery(query.id); // Acknowledge the callback query

    // Handle File buttons (prefixed with 'file_')
    if (data.startsWith('file_')) {
        const fileId = data.substring(5); // Remove 'file_' prefix
        const file = filesData[fileId];
        if (file && file.file_id) {
            try {
                if (file.type.startsWith('image/')) {
                    await bot.sendPhoto(chatId, file.file_id);
                } else if (file.type.startsWith('video/')) {
                    await bot.sendVideo(chatId, file.file_id);
                } else if (file.type.startsWith('audio/')) {
                    await bot.sendAudio(chatId, file.file_id);
                } else {
                    await bot.sendDocument(chatId, file.file_id);
                }
            } catch (err) {
                console.error(`Error sending file ${fileId}:`, err.message);
                bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء إرسال هذا الملف.");
            }
        } else {
            bot.sendMessage(chatId, "⚠️ هذا الملف غير متاح حالياً.");
        }
        return;
    }

    // Handle Page buttons (prefixed with 'page_')
    if (data.startsWith('page_')) {
        const pageKey = data.substring(5); // Remove 'page_' prefix
        if (botData[pageKey]) {
            showPage(chatId, pageKey, messageId);
        } else {
            bot.editMessageText(
                "⚠️ هذه الصفحة غير متاحة حالياً.",
                { chat_id: chatId, message_id: messageId }
            ).catch(err => console.log('Edit message error (page not found):', err.message));
        }
        return;
    }

    // Handle Text buttons (prefixed with 'text_')
    if (data.startsWith('text_')) {
        const textContent = data.substring(5); // The actual text is after 'text_'
        bot.sendMessage(chatId, textContent); // Send the text directly
        return;
    }

    // Fallback for unknown callback_data (e.g., old buttons or corrupted data)
    bot.editMessageText(
        "⚠️ هذا الزر غير متاح حالياً أو غير معروف.",
        { chat_id: chatId, message_id: messageId }
    ).catch(err => console.log('Edit message error (unknown button):', err.message));
});

// --- Express API Routes ---

// Serve the admin dashboard HTML directly from the root directory
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Get Bot Statistics
app.get('/api/stats', (req, res) => {
    resetDailyStats(); // Ensure stats are up-to-date before sending

    const now = new Date();
    const uptimeMs = now.getTime() - stats.startDate.getTime();
    const uptimeMinutes = Math.floor(uptimeMs / (1000 * 60));

    res.json({
        users: stats.users.size,
        messages: stats.messages,
        pages: Object.keys(botData).length,
        files: Object.keys(filesData).length,
        todayUsers: stats.todayUsers.size,
        todayMessages: stats.todayMessages,
        topPage: Object.keys(botData)[0] || null, // Simple top page, could be improved with actual tracking
        uptime: uptimeMinutes
    });
});

// Get All Pages
app.get('/api/pages', (req, res) => {
    res.json(botData);
});

// Get a Specific Page
app.get('/api/pages/:pageId', (req, res) => {
    const pageId = req.params.pageId;
    const page = botData[pageId];

    if (!page) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }

    res.json(page);
});

// Add New Page
app.post('/api/pages', (req, res) => {
    const { pageId, pageData } = req.body;

    if (!pageId || !pageData || !pageData.title || !pageData.message) {
        return res.status(400).json({ error: 'معرف الصفحة والعنوان والرسالة مطلوبة' });
    }

    if (botData[pageId]) {
        return res.status(400).json({ error: 'معرف الصفحة هذا موجود بالفعل' });
    }

    const newPage = {
        title: pageData.title,
        message: pageData.message,
        buttons: pageData.buttons || []
    };

    botData[pageId] = newPage;
    saveData(); // Save changes
    res.json({ success: true, message: 'تم إضافة الصفحة بنجاح' });
});

// Update an Existing Page
app.put('/api/pages/:pageId', (req, res) => {
    const pageId = req.params.pageId;
    const pageData = req.body; // Can contain title, message, buttons

    if (!botData[pageId]) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }

    // Merge new data with existing page data
    botData[pageId] = { ...botData[pageId], ...pageData };
    saveData(); // Save changes
    res.json({ success: true, message: 'تم تحديث الصفحة بنجاح' });
});

// Delete a Page
app.delete('/api/pages/:pageId', (req, res) => {
    const pageId = req.params.pageId;

    if (!botData[pageId]) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }

    delete botData[pageId];
    saveData(); // Save changes
    res.json({ success: true, message: 'تم حذف الصفحة بنجاح' });
});

// Get Buttons for a Specific Page
app.get('/api/pages/:pageId/buttons', (req, res) => {
    const pageId = req.params.pageId;
    const page = botData[pageId];

    if (!page) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }

    res.json(page.buttons || []);
});

// Add a Button to a Page
app.post('/api/pages/:pageId/buttons', (req, res) => {
    const pageId = req.params.pageId;
    const { buttonData, rowIndex } = req.body;

    if (!botData[pageId]) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }
    if (!buttonData || !buttonData.text) {
        return res.status(400).json({ error: 'بيانات الزر مطلوبة (نص الزر على الأقل)' });
    }

    // Ensure callback_data/url fields are correctly set up by frontend,
    // and just store them as provided. The bot logic handles prefixes.

    if (!botData[pageId].buttons) {
        botData[pageId].buttons = [];
    }

    // If rowIndex is provided, try to add to an existing row
    // Otherwise, add to a new row (or the end if no rowIndex)
    const targetRow = rowIndex !== undefined ? parseInt(rowIndex) : botData[pageId].buttons.length;

    if (!botData[pageId].buttons[targetRow]) {
        botData[pageId].buttons[targetRow] = []; // Create new row if it doesn't exist
    }

    botData[pageId].buttons[targetRow].push(buttonData);
    saveData(); // Save changes
    res.json({ success: true, message: 'تم إضافة الزر بنجاح' });
});

// Delete a Button from a Page
app.delete('/api/pages/:pageId/buttons', (req, res) => {
    const pageId = req.params.pageId;
    const { rowIndex, buttonIndex } = req.body;

    if (!botData[pageId]) {
        return res.status(404).json({ error: 'الصفحة غير موجودة' });
    }
    if (!botData[pageId].buttons || !Array.isArray(botData[pageId].buttons[rowIndex])) {
        return res.status(404).json({ error: 'الصف أو الزر غير موجود' });
    }

    if (buttonIndex !== undefined && botData[pageId].buttons[rowIndex][buttonIndex]) {
        botData[pageId].buttons[rowIndex].splice(buttonIndex, 1); // Remove the button

        // If the row becomes empty, consider removing the row
        if (botData[pageId].buttons[rowIndex].length === 0) {
            botData[pageId].buttons.splice(rowIndex, 1);
        }
        saveData(); // Save changes
        return res.json({ success: true, message: 'تم حذف الزر بنجاح' });
    } else {
        return res.status(404).json({ error: 'الزر المحدد غير موجود' });
    }
});


// Get All Files
app.get('/api/files', (req, res) => {
    res.json(filesData);
});

// Multer storage for handling file uploads (in-memory buffer for Telegram upload)
const storage = multer.memoryStorage();
const uploadBuffer = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// Upload a New File
app.post('/api/upload', uploadBuffer.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم تحديد ملف' });
        }
        // Get admin chat ID from environment variables
        const adminChatId = process.env.ADMIN_CHAT_ID;
        if (!adminChatId || adminChatId === 'YOUR_ADMIN_CHAT_ID') { // Ensure you replace 'YOUR_ADMIN_CHAT_ID' placeholder in .env
            return res.status(400).json({ error: 'الرجاء توفير معرف دردشة المسؤول (ADMIN_CHAT_ID) في ملف .env لرفع الملفات.' });
        }

        // Send the file to the bot to get file_id
        let sentMessage;

        // Use an object to store common options
        const sendOptions = {
            caption: `ملف جديد: ${req.file.originalname}`,
            filename: req.file.originalname // Important for sendDocument
        };

        if (req.file.mimetype.startsWith('image/')) {
            sentMessage = await bot.sendPhoto(adminChatId, req.file.buffer, sendOptions);
        } else if (req.file.mimetype.startsWith('video/')) {
            sentMessage = await bot.sendVideo(adminChatId, req.file.buffer, sendOptions);
        } else if (req.file.mimetype.startsWith('audio/')) {
            sentMessage = await bot.sendAudio(adminChatId, req.file.buffer, sendOptions);
        } else {
            sentMessage = await bot.sendDocument(adminChatId, req.file.buffer, sendOptions);
        }

        // Extract file_id from the sent message response
        let fileId;
        if (sentMessage.photo) {
            // Photos come as an array of different sizes, get the largest one
            fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
        } else if (sentMessage.video) {
            fileId = sentMessage.video.file_id;
        } else if (sentMessage.audio) {
            fileId = sentMessage.audio.file_id;
        } else if (sentMessage.document) {
            fileId = sentMessage.document.file_id;
        }

        if (!fileId) {
            throw new Error("فشل الحصول على معرف الملف من تيليجرام.");
        }

        // Save file metadata
        const uniqueFileId = Date.now().toString(); // Use timestamp as a unique ID for our system
        const fileData = {
            id: uniqueFileId,
            name: req.file.originalname,
            type: req.file.mimetype,
            size: req.file.size,
            file_id: fileId, // This is the Telegram file_id
            uploadDate: new Date().toISOString()
        };

        filesData[fileData.id] = fileData;
        saveData(); // Save changes

        res.json({
            success: true,
            message: 'تم رفع الملف بنجاح',
            fileData: fileData
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: `حدث خطأ في رفع الملف: ${error.message}` });
    }
});

// Delete a File
app.delete('/api/files/:fileId', (req, res) => {
    const fileId = req.params.fileId;

    if (!filesData[fileId]) {
        return res.status(404).json({ error: 'الملف غير موجود' });
    }

    delete filesData[fileId];
    saveData(); // Save changes
    res.json({ success: true, message: 'تم حذف الملف بنجاح' });
});

// Preview File (returns metadata, not the file itself)
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

// Export Data
app.get('/api/export', (req, res) => {
    resetDailyStats(); // Ensure stats are fresh before export
    const exportData = {
        botData: botData,
        filesData: filesData,
        stats: {
            totalUsers: Array.from(stats.users), // Export as array
            totalMessages: stats.messages,
            startDate: stats.startDate.toISOString()
        },
        exportDate: new Date().toISOString()
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=bot-backup.json');
    res.json(exportData);
});

// Import Data
app.post('/api/import', uploadBuffer.single('backupFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم تحديد ملف النسخة الاحتياطية' });
        }

        const backupContent = req.file.buffer.toString();
        const backupData = JSON.parse(backupContent);

        if (backupData.botData) {
            botData = backupData.botData;
        }

        if (backupData.filesData) {
            filesData = backupData.filesData;
        }

        if (backupData.stats) {
            // Reconstruct Sets from imported arrays
            stats.users = new Set(backupData.stats.totalUsers || []);
            stats.messages = backupData.stats.totalMessages || 0;
            stats.startDate = backupData.stats.startDate ? new Date(backupData.stats.startDate) : new Date();
            // Preserve current daily stats or reset them
            stats.todayUsers = new Set(); // Reset for today after import
            stats.todayMessages = 0;
            stats.dailyReset = new Date().toDateString();
        }

        saveData(); // Save imported data to disk
        res.json({ success: true, message: 'تم استيراد البيانات بنجاح' });

    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ error: `حدث خطأ في استيراد البيانات: ${error.message}` });
    }
});

// Restart Bot Process
app.post('/api/restart', (req, res) => {
    res.json({ success: true, message: 'جاري إعادة تشغيل البوت...' });
    // Give client time to receive response then exit
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

// Clear All Data
app.post('/api/clear-all', (req, res) => {
    botData = {};
    filesData = {};

    stats = {
        users: new Set(),
        messages: 0,
        todayUsers: new Set(),
        todayMessages: 0,
        startDate: new Date(),
        dailyReset: new Date().toDateString()
    };

    saveData(); // Save cleared state
    res.json({ success: true, message: 'تم مسح جميع البيانات بنجاح' });
});

// Search Data
app.get('/api/search', (req, res) => {
    const query = req.query.q?.toLowerCase() || '';

    if (!query) {
        return res.json({ pages: [], files: [] });
    }

    // Search in Pages
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

    // Search in Files
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

// Get Activity Log
app.get('/api/activity-log', (req, res) => {
    // This is a simplified log. For a real app, you'd log events to a file/DB.
    const activities = [
        {
            id: 1,
            type: 'bot_start',
            description: 'تم تشغيل البوت',
            timestamp: stats.startDate.toISOString(),
            details: { status: 'active', initialUsers: stats.users.size }
        },
        {
            id: 2,
            type: 'current_stats',
            description: `إجمالي المستخدمين: ${stats.users.size}, إجمالي الرسائل: ${stats.messages}`,
            timestamp: new Date().toISOString(),
            details: {
                totalUsers: stats.users.size,
                totalMessages: stats.messages,
                pagesCount: Object.keys(botData).length,
                filesCount: Object.keys(filesData).length
            }
        }
        // You would add more specific logs here (e.g., page added, file uploaded)
        // by pushing to a separate array/database table when those events occur.
    ];

    res.json(activities);
});

// Get Detailed Stats
app.get('/api/detailed-stats', (req, res) => {
    resetDailyStats();

    const now = new Date();
    const uptimeMs = now.getTime() - stats.startDate.getTime();

    res.json({
        overview: {
            totalUsers: stats.users.size,
            totalMessages: stats.messages,
            totalPages: Object.keys(botData).length,
            totalFiles: Object.keys(filesData).length,
            uptime: {
                milliseconds: uptimeMs,
                seconds: Math.floor(uptimeMs / 1000),
                minutes: Math.floor(uptimeMs / (1000 * 60)),
                hours: Math.floor(uptimeMs / (1000 * 60 * 60)),
                days: Math.floor(uptimeMs / (1000 * 60 * 60 * 24))
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

// Get Bot Info from Telegram API
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
            error: `فشل في الحصول على معلومات البوت: ${error.message}`
        });
    }
});

// Set Bot Commands for Telegram
app.post('/api/bot-commands', async (req, res) => {
    try {
        const commands = [
            { command: 'start', description: 'بدء استخدام البوت' }
            // Add more commands here if you implement them
        ];

        await bot.setMyCommands(commands);

        res.json({
            success: true,
            message: 'تم تحديث أوامر البوت بنجاح'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `فشل في تحديث أوامر البوت: ${error.message}`
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
        // With webhooks, bot.isPolling() will always be false.
        // We rely on the webhook being set and Express server running.
        botWebhookSet: true // Indicate that webhook setup was attempted
    });
});

// --- Server Startup & Error Handling ---

// Load data, then start the server
loadData().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 البوت يعمل على البورت ${PORT}`);
        console.log(`📊 لوحة التحكم متاحة على: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT}`);
        console.log(`🤖 البوت متصل ويعمل بانتظار الرسائل...`);
        console.log(`📄 البوت يبدأ بـ ${Object.keys(botData).length} صفحات و ${Object.keys(filesData).length} ملفات.`);
        console.log('---');
        console.log('IMPORTANT: Ensure you have ADMIN_CHAT_ID set in your Render environment variables to upload files!');
    });
}).catch(err => {
    console.error('Failed to load initial data and start server:', err);
    process.exit(1); // Exit if initial data load fails
});

// General bot error handling
bot.on('error', (error) => {
    console.log('خطأ في البوت (Telegram API error):', error.message);
});

// Note: 'polling_error' will no longer occur as polling is disabled
// bot.on('polling_error', (error) => {
//     console.log('خطأ في الاتصال (polling error):', error.message);
// });

// Process error handling for robustness
process.on('uncaughtException', (error) => {
    console.error('خطأ غير متوقع (Uncaught Exception):', error);
    // In production, you might want to log this and restart gracefully
    process.exit(1); // Exit process after logging
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('رفض غير معالج (Unhandled Rejection) at:', promise, 'reason:', reason);
    // In production, you might want to log this but not necessarily exit
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('إيقاف البوت (SIGINT)...');
    try {
        await bot.deleteWebHook(); // Attempt to delete webhook on shutdown
        console.log('تم حذف الويب هوك بنجاح.');
    } catch (err) {
        console.error('فشل حذف الويب هوك:', err.message);
    } finally {
        process.exit(0);
    }
});

process.on('SIGTERM', async () => {
    console.log('إنهاء البوت (SIGTERM)...');
    try {
        await bot.deleteWebHook(); // Attempt to delete webhook on shutdown
        console.log('تم حذف الويب هوك بنجاح.');
    } catch (err) {
        console.error('فشل حذف الويب هوك:', err.message);
    } finally {
        process.exit(0);
    }
});
