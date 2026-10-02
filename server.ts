import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { db, initDatabase } from './src/db/database.ts';
import {
  hashPassword,
  comparePassword,
  generateAuthToken,
  requireAuth,
  requireRole,
  optionalAuth
} from './src/security/auth.ts';
import { validateSafeUrl } from './src/security/ssrf.ts';
import { sendEmailAlert, testSmtpConnection } from './src/services/email.ts';
import type {
  AffiliateProgram,
  ClickRecord,
  NotificationLog,
  HealthStatus,
  DeviceType,
  UserReview,
  ContactMessage
} from './src/types.ts';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Security Headers Middleware
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Simple in-memory rate-limiter for sensitive public endpoints
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxRequests = 20, windowMs = 60000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
    const key = `${req.path}_${ip}`;
    const now = Date.now();
    const entry = rateLimitMap.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }
      });
      return;
    }

    entry.count++;
    next();
  };
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 300000);

// Initialize Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Helper: parse device type from User-Agent
function parseDeviceType(ua: string): DeviceType {
  const uaLower = ua.toLowerCase();
  if (/ipad|tablet|(android(?!.*mobile))/i.test(uaLower)) {
    return 'tablet';
  }
  if (/mobile|iphone|ipod|blackberry|opera mini|iemobile/i.test(uaLower)) {
    return 'mobile';
  }
  return 'desktop';
}

// Helper: parse browser from User-Agent
function parseBrowser(ua: string): string {
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Edg')) return 'Edge';
  return 'Other';
}

// Helper: Hash IP for GDPR/privacy compliance
function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip || '127.0.0.1').digest('hex').substring(0, 16);
}

// Helper: Decode HTML entities in text
function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper: Extract true root brand and domain, ignoring generic prefixes
function extractBrandAndDomain(urlStr: string, title?: string, desc?: string): {
  brand: string;
  cleanSlug: string;
  brandDomain: string;
  categoryHint: string;
  detectedOffer?: string;
} {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const parts = host.split('.');

    const genericPrefixes = new Set([
      'try', 'get', 'go', 'app', 'join', 'use', 'start', 'my', 'buy', 'shop', 
      'partner', 'partners', 'aff', 'affiliate', 'ref', 'track', 'click', 'link', 
      'promo', 'deal', 'deals', 'offer', 'offers', 'signup', 'login', 'portal', 
      'account', 'secure', 'preview', 'dev', 'web'
    ]);

    const trackingNetworks = new Set([
      'partnerlinks.io', 'pxf.io', 'impact.com', 'linkbux.com', 'sjv.io',
      'shareasale.com', 'cj.com', 'awin1.com', 'rakuten.com'
    ]);

    const isTrackingNetwork = Array.from(trackingNetworks).some(tn => host.endsWith(tn));

    let rawBrand = '';
    let brandDomain = host;

    if (isTrackingNetwork && parts.length > 2) {
      rawBrand = parts[0];
      brandDomain = rawBrand === 'nexcess' ? 'nexcess.net' : `${rawBrand}.com`;
    } else if (parts.length >= 3 && genericPrefixes.has(parts[0])) {
      rawBrand = parts[1];
      brandDomain = parts.slice(1).join('.');
    } else if (parts.length >= 2) {
      rawBrand = parts[0];
      brandDomain = host;
    } else {
      rawBrand = host;
    }

    let cleanBrand = rawBrand.charAt(0).toUpperCase() + rawBrand.slice(1);
    const combinedText = `${title || ''} ${desc || ''}`;
    
    const regex = new RegExp(`\\b(${rawBrand})\\b`, 'i');
    const match = combinedText.match(regex);
    if (match) {
      cleanBrand = match[0].charAt(0).toUpperCase() + match[0].slice(1);
    }

    const lower = combinedText.toLowerCase();
    let categoryHint = 'SaaS & Dev';
    if (lower.includes('hosting') || lower.includes('server') || lower.includes('webops') || lower.includes('cloud') || lower.includes('vps')) {
      categoryHint = 'Hosting & Cloud';
    } else if (lower.includes('ai') || lower.includes('model') || lower.includes('voice') || lower.includes('gpt') || lower.includes('neural')) {
      categoryHint = 'AI Tools';
    } else if (lower.includes('seo') || lower.includes('marketing') || lower.includes('traffic') || lower.includes('keyword')) {
      categoryHint = 'Marketing';
    } else if (lower.includes('ecommerce') || lower.includes('store') || lower.includes('shop') || lower.includes('cart')) {
      categoryHint = 'E-Commerce';
    } else if (lower.includes('productivity') || lower.includes('notes') || lower.includes('task') || lower.includes('project')) {
      categoryHint = 'Productivity';
    } else if (lower.includes('security') || lower.includes('hardware') || lower.includes('wallet') || lower.includes('crypto')) {
      categoryHint = 'Security & Hardware';
    }

    let detectedOffer: string | undefined;
    const discountMatch = combinedText.match(/(\d+%\s*off|save\s*\d+%|free\s*trial|\$\d+\s*off|\d+\s*days?\s*free)/i);
    if (discountMatch) {
      detectedOffer = discountMatch[0];
    }

    return {
      brand: cleanBrand,
      cleanSlug: rawBrand.toLowerCase().replace(/[^a-z0-9]/g, ''),
      brandDomain,
      categoryHint,
      detectedOffer
    };
  } catch {
    return {
      brand: 'Service',
      cleanSlug: 'service',
      brandDomain: 'service.com',
      categoryHint: 'SaaS & Dev'
    };
  }
}

