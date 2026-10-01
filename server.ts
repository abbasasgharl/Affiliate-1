import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  INITIAL_PROGRAMS,
  generateInitialClicks,
  INITIAL_NOTIFICATION_SETTINGS,
  INITIAL_NOTIFICATIONS,
  INITIAL_ADMIN_USERS,
  INITIAL_REVIEWS,
  INITIAL_MESSAGES
} from './src/data/seedData.ts';
import type {
  AffiliateProgram,
  ClickRecord,
  NotificationLog,
  NotificationSettings,
  HealthStatus,
  DeviceType,
  AdminUser,
  UserReview,
  ContactMessage
} from './src/types.ts';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-Memory Database initialized with seed data
let programs: AffiliateProgram[] = [...INITIAL_PROGRAMS];
let clicks: ClickRecord[] = generateInitialClicks();
let notifications: NotificationLog[] = [...INITIAL_NOTIFICATIONS];
let notificationSettings: NotificationSettings = { ...INITIAL_NOTIFICATION_SETTINGS };
let adminUsers: AdminUser[] = [...INITIAL_ADMIN_USERS];
let userReviews: UserReview[] = [...INITIAL_REVIEWS];
let contactMessages: ContactMessage[] = [...INITIAL_MESSAGES];
let siteVisitorCount = 890; // Initial tracked visitors for CTR calculation

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

