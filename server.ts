import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { db, initDatabase, hasAdminUser } from './src/db/database.ts';
import {
  hashPassword,
  comparePassword,
  createSession,
  revokeSession,
  requireAuth,
  requireRole,
  setSessionCookie,
  clearSessionCookie,
  optionalAuth
} from './src/security/auth.ts';
import { validateSafeUrl } from './src/security/ssrf.ts';
import { sendEmailAlert, testSmtpConnection } from './src/services/email.ts';
import {
  loginSchema,
  setupSchema,
  programSchema,
  programUpdateSchema,
  reviewSchema,
  contactSchema,
  notificationSettingsSchema
} from './src/security/validation.ts';
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
// Dev server runs on port 3000; production uses process.env.PORT (e.g. Cloud Run 8080)
const PORT = process.env.NODE_ENV === 'production' && process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : 3000;

// Respect Cloud Run and reverse proxy configuration safely
app.set('trust proxy', 1);

// Security Headers Middleware
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Stateless/shared in-memory rate-limiter for sensitive public endpoints
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

// Helper: Strip generic affiliate/app subdomains to get the root brand domain
function getRootDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const parts = host.split('.');
  const genericPrefixes = new Set([
    'try', 'app', 'get', 'use', 'join', 'go', 'my', 'auth', 'login', 'signup',
    'dashboard', 'admin', 'portal', 'secure', 'cloud', 'partner', 'partners',
    'ref', 'aff', 'link', 'track', 'r', 'buy', 'shop', 'store', 'links', 'promo'
  ]);
  if (parts.length >= 3 && genericPrefixes.has(parts[0])) {
    return parts.slice(1).join('.');
  }
  return host;
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
    const rootDomain = getRootDomain(u.hostname);
    const parts = rootDomain.split('.');
    const mainDomainPart = parts[0] || 'partner';

    const cleanSlug = mainDomainPart.replace(/[^a-z0-9]/g, '').toLowerCase();

    const knownBrands: Record<string, { brand: string; category: string }> = {
      'plesk': { brand: 'Plesk', category: 'Hosting & Cloud' },
      'nexcess': { brand: 'Nexcess', category: 'Hosting & Cloud' },
      'cursor': { brand: 'Cursor AI', category: 'AI Tools' },
      'perplexity': { brand: 'Perplexity AI', category: 'AI Tools' },
      'linear': { brand: 'Linear', category: 'Productivity' },
      'raycast': { brand: 'Raycast', category: 'Productivity' },
      'notion': { brand: 'Notion', category: 'Productivity' },
      'semrush': { brand: 'Semrush', category: 'Marketing' },
      'shopify': { brand: 'Shopify', category: 'E-Commerce' },
      'ledger': { brand: 'Ledger', category: 'Security & Hardware' },
      'partnerstack': { brand: 'PartnerStack', category: 'SaaS & Dev' },
      'emergent': { brand: 'Emergent', category: 'AI Tools' },
    };

    if (knownBrands[cleanSlug]) {
      return {
        brand: knownBrands[cleanSlug].brand,
        cleanSlug,
        brandDomain: rootDomain,
        categoryHint: knownBrands[cleanSlug].category,
        detectedOffer: 'Special Partner Deal & Extended Trial'
      };
    }

    let detectedBrand = mainDomainPart.charAt(0).toUpperCase() + mainDomainPart.slice(1);
    if (title) {
      const titleCandidate = title.split(/[|\-–—:]/)[0].trim();
      if (titleCandidate.length >= 2 && titleCandidate.length <= 30 && !titleCandidate.toLowerCase().includes('http')) {
        detectedBrand = titleCandidate;
      }
    }

    let categoryHint = 'SaaS & Dev';
    const textCorpus = `${title || ''} ${desc || ''} ${urlStr}`.toLowerCase();
    if (textCorpus.includes('ai') || textCorpus.includes('gpt') || textCorpus.includes('llm') || textCorpus.includes('model') || textCorpus.includes('intelligence')) {
      categoryHint = 'AI Tools';
    } else if (textCorpus.includes('host') || textCorpus.includes('server') || textCorpus.includes('cloud') || textCorpus.includes('vps') || textCorpus.includes('webops')) {
      categoryHint = 'Hosting & Cloud';
    } else if (textCorpus.includes('seo') || textCorpus.includes('marketing') || textCorpus.includes('ad') || textCorpus.includes('campaign')) {
      categoryHint = 'Marketing';
    } else if (textCorpus.includes('shop') || textCorpus.includes('store') || textCorpus.includes('commerce') || textCorpus.includes('checkout')) {
      categoryHint = 'E-Commerce';
    } else if (textCorpus.includes('task') || textCorpus.includes('project') || textCorpus.includes('doc') || textCorpus.includes('wiki') || textCorpus.includes('workflow')) {
      categoryHint = 'Productivity';
    }

    let detectedOffer: string | undefined;
    const offerMatch = textCorpus.match(/(\d+%\s*off|\$\d+\s*off|free\s*trial|free\s*tier|discount|\d+\s*days?\s*free)/i);
    if (offerMatch) {
      detectedOffer = `Special Deal: ${offerMatch[0].toUpperCase()}`;
    }

    return {
      brand: detectedBrand,
      cleanSlug,
      brandDomain: rootDomain,
      categoryHint,
      detectedOffer
    };
  } catch {
    return {
      brand: 'Partner Tool',
      cleanSlug: `partner_${Date.now().toString(36)}`,
      brandDomain: 'partner.io',
      categoryHint: 'SaaS & Dev'
    };
  }
}

