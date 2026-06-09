const cluster = require('cluster');
const os = require('os');
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

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB) || 100;
const MAX_FILES = parseInt(process.env.MAX_FILES_PER_UPLOAD) || 20;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const COUPLE_NAME = process.env.COUPLE_NAME || 'Irina & Alexander';
const WEDDING_DATE = process.env.WEDDING_DATE || '26. Juni 2026';
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS || '';

if (cluster.isMaster) {
  const numCPUs = Math.min(os.cpus().length, 4);
  console.log(`Master ${process.pid} starting ${numCPUs} workers`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died, restarting`);
    cluster.fork();
  });
} else {

const CATEGORIES = {
  standesamt: 'Standesamtliche Trauung',
  kirche: 'Kirchliche Trauung',
  feier: 'Feier'
};

const app = express();

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
Object.keys(CATEGORIES).forEach(cat => {
  const catDir = path.join(UPLOAD_DIR, cat);
  if (!fs.existsSync(catDir)) {
    fs.mkdirSync(catDir, { recursive: true });
  }
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/fonts', express.static(path.join(__dirname, '..', 'frontend', 'fonts')));
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
  if (uploadRateLimit[ip].length >= 200) {
    return res.status(429).json({ success: false, error: 'Rate limit exceeded. Max 200 uploads per hour.' });
  }
  uploadRateLimit[ip].push(now);
  next();
}

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.webp', '.mp4', '.mov', '.webm'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let category = 'feier';
    if (req.body && req.body.category && CATEGORIES[req.body.category]) {
      category = req.body.category;
    }
    const catDir = path.join(UPLOAD_DIR, category);
    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }
    cb(null, catDir);
  },
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
    cb(new Error(`File type not allowed: ${file.originalname}. Allowed: jpg, jpeg, png, heic, webp, mp4, mov, webm`));
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
  const category = req.body.category || '';
  if (!CATEGORIES[category]) {
    return res.status(400).json({ success: false, error: 'Invalid category. Must be one of: standesamt, kirche, feier' });
  }
  const uploaderName = req.body.uploaderName || '';
  const catDir = path.join(UPLOAD_DIR, category);
  if (!fs.existsSync(catDir)) {
    fs.mkdirSync(catDir, { recursive: true });
  }
  const files = req.files.map(f => {
    const savedPath = f.path;
    const targetPath = path.join(catDir, f.filename);
    if (savedPath !== targetPath) {
      fs.renameSync(savedPath, targetPath);
    }
    return {
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
      url: `/uploads/${category}/${f.filename}`,
      uploadedAt: new Date().toISOString(),
      uploaderName,
      category
    };
  });
  res.json({ success: true, count: files.length, files, category: CATEGORIES[category] });
});

const CHUNK_SIZE = 10 * 1024 * 1024;
const CHUNK_DIR = path.join(UPLOAD_DIR, '.chunks');

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const fileId = req.body.fileId || 'unknown';
      const chunkDir = path.join(CHUNK_DIR, fileId);
      if (!fs.existsSync(chunkDir)) {
        fs.mkdirSync(chunkDir, { recursive: true });
      }
      cb(null, chunkDir);
    },
    filename: (req, file, cb) => {
      const chunkIndex = req.body.chunkIndex || '0';
      cb(null, String(chunkIndex));
    }
  }),
  limits: { fileSize: CHUNK_SIZE + 1024 }
});

app.post('/api/upload-chunk', checkUploadRate, chunkUpload.single('chunk'), (req, res) => {
  const { fileId, chunkIndex, totalChunks, filename, category } = req.body;
  if (!fileId || chunkIndex === undefined || !totalChunks || !filename || !category) {
    return res.status(400).json({ success: false, error: 'Missing chunk metadata' });
  }
  if (!CATEGORIES[category]) {
    return res.status(400).json({ success: false, error: 'Invalid category' });
  }
  const metaPath = path.join(CHUNK_DIR, fileId, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify({ filename, category, totalChunks: parseInt(totalChunks) }));
  }
  const chunkDir = path.join(CHUNK_DIR, fileId);
  const received = fs.readdirSync(chunkDir).filter(f => f !== 'meta.json' && f !== '.placeholder').length;
  res.json({ success: true, fileId, received, total: parseInt(totalChunks) });
});

app.post('/api/upload-finalize', (req, res) => {
  const { fileId } = req.body;
  if (!fileId) {
    return res.status(400).json({ success: false, error: 'Missing fileId' });
  }
  const chunkDir = path.join(CHUNK_DIR, fileId);
  if (!fs.existsSync(chunkDir)) {
    return res.status(400).json({ success: false, error: 'Chunk directory not found' });
  }
  const metaPath = path.join(chunkDir, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    return res.status(400).json({ success: false, error: 'Metadata not found' });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const { filename, category, totalChunks } = meta;

  const chunkFiles = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(chunkDir, String(i));
    if (!fs.existsSync(chunkPath)) {
      return res.status(400).json({ success: false, error: `Missing chunk ${i}` });
    }
    chunkFiles.push(chunkPath);
  }

  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    fs.rmSync(chunkDir, { recursive: true, force: true });
    return res.status(400).json({ success: false, error: 'File type not allowed' });
  }

  const catDir = path.join(UPLOAD_DIR, category);
  if (!fs.existsSync(catDir)) {
    fs.mkdirSync(catDir, { recursive: true });
  }
  const finalId = uuidv4();
  const finalPath = path.join(catDir, `${finalId}-${Date.now()}${ext}`);

  const writeStream = fs.createWriteStream(finalPath);
  chunkFiles.forEach(cf => {
    const data = fs.readFileSync(cf);
    writeStream.write(data);
  });
  writeStream.end();

  writeStream.on('finish', () => {
    fs.rmSync(chunkDir, { recursive: true, force: true });
    const stat = fs.statSync(finalPath);
    res.json({
      success: true,
      file: {
        filename: path.basename(finalPath),
        originalName: filename,
        size: stat.size,
        url: `/uploads/${category}/${path.basename(finalPath)}`,
        category
      }
    });
  });

  writeStream.on('error', (err) => {
    console.error('Finalize error:', err);
    res.status(500).json({ success: false, error: 'Failed to assemble file' });
  });
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

function getPhotosForCategory(cat) {
  const catDir = path.join(UPLOAD_DIR, cat);
  if (!fs.existsSync(catDir)) return [];
  const files = fs.readdirSync(catDir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ALLOWED_EXTENSIONS.includes(ext);
  });
  return files.map(f => {
    const stat = fs.statSync(path.join(catDir, f));
    return {
      filename: f,
      url: `/uploads/${cat}/${f}`,
      size: stat.size,
      uploadedAt: stat.mtime.toISOString(),
      category: cat
    };
  }).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

function getAllPhotos() {
  const result = {};
  let totalCount = 0;
  Object.keys(CATEGORIES).forEach(cat => {
    result[cat] = getPhotosForCategory(cat);
    totalCount += result[cat].length;
  });
  result._total = totalCount;
  return result;
}

app.get('/api/photos', (req, res) => {
  try {
    const cat = req.query.category;
    if (cat && CATEGORIES[cat]) {
      res.json(getPhotosForCategory(cat));
    } else {
      const all = getAllPhotos();
      res.json(all);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

app.get('/api/health', (req, res) => {
  try {
    let totalCount = 0;
    let totalSize = 0;
    const counts = {};
    Object.keys(CATEGORIES).forEach(cat => {
      const photos = getPhotosForCategory(cat);
      counts[cat] = photos.length;
      totalCount += photos.length;
      photos.forEach(p => totalSize += p.size);
    });
    const diskUsageMB = (totalSize / (1024 * 1024)).toFixed(2);
    res.json({ status: 'ok', photoCount: totalCount, diskUsage: `${diskUsageMB} MB`, categories: counts });
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
    const all = getAllPhotos();
    const total = all._total;
    let totalSize = 0;
    Object.keys(CATEGORIES).forEach(cat => {
      all[cat].forEach(p => totalSize += p.size);
    });
    const diskUsageMB = (totalSize / (1024 * 1024)).toFixed(2);

    let galleryHtml = '';
    Object.keys(CATEGORIES).forEach(cat => {
      const photos = all[cat];
      galleryHtml += `<h2 style="margin:30px 0 10px;font-size:20px;color:#8b6fb0">${CATEGORIES[cat]} (${photos.length})</h2>`;
      if (photos.length === 0) {
        galleryHtml += '<p style="color:#999;margin-bottom:20px">Noch keine Fotos.</p>';
      } else {
        galleryHtml += '<div class="grid">';
        photos.forEach(p => {
          const isVideo = /\.(mp4|mov|webm)$/i.test(p.url);
          const mediaTag = isVideo
            ? `<video src="${p.url}" preload="metadata" muted style="width:100%;height:180px;object-fit:cover"></video>`
            : `<img src="${p.url}" loading="lazy">`;
          galleryHtml += `<div class="card"><button class="del-btn" onclick="deletePhoto('${cat}','${p.filename}')">&times;</button>${mediaTag}<div class="card-info">${p.filename}<br>${(p.size/1024/1024).toFixed(2)} MB</div></div>`;
        });
        galleryHtml += '</div>';
      }
    });

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
.stat{background:#f0ebf5;padding:12px 20px;border-radius:8px;font-size:14px}
.stat strong{display:block;font-size:20px;color:#8b6fb0}
.actions{margin:20px 0}
.btn{display:inline-block;padding:12px 24px;background:#8b6fb0;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;text-decoration:none;margin-right:10px}
.btn:hover{background:#7a5ea0}
.btn-danger{background:#c0392b}
.btn-danger:hover{background:#a93226}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-top:10px}
.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);position:relative}
.card img{width:100%;height:180px;object-fit:cover}
.card-info{padding:10px;font-size:12px;color:#666}
.del-btn{position:absolute;top:8px;right:8px;width:28px;height:28px;background:rgba(192,57,43,0.85);color:#fff;border:none;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;z-index:2}
.del-btn:hover{background:#c0392b}
</style>
</head>
<body>
<div class="header">
<h1>Admin Panel - ${COUPLE_NAME}</h1>
<p>${WEDDING_DATE}</p>
<div class="stats">
<div class="stat"><strong>${total}</strong>Dateien gesamt</div>
<div class="stat"><strong>${diskUsageMB} MB</strong>Speicher</div>
${Object.keys(CATEGORIES).map(cat => `<div class="stat"><strong>${all[cat].length}</strong>${CATEGORIES[cat]}</div>`).join('')}
</div>
</div>
<div class="actions">
<a href="/admin/download-all" class="btn">Alle Fotos als ZIP</a>
<button class="btn btn-danger" onclick="if(confirm('Wirklich ALLE Fotos löschen?')){fetch('/admin/delete-all',{method:'POST'}).then(r=>r.json()).then(d=>{alert(d.message||'Fehlgeschlagen');location.reload()})}">Alle Fotos löschen</button>
<a href="/" class="btn">Zurück zur Webseite</a>
</div>
${galleryHtml}
<script>
function deletePhoto(cat,filename){
  if(!confirm('Foto wirklich löschen?'))return;
  fetch('/admin/photo/'+cat+'/'+filename,{method:'DELETE'})
    .then(r=>r.json())
    .then(d=>{alert(d.message||'Fehlgeschlagen');location.reload()})
    .catch(()=>alert('Fehler beim Löschen'));
}
</script>
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
    let totalFiles = 0;
    Object.keys(CATEGORIES).forEach(cat => {
      const catDir = path.join(UPLOAD_DIR, cat);
      if (fs.existsSync(catDir)) {
        totalFiles += fs.readdirSync(catDir).filter(f => ALLOWED_EXTENSIONS.includes(path.extname(f).toLowerCase())).length;
      }
    });
    if (totalFiles === 0) {
      return res.status(404).json({ error: 'No photos to download' });
    }
    const zipName = `hochzeit-fotos-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);
    Object.keys(CATEGORIES).forEach(cat => {
      const catDir = path.join(UPLOAD_DIR, cat);
      if (fs.existsSync(catDir)) {
        const files = fs.readdirSync(catDir).filter(f => ALLOWED_EXTENSIONS.includes(path.extname(f).toLowerCase()));
        files.forEach(f => {
          archive.file(path.join(catDir, f), { name: `${CATEGORIES[cat]}/${f}` });
        });
      }
    });
    archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create ZIP' });
  }
});