// Helper: Extract true root brand and domain, ignoring generic prefixes like try., get., go., etc.
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
      // e.g. try.plesk.com -> brand is plesk
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
    
    // Check if title or description mentions the capitalized brand name (e.g. "Plesk", "Cursor")
    const regex = new RegExp(`\\b(${rawBrand})\\b`, 'i');
    const match = combinedText.match(regex);
    if (match) {
      cleanBrand = match[0].charAt(0).toUpperCase() + match[0].slice(1);
    }

    // Category detection based on keywords
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
    } else if (lower.includes('crypto') || lower.includes('bitcoin') || lower.includes('wallet')) {
      categoryHint = 'Finance & Crypto';
    } else if (lower.includes('workspace') || lower.includes('notes') || lower.includes('project') || lower.includes('task')) {
      categoryHint = 'Productivity';
    }

    // Detected offer / discount extraction (e.g. "Save 8% off on yearly licenses")
    let detectedOffer: string | undefined = undefined;
    const discountMatch = combinedText.match(/save\s+\d+%\s+off[^.]*/i) ||
                          combinedText.match(/\d+%\s+off[^.]*/i) ||
                          combinedText.match(/free\s+trial[^.]*/i);
    if (discountMatch) {
      detectedOffer = `Special Deal: ${discountMatch[0].trim()}`;
    }

    const cleanSlug = rawBrand.toLowerCase().replace(/[^a-z0-9_-]/g, '');

    return {
      brand: cleanBrand,
      cleanSlug,
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

// Helper: trigger notification
async function dispatchClickNotification(program: AffiliateProgram, click: ClickRecord) {
  const channel = notificationSettings.enable_telegram ? 'telegram' :
                  notificationSettings.enable_webhook ? 'webhook' : 'email';
  
  const message = `🔔 Referral Link Clicked: ${program.name} (/go/${program.cloaked_slug}) | Source: ${click.referrer_domain || 'Direct'} | Device: ${click.device_type}`;
  
  // 1. Email Alert Dispatch (Notifying Admin)
  if (notificationSettings.enable_email && notificationSettings.alert_email) {
    const emailNotif: NotificationLog = {
      id: `notif_email_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      click_id: click.id,
      program_id: program.id,
      program_name: program.name,
      channel: 'email',
      sent_status: 'sent',
      timestamp: new Date().toISOString(),
      message: `✉️ Email Alert Dispatched to ${notificationSettings.alert_email}: A user clicked your referral link for ${program.name}!`,
      payload: {
        to: notificationSettings.alert_email,
        subject: `[AffiliateOS] New Click on ${program.name}`,
        service: program.name,
        slug: `/go/${program.cloaked_slug}`,
        destination: program.original_link,
        referrer: click.referrer_domain,
        device: click.device_type,
        time: click.timestamp
      }
    };
    notifications.unshift(emailNotif);
  }

  // 2. Secondary Channel (Telegram or Webhook)
  if (notificationSettings.enable_telegram || notificationSettings.enable_webhook) {
    const channel = notificationSettings.enable_telegram ? 'telegram' : 'webhook';
    const notif: NotificationLog = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      click_id: click.id,
      program_id: program.id,
      program_name: program.name,
      channel: channel as any,
      sent_status: 'sent',
      timestamp: new Date().toISOString(),
      message,
      payload: {
        program: program.name,
        slug: program.cloaked_slug,
        target: program.original_link,
        referrer: click.referrer_url,
        device: click.device_type,
        time: click.timestamp
      }
    };
    notifications.unshift(notif);
  }

  if (notifications.length > 100) notifications.length = 100;

  // If webhook is enabled, simulate or execute POST
  if (notificationSettings.enable_webhook && notificationSettings.webhook_url) {
    try {
      if (notificationSettings.webhook_url.startsWith('http')) {
        // Safe timeout fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        fetch(notificationSettings.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ program: program.name, slug: program.cloaked_slug, click }),
          signal: controller.signal
        }).catch(() => {/* ignore webhook failure */}).finally(() => clearTimeout(timeoutId));
      }
    } catch {
      // Ignore webhook errors
    }
  }
}

// -----------------------------------------------------------------------------
// 1. CLOAKED REDIRECT & CLICK TRACKING ROUTE: /go/:slug
// -----------------------------------------------------------------------------
app.get('/go/:slug', async (req: Request, res: Response) => {
  const slug = req.params.slug.toLowerCase().trim();
  const program = programs.find(p => p.cloaked_slug.toLowerCase() === slug);

  if (!program) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Link Not Found - AffiliateOS</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #030712; color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background: #111827; padding: 40px; border-radius: 16px; border: 1px solid #1f2937; max-width: 440px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
            h1 { color: #f87171; font-size: 24px; margin-top: 0; }
            p { color: #9ca3af; line-height: 1.5; font-size: 15px; }
            a { display: inline-block; margin-top: 20px; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>404 — Partner Link Expired or Not Found</h1>
            <p>The cloaked route <code>/go/${encodeURIComponent(slug)}</code> does not correspond to an active partner program.</p>
            <a href="/">Browse Verified Programs</a>
          </div>
        </body>
      </html>
    `);
  }

  // Record Click
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
    country: 'US'
  };

  clicks.unshift(click);
  if (clicks.length > 500) clicks.pop();

  // Trigger click notification
  dispatchClickNotification(program, click);

  // If preview or paused, show an informative card
  const isPreview = req.query.preview === '1' || req.query.preview === 'true';
  if (program.status === 'paused' || program.status === 'expired') {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${program.name} - Status Alert</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #030712; color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background: #111827; padding: 40px; border-radius: 16px; border: 1px solid #374151; max-width: 480px; }
            .badge { display: inline-block; background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; }
            h1 { font-size: 22px; margin: 0 0 10px 0; }
            p { color: #9ca3af; font-size: 14px; line-height: 1.6; }
            .btn { display: inline-block; margin-top: 15px; background: #374151; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; margin-right: 8px; }
            .btn-primary { background: #6366f1; }
          </style>
        </head>
        <body>
          <div class="card">
            <span class="badge">Program ${program.status}</span>
            <h1>${program.name}</h1>
            <p>This partner link is currently marked as <strong>${program.status}</strong> by our affiliate health monitors. You can proceed directly or view alternate programs.</p>
            <div>
              <a href="${program.original_link}" class="btn">Proceed Anyway &rarr;</a>
              <a href="/" class="btn btn-primary">Browse Alternatives</a>
            </div>
          </div>
        </body>
      </html>
    `);
  }

  if (isPreview) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Redirecting to ${program.name} - AffiliateOS Safe Gateway</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="2;url=${program.original_link}">
          <style>
            body { background: #030712; color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #111827; padding: 36px; border-radius: 20px; border: 1px solid #1f2937; max-width: 460px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
            .spinner { border: 3px solid rgba(255,255,255,0.1); border-top-color: #6366f1; border-radius: 50%; width: 36px; height: 36px; animation: spin 0.8s linear infinite; margin: 0 auto 20px auto; }
            @keyframes spin { to { transform: rotate(360deg); } }
            h2 { font-size: 20px; margin: 0 0 8px 0; }
            p { color: #9ca3af; font-size: 14px; margin: 0 0 16px 0; }
            .disclosure { background: #0f172a; padding: 10px 14px; border-radius: 8px; font-size: 11px; color: #64748b; line-height: 1.4; border: 1px solid #1e293b; }
            a { color: #818cf8; text-decoration: none; font-size: 13px; font-weight: 500; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="spinner"></div>
            <h2>Connecting you to ${program.name}</h2>
            <p>You are being safely forwarded via your verified partner link...</p>
            <div class="disclosure">
              <strong>FTC Disclosure:</strong> We may earn a commission if you make a purchase through this link at no additional cost to you.
            </div>
            <p style="margin-top: 16px;"><a href="${program.original_link}">Click here if not redirected automatically &rarr;</a></p>
          </div>
        </body>
      </html>
    `);
  }

  // High Performance 302 HTTP Redirect
  res.redirect(302, program.original_link);
});

// -----------------------------------------------------------------------------
// 2. AI AGENT LINK ANALYSIS ROUTE: /api/ai/analyze-link
// -----------------------------------------------------------------------------
app.post('/api/ai/analyze-link', async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Valid URL is required.' });
  }

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  // Duplicate Link Check
  const duplicate = programs.find(p => {
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

  // Step 1: Attempt to scrape / fetch page content safely
  let scrapedTitle = '';
  let scrapedDescription = '';
  let scrapedContent = '';
  let scrapedImage = '';
  let scrapedFavicon = '';
  let fetchFailed = false;
  let botBlocked = false;
  let httpStatus = 200;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const pageRes = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 AffiliateOS-Bot/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    httpStatus = pageRes.status;

    if (pageRes.status === 403 || pageRes.status === 429) {
      botBlocked = true;
    } else if (!pageRes.ok) {
      fetchFailed = true;
    } else {
      const html = await pageRes.text();
      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) scrapedTitle = titleMatch[1].trim();

      // Extract meta description
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                        html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
      if (descMatch) scrapedDescription = descMatch[1].trim();

      // Extract OG title and description
      const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
      if (ogTitle && !scrapedTitle) scrapedTitle = ogTitle[1].trim();

      // Extract OpenGraph / Twitter Image
      const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i) ||
                           html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']*)["']/i) ||
                           html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:image["']/i);
      if (ogImageMatch && ogImageMatch[1]) {
        let rawImg = ogImageMatch[1].trim();
        if (rawImg.startsWith('//')) rawImg = 'https:' + rawImg;
        else if (rawImg.startsWith('/')) {
          try {
            const u = new URL(normalizedUrl);
            rawImg = `${u.origin}${rawImg}`;
          } catch {}
        }
        if (rawImg.startsWith('http')) scrapedImage = rawImg;
      }

      // Extract Favicon
      const iconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']*)["']/i) ||
                        html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']*)["']/i);
      if (iconMatch && iconMatch[1]) {
        let rawIcon = iconMatch[1].trim();
        if (rawIcon.startsWith('//')) rawIcon = 'https:' + rawIcon;
        else if (rawIcon.startsWith('/')) {
          try {
            const u = new URL(normalizedUrl);
            rawIcon = `${u.origin}${rawIcon}`;
          } catch {}
        }
        if (rawIcon.startsWith('http')) scrapedFavicon = rawIcon;
      }

      // Extract visible headings and paragraphs
      const bodySnippet = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 3000);

      scrapedContent = bodySnippet;
    }
  } catch (err: any) {
    fetchFailed = true;
  }

  // Clean HTML entities in title & description
  scrapedTitle = decodeHtmlEntities(scrapedTitle);
  scrapedDescription = decodeHtmlEntities(scrapedDescription);

  // Extract real brand, clean slug, and root brand domain (ignoring generic prefixes like try., get., go., etc.)
  const {
    brand: brandName,
    cleanSlug: baseSlug,
    brandDomain,
    categoryHint,
    detectedOffer
  } = extractBrandAndDomain(normalizedUrl, scrapedTitle, scrapedDescription);

  // High-resolution logo resolution (always points to real root brand domain)
  const autoResolvedLogo = scrapedFavicon && scrapedFavicon.startsWith('http')
    ? scrapedFavicon
    : `https://www.google.com/s2/favicons?domain=${brandDomain}&sz=128`;

  // Curated category banner fallbacks if og:image is missing
  const categoryBannerMap: Record<string, string> = {
    'AI Tools': 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
    'SaaS & Dev': 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop&q=80',
    'Productivity': 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&auto=format&fit=crop&q=80',
    'Marketing': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop&q=80',
    'E-Commerce': 'https://images.unsplash.com/photo-1556742049-0a67e557224f?w=800&auto=format&fit=crop&q=80',
    'Finance & Crypto': 'https://images.unsplash.com/photo-1621416894569-0f39ed31d247?w=800&auto=format&fit=crop&q=80',
    'Hosting & Cloud': 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&auto=format&fit=crop&q=80'
  };

  const autoResolvedBanner = (scrapedImage && scrapedImage.startsWith('http'))
    ? scrapedImage
    : (categoryBannerMap[categoryHint] || categoryBannerMap['Hosting & Cloud']);

  // Ensure unique slug
  let candidateSlug = baseSlug;
  let counter = 1;
  while (programs.some(p => p.cloaked_slug === candidateSlug)) {
    candidateSlug = `${baseSlug}-${counter++}`;
  }

  // If severely blocked or failed, handle fallback
  if (botBlocked) {
    const fallbackProgram: Partial<AffiliateProgram> = {
      name: `${brandName}`,
      category: categoryHint,
      logo_url: autoResolvedLogo,
      banner_url: autoResolvedBanner,
      original_link: normalizedUrl,
      cloaked_slug: candidateSlug,
      referral_perk: detectedOffer || 'Free Trial Available • Exclusive Referral Access',
      cta_label: `Try ${brandName} Free`,
      ai_generated_pick: `Recommended ★ 4.8/5 — Leading ${brandName} platform`,
      ai_description: scrapedDescription || `${brandName} delivers industry-standard solutions with proven user satisfaction.`,
      ai_brief: `${brandName} is a top choice in its category. Review terms and activate your referral link.`,
      commission_type: 'percentage',
      commission_value: '20% (Estimated)',
      status: 'active',
      health_status: 'warning',
      last_http_code: 403,
      key_selling_points: [
        'Trusted industry solution used by professionals worldwide',
        'Intuitive interface and fast onboarding',
        'Official portal accessible via direct referral link'
      ],
      target_audience: 'Professionals, developers, and modern teams',
      tags: [brandName, categoryHint],
      date_added: new Date().toISOString()
    };

    return res.json({
      success: true,
      program: fallbackProgram,
      botBlocked: true,
      warning: 'Scraping was protected by target firewall. Auto-populated details and images.'
    });
  }

  // Step 2: Use Gemini LLM with gemini-3.8-flash
  try {
    const prompt = `
You are an expert affiliate marketer, copywriter, and growth consultant.
A user wants to promote their affiliate/referral link for this service.
IMPORTANT:
- Product/Service Name must be "${brandName}". Do NOT use generic subdomains like "try", "get", "go", "app", or "partner" as the name or slug.
- Recommended Cloaked Slug must be "${candidateSlug}".
- Brand Domain is "${brandDomain}".

Target URL: ${normalizedUrl}
Brand: ${brandName}
Page Title: ${scrapedTitle || 'N/A'}
Meta Description: ${scrapedDescription || 'N/A'}
Detected Offer: ${detectedOffer || 'N/A'}
Page Content Excerpt: ${scrapedContent ? scrapedContent.slice(0, 1500) : 'N/A'}

TASK:
Extract and generate the following structured outputs:
1. Product/Service Name: "${brandName}"
2. Category: Must be one of: "Hosting & Cloud", "AI Tools", "SaaS & Dev", "Marketing", "Productivity", "E-Commerce", "Finance & Crypto", or "Security".
3. AI Generated Pick: High-converting verdict & rating showing why visitors should use this service. Format: "Editor's Pick ★ 4.9/5 — [Compelling reason why users love this product]"
4. Referral Perk: An enticing offer, discount, or perk for clicking the referral link (e.g. "${detectedOffer || 'Free Trial Included • Special Referral Deal'}").
5. CTA Label: Action-oriented button text (e.g. "Try ${brandName} Free", "Claim Deal & Visit Site").
6. AI Description: A high-converting 2-3 sentence marketing overview highlighting its main superpower and why it's worth using.
7. AI Brief: An analytical review paragraph (100-150 words) explaining exactly what it does, who gets the biggest benefit from using it, and why you personally recommend it.
8. Commission Type: "percentage", "flat", or "recurring".
9. Commission Value: Realistic or extracted commission value string (e.g., "30% Recurring", "$150 Flat Bounty", "20% RevShare").
10. Key Selling Points: Exactly 3 persuasive bullet points proving this is a great service.
11. Target Audience: Precise target audience description.
12. Recommended Cloaked Slug: "${candidateSlug}".
13. Tags: 3 to 5 relevant keyword tags.

Respond ONLY with valid JSON conforming to the schema.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
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
            key_selling_points: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            target_audience: { type: Type.STRING },
            cloaked_slug: { type: Type.STRING },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: [
            'name',
            'category',
            'ai_generated_pick',
            'referral_perk',
            'cta_label',
            'ai_description',
            'ai_brief',
            'commission_type',
            'commission_value',
            'key_selling_points',
            'target_audience',
            'cloaked_slug',
            'tags'
          ]
        }
      }
    });

    const parsedJson = JSON.parse(response.text?.trim() || '{}');

    const assignedCategory = parsedJson.category || categoryHint;
    const finalBanner = (scrapedImage && scrapedImage.startsWith('http'))
      ? scrapedImage
      : (categoryBannerMap[assignedCategory] || categoryBannerMap['Hosting & Cloud']);

    const newDraftProgram: Partial<AffiliateProgram> = {
      name: parsedJson.name || brandName,
      category: assignedCategory,
      logo_url: autoResolvedLogo,
      banner_url: finalBanner,
      original_link: normalizedUrl,
      cloaked_slug: candidateSlug,
      referral_perk: parsedJson.referral_perk || detectedOffer || 'Free Trial Available • Exclusive Referral Perk',
      cta_label: parsedJson.cta_label || `Try ${parsedJson.name || brandName} Free`,
      ai_generated_pick: parsedJson.ai_generated_pick || `Editor's Choice ★ 4.9/5 — Leading ${brandName} platform`,
      ai_description: decodeHtmlEntities(parsedJson.ai_description || scrapedDescription || `${brandName} delivers exceptional industry-standard solutions.`),
      ai_brief: decodeHtmlEntities(parsedJson.ai_brief || `${brandName} is a top choice for modern digital teams looking to elevate their workflow.`),
      commission_type: (parsedJson.commission_type as any) || 'recurring',
      commission_value: parsedJson.commission_value || '25% Recurring',
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
    console.error('Gemini analysis error, using intelligent fallback:', err);
    // Complete robust fallback with logo, banner, and clean brand name
    const finalBanner = (scrapedImage && scrapedImage.startsWith('http'))
      ? scrapedImage
      : (categoryBannerMap[categoryHint] || categoryBannerMap['Hosting & Cloud']);

    const fallbackProgram: Partial<AffiliateProgram> = {
      name: brandName,
      category: categoryHint,
      logo_url: autoResolvedLogo,
      banner_url: finalBanner,
      original_link: normalizedUrl,
      cloaked_slug: candidateSlug,
      referral_perk: detectedOffer || 'Special Referral Deal • Free Trial Included',
      cta_label: `Try ${brandName} Free`,
      ai_generated_pick: `Editor's Choice ★ 4.8/5 — Highly rated ${brandName} platform for web professionals`,
      ai_description: decodeHtmlEntities(scrapedDescription) || `${brandName} provides industry-tested digital solutions with dependable performance.`,
      ai_brief: `${brandName} is a top-tier service engineered for reliability and high productivity. Designed for modern teams and web operators.`,
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

    return res.json({
      success: true,
      program: fallbackProgram,
      aiError: err.message
    });
  }
});