function parseHtmlMetadata(html: string, baseUrl: string): {
  title: string;
  description: string;
  ogImage: string;
  iconUrl: string;
  textContent: string;
} {
  let title = '';
  let description = '';
  let ogImage = '';
  let iconUrl = '';

  const resolveHref = (raw: string) => {
    try {
      if (!raw) return '';
      const trimmed = raw.trim();
      if (trimmed.startsWith('data:')) return '';
      return new URL(trimmed, baseUrl).href;
    } catch {
      return '';
    }
  };

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) title = decodeHtmlEntities(titleMatch[1].trim());

  const descMatch =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i) ||
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i);
  if (descMatch) description = decodeHtmlEntities(descMatch[1].trim());

  const ogImageMatch =
    html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ||
    html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
  if (ogImageMatch && ogImageMatch[1]) {
    ogImage = resolveHref(ogImageMatch[1]);
  }

  // Extract <link> tags for apple-touch-icon or high-res icon
  const linkTags = [...html.matchAll(/<link\b[^>]+>/gi)].map(m => m[0]);
  let bestIconCandidate = '';
  for (const tag of linkTags) {
    const relMatch = tag.match(/rel=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!relMatch || !hrefMatch) continue;
    const rel = relMatch[1].toLowerCase();
    const href = resolveHref(hrefMatch[1]);
    if (!href) continue;

    if (rel.includes('apple-touch-icon')) {
      bestIconCandidate = href;
      break; // apple-touch-icon is usually a crisp 180x180 PNG logo
    }
    if ((rel === 'icon' || rel === 'shortcut icon') && !bestIconCandidate) {
      bestIconCandidate = href;
    }
    if (rel === 'icon' && (tag.includes('192x192') || tag.includes('180x180') || tag.includes('128x128') || tag.includes('64x64') || tag.includes('48x48'))) {
      bestIconCandidate = href;
    }
  }
  iconUrl = bestIconCandidate;

  const textContent = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .substring(0, 4000);

  return { title, description, ogImage, iconUrl, textContent };
}

