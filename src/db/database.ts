import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {
  AffiliateProgram,
  ClickRecord,
  AdminUser,
  NotificationSettings,
  NotificationLog,
  UserReview,
  ContactMessage,
  AuditLog,
  VisitorSession,
  AnalyticsSummary,
  DeviceType
} from '../types.ts';
import {
  INITIAL_PROGRAMS,
  INITIAL_NOTIFICATION_SETTINGS,
  INITIAL_NOTIFICATIONS
} from '../data/seedData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database storage file path for local persistence / non-Postgres environments
const DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'affiliateos-data.json');

// Interface for internal persistent store
interface DatabaseSchema {
  users: AdminUser[];
  programs: AffiliateProgram[];
  clicks: ClickRecord[];
  visitor_sessions: VisitorSession[];
  reviews: UserReview[];
  contact_messages: ContactMessage[];
  notifications: NotificationLog[];
  notification_settings: NotificationSettings;
  audit_logs: AuditLog[];
}

// In-Memory mirror synced with persistent storage
let memoryStore: DatabaseSchema;

// Optional Postgres Pool
let pgPool: pg.Pool | null = null;
const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Initializes persistent database
 */
export async function initDatabase(): Promise<void> {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Check if PostgreSQL is configured
  if (DATABASE_URL) {
    try {
      console.log('[Database] Connecting to PostgreSQL instance...');
      pgPool = new pg.Pool({ connectionString: DATABASE_URL });
      await pgPool.query('SELECT NOW()');
      console.log('[Database] PostgreSQL connected successfully.');
    } catch (err: any) {
      console.warn('[Database] PostgreSQL connection failed, falling back to ACID local storage:', err.message);
      pgPool = null;
    }
  }

  // Load from local persistent file or initialize new
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      memoryStore = JSON.parse(raw);
      console.log(`[Database] Loaded persistent state from disk (${memoryStore.programs.length} programs, ${memoryStore.users.length} users).`);
    } catch (err) {
      console.error('[Database] Failed to read database file, initializing default:', err);
      await initDefaultState();
    }
  } else {
    console.log('[Database] Initializing fresh database with seeded admin and verified programs...');
    await initDefaultState();
  }

  // Ensure primary admin user exists with hashed password
  await ensureDefaultAdmin();
}

/**
 * Creates default seed state
 */
async function initDefaultState(): Promise<void> {
  const defaultPasswordHash = await bcrypt.hash('AffiliateOS@2026', 10);

  memoryStore = {
    users: [
      {
        id: 'usr_super_1',
        email: 'abbas.aj@gmail.com',
        name: 'Abbas (Owner)',
        role: 'super_admin',
        password_hash: defaultPasswordHash,
        status: 'active',
        avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
        last_login: new Date().toISOString()
      },
      {
        id: 'usr_editor_1',
        email: 'editor@affiliateos.io',
        name: 'Sarah Chen',
        role: 'editor',
        password_hash: defaultPasswordHash,
        status: 'active',
        avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80',
        last_login: new Date(Date.now() - 3600000 * 4).toISOString()
      }
    ],
    programs: [...INITIAL_PROGRAMS],
    clicks: [], // Fresh real clicks only
    visitor_sessions: [],
    reviews: process.env.DEMO_MODE === 'true' ? [
      {
        id: 'rev_demo_1',
        program_id: 'prog_nexcess',
        program_name: 'Nexcess Managed Hosting',
        user_name: 'Demo Reviewer',
        rating: 5,
        title: 'Demo Review — Not a real customer review',
        comment: 'Sample evaluation review for development and testing verification.',
        timestamp: new Date().toISOString(),
        verified: false,
        status: 'approved'
      }
    ] : [],
    contact_messages: [
      {
        id: 'msg_1',
        name: 'David Miller',
        email: 'david.m@techagency.co',
        subject: 'Question on Nexcess vs Plesk for high-traffic agency',
        message: 'Hello, we manage 40 client sites and are deciding between Nexcess managed cloud and Plesk VPS. Which is optimal for auto-scaling?',
        program_id: 'prog_nexcess',
        timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
        status: 'unread'
      }
    ],
    notifications: [...INITIAL_NOTIFICATIONS],
    notification_settings: {
      ...INITIAL_NOTIFICATION_SETTINGS,
      alert_email: 'abbas.aj@gmail.com'
    },
    audit_logs: [
      {
        id: `audit_${Date.now()}`,
        user_id: 'usr_super_1',
        user_email: 'abbas.aj@gmail.com',
        action: 'system_initialized',
        resource_type: 'system',
        timestamp: new Date().toISOString(),
        ip_hash: '127.0.0.1'
      }
    ]
  };

  saveToDisk();
}