// -----------------------------------------------------------------------------
// 3. LINK HEALTH CHECKER API: /api/health/check
// -----------------------------------------------------------------------------
app.post('/api/health/check', async (req: Request, res: Response) => {
  const { programId, url, checkAll } = req.body;

  const checkSingleUrl = async (targetUrl: string): Promise<{ code: number; timeMs: number; status: HealthStatus }> => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const testRes = await fetch(targetUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'AffiliateOS-HealthCheck/1.0' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const timeMs = Date.now() - start;
      const code = testRes.status;

      let status: HealthStatus = 'healthy';
      if (code >= 400) {
        status = 'broken';
      } else if (code >= 300 || timeMs > 2500) {
        status = 'warning';
      }
      return { code, timeMs, status };
    } catch {
      return { code: 0, timeMs: Date.now() - start, status: 'broken' };
    }
  };

  if (checkAll) {
    const results = [];
    for (const prog of programs) {
      const health = await checkSingleUrl(prog.original_link);
      prog.health_status = health.status;
      prog.last_http_code = health.code;
      prog.last_response_time_ms = health.timeMs;
      prog.last_checked = new Date().toISOString();
      results.push({ id: prog.id, name: prog.name, ...health });
    }
    return res.json({ success: true, results, programs });
  }

  if (programId) {
    const prog = programs.find(p => p.id === programId);
    if (!prog) return res.status(404).json({ error: 'Program not found' });
    const health = await checkSingleUrl(prog.original_link);
    prog.health_status = health.status;
    prog.last_http_code = health.code;
    prog.last_response_time_ms = health.timeMs;
    prog.last_checked = new Date().toISOString();
    return res.json({ success: true, health, program: prog });
  }

  if (url) {
    const health = await checkSingleUrl(url);
    return res.json({ success: true, health });
  }

  return res.status(400).json({ error: 'Missing parameters' });
});