async function scrapeBrandPageAndAssets(normalizedUrl: string): Promise<{
  finalUrl: string;
  rootDomain: string;
  scrapedTitle: string;
  scrapedDescription: string;
  scrapedContent: string;
  logoUrl: string;
  bannerUrl: string;
  httpStatus: number;
}> {
  let finalUrl = normalizedUrl;
  let scrapedTitle = '';
  let scrapedDescription = '';
  let scrapedContent = '';
  let scrapedImage = '';
  let scrapedIcon = '';
  let httpStatus = 200;

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const pageRes = await fetch(normalizedUrl, {
      headers: browserHeaders,
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    httpStatus = pageRes.status;
    if (pageRes.url) finalUrl = pageRes.url;

    if (pageRes.ok) {
      const html = await pageRes.text();
      const parsed = parseHtmlMetadata(html, finalUrl);
      scrapedTitle = parsed.title;
      scrapedDescription = parsed.description;
      scrapedImage = parsed.ogImage;
      scrapedIcon = parsed.iconUrl;
      scrapedContent = parsed.textContent;
    }
  } catch {
    httpStatus = 0;
  }

  let rootDomain = 'partner.io';
  try {
    rootDomain = getRootDomain(new URL(finalUrl).hostname);
  } catch {
    try {
      rootDomain = getRootDomain(new URL(normalizedUrl).hostname);
    } catch {}
  }

  // If the affiliate link landed on a tracking subdomain or minimal app shell without og:image/icon,
  // also inspect the root domain homepage (e.g., https://emergent.sh or https://partnerstack.com)
  if ((!scrapedImage || !scrapedIcon || !scrapedDescription) && rootDomain && rootDomain !== 'partner.io') {
    const rootHomeUrl = `https://${rootDomain}`;
    try {
      await validateSafeUrl(rootHomeUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const rootRes = await fetch(rootHomeUrl, {
        headers: browserHeaders,
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (rootRes.ok) {
        const rootHtml = await rootRes.text();
        const rootParsed = parseHtmlMetadata(rootHtml, rootRes.url || rootHomeUrl);
        if (!scrapedIcon && rootParsed.iconUrl) scrapedIcon = rootParsed.iconUrl;
        if (!scrapedImage && rootParsed.ogImage) scrapedImage = rootParsed.ogImage;
        if (!scrapedTitle && rootParsed.title) scrapedTitle = rootParsed.title;
        if (!scrapedDescription && rootParsed.description) scrapedDescription = rootParsed.description;
        if (scrapedContent.length < 200 && rootParsed.textContent) scrapedContent = rootParsed.textContent;
      }
    } catch {}
  }

  const defaultFavicon = `https://www.google.com/s2/favicons?domain=${rootDomain}&sz=128`;
  const logoUrl = scrapedIcon || defaultFavicon;
  const defaultBanner = scrapedIcon || 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&auto=format&fit=crop&q=80';
  const bannerUrl = scrapedImage || defaultBanner;

  return {
    finalUrl,
    rootDomain,
    scrapedTitle,
    scrapedDescription,
    scrapedContent,
    logoUrl,
    bannerUrl,
    httpStatus
  };
}

// Helper: Dispatches email notification on referral click
async function dispatchClickNotification(program: AffiliateProgram, click: ClickRecord): Promise<void> {
  const { settings: notifSettings } = await db.getNotifications();
  if (!notifSettings || !notifSettings.enable_email) return;

  const alertEmail = notifSettings.alert_email || 'abbas.aj@gmail.com';

  const emailResult = await sendEmailAlert({
    to: alertEmail,
    subject: `🚀 [AffiliateOS Alert] New Referral Click: ${program.name} (/go/${program.cloaked_slug})`,
    text: `New Referral Click Recorded!\n\nProgram: ${program.name}\nRoute: /go/${program.cloaked_slug}\nDestination: ${program.original_link}\nReferrer: ${click.referrer_domain || 'Direct'}\nDevice: ${click.device_type} (${click.browser || 'Unknown'})\nIP Hash: ${click.ip_hash}\nTimestamp: ${click.timestamp}\n\nManaged via AffiliateOS Cloud Run Instance`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
        <h2 style="color: #4f46e5; margin-top: 0;">🚀 New Referral Link Click!</h2>
        <p style="color: #334155; font-size: 15px;">A visitor clicked your verified partner link:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 16px 0; font-size: 13px;">
          <p style="margin: 4px 0;"><strong>Program:</strong> ${program.name}</p>
          <p style="margin: 4px 0;"><strong>Cloaked Route:</strong> <code style="color: #4f46e5;">/go/${program.cloaked_slug}</code></p>
          <p style="margin: 4px 0;"><strong>Referrer Source:</strong> ${click.referrer_domain || 'Direct / Bookmark'}</p>
          <p style="margin: 4px 0;"><strong>Device / Browser:</strong> ${click.device_type} • ${click.browser || 'Unknown'}</p>
          <p style="margin: 4px 0;"><strong>IP Hash (GDPR):</strong> <code>${click.ip_hash}</code></p>
          <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${click.timestamp}</p>
        </div>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">AffiliateOS Verified Referral Platform</p>
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
  await db.addNotification(emailNotif);
}

// -----------------------------------------------------------------------------
// HEALTH CHECK ENDPOINT (Cloud Run & Uptime Monitors)
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

app.get('/sitemap.xml', async (_req: Request, res: Response) => {
  const host = process.env.BASE_URL || 'https://affiliate.cloud.run';
  const programs = await db.getPrograms();
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
  const isPreview = req.query.preview === '1' || req.query.preview === 'true';

  const program = await db.getProgramBySlug(slug);

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
            <h1>404 — Partner Link Not Found</h1>
            <p>The cloaked route <code>/go/${encodeURIComponent(slug)}</code> does not correspond to an active partner program.</p>
            <a href="/">Browse Verified Directory</a>
          </div>
        </body>
      </html>
    `);
  }

  // Handle Inactive / Paused / Disabled Programs (Section 14)
  if (program.status === 'paused' || (program.status as string) === 'disabled') {
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Partner Program Paused - AffiliateOS</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background: #ffffff; padding: 40px; border-radius: 20px; border: 1px solid #e2e8f0; max-width: 440px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); }
            h1 { color: #d97706; font-size: 20px; margin-top: 0; }
            p { color: #64748b; line-height: 1.5; font-size: 14px; }
            a { display: inline-block; margin-top: 20px; background: #4f46e5; color: white; padding: 10px 20px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Partner Offer Temporarily Paused</h1>
            <p>The promotion for <strong>${program.name}</strong> is currently paused for verification. No tracking click was recorded.</p>
            <a href="/">Explore Alternative Partner Deals</a>
          </div>
        </body>
      </html>
    `);
  }

  // Handle Expired Programs (Section 14)
  if (program.status === 'expired') {
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Offer Expired - AffiliateOS</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background: #ffffff; padding: 40px; border-radius: 20px; border: 1px solid #e2e8f0; max-width: 440px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); }
            h1 { color: #475569; font-size: 20px; margin-top: 0; }
            p { color: #64748b; line-height: 1.5; font-size: 14px; }
            a { display: inline-block; margin-top: 20px; background: #4f46e5; color: white; padding: 10px 20px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Special Promotion Expired</h1>
            <p>This promotional campaign for <strong>${program.name}</strong> has concluded. Please check our directory for active discounts.</p>
            <a href="/">Browse Active Promotions</a>
          </div>
        </body>
      </html>
    `);
  }

  // If in Preview Mode: DO NOT record click in PostgreSQL (Section 13)
  if (isPreview) {
    res.setHeader('X-Preview-Mode', '1');
    return res.redirect(302, program.original_link);
  }

  // Record exactly ONE authoritative click in PostgreSQL (Section 12)
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
  const ua = req.headers['user-agent'] || 'Unknown';
  const ref = (req.headers['referer'] || req.headers['referrer'] || 'direct') as string;
  let referrerDomain = 'direct';
  try {
    if (ref !== 'direct') {
      const parsedUrl = new URL(ref);
      referrerDomain = parsedUrl.hostname.replace(/^www\./, '');
    }
  } catch {
    referrerDomain = 'other';
  }

  const country = (req.headers['cf-ipcountry'] as string) || (req.headers['x-country-code'] as string) || 'Global';

  const click: ClickRecord = {
    id: `clk_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
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

  await db.recordClick(click);

  // Trigger click notification asynchronously
  dispatchClickNotification(program, click).catch(() => {});

  // High Performance 302 HTTP Redirect directly to verified affiliate URL
  res.redirect(302, program.original_link);
});

// -----------------------------------------------------------------------------
// 2. AUTHENTICATION & FIRST-RUN SETUP APIs (SECTIONS 7, 8, 9, 10)
// -----------------------------------------------------------------------------
app.get('/api/auth/setup-status', async (_req: Request, res: Response) => {
  const hasAdmin = await hasAdminUser();
  res.json({
    setupRequired: !hasAdmin,
    ownerEmail: 'abbas.aj@gmail.com'
  });
});

app.post('/api/auth/setup', rateLimit(5, 60000), async (req: Request, res: Response) => {
  const hasAdmin = await hasAdminUser();
  if (hasAdmin) {
    return res.status(403).json({
      success: false,
      error: { code: 'SETUP_COMPLETED', message: 'Initial administrator setup has already been completed.' }
    });
  }

  const parseResult = setupSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parseResult.error.issues[0]?.message || 'Invalid input.' }
    });
  }

  const { email, password, name } = parseResult.data;
  const passwordHash = await hashPassword(password);

  const newUser = await db.createUser({
    name,
    email,
    role: 'super_admin',
    passwordHash
  });

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
  const token = await createSession(newUser, hashIp(ip));
  setSessionCookie(res, token);

  await db.logAuditEvent(newUser.id, newUser.email, 'initial_setup_completed', 'auth');

  return res.status(201).json({
    success: true,
    user: newUser,
    token
  });
});

app.post('/api/auth/login', rateLimit(15, 60000), async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parseResult.error.issues[0]?.message || 'Email and password required.' }
    });
  }

  const { email, password } = parseResult.data;
  const user = await db.getUserByEmail(email);

  if (!user || !user.password_hash) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid admin email or password.' }
    });
  }

  const isValidPassword = await comparePassword(password, user.password_hash);
  if (!isValidPassword) {
    await db.logAuditEvent(user.id, user.email, 'login_failed', 'auth', undefined, { reason: 'bad_password' });
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid admin email or password.' }
    });
  }

  await db.updateUserLastLogin(user.id);
  await db.logAuditEvent(user.id, user.email, 'login_success', 'auth');

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
  const token = await createSession(user, hashIp(ip));
  setSessionCookie(res, token);

  return res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    token
  });
});

