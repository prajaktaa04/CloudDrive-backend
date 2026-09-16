const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const { requireAuth } = require('./middleware/auth');
const errorHandler = require('./middleware/error');
const authRoutes = require('./routes/auth');
const folderRoutes = require('./routes/folders');
const fileRoutes = require('./routes/files');
const shareRoutes = require('./routes/shares');
const linkRoutes = require('./routes/links');
const searchRoutes = require('./routes/search');
const starRoutes = require('./routes/stars');
const trashRoutes = require('./routes/trash');
const sharedRoutes = require('./routes/shared');

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const limiter = rateLimit({ windowMs: 5 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);
app.get('/', (_req, res) => res.json({ ok: true, service: 'cloud-drive-api' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'cloud-drive-api' }));
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/public', linkRoutes);

app.use('/api/folders', requireAuth, folderRoutes);
app.use('/api/files', requireAuth, fileRoutes);
app.use('/api/shares', requireAuth, shareRoutes);
app.use('/api/link-shares', requireAuth, linkRoutes);
app.use('/api/search', requireAuth, searchRoutes);
app.use('/api/stars', requireAuth, starRoutes);
app.use('/api/trash', requireAuth, trashRoutes);
app.use('/api/shared', requireAuth, sharedRoutes);

app.use(errorHandler);
app.listen(env.port, () => console.log(`Cloud Drive API running on http://localhost:${env.port}`));