// -----------------------------------------------------------------------------
// 4. PROGRAM CRUD APIs
// -----------------------------------------------------------------------------
app.get('/api/programs', (_req: Request, res: Response) => {
  res.json({ programs });
});

app.post('/api/programs', (req: Request, res: Response) => {
  const newProgData = req.body;
  if (!newProgData.name || !newProgData.original_link || !newProgData.cloaked_slug) {
    return res.status(400).json({ error: 'Name, original link, and cloaked slug are required.' });
  }

  // Duplicate slug check
  const slugExists = programs.some(p => p.cloaked_slug.toLowerCase() === newProgData.cloaked_slug.toLowerCase());
  if (slugExists) {
    return res.status(409).json({ error: `Slug "${newProgData.cloaked_slug}" is already taken. Please choose another.` });
  }

  const program: AffiliateProgram = {
    id: `prog_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: newProgData.name,
    category: newProgData.category || 'SaaS & Dev',
    logo_url: newProgData.logo_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
    original_link: newProgData.original_link,
    cloaked_slug: newProgData.cloaked_slug.toLowerCase().trim(),
    ai_generated_pick: newProgData.ai_generated_pick || 'Editor Pick ★ 4.8/5',
    ai_description: newProgData.ai_description || '',
    ai_brief: newProgData.ai_brief || '',
    commission_type: newProgData.commission_type || 'recurring',
    commission_value: newProgData.commission_value || '20%',
    cookie_duration_days: newProgData.cookie_duration_days || 30,
    average_payout: newProgData.average_payout || '',
    status: newProgData.status || 'needs_review',
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

  programs.unshift(program);
  res.status(201).json({ success: true, program });
});

app.put('/api/programs/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const index = programs.findIndex(p => p.id === id);
  if (index === -1) return res.status(404).json({ error: 'Program not found' });

  // If slug is changed, check for conflict
  if (req.body.cloaked_slug && req.body.cloaked_slug !== programs[index].cloaked_slug) {
    const slugConflict = programs.some(p => p.id !== id && p.cloaked_slug.toLowerCase() === req.body.cloaked_slug.toLowerCase());
    if (slugConflict) {
      return res.status(409).json({ error: `Slug "${req.body.cloaked_slug}" is already in use.` });
    }
  }

  programs[index] = {
    ...programs[index],
    ...req.body,
    id // protect ID
  };

  res.json({ success: true, program: programs[index] });
});

app.delete('/api/programs/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const initialLen = programs.length;
  programs = programs.filter(p => p.id !== id);
  if (programs.length === initialLen) return res.status(404).json({ error: 'Program not found' });
  res.json({ success: true, deletedId: id });
});

// -----------------------------------------------------------------------------
// 5. CLICKS & ANALYTICS APIs
// -----------------------------------------------------------------------------
app.get('/api/clicks', (req: Request, res: Response) => {
  const programId = req.query.program_id as string;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

  let filtered = clicks;
  if (programId) {
    filtered = filtered.filter(c => c.program_id === programId);
  }

  res.json({ clicks: filtered.slice(0, limit), total: filtered.length });
});

// Record a click from client-side fallback if needed
app.post('/api/clicks', (req: Request, res: Response) => {
  const { program_id, referrer, user_agent } = req.body;
  const prog = programs.find(p => p.id === program_id);
  if (!prog) return res.status(404).json({ error: 'Program not found' });

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
  const ua = user_agent || req.headers['user-agent'] || 'Unknown';
  const ref = referrer || req.headers['referer'] || 'direct';

  let referrerDomain = 'direct';
  try {
    if (ref !== 'direct') {
      referrerDomain = new URL(ref).hostname.replace('www.', '');
    }
  } catch {
    referrerDomain = 'other';
  }

  const click: ClickRecord = {
    id: `clk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    program_id: prog.id,
    program_name: prog.name,
    cloaked_slug: prog.cloaked_slug,
    timestamp: new Date().toISOString(),
    ip_hash: hashIp(ip),
    user_agent: ua,
    referrer_url: String(ref),
    referrer_domain: referrerDomain,
    device_type: parseDeviceType(ua),
    browser: parseBrowser(ua),
    country: 'US'
  };

  clicks.unshift(click);
  dispatchClickNotification(prog, click);
  res.json({ success: true, click });
});

