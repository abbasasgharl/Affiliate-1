import {
  AffiliateProgram,
  ClickRecord,
  NotificationSettings,
  NotificationLog,
  AnalyticsSummary,
  HealthStatus,
  UserReview,
  AdminUser,
  ContactMessage,
  UserRole
} from '../types';

export const api = {
  async getPrograms(): Promise<AffiliateProgram[]> {
    try {
      const res = await fetch('/api/programs');
      if (!res.ok) throw new Error('Failed to fetch programs');
      const data = await res.json();
      return data.programs;
    } catch (err) {
      console.error('Error fetching programs:', err);
      return [];
    }
  },

  async createProgram(programData: Partial<AffiliateProgram>): Promise<AffiliateProgram> {
    const res = await fetch('/api/programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(programData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create program');
    return data.program;
  },

  async updateProgram(id: string, updates: Partial<AffiliateProgram>): Promise<AffiliateProgram> {
    const res = await fetch(`/api/programs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update program');
    return data.program;
  },

  async deleteProgram(id: string): Promise<string> {
    const res = await fetch(`/api/programs/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete program');
    return data.deletedId;
  },

  async analyzeLinkWithAI(url: string): Promise<{
    program: Partial<AffiliateProgram>;
    botBlocked?: boolean;
    warning?: string;
  }> {
    const res = await fetch('/api/ai/analyze-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI Analysis failed');
    return data;
  },

  async checkLinkHealth(options: { programId?: string; url?: string; checkAll?: boolean }): Promise<any> {
    const res = await fetch('/api/health/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Health check failed');
    return data;
  },

  async getClicks(programId?: string, limit = 100): Promise<{ clicks: ClickRecord[]; total: number }> {
    try {
      const url = programId ? `/api/clicks?program_id=${programId}&limit=${limit}` : `/api/clicks?limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch clicks');
      return await res.json();
    } catch {
      return { clicks: [], total: 0 };
    }
  },

  async trackClientClick(programId: string): Promise<void> {
    try {
      await fetch('/api/clicks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program_id: programId,
          referrer: document.referrer || window.location.href,
          user_agent: navigator.userAgent
        })
      });
    } catch (err) {
      console.warn('Failed to track client click:', err);
    }
  },

  async getAnalytics(): Promise<AnalyticsSummary> {
    try {
      const res = await fetch('/api/analytics');
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return await res.json();
    } catch (err) {
      console.error('Error fetching analytics:', err);
      return {
        totalVisitors: 0,
        totalClicks: 0,
        uniqueClicks: 0,
        clickThroughRate: 0,
        todayVisitors: 0,
        todayClicks: 0,
        estimatedRevenue: 0,
        healthyLinksCount: 0,
        brokenLinksCount: 0,
        topPrograms: [],
        clicksOverTime: [],
        referrerBreakdown: [],
        deviceBreakdown: []
      };
    }
  },

  async getNotificationConfig(): Promise<{ settings: NotificationSettings; history: NotificationLog[] }> {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) throw new Error('Failed to fetch notification config');
      return await res.json();
    } catch {
      return {
        settings: {
          enable_email: true,
          alert_email: '',
          enable_telegram: false,
          telegram_bot_token: '',
          telegram_chat_id: '',
          enable_webhook: false,
          webhook_url: '',
          rate_limit_mode: 'instant',
          min_clicks_threshold: 1,
          alert_on_broken_link: true
        },
        history: []
      };
    }
  },

  async updateNotificationSettings(settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const res = await fetch('/api/notifications/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    const data = await res.json();
    if (!res.ok) throw new Error('Failed to update notification settings');
    return data.settings;
  },

  async sendTestNotification(channel: string): Promise<NotificationLog> {
    const res = await fetch('/api/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to dispatch test notification');
    return data.notification;
  },

  // Visitor tracking
  async recordVisitor(): Promise<void> {
    try {
      await fetch('/api/visitors/record', { method: 'POST' });
    } catch {
      // ignore
    }
  },

  // User Reviews API
  async getReviews(programId?: string): Promise<UserReview[]> {
    try {
      const url = programId ? `/api/reviews?program_id=${programId}` : '/api/reviews';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch reviews');
      const data = await res.json();
      return data.reviews || [];
    } catch (err) {
      console.error('Error fetching reviews:', err);
      return [];
    }
  },

  async submitReview(reviewData: Partial<UserReview>): Promise<UserReview> {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reviewData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit review');
    return data.review;
  },

  async deleteReview(id: string): Promise<void> {
    const res = await fetch(`/api/reviews/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete review');
  },

  // Admin User Management API
  async getAdminUsers(): Promise<AdminUser[]> {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to fetch admin users');
      const data = await res.json();
      return data.users || [];
    } catch (err) {
      console.error('Error fetching admin users:', err);
      return [];
    }
  },

  async createAdminUser(userData: { name: string; email: string; role: UserRole }): Promise<AdminUser> {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add admin user');
    return data.user;
  },

  async deleteAdminUser(id: string): Promise<void> {
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to revoke admin user');
  },

  // Contact Form API
  async getContactMessages(): Promise<ContactMessage[]> {
    try {
      const res = await fetch('/api/contact');
      if (!res.ok) throw new Error('Failed to fetch contact messages');
      const data = await res.json();
      return data.messages || [];
    } catch {
      return [];
    }
  },

  async sendContactMessage(messageData: {
    name: string;
    email: string;
    subject: string;
    message: string;
    program_id?: string;
  }): Promise<ContactMessage> {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messageData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send message');
    return data.message;
  },

  async markMessageRead(id: string): Promise<void> {
    await fetch(`/api/contact/${id}/read`, { method: 'PUT' });
  }
};
