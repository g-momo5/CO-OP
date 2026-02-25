# دليل التثبيت - Installation Guide

## متطلبات النظام - System Requirements

- **Node.js** (versione 16 أو أحدث / version 16 or higher)
- **npm** أو **yarn** (مدير الحزم / package manager)
- **macOS 10.14+** أو **Windows 10+** أو **Linux**

## خطوات التثبيت - Installation Steps

### 1. تثبيت Node.js
```bash
# تحميل وتثبيت Node.js من الموقع الرسمي
# Download and install Node.js from official website
# https://nodejs.org/
```

### 2. استنساخ المشروع
```bash
# Clone the project
git clone <repository-url>
cd coop2
```

### 3. تثبيت التبعيات
```bash
# Install dependencies
npm install
```

### 4. تشغيل التطبيق
```bash
# Run in development mode
npm run dev

# Run in production mode
npm start
```

## بناء التطبيق - Building the Application

### لـ macOS
```bash
npm run build-mac
```

### لـ Windows
```bash
npm run build-win
```

### لـ Linux
```bash
npm run build-linux
```

## استكشاف الأخطاء - Troubleshooting

### مشكلة: "electron: command not found"
**الحل:** تأكد من تثبيت التبعيات بشكل صحيح
```bash
npm install
```

### مشكلة: خطأ في قاعدة البيانات
**الحل:** احذف ملف قاعدة البيانات وأعد تشغيل التطبيق
```bash
rm coop_database.db
npm start
```

### مشكلة: خطأ في الرسوم البيانية
**الحل:** تأكد من اتصال الإنترنت لتحميل Chart.js

## الميزات - Features

✅ **إدارة الفواتير** - Invoice Management
✅ **الرسوم البيانية** - Charts & Analytics
✅ **التقارير** - Reports
✅ **إدارة الأسعار** - Price Management
✅ **تصدير PDF** - PDF Export
✅ **دعم العربية** - Arabic Support
✅ **تصميم متجاوب** - Responsive Design

## الدعم - Support

للمساعدة التقنية، يرجى التواصل مع فريق التطوير.
For technical support, please contact the development team.

---

**تم تطوير هذا النظام بواسطة فريق الجمعية التعاونية للبترول**
**Developed by the Petroleum Cooperative Society Team**