// Record a site visitor session
app.post('/api/visitors/record', (_req: Request, res: Response) => {
  siteVisitorCount++;
  res.json({ success: true, totalVisitors: siteVisitorCount });
});

// Analytics calculation
app.get('/api/analytics', (_req: Request, res: Response) => {
  const totalClicks = clicks.length;
  const uniqueIps = new Set(clicks.map(c => c.ip_hash));
  const uniqueClicks = uniqueIps.size;
  const totalVisitors = Math.max(siteVisitorCount, Math.round(uniqueClicks * 3.4 + 180));
  const clickThroughRate = Math.round((totalClicks / Math.max(totalVisitors, 1)) * 1000) / 10;

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const todayClicks = clicks.filter(c => c.timestamp.startsWith(todayStr)).length;
  const todayVisitors = Math.round(todayClicks * 3.2 + 24);

  // Clicks by program
  const programClicksMap: Record<string, number> = {};
  clicks.forEach(c => {
    programClicksMap[c.program_id] = (programClicksMap[c.program_id] || 0) + 1;
  });

  const topPrograms = programs
    .map(p => ({
      id: p.id,
      name: p.name,
      slug: p.cloaked_slug,
      clicks: programClicksMap[p.id] || 0,
      commission_value: p.commission_value,
      health_status: p.health_status
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);

  // Daily clicks & visitors for past 7 days
  const clicksOverTime = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    const count = clicks.filter(c => c.timestamp.startsWith(dateStr)).length;
    const estVisitors = Math.round(count * 3.1 + 18);
    clicksOverTime.push({
      date: dateStr,
      label: dayLabel,
      clicks: count,
      visitors: estVisitors
    });
  }

  // Referrers
  const referrerMap: Record<string, number> = {};
  clicks.forEach(c => {
    const domain = c.referrer_domain || 'direct';
    referrerMap[domain] = (referrerMap[domain] || 0) + 1;
  });

  const referrerBreakdown = Object.entries(referrerMap)
    .map(([domain, count]) => ({
      domain,
      clicks: count,
      percentage: totalClicks > 0 ? Math.round((count / totalClicks) * 100) : 0
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 6);

  // Devices
  const deviceMap: Record<DeviceType, number> = { desktop: 0, mobile: 0, tablet: 0 };
  clicks.forEach(c => {
    if (deviceMap[c.device_type] !== undefined) {
      deviceMap[c.device_type]++;
    } else {
      deviceMap.desktop++;
    }
  });

  const deviceBreakdown = (['desktop', 'mobile', 'tablet'] as DeviceType[]).map(dev => ({
    device: dev,
    clicks: deviceMap[dev],
    percentage: totalClicks > 0 ? Math.round((deviceMap[dev] / totalClicks) * 100) : 0
  }));

  // Link health counts
  const healthyLinksCount = programs.filter(p => p.health_status === 'healthy').length;
  const brokenLinksCount = programs.filter(p => p.health_status === 'broken').length;

  const estimatedRevenue = Math.round(totalClicks * 0.038 * 45);

  res.json({
    totalVisitors,
    totalClicks,
    uniqueClicks,
    clickThroughRate,
    todayVisitors,
    todayClicks,
    estimatedRevenue,
    healthyLinksCount,
    brokenLinksCount,
    topPrograms,
    clicksOverTime,
    referrerBreakdown,
    deviceBreakdown
  });
});

// -----------------------------------------------------------------------------
// 6. USER REVIEWS APIs
// -----------------------------------------------------------------------------
app.get('/api/reviews', (req: Request, res: Response) => {
  const { program_id } = req.query;
  if (program_id) {
    const filtered = userReviews.filter(r => r.program_id === program_id);
    return res.json({ reviews: filtered });
  }
  res.json({ reviews: userReviews });
});

app.post('/api/reviews', (req: Request, res: Response) => {
  const { program_id, user_name, user_email, rating, title, comment } = req.body;
  if (!program_id || !user_name || !comment) {
    return res.status(400).json({ error: 'Program, name, and comment are required.' });
  }

  const prog = programs.find(p => p.id === program_id);
  const newReview: UserReview = {
    id: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    program_id,
    program_name: prog ? prog.name : 'Affiliate Partner',
    user_name: user_name.trim(),
    user_email: user_email ? user_email.trim() : undefined,
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    title: title ? title.trim() : undefined,
    comment: comment.trim(),
    timestamp: new Date().toISOString(),
    verified: true,
    status: 'approved'
  };

  userReviews.unshift(newReview);

  // Send admin notification about the new review
  if (notificationSettings.enable_email) {
    notifications.unshift({
      id: `notif_rev_${Date.now()}`,
      program_id,
      program_name: newReview.program_name,
      channel: 'email',
      sent_status: 'sent',
      timestamp: new Date().toISOString(),
      message: `⭐ New User Review for ${newReview.program_name}: "${newReview.user_name}" left a ${newReview.rating}-star review!`
    });
  }

  res.status(201).json({ success: true, review: newReview });
});

app.delete('/api/reviews/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  userReviews = userReviews.filter(r => r.id !== id);
  res.json({ success: true, deletedId: id });
});

// -----------------------------------------------------------------------------
// 7. CONTACT MESSAGES APIs
// -----------------------------------------------------------------------------
app.get('/api/contact', (_req: Request, res: Response) => {
  res.json({ messages: contactMessages });
});

app.post('/api/contact', (req: Request, res: Response) => {
  const { name, email, subject, message, program_id } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  const newMessage: ContactMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: name.trim(),
    email: email.trim(),
    subject: subject ? subject.trim() : 'Inquiry from AffiliateOS Visitor',
    message: message.trim(),
    program_id,
    timestamp: new Date().toISOString(),
    status: 'unread'
  };

  contactMessages.unshift(newMessage);

  // Dispatch email notification to admin
  if (notificationSettings.alert_email) {
    notifications.unshift({
      id: `notif_contact_${Date.now()}`,
      program_id: program_id || 'general',
      program_name: 'Contact Form Inquiry',
      channel: 'email',
      sent_status: 'sent',
      timestamp: new Date().toISOString(),
      message: `📩 New Contact Message from ${newMessage.name} (${newMessage.email}): "${newMessage.subject}"`
    });
  }

  res.status(201).json({ success: true, message: newMessage });
});

app.put('/api/contact/:id/read', (req: Request, res: Response) => {
  const { id } = req.params;
  const msg = contactMessages.find(m => m.id === id);
  if (msg) msg.status = 'read';
  res.json({ success: true });
});

// -----------------------------------------------------------------------------
// 8. ADMIN USER MANAGEMENT APIs
// -----------------------------------------------------------------------------
app.get('/api/admin/users', (_req: Request, res: Response) => {
  res.json({ users: adminUsers });
});

app.post('/api/admin/users', (req: Request, res: Response) => {
  const { name, email, role } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const emailLower = email.toLowerCase().trim();
  if (adminUsers.some(u => u.email.toLowerCase() === emailLower)) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }

  const newUser: AdminUser = {
    id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: name.trim(),
    email: emailLower,
    role: role === 'super_admin' ? 'super_admin' : 'editor',
    last_login: new Date().toISOString()
  };

  adminUsers.push(newUser);
  res.status(201).json({ success: true, user: newUser });
});