app.delete('/admin/photo/:category/:filename', basicAuth, (req, res) => {
  try {
    const { category, filename } = req.params;
    if (!CATEGORIES[category]) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    const safeName = path.basename(filename);
    if (!ALLOWED_EXTENSIONS.includes(path.extname(safeName).toLowerCase())) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    const filePath = path.join(UPLOAD_DIR, category, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    fs.unlinkSync(filePath);
    res.json({ success: true, message: `${safeName} gelöscht` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

app.post('/admin/delete-all', basicAuth, (req, res) => {
  try {
    let total = 0;
    Object.keys(CATEGORIES).forEach(cat => {
      const catDir = path.join(UPLOAD_DIR, cat);
      if (fs.existsSync(catDir)) {
        const files = fs.readdirSync(catDir).filter(f => ALLOWED_EXTENSIONS.includes(path.extname(f).toLowerCase()));
        files.forEach(f => fs.unlinkSync(path.join(catDir, f)));
        total += files.length;
      }
    });
    const rootFiles = fs.readdirSync(UPLOAD_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXTENSIONS.includes(ext);
    });
    rootFiles.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f)));
    total += rootFiles.length;
    res.json({ success: true, message: `${total} Fotos gelöscht` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete photos' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Worker ${process.pid} running on ${HOST}:${PORT}`);
  console.log(`Couple: ${COUPLE_NAME}`);
  console.log(`Upload directory: ${UPLOAD_DIR}`);
});

}
