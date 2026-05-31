const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const cors = require('cors');
const dotenv = require('dotenv');
const archiver = require('archiver');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB) || 20;
const MAX_FILES = parseInt(process.env.MAX_FILES_PER_UPLOAD) || 20;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const COUPLE_NAME = process.env.COUPLE_NAME || 'Irina & Alexander';
const WEDDING_DATE = process.env.WEDDING_DATE || '26. Juni 2026';
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS || '';

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

if (ALLOWED_ORIGINS) {
  const origins = ALLOWED_ORIGINS.split(',').map(o => o.trim());
  app.use(cors({ origin: origins }));
}

const uploadRateLimit = {};
function checkUploadRate(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!uploadRateLimit[ip]) {
    uploadRateLimit[ip] = [];
  }
  uploadRateLimit[ip] = uploadRateLimit[ip].filter(t => now - t < 3600000);
  if (uploadRateLimit[ip].length >= 50) {
    return res.status(429).json({ success: false, error: 'Rate limit exceeded. Max 50 uploads per hour.' });
  }
  uploadRateLimit[ip].push(now);
  next();
}

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.webp'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : '.jpg';
    const timestamp = Date.now();
    const id = uuidv4();
    cb(null, `${id}-${timestamp}${safeExt}`);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = ALLOWED_TYPES.includes(file.mimetype);
  const extOk = ALLOWED_EXTENSIONS.includes(ext);
  if (mimeOk || extOk) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.originalname}. Allowed: jpg, jpeg, png, heic, webp`));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES
  }
});

app.post('/api/upload', checkUploadRate, upload.array('files[]', MAX_FILES), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, error: 'No files uploaded' });
  }
  const uploaderName = req.body.uploaderName || '';
  const files = req.files.map(f => ({
    filename: f.filename,
    originalName: f.originalname,
    size: f.size,
    url: `/uploads/${f.filename}`,
    uploadedAt: new Date().toISOString(),
    uploaderName
  }));
  res.json({ success: true, count: files.length, files });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: `File too large. Max ${MAX_FILE_SIZE_MB}MB per file.` });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, error: `Too many files. Max ${MAX_FILES} per upload.` });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err.message && err.message.includes('File type not allowed')) {
    return res.status(400).json({ success: false, error: err.message });
  }
  console.error(err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.get('/api/photos', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXTENSIONS.includes(ext);
    });
    const photos = files.map(f => {
      const stat = fs.statSync(path.join(UPLOAD_DIR, f));
      return {
        filename: f,
        url: `/uploads/${f}`,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString()
      };
    }).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json(photos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

app.get('/api/health', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXTENSIONS.includes(ext);
    });
    let totalSize = 0;
    files.forEach(f => {
      totalSize += fs.statSync(path.join(UPLOAD_DIR, f)).size;
    });
    const diskUsageMB = (totalSize / (1024 * 1024)).toFixed(2);
    res.json({ status: 'ok', photoCount: files.length, diskUsage: `${diskUsageMB} MB` });
  } catch (err) {
    res.json({ status: 'ok', photoCount: 0, diskUsage: '0 MB' });
  }
});

function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }
  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [, password] = credentials.split(':');
  if (password === ADMIN_PASSWORD) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
  return res.status(401).send('Invalid password');
}

app.get('/admin', basicAuth, (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXTENSIONS.includes(ext);
    });
    let totalSize = 0;
    const photos = files.map(f => {
      const stat = fs.statSync(path.join(UPLOAD_DIR, f));
      totalSize += stat.size;
      return {
        filename: f,
        url: `/uploads/${f}`,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString()
      };
    }).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    const diskUsageMB = (totalSize / (1024 * 1024)).toFixed(2);

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin - ${COUPLE_NAME}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333;padding:20px}
.header{background:#fff;padding:20px;border-radius:12px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
.header h1{font-size:24px;margin-bottom:8px}
.stats{display:flex;gap:20px;margin-top:12px;flex-wrap:wrap}
.stat{background:#f8f0f0;padding:12px 20px;border-radius:8px;font-size:14px}
.stat strong{display:block;font-size:20px;color:#b07878}
.actions{margin:20px 0}
.btn{display:inline-block;padding:12px 24px;background:#b07878;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;text-decoration:none;margin-right:10px}
.btn:hover{background:#967070}
.btn-danger{background:#c0392b}
.btn-danger:hover{background:#a93226}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-top:20px}
.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
.card img{width:100%;height:180px;object-fit:cover}
.card-info{padding:10px;font-size:12px;color:#666}
</style>
</head>
<body>
<div class="header">
<h1>Admin Panel - ${COUPLE_NAME}</h1>
<p>${WEDDING_DATE}</p>
<div class="stats">
<div class="stat"><strong>${photos.length}</strong>Fotos</div>
<div class="stat"><strong>${diskUsageMB} MB</strong>Speicher</div>
</div>
</div>
<div class="actions">
<a href="/admin/download-all" class="btn">Alle Fotos als ZIP herunterladen</a>
<button class="btn btn-danger" onclick="if(confirm('Wirklich ALLE Fotos löschen?')){fetch('/admin/delete-all',{method:'POST'}).then(r=>r.json()).then(d=>{alert(d.message||'Fehlgeschlagen');location.reload()})}">Alle Fotos löschen</button>
<a href="/" class="btn">Zurück zur Webseite</a>
</div>
<div class="grid">
${photos.map(p => `<div class="card"><img src="${p.url}" loading="lazy"><div class="card-info">${p.filename}<br>${(p.size/1024/1024).toFixed(2)} MB</div></div>`).join('')}
</div>
</body>
</html>`;
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading admin page');
  }
});

app.get('/admin/download-all', basicAuth, (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXTENSIONS.includes(ext);
    });
    if (files.length === 0) {
      return res.status(404).json({ error: 'No photos to download' });
    }
    const zipName = `hochzeit-fotos-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);
    files.forEach(f => {
      const filePath = path.join(UPLOAD_DIR, f);
      archive.file(filePath, { name: f });
    });
    archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create ZIP' });
  }
});

app.post('/admin/delete-all', basicAuth, (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXTENSIONS.includes(ext);
    });
    files.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f)));
    res.json({ success: true, message: `${files.length} Fotos gelöscht` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete photos' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wedding Photos server running on port ${PORT}`);
  console.log(`Couple: ${COUPLE_NAME}`);
  console.log(`Upload directory: ${UPLOAD_DIR}`);
});
