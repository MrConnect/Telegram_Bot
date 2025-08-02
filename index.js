const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, {polling: true});
const app = express();
const PORT = process.env.PORT || 3000;

// إعداد Express
app.use(express.static('public'));
app.use(express.json());

// بيانات البوت (ستكون في ملف منفصل لاحقاً)
const botData = {
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

// File IDs - هنا هتحط File IDs الملفات بتاعتك
const fileIds = {
  photo_1: "YOUR_PHOTO_1_FILE_ID",
  photo_2: "YOUR_PHOTO_2_FILE_ID", 
  doc_catalog: "YOUR_DOC_1_FILE_ID",
  doc_prices: "YOUR_DOC_2_FILE_ID",
  video_1: "YOUR_VIDEO_1_FILE_ID",
  video_2: "YOUR_VIDEO_2_FILE_ID"
};

// إحصائيات بسيطة
let stats = {
  users: new Set(),
  messages: 0,
  startDate: new Date()
};

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
    // تحديث الرسالة الموجودة
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: options.reply_markup
    }).catch(err => console.log('Edit message error:', err.message));
  } else {
    // إرسال رسالة جديدة
    bot.sendMessage(chatId, message, options);
  }
}

// أمر البداية
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  stats.users.add(chatId);
  stats.messages++;
  
  showPage(chatId, 'main_page');
});

// معالجة الأزرار
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.callback_data;
  
  stats.messages++;
  
  // الرد على الاستعلام لإزالة loading
  bot.answerCallbackQuery(query.id);
  
  // التعامل مع الملفات
  if (fileIds[data] && fileIds[data] !== `YOUR_${data.toUpperCase()}_FILE_ID`) {
    // إرسال الملف حسب نوعه
    if (data.startsWith('photo_')) {
      bot.sendPhoto(chatId, fileIds[data]);
    } else if (data.startsWith('doc_')) {
      bot.sendDocument(chatId, fileIds[data]);
    } else if (data.startsWith('video_')) {
      bot.sendVideo(chatId, fileIds[data]);
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

// صفحة الإدارة
app.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - stats.startDate.getTime()) / 1000 / 60); // دقائق
  
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>لوحة تحكم البوت</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
            .stat-card { background: #4CAF50; color: white; padding: 20px; border-radius: 8px; text-align: center; }
            .stat-number { font-size: 2em; font-weight: bold; }
            .stat-label { margin-top: 5px; }
            h1 { color: #333; text-align: center; }
            .info { background: #e3f2fd; padding: 15px; border-radius: 5px; margin: 15px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 لوحة تحكم البوت</h1>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-number">${stats.users.size}</div>
                    <div class="stat-label">المستخدمين</div>
                </div>
                <div class="stat-card" style="background: #2196F3;">
                    <div class="stat-number">${stats.messages}</div>
                    <div class="stat-label">الرسائل</div>
                </div>
                <div class="stat-card" style="background: #FF9800;">
                    <div class="stat-number">${uptime}</div>
                    <div class="stat-label">دقيقة تشغيل</div>
                </div>
            </div>
            
            <div class="info">
                <h3>📊 معلومات النظام:</h3>
                <p><strong>تاريخ التشغيل:</strong> ${stats.startDate.toLocaleString('ar-EG')}</p>
                <p><strong>حالة البوت:</strong> <span style="color: green;">✅ يعمل</span></p>
                <p><strong>المنصة:</strong> Render.com</p>
            </div>
            
            <div class="info">
                <h3>📝 ملاحظات:</h3>
                <ul>
                    <li>لتحديث File IDs، عدل ملف index.js في GitHub</li>
                    <li>البوت يدعم الصور والمستندات والفيديوهات</li>
                    <li>الإحصائيات تعيد التشغيل مع كل نشر جديد</li>
                </ul>
            </div>
        </div>
    </body>
    </html>
  `);
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 البوت يعمل على البورت ${PORT}`);
  console.log(`📊 لوحة التحكم متاحة على: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT}`);
});

// معالجة الأخطاء
bot.on('error', (error) => {
  console.log('خطأ في البوت:', error.message);
});

process.on('uncaughtException', (error) => {
  console.log('خطأ غير متوقع:', error.message);
});

process.on('unhandledRejection', (error) => {
  console.log('رفض غير معالج:', error.message);
});