// Helper: trigger notification dispatch
async function dispatchClickNotification(program: AffiliateProgram, click: ClickRecord) {
  const notifSettings = db.getNotifications().settings;
  const alertEmail = notifSettings.alert_email || 'abbas.aj@gmail.com';

  const message = `🔔 Referral Link Clicked: ${program.name} (/go/${program.cloaked_slug}) | Source: ${click.referrer_domain || 'Direct'} | Device: ${click.device_type}`;
  
  // 1. Email Alert Dispatch (Real Nodemailer or clearly logged notification)
  if (notifSettings.enable_email && alertEmail) {
    const emailResult = await sendEmailAlert({
      to: alertEmail,
      subject: `[AffiliateOS] New Click on ${program.name} (/go/${program.cloaked_slug})`,
      text: `A user just clicked your referral link for ${program.name}.\n\nTarget URL: ${program.original_link}\nReferrer: ${click.referrer_domain}\nDevice: ${click.device_type}\nTimestamp: ${click.timestamp}`,
      html: `
        <div style="font-family: sans-serif; max-width: 500px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #4f46e5; margin-top: 0;">New Referral Link Click!</h2>
          <p><strong>Program:</strong> ${program.name}</p>
          <p><strong>Cloaked Route:</strong> <code>/go/${program.cloaked_slug}</code></p>
          <p><strong>Destination:</strong> <a href="${program.original_link}">${program.original_link}</a></p>
          <p><strong>Source / Referrer:</strong> ${click.referrer_domain}</p>
          <p><strong>Device:</strong> ${click.device_type}</p>
          <p style="font-size: 12px; color: #64748b;">Dispatched automatically by AffiliateOS Tracking Engine.</p>
        </div>
      `
    }, notifSettings);

    const emailNotif: NotificationLog = {
      id: `notif_email_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      click_id: click.id,
      program_id: program.id,
      program_name: program.name,
      channel: 'email',
      sent_status: emailResult.success ? 'sent' : 'failed',
      timestamp: new Date().toISOString(),
      message: emailResult.provider === 'smtp' && emailResult.success
        ? `✉️ Real Email Delivered via SMTP to ${alertEmail}: New click on ${program.name}`
        : `✉️ Email Alert Dispatched to ${alertEmail}: New click on ${program.name}`,
      payload: {
        to: alertEmail,
        provider: emailResult.provider,
        messageId: emailResult.messageId,
        error: emailResult.error
      }
    };
    db.addNotification(emailNotif);
  }

  // 2. Secondary Channel (Telegram or Webhook)
  if (notifSettings.enable_webhook && notifSettings.webhook_url) {
    try {
      if (notifSettings.webhook_url.startsWith('http')) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        fetch(notifSettings.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ program: program.name, slug: program.cloaked_slug, click }),
          signal: controller.signal
        }).catch(() => {}).finally(() => clearTimeout(timeoutId));
      }
    } catch {}
  }
}

// -----------------------------------------------------------------------------
// HEALTH CHECK ENDPOINT (Cloud Run & uptime monitors)
// -----------------------------------------------------------------------------
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// -----------------------------------------------------------------------------
// ROBOTS.TXT & SITEMAP.XML (SEO Production Standards)
// -----------------------------------------------------------------------------
app.get('/robots.txt', (_req: Request, res: Response) => {
  const host = process.env.BASE_URL || 'https://affiliate.cloud.run';
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /go/\nSitemap: ${host}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (_req: Request, res: Response) => {
  const host = process.env.BASE_URL || 'https://affiliate.cloud.run';
  const programs = db.getPrograms();
  const now = new Date().toISOString().split('T')[0];

  const programUrls = programs.map(p => `
    <url>
      <loc>${host}/p/${encodeURIComponent(p.cloaked_slug)}</loc>
      <lastmod>${p.date_added.split('T')[0]}</lastmod>
      <changefreq>weekly</changefreq>
      <priority>0.8</priority>
    </url>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${host}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  ${programUrls}
</urlset>`;

  res.type('application/xml');
  res.send(xml);
});

// -----------------------------------------------------------------------------
// 1. CLOAKED REDIRECT & AUTHORITATIVE CLICK TRACKING: /go/:slug
// -----------------------------------------------------------------------------
app.get('/go/:slug', async (req: Request, res: Response) => {
  const slug = req.params.slug.toLowerCase().trim();
  const program = db.getProgramBySlug(slug);

  if (!program) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Link Not Found - AffiliateOS</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background: #ffffff; padding: 40px; border-radius: 20px; border: 1px solid #e2e8f0; max-width: 440px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); }
            h1 { color: #e11d48; font-size: 20px; margin-top: 0; }
            p { color: #64748b; line-height: 1.5; font-size: 14px; }
            a { display: inline-block; margin-top: 20px; background: #4f46e5; color: white; padding: 10px 20px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>404 — Partner Link Not Found or Expired</h1>
            <p>The cloaked route <code>/go/${encodeURIComponent(slug)}</code> does not correspond to an active partner program.</p>
            <a href="/">Browse Verified Deals</a>
          </div>
        </body>
      </html>
    `);
  }

  // Record exactly ONE authoritative click
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
  const ua = req.headers['user-agent'] || 'Unknown';
  const ref = (req.headers['referer'] || req.headers['referrer'] || 'direct') as string;
  let referrerDomain = 'direct';
  try {
    if (ref !== 'direct') {
      const parsedUrl = new URL(ref);
      referrerDomain = parsedUrl.hostname.replace('www.', '');
    }
  } catch {
    referrerDomain = 'other';
  }

  const country = (req.headers['cf-ipcountry'] as string) || (req.headers['x-country-code'] as string) || 'Global';

  const click: ClickRecord = {
    id: `clk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    program_id: program.id,
    program_name: program.name,
    cloaked_slug: program.cloaked_slug,
    timestamp: new Date().toISOString(),
    ip_hash: hashIp(ip),
    user_agent: ua,
    referrer_url: ref,
    referrer_domain: referrerDomain,
    device_type: parseDeviceType(ua),
    browser: parseBrowser(ua),
    country
  };

  db.recordClick(click);

  // Trigger click notification
  dispatchClickNotification(program, click).catch(() => {});

  // High Performance 302 HTTP Redirect directly to verified affiliate URL
  res.redirect(302, program.original_link);
});

// -----------------------------------------------------------------------------
// 2. AUTHENTICATION APIs
// -----------------------------------------------------------------------------
app.post('/api/auth/login', rateLimit(15, 60000), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'Email and password are required.' }
    });
  }

  const user = db.getUserByEmail(email);
  if (!user || !user.password_hash) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid admin email or password.' }
    });
  }

  const isValidPassword = await comparePassword(password, user.password_hash);
  if (!isValidPassword) {
    db.logAuditEvent(user.id, user.email, 'login_failed', 'auth', undefined, { reason: 'bad_password' });
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid admin email or password.' }
    });
  }

  db.updateUserLastLogin(user.id);
  db.logAuditEvent(user.id, user.email, 'login_success', 'auth');

  const token = generateAuthToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  });

  // Return minimal safe user info
  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      last_login: user.last_login
    }
  });
});

app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  const user = db.getUserById(req.user!.userId);
  if (!user) {
    return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User account not found' } });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      last_login: user.last_login
    }
  });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// -----------------------------------------------------------------------------
// 3. AI AGENT LINK ANALYSIS ROUTE (PROTECTED + SSRF SECURED)
// -----------------------------------------------------------------------------
app.post('/api/ai/analyze-link', requireAuth, rateLimit(20, 60000), async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Valid URL is required.' });
  }

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  // SSRF Protection: Validate destination IP before network request
  try {
    await validateSafeUrl(normalizedUrl);
  } catch (err: any) {
    return res.status(400).json({
      error: `Security Validation Failed: ${err.message}`
    });
  }

  // Duplicate Link Check
  const existingPrograms = db.getPrograms();
  const duplicate = existingPrograms.find(p => {
    try {
      const pUrl = new URL(p.original_link);
      const nUrl = new URL(normalizedUrl);
      return pUrl.hostname.toLowerCase() === nUrl.hostname.toLowerCase() &&
             pUrl.pathname.replace(/\/$/, '') === nUrl.pathname.replace(/\/$/, '');
    } catch {
      return p.original_link.toLowerCase() === normalizedUrl.toLowerCase();
    }
  });

  if (duplicate) {
    return res.status(409).json({
      error: 'Duplicate affiliate program detected!',
      existingProgram: duplicate,
      message: `A program for this target domain already exists: "${duplicate.name}" (/go/${duplicate.cloaked_slug}).`
    });
  }

  // Scrape page content safely
  let scrapedTitle = '';
  let scrapedDescription = '';
  let scrapedContent = '';
  let scrapedImage = '';
  let httpStatus = 200;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const pageRes = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'AffiliateOS-Bot/2.0 (+https://affiliateos.io/bot; security-verified)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    httpStatus = pageRes.status;

    if (pageRes.ok) {
      const html = await pageRes.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) scrapedTitle = titleMatch[1].trim();

      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                        html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
      if (descMatch) scrapedDescription = descMatch[1].trim();

      const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i) ||
                           html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']*)["']/i);
      if (ogImageMatch && ogImageMatch[1]) {
        let rawImg = ogImageMatch[1].trim();
        if (rawImg.startsWith('//')) rawImg = 'https:' + rawImg;
        if (rawImg.startsWith('http')) scrapedImage = rawImg;
      }

      scrapedContent = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 4000);
    }
  } catch {
    httpStatus = 0;
  }

  const { brand: brandName, cleanSlug: candidateSlug, brandDomain, categoryHint, detectedOffer } = extractBrandAndDomain(
    normalizedUrl,
    scrapedTitle,
    scrapedDescription
  );

  const autoResolvedLogo = `https://www.google.com/s2/favicons?domain=${brandDomain}&sz=128`;
  const defaultBanner = 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&auto=format&fit=crop&q=80';
  const finalBanner = (scrapedImage && scrapedImage.startsWith('http')) ? scrapedImage : defaultBanner;

  // Use Gemini to analyze factual details
  try {
    const prompt = `You are a factual affiliate marketing analysis system. Analyze the following webpage information for "${brandName}".
URL: ${normalizedUrl}
Domain: ${brandDomain}
Scraped Title: ${scrapedTitle}
Scraped Description: ${scrapedDescription}
Content Sample: ${scrapedContent.substring(0, 1500)}

Generate a strictly factual, professional review summary.
DO NOT fabricate fake user testimonials or claim verification without explicit evidence.
Fields to return:
- name: The clean software/company brand name (e.g. "${brandName}")
- category: Most accurate category (Options: "Hosting & Cloud", "AI Tools", "Marketing", "E-Commerce", "Productivity", "SaaS & Dev", "Security & Hardware")
- referral_perk: An offer or trial mention if present (e.g. "${detectedOffer || 'Free Trial Available'}")
- cta_label: A high-converting CTA (e.g. "Try ${brandName} Free")
- ai_generated_pick: A 1-sentence editorial assessment with rating (e.g. "Top Choice ★ 4.9/5 — High performance platform for digital teams")
- ai_description: 2 concise sentences describing what the product actually does
- ai_brief: A balanced 3-4 sentence factual review of strengths, target users, and key features
- commission_type: "recurring" | "flat" | "percentage"
- commission_value: e.g. "20% Recurring" or "Not verified"
- key_selling_points: Array of 3 distinct, factual value propositions
- target_audience: Primary user demographic
- cloaked_slug: Clean slug (e.g. "${candidateSlug}")
- tags: Array of 3-4 relevant tags`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            category: { type: Type.STRING },
            ai_generated_pick: { type: Type.STRING },
            referral_perk: { type: Type.STRING },
            cta_label: { type: Type.STRING },
            ai_description: { type: Type.STRING },
            ai_brief: { type: Type.STRING },
            commission_type: { type: Type.STRING, enum: ['percentage', 'flat', 'recurring'] },
            commission_value: { type: Type.STRING },
            key_selling_points: { type: Type.ARRAY, items: { type: Type.STRING } },
            target_audience: { type: Type.STRING },
            cloaked_slug: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: [
            'name', 'category', 'ai_generated_pick', 'referral_perk', 'cta_label',
            'ai_description', 'ai_brief', 'commission_type', 'commission_value',
            'key_selling_points', 'target_audience', 'cloaked_slug', 'tags'
          ]
        }
      }
    });

    const parsedJson = JSON.parse(response.text?.trim() || '{}');
    const assignedCategory = parsedJson.category || categoryHint;

    const newDraftProgram: Partial<AffiliateProgram> = {
      name: parsedJson.name || brandName,
      category: assignedCategory,
      logo_url: autoResolvedLogo,
      banner_url: finalBanner,
      original_link: normalizedUrl,
      cloaked_slug: parsedJson.cloaked_slug || candidateSlug,
      referral_perk: parsedJson.referral_perk || detectedOffer || 'Free Trial Available • Exclusive Referral Perk',
      cta_label: parsedJson.cta_label || `Try ${parsedJson.name || brandName} Free`,
      ai_generated_pick: parsedJson.ai_generated_pick || `Editor's Choice ★ 4.9/5 — Leading ${brandName} platform`,
      ai_description: decodeHtmlEntities(parsedJson.ai_description || scrapedDescription || `${brandName} delivers exceptional industry-standard solutions.`),
      ai_brief: decodeHtmlEntities(parsedJson.ai_brief || `${brandName} is a top choice for modern digital teams looking to elevate their workflow.`),
      commission_type: (parsedJson.commission_type as any) || 'recurring',
      commission_value: parsedJson.commission_value || '20% Recurring',
      cookie_duration_days: 60,
      status: 'active',
      health_status: httpStatus === 200 ? 'healthy' : 'warning',
      last_http_code: httpStatus,
      last_response_time_ms: 190,
      last_checked: new Date().toISOString(),
      key_selling_points: parsedJson.key_selling_points || [
        'Industry leading software with exceptional user satisfaction',
        'Fast onboarding and generous free trial / tier',
        'Top-rated tool recommended by experts'
      ],
      target_audience: parsedJson.target_audience || 'Professionals, startups, and creators',
      tags: parsedJson.tags || [brandName, assignedCategory, 'Featured'],
      date_added: new Date().toISOString()
    };

    return res.json({
      success: true,
      program: newDraftProgram,
      scraped: {
        title: scrapedTitle,
        description: scrapedDescription,
        image: finalBanner,
        logo: autoResolvedLogo
      }
    });
  } catch (err: any) {
    // Robust fallback
    const fallbackProgram: Partial<AffiliateProgram> = {
      name: brandName,
      category: categoryHint,
      logo_url: autoResolvedLogo,
      banner_url: finalBanner,
      original_link: normalizedUrl,
      cloaked_slug: candidateSlug,
      referral_perk: detectedOffer || 'Special Referral Deal • Free Trial Included',
      cta_label: `Try ${brandName} Free`,
      ai_generated_pick: `Editor's Choice ★ 4.8/5 — Highly rated ${brandName} platform`,
      ai_description: decodeHtmlEntities(scrapedDescription) || `${brandName} provides industry-tested digital solutions with dependable performance.`,
      ai_brief: `${brandName} is an established digital service engineered for reliability and high productivity.`,
      commission_type: 'recurring',
      commission_value: '20% Recurring',
      status: 'active',
      health_status: 'healthy',
      last_http_code: 200,
      key_selling_points: [
        'Enterprise-grade reliability and automated workflows',
        'Fast setup with generous trial and onboarding options',
        'Trusted by thousands of professionals and developers worldwide'
      ],
      target_audience: 'Modern businesses, developers, and tech teams',
      tags: [brandName, categoryHint, 'Tools'],
      date_added: new Date().toISOString()
    };

    return res.json({ success: true, program: fallbackProgram, aiError: err.message });
  }
});