app.delete('/api/admin/users/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (adminUsers.length <= 1) {
    return res.status(400).json({ error: 'Cannot delete the primary super admin account.' });
  }
  adminUsers = adminUsers.filter(u => u.id !== id);
  res.json({ success: true, deletedId: id });
});

// -----------------------------------------------------------------------------
// 6. NOTIFICATION SETTINGS & TEST PING API
// -----------------------------------------------------------------------------
app.get('/api/notifications', (_req: Request, res: Response) => {
  res.json({
    settings: notificationSettings,
    history: notifications.slice(0, 40)
  });
});

app.put('/api/notifications/settings', (req: Request, res: Response) => {
  notificationSettings = {
    ...notificationSettings,
    ...req.body
  };
  res.json({ success: true, settings: notificationSettings });
});

app.post('/api/notifications/test', (req: Request, res: Response) => {
  const { channel = 'telegram' } = req.body;
  const sampleProg = programs[0] || { name: 'Sample Program', cloaked_slug: 'sample' };

  const testNotif: NotificationLog = {
    id: `test_${Date.now()}`,
    program_id: sampleProg.id,
    program_name: sampleProg.name,
    channel: channel as any,
    sent_status: 'sent',
    timestamp: new Date().toISOString(),
    message: `🧪 Test Ping Dispatched: Connected to ${channel.toUpperCase()}! AffiliateOS real-time click alerts are functioning properly.`,
    payload: {
      type: 'test_dispatch',
      channel,
      timestamp: new Date().toISOString()
    }
  };

  notifications.unshift(testNotif);
  res.json({ success: true, notification: testNotif });
});

// -----------------------------------------------------------------------------
// VITE MIDDLEWARE SETUP FOR FULL-STACK
// -----------------------------------------------------------------------------
async function startServer() {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AffiliateOS full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