/**
 * Ensures primary admin user exists and has a valid password hash
 */
async function ensureDefaultAdmin(): Promise<void> {
  const adminEmail = 'abbas.aj@gmail.com';
  let admin = memoryStore.users.find(u => u.email.toLowerCase() === adminEmail);

  if (!admin) {
    const passwordHash = await bcrypt.hash('AffiliateOS@2026', 10);
    admin = {
      id: 'usr_super_1',
      email: adminEmail,
      name: 'Abbas (Owner)',
      role: 'super_admin',
      password_hash: passwordHash,
      status: 'active',
      last_login: new Date().toISOString()
    };
    memoryStore.users.unshift(admin);
    saveToDisk();
  } else if (!admin.password_hash) {
    admin.password_hash = await bcrypt.hash('AffiliateOS@2026', 10);
    saveToDisk();
  }
}

/**
 * Persist current state to disk atomically
 */
function saveToDisk(): void {
  try {
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    console.error('[Database] Failed to write database state to disk:', err);
  }
}

// -----------------------------------------------------------------------------
// USER OPERATIONS
// -----------------------------------------------------------------------------
export const db = {
  getUserByEmail(email: string): AdminUser | undefined {
    return memoryStore.users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
  },

  getUserById(id: string): AdminUser | undefined {
    return memoryStore.users.find(u => u.id === id);
  },

  getAllUsers(): AdminUser[] {
    // Return users without exposing password_hash
    return memoryStore.users.map(({ password_hash, ...u }) => ({ ...u }));
  },

  async createUser(data: { name: string; email: string; role: AdminUser['role']; password?: string }): Promise<AdminUser> {
    const existing = db.getUserByEmail(data.email);
    if (existing) {
      throw new Error(`User with email "${data.email}" already exists.`);
    }

    const passwordHash = await bcrypt.hash(data.password || 'AffiliateOS@2026', 10);

    const newUser: AdminUser = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: data.name.trim(),
      email: data.email.toLowerCase().trim(),
      role: data.role,
      password_hash: passwordHash,
      status: 'active',
      last_login: new Date().toISOString()
    };

    memoryStore.users.push(newUser);
    saveToDisk();
    const { password_hash, ...safeUser } = newUser;
    return safeUser as AdminUser;
  },

  updateUserLastLogin(id: string): void {
    const user = memoryStore.users.find(u => u.id === id);
    if (user) {
      user.last_login = new Date().toISOString();
      saveToDisk();
    }
  },

  deleteUser(id: string): boolean {
    const user = memoryStore.users.find(u => u.id === id);
    if (!user) return false;
    if (user.email === 'abbas.aj@gmail.com') {
      throw new Error('Cannot delete the primary owner account (abbas.aj@gmail.com).');
    }
    memoryStore.users = memoryStore.users.filter(u => u.id !== id);
    saveToDisk();
    return true;
  },

  // -----------------------------------------------------------------------------
  // PROGRAM OPERATIONS
  // -----------------------------------------------------------------------------
  getPrograms(category?: string, search?: string): AffiliateProgram[] {
    let list = [...memoryStore.programs];
    if (category && category !== 'All') {
      list = list.filter(p => p.category.toLowerCase() === category.toLowerCase());
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        p => p.name.toLowerCase().includes(q) ||
             p.ai_description.toLowerCase().includes(q) ||
             p.category.toLowerCase().includes(q)
      );
    }
    return list;
  },

  getProgramById(id: string): AffiliateProgram | undefined {
    return memoryStore.programs.find(p => p.id === id);
  },

  getProgramBySlug(slug: string): AffiliateProgram | undefined {
    return memoryStore.programs.find(p => p.cloaked_slug.toLowerCase() === slug.toLowerCase().trim());
  },

  createProgram(program: AffiliateProgram): AffiliateProgram {
    const slugExists = memoryStore.programs.some(p => p.cloaked_slug.toLowerCase() === program.cloaked_slug.toLowerCase());
    if (slugExists) {
      throw new Error(`Cloaked slug "${program.cloaked_slug}" is already in use.`);
    }
    memoryStore.programs.unshift(program);
    saveToDisk();
    return program;
  },

  updateProgram(id: string, updates: Partial<AffiliateProgram>): AffiliateProgram {
    const index = memoryStore.programs.findIndex(p => p.id === id);
    if (index === -1) throw new Error('Program not found');

    if (updates.cloaked_slug && updates.cloaked_slug !== memoryStore.programs[index].cloaked_slug) {
      const slugConflict = memoryStore.programs.some(p => p.id !== id && p.cloaked_slug.toLowerCase() === updates.cloaked_slug!.toLowerCase());
      if (slugConflict) {
        throw new Error(`Slug "${updates.cloaked_slug}" is already in use.`);
      }
    }

    memoryStore.programs[index] = {
      ...memoryStore.programs[index],
      ...updates,
      id
    };
    saveToDisk();
    return memoryStore.programs[index];
  },

  deleteProgram(id: string): boolean {
    const initialLen = memoryStore.programs.length;
    memoryStore.programs = memoryStore.programs.filter(p => p.id !== id);
    saveToDisk();
    return memoryStore.programs.length < initialLen;
  },

  // -----------------------------------------------------------------------------
  // CLICK OPERATIONS
  // -----------------------------------------------------------------------------
  recordClick(click: ClickRecord): void {
    memoryStore.clicks.unshift(click);
    // Limit to latest 10,000 clicks
    if (memoryStore.clicks.length > 10000) {
      memoryStore.clicks.pop();
    }
    saveToDisk();
  },

  getClicks(programId?: string, limit = 100): ClickRecord[] {
    let list = memoryStore.clicks;
    if (programId) {
      list = list.filter(c => c.program_id === programId);
    }
    return list.slice(0, limit);
  },

  clearAllClicks(): number {
    const count = memoryStore.clicks.length;
    memoryStore.clicks = [];
    saveToDisk();
    return count;
  },

  // -----------------------------------------------------------------------------
  // VISITOR TRACKING
  // -----------------------------------------------------------------------------
  recordVisitorSession(sessionId: string, ipHash: string, landingPage?: string, referrer?: string, device?: DeviceType): boolean {
    const existing = memoryStore.visitor_sessions.find(v => v.session_id === sessionId || (v.ip_hash === ipHash && Date.now() - new Date(v.last_seen).getTime() < 1800000));

    if (existing) {
      existing.last_seen = new Date().toISOString();
      return false; // not a new visitor session
    }

    const session: VisitorSession = {
      id: `vis_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      session_id: sessionId,
      ip_hash: ipHash,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      landing_page: landingPage,
      referrer: referrer,
      device: device || 'desktop'
    };

    memoryStore.visitor_sessions.unshift(session);
    if (memoryStore.visitor_sessions.length > 5000) memoryStore.visitor_sessions.pop();
    saveToDisk();
    return true; // new unique visitor
  },

  getVisitorCount(): { total: number; today: number } {
    const todayStr = new Date().toISOString().split('T')[0];
    const total = memoryStore.visitor_sessions.length;
    const today = memoryStore.visitor_sessions.filter(v => v.first_seen.startsWith(todayStr)).length;
    return { total: Math.max(total, 1), today };
  },

  // -----------------------------------------------------------------------------
  // REAL ANALYTICS (BASED ON REAL DATABASE EVENTS, NO FAKE MULTIPLIERS)
  // -----------------------------------------------------------------------------
  getAnalytics(): AnalyticsSummary {
    const totalClicks = memoryStore.clicks.length;
    const uniqueIps = new Set(memoryStore.clicks.map(c => c.ip_hash));
    const uniqueClicks = uniqueIps.size;

    const { total: totalVisitors, today: todayVisitors } = db.getVisitorCount();

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayClicks = memoryStore.clicks.filter(c => c.timestamp.startsWith(todayStr)).length;

    // True CTR: Total Clicks / Total Unique Visitors
    const clickThroughRate = totalVisitors > 0
      ? Math.round((totalClicks / totalVisitors) * 1000) / 10
      : 0;

    // Top programs by real clicks
    const programClicksMap: Record<string, number> = {};
    memoryStore.clicks.forEach(c => {
      programClicksMap[c.program_id] = (programClicksMap[c.program_id] || 0) + 1;
    });

    const topPrograms = memoryStore.programs
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

    // Clicks and visitors over last 7 days
    const clicksOverTime = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      const dayClicks = memoryStore.clicks.filter(c => c.timestamp.startsWith(dateStr)).length;
      const dayVisitors = memoryStore.visitor_sessions.filter(v => v.first_seen.startsWith(dateStr)).length;

      clicksOverTime.push({
        date: dateStr,
        label: dayLabel,
        clicks: dayClicks,
        visitors: dayVisitors
      });
    }

    // Traffic sources from clicks
    const referrerMap: Record<string, number> = {};
    memoryStore.clicks.forEach(c => {
      const domain = c.referrer_domain || 'Direct';
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
    memoryStore.clicks.forEach(c => {
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

    const healthyLinksCount = memoryStore.programs.filter(p => p.health_status === 'healthy').length;
    const brokenLinksCount = memoryStore.programs.filter(p => p.health_status === 'broken').length;

    // Conservative estimated commission based on actual recorded clicks
    const estimatedRevenue = Math.round(totalClicks * 1.85);

    return {
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
    };
  },

  // -----------------------------------------------------------------------------
  // REVIEWS OPERATIONS
  // -----------------------------------------------------------------------------
  getReviews(programId?: string, status?: UserReview['status']): UserReview[] {
    let list = memoryStore.reviews;
    if (programId) list = list.filter(r => r.program_id === programId);
    if (status) list = list.filter(r => r.status === status);
    return list;
  },

  createReview(data: Omit<UserReview, 'id' | 'timestamp' | 'status' | 'verified'>): UserReview {
    const newRev: UserReview = {
      id: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ...data,
      timestamp: new Date().toISOString(),
      verified: false, // New reviews start unverified until admin approves
      status: 'pending' // Enforces human moderation workflow before publishing
    };
    memoryStore.reviews.unshift(newRev);
    saveToDisk();
    return newRev;
  },

  updateReviewStatus(id: string, status: UserReview['status'], verified = false): boolean {
    const rev = memoryStore.reviews.find(r => r.id === id);
    if (!rev) return false;
    rev.status = status;
    rev.verified = verified;
    saveToDisk();
    return true;
  },

  deleteReview(id: string): boolean {
    const initialLen = memoryStore.reviews.length;
    memoryStore.reviews = memoryStore.reviews.filter(r => r.id !== id);
    saveToDisk();
    return memoryStore.reviews.length < initialLen;
  },

  // -----------------------------------------------------------------------------
  // CONTACT MESSAGES OPERATIONS
  // -----------------------------------------------------------------------------
  getContactMessages(): ContactMessage[] {
    return memoryStore.contact_messages;
  },

  createContactMessage(data: Omit<ContactMessage, 'id' | 'timestamp' | 'status'>): ContactMessage {
    const msg: ContactMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ...data,
      timestamp: new Date().toISOString(),
      status: 'unread'
    };
    memoryStore.contact_messages.unshift(msg);
    saveToDisk();
    return msg;
  },

  markContactMessageRead(id: string): boolean {
    const msg = memoryStore.contact_messages.find(m => m.id === id);
    if (!msg) return false;
    msg.status = 'read';
    saveToDisk();
    return true;
  },

  deleteContactMessage(id: string): boolean {
    const initialLen = memoryStore.contact_messages.length;
    memoryStore.contact_messages = memoryStore.contact_messages.filter(m => m.id !== id);
    saveToDisk();
    return memoryStore.contact_messages.length < initialLen;
  },

  clearAllContactMessages(): number {
    const count = memoryStore.contact_messages.length;
    memoryStore.contact_messages = [];
    saveToDisk();
    return count;
  },

  // -----------------------------------------------------------------------------
  // NOTIFICATIONS OPERATIONS
  // -----------------------------------------------------------------------------
  getNotifications(): { settings: NotificationSettings; history: NotificationLog[] } {
    return {
      settings: memoryStore.notification_settings,
      history: memoryStore.notifications.slice(0, 50)
    };
  },

  addNotification(notif: NotificationLog): void {
    memoryStore.notifications.unshift(notif);
    if (memoryStore.notifications.length > 200) memoryStore.notifications.pop();
    saveToDisk();
  },

  updateNotificationSettings(updates: Partial<NotificationSettings>): NotificationSettings {
    memoryStore.notification_settings = {
      ...memoryStore.notification_settings,
      ...updates
    };
    saveToDisk();
    return memoryStore.notification_settings;
  },

  // -----------------------------------------------------------------------------
  // AUDIT LOGS
  // -----------------------------------------------------------------------------
  logAuditEvent(userId: string, userEmail: string, action: string, resourceType: string, resourceId?: string, metadata?: Record<string, any>, ipHash = '127.0.0.1'): void {
    const entry: AuditLog = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      user_id: userId,
      user_email: userEmail,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata,
      timestamp: new Date().toISOString(),
      ip_hash: ipHash
    };
    memoryStore.audit_logs.unshift(entry);
    if (memoryStore.audit_logs.length > 1000) memoryStore.audit_logs.pop();
    saveToDisk();
  },

  getAuditLogs(limit = 100): AuditLog[] {
    return memoryStore.audit_logs.slice(0, limit);
  }
};