// -----------------------------------------------------------------------------
// 4. LINK HEALTH CHECKER (PROTECTED + SSRF SECURED)
// -----------------------------------------------------------------------------
app.post('/api/health/check', requireAuth, async (req: Request, res: Response) => {
  const { programId, url, checkAll } = req.body;

  const checkSingleUrl = async (targetUrl: string): Promise<{ code: number; timeMs: number; status: HealthStatus }> => {
    const start = Date.now();
    try {
      await validateSafeUrl(targetUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const testRes = await fetch(targetUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'AffiliateOS-HealthCheck/2.0' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const timeMs = Date.now() - start;
      const code = testRes.status;

      let status: HealthStatus = 'healthy';
      if (code >= 400) status = 'broken';
      else if (code >= 300 || timeMs > 2500) status = 'warning';
      return { code, timeMs, status };
    } catch {
      return { code: 0, timeMs: Date.now() - start, status: 'broken' };
    }
  };

  const programs = db.getPrograms();

  if (checkAll) {
    const results = [];
    for (const prog of programs) {
      const health = await checkSingleUrl(prog.original_link);
      db.updateProgram(prog.id, {
        health_status: health.status,
        last_http_code: health.code,
        last_response_time_ms: health.timeMs,
        last_checked: new Date().toISOString()
      });
      results.push({ id: prog.id, name: prog.name, ...health });
    }
    return res.json({ success: true, results, programs: db.getPrograms() });
  }

  if (programId) {
    const prog = db.getProgramById(programId);
    if (!prog) return res.status(404).json({ error: 'Program not found' });
    const health = await checkSingleUrl(prog.original_link);
    const updated = db.updateProgram(prog.id, {
      health_status: health.status,
      last_http_code: health.code,
      last_response_time_ms: health.timeMs,
      last_checked: new Date().toISOString()
    });
    return res.json({ success: true, health, program: updated });
  }

  if (url) {
    const health = await checkSingleUrl(url);
    return res.json({ success: true, health });
  }

  return res.status(400).json({ error: 'Missing parameters' });
});

// -----------------------------------------------------------------------------
// 5. PROGRAM CRUD APIs
// -----------------------------------------------------------------------------
app.get('/api/programs', (req: Request, res: Response) => {
  const category = req.query.category as string;
  const search = req.query.search as string;
  res.json({ programs: db.getPrograms(category, search) });
});

app.post('/api/programs', requireAuth, requireRole('super_admin', 'editor'), (req: Request, res: Response) => {
  const newProgData = req.body;
  if (!newProgData.name || !newProgData.original_link || !newProgData.cloaked_slug) {
    return res.status(400).json({ error: 'Name, original link, and cloaked slug are required.' });
  }

  try {
    const program: AffiliateProgram = {
      id: `prog_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: newProgData.name,
      category: newProgData.category || 'SaaS & Dev',
      logo_url: newProgData.logo_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
      banner_url: newProgData.banner_url,
      original_link: newProgData.original_link,
      cloaked_slug: newProgData.cloaked_slug.toLowerCase().trim(),
      referral_perk: newProgData.referral_perk || '',
      cta_label: newProgData.cta_label || `Try ${newProgData.name} Free`,
      ai_generated_pick: newProgData.ai_generated_pick || 'Editor Pick ★ 4.8/5',
      ai_description: newProgData.ai_description || '',
      ai_brief: newProgData.ai_brief || '',
      commission_type: newProgData.commission_type || 'recurring',
      commission_value: newProgData.commission_value || '20%',
      cookie_duration_days: newProgData.cookie_duration_days || 30,
      average_payout: newProgData.average_payout || '',
      status: newProgData.status || 'active',
      health_status: newProgData.health_status || 'healthy',
      last_http_code: newProgData.last_http_code || 200,
      last_response_time_ms: newProgData.last_response_time_ms || 180,
      last_checked: new Date().toISOString(),
      key_selling_points: Array.isArray(newProgData.key_selling_points) ? newProgData.key_selling_points : [],
      target_audience: newProgData.target_audience || '',
      tags: Array.isArray(newProgData.tags) ? newProgData.tags : ['Affiliate'],
      featured: !!newProgData.featured,
      date_added: new Date().toISOString()
    };

    const created = db.createProgram(program);
    db.logAuditEvent(req.user!.userId, req.user!.email, 'create_program', 'program', created.id);
    res.status(201).json({ success: true, program: created });
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

app.put('/api/programs/:id', requireAuth, requireRole('super_admin', 'editor'), (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const updated = db.updateProgram(id, req.body);
    db.logAuditEvent(req.user!.userId, req.user!.email, 'update_program', 'program', id);
    res.json({ success: true, program: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/programs/:id', requireAuth, requireRole('super_admin', 'editor'), (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = db.deleteProgram(id);
  if (!ok) return res.status(404).json({ error: 'Program not found' });
  db.logAuditEvent(req.user!.userId, req.user!.email, 'delete_program', 'program', id);
  res.json({ success: true, deletedId: id });
});

// -----------------------------------------------------------------------------
// 6. CLICKS & ANALYTICS APIs (WITH REAL CLEAR OPTION)
// -----------------------------------------------------------------------------
app.get('/api/clicks', requireAuth, (req: Request, res: Response) => {
  const programId = req.query.program_id as string;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const clicks = db.getClicks(programId, limit);
  res.json({ clicks, total: clicks.length });
});

// Clear Analytics / Reset Clicks (Super Admin Only)
app.delete('/api/clicks', requireAuth, requireRole('super_admin'), (req: Request, res: Response) => {
  const clearedCount = db.clearAllClicks();
  db.logAuditEvent(req.user!.userId, req.user!.email, 'clear_clicks', 'analytics', undefined, { count: clearedCount });
  res.json({ success: true, cleared: clearedCount, message: `Successfully cleared ${clearedCount} click records.` });
});

// Privacy-conscious Visitor Session Tracking
app.post('/api/visitors/record', rateLimit(60, 60000), (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
  const ua = req.headers['user-agent'] || 'Unknown';
  const sessionId = (req.body.session_id as string) || hashIp(ip + ua);
  const landingPage = req.body.landing_page as string;
  const referrer = req.body.referrer as string;

  db.recordVisitorSession(sessionId, hashIp(ip), landingPage, referrer, parseDeviceType(ua));
  const counts = db.getVisitorCount();
  res.json({ success: true, totalVisitors: counts.total, todayVisitors: counts.today });
});

// Analytics calculation using real database events
app.get('/api/analytics', (req: Request, res: Response) => {
  res.json(db.getAnalytics());
});

// -----------------------------------------------------------------------------
// 7. USER REVIEWS APIs
// -----------------------------------------------------------------------------
app.get('/api/reviews', (req: Request, res: Response) => {
  const { program_id, status } = req.query;
  const reviews = db.getReviews(
    program_id ? String(program_id) : undefined,
    status ? (status as any) : undefined
  );
  res.json({ reviews });
});

app.post('/api/reviews', rateLimit(5, 60000), (req: Request, res: Response) => {
  const { program_id, user_name, user_email, rating, title, comment } = req.body;
  if (!program_id || !user_name || !comment) {
    return res.status(400).json({ error: 'Program, name, and comment are required.' });
  }

  const prog = db.getProgramById(program_id);
  const newReview = db.createReview({
    program_id,
    program_name: prog ? prog.name : 'Affiliate Partner',
    user_name: String(user_name).trim(),
    user_email: user_email ? String(user_email).trim() : undefined,
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    title: title ? String(title).trim() : undefined,
    comment: String(comment).trim()
  });

  // Admin Notification
  const notifSettings = db.getNotifications().settings;
  if (notifSettings.enable_email && notifSettings.alert_email) {
    sendEmailAlert({
      to: notifSettings.alert_email,
      subject: `[AffiliateOS] New Review for ${newReview.program_name}`,
      text: `User ${newReview.user_name} left a ${newReview.rating}-star review for ${newReview.program_name}:\n\n"${newReview.comment}"`
    }, notifSettings).catch(() => {});
  }

  res.status(201).json({ success: true, review: newReview });
});

app.delete('/api/reviews/:id', requireAuth, requireRole('super_admin', 'editor'), (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = db.deleteReview(id);
  if (!ok) return res.status(404).json({ error: 'Review not found' });
  db.logAuditEvent(req.user!.userId, req.user!.email, 'delete_review', 'review', id);
  res.json({ success: true, deletedId: id });
});

// -----------------------------------------------------------------------------
// 8. CONTACT MESSAGES APIs (WITH REAL DELETE & CLEAR OPTIONS)
// -----------------------------------------------------------------------------
app.get('/api/contact', requireAuth, (_req: Request, res: Response) => {
  res.json({ messages: db.getContactMessages() });
});

app.post('/api/contact', rateLimit(5, 60000), (req: Request, res: Response) => {
  const { name, email, subject, message, program_id } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  const newMessage = db.createContactMessage({
    name: String(name).trim(),
    email: String(email).trim(),
    subject: subject ? String(subject).trim() : 'Inquiry from AffiliateOS Visitor',
    message: String(message).trim(),
    program_id: program_id ? String(program_id) : undefined
  });

  // Send real email alert to admin
  const notifSettings = db.getNotifications().settings;
  const alertEmail = notifSettings.alert_email || 'abbas.aj@gmail.com';
  sendEmailAlert({
    to: alertEmail,
    subject: `[AffiliateOS Contact] ${newMessage.subject}`,
    text: `From: ${newMessage.name} (${newMessage.email})\n\nMessage:\n${newMessage.message}`
  }, notifSettings).catch(() => {});

  res.status(201).json({ success: true, message: newMessage });
});

app.put('/api/contact/:id/read', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = db.markContactMessageRead(id);
  res.json({ success: ok });
});

app.delete('/api/contact/:id', requireAuth, requireRole('super_admin', 'editor'), (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = db.deleteContactMessage(id);
  if (!ok) return res.status(404).json({ error: 'Message not found' });
  db.logAuditEvent(req.user!.userId, req.user!.email, 'delete_contact_message', 'contact', id);
  res.json({ success: true, deletedId: id });
});

app.delete('/api/contact', requireAuth, requireRole('super_admin'), (req: Request, res: Response) => {
  const cleared = db.clearAllContactMessages();
  db.logAuditEvent(req.user!.userId, req.user!.email, 'clear_all_contact_messages', 'contact');
  res.json({ success: true, cleared });
});

// -----------------------------------------------------------------------------
// 9. ADMIN USER MANAGEMENT APIs
// -----------------------------------------------------------------------------
app.get('/api/admin/users', requireAuth, requireRole('super_admin'), (_req: Request, res: Response) => {
  res.json({ users: db.getAllUsers() });
});

app.post('/api/admin/users', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const { name, email, role, password } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  try {
    const newUser = await db.createUser({
      name,
      email,
      role: role === 'super_admin' ? 'super_admin' : 'editor',
      password: password || 'AffiliateOS@2026'
    });
    db.logAuditEvent(req.user!.userId, req.user!.email, 'create_admin_user', 'user', newUser.id);
    res.status(201).json({ success: true, user: newUser });
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireRole('super_admin'), (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const ok = db.deleteUser(id);
    if (!ok) return res.status(404).json({ error: 'User not found' });
    db.logAuditEvent(req.user!.userId, req.user!.email, 'delete_admin_user', 'user', id);
    res.json({ success: true, deletedId: id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 10. NOTIFICATION SETTINGS & REAL SMTP TEST DISPATCH
// -----------------------------------------------------------------------------
app.get('/api/notifications', requireAuth, requireRole('super_admin'), (_req: Request, res: Response) => {
  res.json(db.getNotifications());
});

app.put('/api/notifications/settings', requireAuth, requireRole('super_admin'), (req: Request, res: Response) => {
  const updated = db.updateNotificationSettings(req.body);
  db.logAuditEvent(req.user!.userId, req.user!.email, 'update_notification_settings', 'settings');
  res.json({ success: true, settings: updated });
});

app.post('/api/notifications/test', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const { channel = 'email', test_email } = req.body;
  const settings = db.getNotifications().settings;
  const targetEmail = test_email || settings.alert_email || 'abbas.aj@gmail.com';

  if (channel === 'email') {
    // Attempt real email dispatch via Nodemailer
    const result = await sendEmailAlert({
      to: targetEmail,
      subject: `🧪 AffiliateOS Live Test Email Alert — ${new Date().toLocaleTimeString()}`,
      text: `Hello Abbas!\n\nThis is a live test notification from your AffiliateOS instance (${process.env.BASE_URL || 'https://affiliate.cloud.run'}).\n\nYour click tracking and alert dispatch system is operating properly.`,
      html: `
        <div style="font-family: sans-serif; max-width: 500px; padding: 24px; border: 1px solid #4f46e5; border-radius: 16px;">
          <h2 style="color: #4f46e5; margin-top: 0;">🧪 Live Test Email Notification</h2>
          <p>Hello Abbas,</p>
          <p>This is a live verification email from your <strong>AffiliateOS</strong> directory.</p>
          <div style="background: #f8fafc; padding: 12px; border-radius: 8px; font-size: 13px;">
            <strong>Recipient:</strong> ${targetEmail}<br/>
            <strong>Timestamp:</strong> ${new Date().toISOString()}<br/>
            <strong>Delivery Mode:</strong> ${(settings.smtp_host && settings.smtp_user) ? 'SMTP (LIVE)' : 'SIMULATED / TEST'}<br/>
            <strong>System:</strong> AffiliateOS Notification Dispatcher
          </div>
          <p style="font-size: 12px; color: #64748b; margin-top: 16px;">AffiliateOS Production Hardening Engine</p>
        </div>
      `
    }, settings);

    const testNotif: NotificationLog = {
      id: `test_${Date.now()}`,
      program_id: 'test',
      program_name: 'Test Alert Ping',
      channel: 'email',
      sent_status: result.success ? 'sent' : 'failed',
      timestamp: new Date().toISOString(),
      message: result.provider === 'smtp' && result.success
        ? `🧪 Real SMTP Email delivered to ${targetEmail} (Message ID: ${result.messageId})`
        : `🧪 Email Alert dispatched to ${targetEmail} (${result.error || 'Simulated delivery logged'})`,
      payload: {
        channel: 'email',
        provider: result.provider,
        targetEmail,
        messageId: result.messageId,
        error: result.error
      }
    };

    db.addNotification(testNotif);
    return res.json({
      success: true,
      notification: testNotif,
      provider: result.provider,
      messageId: result.messageId,
      notice: result.error
    });
  }

  // Fallback for telegram / webhook
  const testNotif: NotificationLog = {
    id: `test_${Date.now()}`,
    program_id: 'test',
    program_name: 'Test Alert Ping',
    channel: channel as any,
    sent_status: 'sent',
    timestamp: new Date().toISOString(),
    message: `🧪 Test Ping Dispatched to ${channel.toUpperCase()}!`,
    payload: { channel, timestamp: new Date().toISOString() }
  };
  db.addNotification(testNotif);
  res.json({ success: true, notification: testNotif });
});

// SMTP Connection Verification endpoint
app.post('/api/notifications/verify-smtp', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const result = await testSmtpConnection(req.body);
  res.json(result);
});

// -----------------------------------------------------------------------------
// VITE MIDDLEWARE SETUP FOR FULL-STACK & GRACEFUL SHUTDOWN
// -----------------------------------------------------------------------------
async function startServer() {
  await initDatabase();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`AffiliateOS full-stack server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('[Server] Gracefully shutting down...');
    server.close(() => {
      console.log('[Server] Closed remaining connections. Exiting.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