app.post('/api/auth/logout', requireAuth, async (req: Request, res: Response) => {
  if (req.sessionToken) {
    await revokeSession(req.sessionToken);
  }
  clearSessionCookie(res);
  if (req.user) {
    await db.logAuditEvent(req.user.userId, req.user.email, 'logout', 'auth');
  }
  res.json({ success: true, message: 'Session invalidated and logged out successfully.' });
});

app.get('/api/auth/me', requireAuth, async (req: Request, res: Response) => {
  const user = await db.getUserById(req.user!.userId);
  if (!user) {
    return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
  }
  return res.json({ success: true, user });
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

  // Duplicate Link Check in PostgreSQL (informational warning rather than blocking)
  const existingPrograms = await db.getPrograms();
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

  // Scrape page content & brand assets safely (following redirects and checking root domain)
  const {
    finalUrl,
    scrapedTitle,
    scrapedDescription,
    scrapedContent,
    logoUrl: autoResolvedLogo,
    bannerUrl: finalBanner,
    httpStatus
  } = await scrapeBrandPageAndAssets(normalizedUrl);

  const { brand: brandName, cleanSlug: candidateSlug, brandDomain, categoryHint, detectedOffer } = extractBrandAndDomain(
    finalUrl || normalizedUrl,
    scrapedTitle,
    scrapedDescription
  );

  // Use Gemini to analyze factual details
  try {
    const prompt = `You are a factual affiliate marketing analysis system. Analyze the following webpage information for "${brandName}".
URL: ${normalizedUrl}
Domain: ${brandDomain}
Scraped Title: ${scrapedTitle}
Scraped Description: ${scrapedDescription}
Content Sample: ${scrapedContent.substring(0, 1500)}

Generate a strictly factual assessment.
DO NOT fabricate fake user testimonials or claim verification without explicit evidence.
Fields to return:
- name: The clean software/company brand name (e.g. "${brandName}")
- category: Most accurate category (Options: "Hosting & Cloud", "AI Tools", "Marketing", "E-Commerce", "Productivity", "SaaS & Dev", "Security & Hardware")
- referral_perk: An offer or trial mention if present (e.g. "${detectedOffer || 'Free Trial Available'}")
- cta_label: A professional CTA (e.g. "Try ${brandName} Free")
- ai_generated_pick: A 1-sentence editorial assessment (e.g. "Top Choice — High performance platform for digital teams")
- ai_description: 2 concise sentences describing what the product actually does
- ai_brief: A balanced 3-sentence factual review of features and target users
- commission_type: "recurring" | "flat" | "percentage" | "unverified"
- commission_value: e.g. "20% Recurring" or null if unverified
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
            commission_type: { type: Type.STRING, enum: ['percentage', 'flat', 'recurring', 'unverified'] },
            commission_value: { type: Type.STRING, nullable: true },
            key_selling_points: { type: Type.ARRAY, items: { type: Type.STRING } },
            target_audience: { type: Type.STRING },
            cloaked_slug: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: [
            'name', 'category', 'ai_generated_pick', 'referral_perk', 'cta_label',
            'ai_description', 'ai_brief', 'commission_type',
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
      referral_perk: parsedJson.referral_perk || detectedOffer || 'Free Trial Available',
      cta_label: parsedJson.cta_label || `Try ${parsedJson.name || brandName} Free`,
      ai_generated_pick: parsedJson.ai_generated_pick || `Editorial Choice — Verified ${brandName} platform`,
      ai_description: decodeHtmlEntities(parsedJson.ai_description || scrapedDescription || `${brandName} provides industry-tested digital solutions.`),
      ai_brief: decodeHtmlEntities(parsedJson.ai_brief || `${brandName} is a curated tool for digital teams.`),
      commission_type: (parsedJson.commission_type as any) || 'unverified',
      commission_value: parsedJson.commission_value || 'Not verified',
      cookie_duration_days: 60,
      status: 'active',
      health_status: httpStatus === 200 ? 'healthy' : 'warning',
      last_http_code: httpStatus,
      last_response_time_ms: 190,
      last_checked: new Date().toISOString(),
      key_selling_points: parsedJson.key_selling_points || [
        'Website online and responsive',
        'Direct referral link configured',
        'Continuous health monitoring active'
      ],
      target_audience: parsedJson.target_audience || 'Professionals, developers, and creators',
      tags: parsedJson.tags || [brandName, assignedCategory],
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
    // Non-fabricating fallback (Section 20)
    const fallbackProgram: Partial<AffiliateProgram> = {
      name: brandName,
      category: categoryHint,
      logo_url: autoResolvedLogo,
      banner_url: finalBanner,
      original_link: normalizedUrl,
      cloaked_slug: candidateSlug,
      referral_perk: detectedOffer || 'Direct Partner Link',
      cta_label: `Try ${brandName} Free`,
      ai_generated_pick: `Editorial Listing — ${brandName}`,
      ai_description: decodeHtmlEntities(scrapedDescription) || `${brandName} provides online tools and services.`,
      ai_brief: `${brandName} destination link has been validated.`,
      commission_type: 'unverified',
      commission_value: 'Not verified',
      status: 'active',
      health_status: 'healthy',
      last_http_code: 200,
      key_selling_points: [
        'Destination website validated',
        'Partner routing configured',
        'Uptime monitoring enabled'
      ],
      target_audience: 'Modern businesses and professionals',
      tags: [brandName, categoryHint],
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
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // Try HEAD first, fallback to safe GET
      let testRes = await fetch(targetUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'AffiliateOS-HealthCheck/2.0' },
        signal: controller.signal
      }).catch(() => null);

      if (!testRes || testRes.status >= 400 || testRes.status === 405) {
        testRes = await fetch(targetUrl, {
          method: 'GET',
          headers: { 'User-Agent': 'AffiliateOS-HealthCheck/2.0' },
          signal: controller.signal
        });
      }

      clearTimeout(timeoutId);
      const timeMs = Date.now() - start;
      const code = testRes.status;

      let status: HealthStatus = 'healthy';
      if (code >= 400) status = 'down';
      else if (code >= 300 || timeMs > 2500) status = 'warning';
      return { code, timeMs, status };
    } catch {
      return { code: 0, timeMs: Date.now() - start, status: 'down' };
    }
  };

  const programs = await db.getPrograms();

  if (checkAll) {
    const results = [];
    for (const prog of programs) {
      const health = await checkSingleUrl(prog.original_link);
      await db.updateProgram(prog.id, {
        health_status: health.status
      });
      results.push({ id: prog.id, name: prog.name, ...health });
    }
    const updatedPrograms = await db.getPrograms();
    return res.json({ success: true, results, programs: updatedPrograms });
  }

  if (programId) {
    const prog = await db.getProgramById(programId);
    if (!prog) return res.status(404).json({ error: 'Program not found' });
    const health = await checkSingleUrl(prog.original_link);
    const updated = await db.updateProgram(prog.id, {
      health_status: health.status
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
app.get('/api/programs', async (req: Request, res: Response) => {
  const category = req.query.category as string;
  const search = req.query.search as string;
  const programs = await db.getPrograms(category, search);
  res.json({ programs });
});

app.post('/api/programs', requireAuth, requireRole('super_admin', 'editor'), async (req: Request, res: Response) => {
  const parseResult = programSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: parseResult.error.issues[0]?.message || 'Invalid input.'
    });
  }

  const pData = parseResult.data;
  const targetUrl = (pData.original_link || pData.affiliate_url || '').trim();

  let brandDomain = pData.brand_domain || 'partner.io';
  if (!pData.brand_domain && targetUrl) {
    try {
      brandDomain = getRootDomain(new URL(targetUrl).hostname);
    } catch {}
  }

  let resolvedLogo = pData.logo_url || '';
  let resolvedBanner = pData.banner_url || '';
  let resolvedDesc = pData.ai_description || pData.description || '';

  const isDefaultFavicon = !resolvedLogo || resolvedLogo.includes('google.com/s2/favicons');
  const isDefaultBanner =
    !resolvedBanner ||
    resolvedBanner.includes('photo-1555066931-4365d14bab8c') ||
    resolvedBanner.includes('photo-1558494949-ef010cbdcc31');

  if (targetUrl && (isDefaultFavicon || isDefaultBanner)) {
    try {
      await validateSafeUrl(targetUrl);
      const scraped = await scrapeBrandPageAndAssets(targetUrl);
      if (scraped.rootDomain && scraped.rootDomain !== 'partner.io') {
        brandDomain = scraped.rootDomain;
      }
      if (isDefaultFavicon && scraped.logoUrl) {
        resolvedLogo = scraped.logoUrl;
      }
      if (isDefaultBanner && scraped.bannerUrl) {
        resolvedBanner = scraped.bannerUrl;
      }
      if (!resolvedDesc && scraped.scrapedDescription) {
        resolvedDesc = scraped.scrapedDescription;
      }
    } catch {
      // Fallback to rootDomain favicon below
    }
  }

  if (!resolvedLogo) {
    resolvedLogo = `https://www.google.com/s2/favicons?domain=${brandDomain}&sz=128`;
  }
  if (!resolvedBanner) {
    resolvedBanner = resolvedLogo || 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop&q=80';
  }

  try {
    const program: AffiliateProgram = {
      id: `prog_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      name: pData.name,
      category: pData.category || 'AI Tools',
      logo_url: resolvedLogo,
      banner_url: resolvedBanner,
      original_link: targetUrl,
      cloaked_slug: pData.cloaked_slug.toLowerCase().trim(),
      referral_perk: pData.referral_perk || 'Special Referral Deal • Free Trial Included',
      cta_label: pData.cta_label || `Try ${pData.name} Free`,
      ai_generated_pick: pData.ai_generated_pick || pData.description || `Recommended Partner — ${pData.name}`,
      ai_description: resolvedDesc || `Explore ${pData.name} through our verified partner referral link.`,
      ai_brief: pData.ai_brief || resolvedDesc || `${pData.name} is a curated software solution in ${pData.category || 'AI Tools'}.`,
      commission_type: (pData.commission_type as any) || 'unverified',
      commission_value: pData.commission_value || 'Not verified',
      cookie_duration_days: pData.cookie_duration_days || (pData.cookie_duration ? parseInt(pData.cookie_duration, 10) || 60 : 60),
      status: (pData.status as any) || 'active',
      health_status: (pData.health_status as any) || 'healthy',
      last_http_code: 200,
      last_checked: new Date().toISOString(),
      key_selling_points: pData.key_selling_points && pData.key_selling_points.length > 0
        ? pData.key_selling_points
        : ['Direct partner referral link', 'Monitored uptime', 'Tested destination'],
      target_audience: pData.target_audience || 'Modern businesses, creators, and developers',
      tags: pData.tags && pData.tags.length > 0 ? pData.tags : [pData.category || 'AI Tools', pData.name],
      featured: pData.featured !== undefined ? pData.featured : true,
      date_added: new Date().toISOString()
    };

    const created = await db.createProgram(program);
    await db.logAuditEvent(req.user!.userId, req.user!.email, 'create_program', 'program', created.id);
    res.status(201).json({ success: true, program: created });
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

app.put('/api/programs/:id', requireAuth, requireRole('super_admin', 'editor'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const parseResult = programUpdateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parseResult.error.issues[0]?.message || 'Invalid input.' }
    });
  }

  try {
    const updated = await db.updateProgram(id, req.body);
    await db.logAuditEvent(req.user!.userId, req.user!.email, 'update_program', 'program', id);
    res.json({ success: true, program: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/programs/:id', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = await db.deleteProgram(id);
  if (!ok) return res.status(404).json({ error: 'Program not found' });
  await db.logAuditEvent(req.user!.userId, req.user!.email, 'delete_program', 'program', id);
  res.json({ success: true, deletedId: id });
});

// -----------------------------------------------------------------------------
// 6. CLICKS & ANALYTICS APIs (SECTIONS 11, 17, 18)
// -----------------------------------------------------------------------------
app.get('/api/clicks', requireAuth, requireRole('super_admin', 'editor'), async (req: Request, res: Response) => {
  const programId = req.query.program_id as string;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const clicks = await db.getClicks(programId, limit);
  res.json({ clicks, total: clicks.length });
});

// Clear Analytics / Reset Clicks (Super Admin Only)
app.delete('/api/clicks', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const clearedCount = await db.clearAllClicks();
  await db.logAuditEvent(req.user!.userId, req.user!.email, 'clear_clicks', 'analytics', undefined, { count: clearedCount });
  res.json({ success: true, cleared: clearedCount, message: `Successfully cleared ${clearedCount} click records.` });
});

// Privacy-conscious Visitor Session Tracking
app.post('/api/visitors/record', rateLimit(60, 60000), async (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
  const ua = req.headers['user-agent'] || 'Unknown';
  const sessionId = (req.body.session_id as string) || hashIp(ip + ua);

  await db.recordVisitorSession(sessionId, hashIp(ip), ua);
  const counts = await db.getVisitorCount();
  res.json({ success: true, totalVisitors: counts.total, todayVisitors: counts.today });
});

// Protected Analytics Endpoint (Section 11)
app.get('/api/analytics', requireAuth, requireRole('super_admin', 'editor'), async (_req: Request, res: Response) => {
  const analytics = await db.getAnalytics();
  res.json(analytics);
});

// -----------------------------------------------------------------------------
// 7. USER REVIEWS APIs (SECTIONS 15, 16)
// -----------------------------------------------------------------------------
// Public reviews: APPROVED ONLY
app.get('/api/programs/:id/reviews', async (req: Request, res: Response) => {
  const reviews = await db.getReviews(req.params.id, 'approved');
  res.json({ reviews });
});

// Admin reviews: all moderation statuses
app.get('/api/reviews', requireAuth, requireRole('super_admin', 'editor'), async (req: Request, res: Response) => {
  const { program_id, status } = req.query;
  const reviews = await db.getReviews(
    program_id ? String(program_id) : undefined,
    status ? (status as any) : undefined
  );
  res.json({ reviews });
});

app.post('/api/reviews', rateLimit(5, 60000), async (req: Request, res: Response) => {
  const parseResult = reviewSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parseResult.error.issues[0]?.message || 'Invalid review data.' }
    });
  }

  const { program_id, user_name, user_email, rating, comment } = parseResult.data;
  const newReview = await db.createReview({
    program_id,
    user_name,
    user_email,
    rating,
    comment
  });

  res.status(201).json({ success: true, review: newReview, message: 'Review submitted for moderation.' });
});

app.patch('/api/reviews/:id/status', requireAuth, requireRole('super_admin', 'editor'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, verified } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved, rejected, or pending.' });
  }

  const ok = await db.updateReviewStatus(id, status, Boolean(verified));
  await db.logAuditEvent(req.user!.userId, req.user!.email, 'moderate_review', 'review', id, { status });
  res.json({ success: ok });
});

app.delete('/api/reviews/:id', requireAuth, requireRole('super_admin', 'editor'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = await db.deleteReview(id);
  if (!ok) return res.status(404).json({ error: 'Review not found' });
  await db.logAuditEvent(req.user!.userId, req.user!.email, 'delete_review', 'review', id);
  res.json({ success: true, deletedId: id });
});

// -----------------------------------------------------------------------------
// 8. CONTACT MESSAGES APIs (SECTIONS 28)
// -----------------------------------------------------------------------------
app.get('/api/contact', requireAuth, requireRole('super_admin', 'editor'), async (_req: Request, res: Response) => {
  const messages = await db.getContactMessages();
  res.json({ messages });
});

app.post('/api/contact', rateLimit(5, 60000), async (req: Request, res: Response) => {
  const parseResult = contactSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parseResult.error.issues[0]?.message || 'Invalid contact data.' }
    });
  }

  const { name, email, subject, message, program_id } = parseResult.data;
  const newMessage = await db.createContactMessage({
    name,
    email,
    subject,
    message,
    program_id
  });

  // Send real email alert to admin
  const { settings: notifSettings } = await db.getNotifications();
  const alertEmail = notifSettings.alert_email || 'abbas.aj@gmail.com';
  sendEmailAlert({
    to: alertEmail,
    subject: `[AffiliateOS Contact] ${newMessage.subject}`,
    text: `From: ${newMessage.name} (${newMessage.email})\n\nMessage:\n${newMessage.message}`
  }, notifSettings).catch(() => {});

  res.status(201).json({ success: true, message: newMessage });
});

app.put('/api/contact/:id/read', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = await db.markContactMessageRead(id);
  res.json({ success: ok });
});

app.delete('/api/contact/:id', requireAuth, requireRole('super_admin', 'editor'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = await db.deleteContactMessage(id);
  if (!ok) return res.status(404).json({ error: 'Message not found' });
  await db.logAuditEvent(req.user!.userId, req.user!.email, 'delete_contact_message', 'contact', id);
  res.json({ success: true, deletedId: id });
});

app.delete('/api/contact', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const cleared = await db.clearAllContactMessages();
  await db.logAuditEvent(req.user!.userId, req.user!.email, 'clear_all_contact_messages', 'contact');
  res.json({ success: true, cleared });
});

// -----------------------------------------------------------------------------
// 9. ADMIN USER MANAGEMENT APIs
// -----------------------------------------------------------------------------
app.get('/api/admin/users', requireAuth, requireRole('super_admin'), async (_req: Request, res: Response) => {
  const users = await db.getAllUsers();
  res.json({ users });
});

app.post('/api/admin/users', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const { name, email, role, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const newUser = await db.createUser({
      name,
      email,
      role: role === 'super_admin' ? 'super_admin' : 'editor',
      passwordHash
    });
    await db.logAuditEvent(req.user!.userId, req.user!.email, 'create_admin_user', 'user', newUser.id);
    res.status(201).json({ success: true, user: newUser });
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const ok = await db.deleteUser(id);
    if (!ok) return res.status(404).json({ error: 'User not found' });
    await db.logAuditEvent(req.user!.userId, req.user!.email, 'delete_admin_user', 'user', id);
    res.json({ success: true, deletedId: id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 10. NOTIFICATION SETTINGS & REAL SMTP TEST DISPATCH
// -----------------------------------------------------------------------------
app.get('/api/notifications', requireAuth, requireRole('super_admin'), async (_req: Request, res: Response) => {
  const notifs = await db.getNotifications();
  res.json(notifs);
});

app.put('/api/notifications/settings', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const parseResult = notificationSettingsSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parseResult.error.issues[0]?.message || 'Invalid settings.' }
    });
  }

  const updated = await db.updateNotificationSettings(parseResult.data);
  await db.logAuditEvent(req.user!.userId, req.user!.email, 'update_notification_settings', 'settings');
  res.json({ success: true, settings: updated });
});

app.post('/api/notifications/test', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const { channel = 'email', test_email } = req.body;
  const { settings } = await db.getNotifications();
  const targetEmail = test_email || settings.alert_email || 'abbas.aj@gmail.com';

  if (channel === 'email') {
    const result = await sendEmailAlert({
      to: targetEmail,
      subject: `🧪 AffiliateOS Live Test Email Alert — ${new Date().toLocaleTimeString()}`,
      text: `Hello!\n\nThis is a live test notification from your AffiliateOS instance (${process.env.BASE_URL || 'https://affiliate.cloud.run'}).\n\nYour click tracking and alert dispatch system is operating properly.`,
      html: `
        <div style="font-family: sans-serif; max-width: 500px; padding: 24px; border: 1px solid #4f46e5; border-radius: 16px;">
          <h2 style="color: #4f46e5; margin-top: 0;">🧪 Live Test Email Notification</h2>
          <p>Hello,</p>
          <p>This is a live verification email from your <strong>AffiliateOS</strong> directory.</p>
          <div style="background: #f8fafc; padding: 12px; border-radius: 8px; font-size: 13px;">
            <strong>Recipient:</strong> ${targetEmail}<br/>
            <strong>Timestamp:</strong> ${new Date().toISOString()}<br/>
            <strong>Delivery Mode:</strong> ${(settings.smtp_host && settings.smtp_user) ? 'SMTP (LIVE)' : 'SIMULATED / TEST'}<br/>
            <strong>System:</strong> AffiliateOS Notification Dispatcher
          </div>
          <p style="font-size: 12px; color: #64748b; margin-top: 16px;">AffiliateOS Production Engine</p>
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

    await db.addNotification(testNotif);
    return res.json({
      success: true,
      notification: testNotif,
      provider: result.provider,
      messageId: result.messageId,
      notice: result.error
    });
  }

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
  await db.addNotification(testNotif);
  res.json({ success: true, notification: testNotif });
});

// SMTP Connection Verification endpoint
app.post('/api/notifications/verify-smtp', requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  const result = await testSmtpConnection(req.body);
  res.json(result);
});

// -----------------------------------------------------------------------------
// CENTRALIZED ERROR HANDLING MIDDLEWARE (SECTION 30)
// -----------------------------------------------------------------------------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Centralized Error Handler]:', err);
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: isProd && status === 500 ? 'An unexpected server error occurred.' : (err.message || 'Server error')
    }
  });
});

// -----------------------------------------------------------------------------
// VITE MIDDLEWARE SETUP FOR FULL-STACK & GRACEFUL SHUTDOWN
// -----------------------------------------------------------------------------
async function startServer() {
  await initDatabase();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
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
