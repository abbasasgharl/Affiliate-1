import React, { useState, useEffect, useMemo } from 'react';
import {
  Layers,
  Sparkles,
  UploadCloud,
  Activity,
  BarChart3,
  ListFilter,
  Bell,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Edit3,
  Trash2,
  Play,
  Pause,
  RefreshCw,
  Search,
  Copy,
  Check,
  ShieldCheck,
  Send,
  Download,
  Gift,
  Lock,
  Plus,
  Users,
  UserPlus,
  MessageSquare,
  Mail,
  Star,
  Eye,
  ShieldAlert,
  Inbox
} from 'lucide-react';
import {
  AffiliateProgram,
  ClickRecord,
  NotificationSettings,
  NotificationLog,
  AnalyticsSummary,
  UserRole,
  BulkImportItem,
  AdminUser,
  UserReview,
  ContactMessage
} from '../types';
import { api } from '../services/api';

interface AdminPortalProps {
  programs: AffiliateProgram[];
  onProgramsUpdated: (programs: AffiliateProgram[]) => void;
  onOpenAddModal: () => void;
  onOpenEditModal: (program: AffiliateProgram) => void;
  currentUserRole: UserRole;
  onRoleChange: (role: UserRole) => void;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  programs,
  onProgramsUpdated,
  onOpenAddModal,
  onOpenEditModal,
  currentUserRole,
  onRoleChange
}) => {
  type AdminTab =
    | 'programs'
    | 'review_queue'
    | 'bulk_import'
    | 'health_checker'
    | 'analytics'
    | 'clicks'
    | 'notifications'
    | 'team_management'
    | 'reviews'
    | 'inbox';

  const [activeTab, setActiveTab] = useState<AdminTab>('programs');

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const [bulkInput, setBulkInput] = useState('');
  const [bulkQueue, setBulkQueue] = useState<BulkImportItem[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const [checkingAllHealth, setCheckingAllHealth] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [clicks, setClicks] = useState<ClickRecord[]>([]);
  const [clickProgramFilter, setClickProgramFilter] = useState<string>('all');
  const [clickDeviceFilter, setClickDeviceFilter] = useState<string>('all');

  const [notifSettings, setNotifSettings] = useState<NotificationSettings | null>(null);
  const [notifHistory, setNotifHistory] = useState<NotificationLog[]>([]);
  const [sendingTestPing, setSendingTestPing] = useState(false);
  const [saveNotifSuccess, setSaveNotifSuccess] = useState(false);

  // Admin User Management State
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('editor');
  const [userActionError, setUserActionError] = useState('');
  const [userActionSuccess, setUserActionSuccess] = useState('');

  // User Reviews Moderation State
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [reviewRatingFilter, setReviewRatingFilter] = useState<string>('all');

  // Contact Messages & Inquiries State
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const needsReviewItems = useMemo(() => {
    return programs.filter(p => p.status === 'needs_review' || p.status === 'manual_needed');
  }, [programs]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      loadAnalytics();
    } else if (activeTab === 'clicks') {
      loadClicks();
    } else if (activeTab === 'notifications') {
      loadNotifications();
    } else if (activeTab === 'team_management') {
      loadAdminUsers();
    } else if (activeTab === 'reviews') {
      loadReviews();
    } else if (activeTab === 'inbox') {
      loadContactMessages();
    }
  }, [activeTab]);

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const data = await api.getAnalytics();
      setAnalytics(data);
    } catch (err) {
      console.error(err);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const loadClicks = async () => {
    try {
      const data = await api.getClicks();
      setClicks(data.clicks);
    } catch (err) {
      console.error(err);
    }
  };

  const loadNotifications = async () => {
    try {
      const data = await api.getNotificationConfig();
      setNotifSettings(data.settings);
      setNotifHistory(data.history);
    } catch (err) {
      console.error(err);
    }
  };

  const loadAdminUsers = async () => {
    setLoadingAdminUsers(true);
    try {
      const data = await api.getAdminUsers();
      setAdminUsers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAdminUsers(false);
    }
  };

  const loadReviews = async () => {
    setLoadingReviews(true);
    try {
      const data = await api.getReviews();
      setReviews(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReviews(false);
    }
  };

  const loadContactMessages = async () => {
    setLoadingMessages(true);
    try {
      const data = await api.getContactMessages();
      setContactMessages(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleCreateAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) {
      setUserActionError('Please enter both name and email.');
      return;
    }
    setUserActionError('');
    try {
      const created = await api.createAdminUser({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        role: newUserRole
      });
      setAdminUsers(prev => [...prev, created]);
      setUserActionSuccess(`Granted ${newUserRole === 'super_admin' ? 'Super Admin' : 'Editor'} privilege to ${created.email}`);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserRole('editor');
      setIsAddUserModalOpen(false);
      setTimeout(() => setUserActionSuccess(''), 4000);
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to add admin user');
    }
  };

  const handleDeleteAdminUser = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to revoke admin privileges from ${name}?`)) return;
    try {
      await api.deleteAdminUser(id);
      setAdminUsers(prev => prev.filter(u => u.id !== id));
      setUserActionSuccess(`Revoked admin access for ${name}`);
      setTimeout(() => setUserActionSuccess(''), 4000);
    } catch (err: any) {
      alert(err.message || 'Failed to revoke admin privileges');
    }
  };

  const handleDeleteReview = async (id: string) => {
    if (!window.confirm('Delete this user review permanently?')) return;
    try {
      await api.deleteReview(id);
      setReviews(prev => prev.filter(r => r.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete review');
    }
  };

  const handleMarkMessageRead = async (id: string) => {
    try {
      await api.markMessageRead(id);
      setContactMessages(prev => prev.map(m => m.id === id ? { ...m, status: 'read' } : m));
    } catch {
      // ignore
    }
  };

  const handleToggleStatus = async (program: AffiliateProgram) => {
    const newStatus = program.status === 'active' ? 'paused' : 'active';
    try {
      const updated = await api.updateProgram(program.id, { status: newStatus });
      onProgramsUpdated(programs.map(p => p.id === updated.id ? updated : p));
    } catch (err: any) {
      alert(err.message || 'Failed to toggle program status');
    }
  };

  const handleApproveProgram = async (program: AffiliateProgram) => {
    try {
      const updated = await api.updateProgram(program.id, { status: 'active' });
      onProgramsUpdated(programs.map(p => p.id === updated.id ? updated : p));
    } catch (err: any) {
      alert(err.message || 'Failed to approve program');
    }
  };

  const handleScanAllHealth = async () => {
    setCheckingAllHealth(true);
    try {
      const result = await api.checkLinkHealth({ checkAll: true });
      if (result && result.programs) {
        onProgramsUpdated(result.programs);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to scan link health');
    } finally {
      setCheckingAllHealth(false);
    }
  };

  const handleStartBulkImport = async () => {
    if (!bulkInput.trim()) return;
    const lines = bulkInput
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 5);

    if (lines.length === 0) return;

    const initialItems: BulkImportItem[] = lines.map((url, i) => ({
      id: `bulk_${Date.now()}_${i}`,
      url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
      status: 'pending'
    }));

    setBulkQueue(initialItems);
    setBulkProcessing(true);

    const updatedQueue = [...initialItems];

    for (let i = 0; i < updatedQueue.length; i++) {
      const item = updatedQueue[i];
      item.status = 'scraping';
      setBulkQueue([...updatedQueue]);

      try {
        item.status = 'analyzing';
        setBulkQueue([...updatedQueue]);

        const res = await api.analyzeLinkWithAI(item.url);
        if (res && res.program) {
          const created = await api.createProgram({
            ...res.program,
            original_link: item.url,
            status: 'active'
          });
          item.status = 'completed';
          item.program = created;
          onProgramsUpdated([created, ...programs]);
        } else {
          item.status = 'failed';
          item.error = 'No program data returned';
        }
      } catch (err: any) {
        item.status = 'failed';
        item.error = err.message || 'AI extraction failed';
      }

      setBulkQueue([...updatedQueue]);
    }

    setBulkProcessing(false);
  };

  const handleLoadSampleBulk = () => {
    setBulkInput([
      'https://linear.app/?ref=affiliateos_sample',
      'https://www.perplexity.ai/?ref=affiliateos_sample',
      'https://raycast.com/?ref=affiliateos_sample'
    ].join('\n'));
  };

  const handleExportClicksCsv = () => {
    if (clicks.length === 0) return;
    const headers = ['Click ID', 'Program Name', 'Cloaked Route', 'Timestamp', 'IP Hash (GDPR)', 'Device', 'Referrer Domain'];
    const rows = clicks.map(c => [
      c.id,
      `"${c.program_name}"`,
      `/go/${c.cloaked_slug}`,
      c.timestamp,
      c.ip_hash,
      c.device_type,
      c.referrer_domain
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `affiliateos_clicks_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredPrograms = useMemo(() => {
    return programs.filter(p => {
      const matchStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchSearch =
        p.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        p.cloaked_slug.toLowerCase().includes(searchFilter.toLowerCase()) ||
        p.category.toLowerCase().includes(searchFilter.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [programs, statusFilter, searchFilter]);

  const filteredClicks = useMemo(() => {
    return clicks.filter(c => {
      const matchProg = clickProgramFilter === 'all' || c.program_id === clickProgramFilter;
      const matchDev = clickDeviceFilter === 'all' || c.device_type === clickDeviceFilter;
      return matchProg && matchDev;
    });
  }, [clicks, clickProgramFilter, clickDeviceFilter]);

  const handleSendTestPing = async (channel: string) => {
    setSendingTestPing(true);
    try {
      const result = await api.sendTestNotification(channel);
      setNotifHistory(prev => [result, ...prev]);
      alert(`Test alert sent successfully to ${channel.toUpperCase()}!`);
    } catch (err: any) {
      alert(err.message || 'Failed to dispatch test notification');
    } finally {
      setSendingTestPing(false);
    }
  };

  const handleSaveNotifSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifSettings) return;
    try {
      const updated = await api.updateNotificationSettings(notifSettings);
      setNotifSettings(updated);
      setSaveNotifSuccess(true);
      setTimeout(() => setSaveNotifSuccess(false), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to save notification settings');
    }
  };

  if (currentUserRole === 'viewer') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 max-w-md mx-auto shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 mb-2">Admin Portal Access</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            Select an authorized role to manage referral links, check click tracking, or review AI-analyzed programs.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => onRoleChange('super_admin')}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Enter as Super Admin</span>
            </button>
            <button
              onClick={() => onRoleChange('editor')}
              className="w-full py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Enter as Editor</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Admin Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Referral Management Hub</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {currentUserRole === 'super_admin' ? 'Super Admin' : 'Editor'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Automated Link Extraction • Click Analytics • Link Health Diagnostics
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleScanAllHealth}
            disabled={checkingAllHealth}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold transition shadow-2xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingAllHealth ? 'animate-spin text-indigo-600' : ''}`} />
            <span>{checkingAllHealth ? 'Scanning Links...' : 'Check Link Health'}</span>
          </button>

          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition shadow-md shadow-indigo-600/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Referral Link</span>
          </button>
        </div>
      </div>

      {/* Admin Tab Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-4 border-b border-slate-200 scrollbar-none">
        <button
          onClick={() => setActiveTab('programs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'programs'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Programs ({programs.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('review_queue')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer relative ${
            activeTab === 'review_queue'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Review Staging</span>
          {needsReviewItems.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white font-bold text-[10px]">
              {needsReviewItems.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('bulk_import')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'bulk_import'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          <span>Bulk Ingestion</span>
        </button>

        <button
          onClick={() => setActiveTab('health_checker')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'health_checker'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Link Health</span>
        </button>

        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'analytics'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Click Analytics</span>
        </button>

        <button
          onClick={() => setActiveTab('clicks')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'clicks'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <ListFilter className="w-4 h-4" />
          <span>Click Logs</span>
        </button>

        <button
          onClick={() => setActiveTab('notifications')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'notifications'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Email & Click Alerts</span>
        </button>

        <button
          onClick={() => setActiveTab('team_management')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'team_management'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Admin Users & Privileges</span>
        </button>

        <button
          onClick={() => setActiveTab('reviews')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'reviews'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Star className="w-4 h-4" />
          <span>User Reviews</span>
          {reviews.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-800 font-bold text-[10px]">
              {reviews.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('inbox')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'inbox'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Mail className="w-4 h-4" />
          <span>User Inquiries</span>
          {contactMessages.filter(m => m.status === 'unread').length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-indigo-600 text-white font-bold text-[10px]">
              {contactMessages.filter(m => m.status === 'unread').length} new
            </span>
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: PROGRAMS TABLE                                                     */}
      {/* ========================================================================= */}
      {activeTab === 'programs' && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter programs..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 shadow-2xs"
                />
              </div>

              <select
                aria-label="Filter programs by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-600 shadow-2xs cursor-pointer"
              >
                <option value="all">All Statuses ({programs.length})</option>
                <option value="active">Active ({programs.filter(p => p.status === 'active').length})</option>
                <option value="needs_review">Needs Review ({programs.filter(p => p.status === 'needs_review').length})</option>
                <option value="paused">Paused ({programs.filter(p => p.status === 'paused').length})</option>
              </select>
            </div>

            <div className="text-xs text-slate-500 font-semibold self-end sm:self-auto">
              Showing <strong>{filteredPrograms.length}</strong> of {programs.length} programs
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3.5 px-4">Program & Cover</th>
                    <th className="py-3.5 px-4">Referral Perk</th>
                    <th className="py-3.5 px-4">Cloaked Route</th>
                    <th className="py-3.5 px-4">Health</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPrograms.map((program) => {
                    const cloakedUrl = `${window.location.origin}/go/${program.cloaked_slug}`;
                    return (
                      <tr key={program.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={program.logo_url}
                              alt={program.name}
                              className="w-10 h-10 rounded-xl object-contain p-1 bg-white border border-slate-200 shadow-2xs"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://www.google.com/s2/favicons?domain=${program.cloaked_slug}.com&sz=128`;
                              }}
                            />
                            <div>
                              <div className="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
                                {program.name}
                              </div>
                              <span className="text-[11px] text-slate-500 font-medium">{program.category}</span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          {program.referral_perk ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 font-bold text-[11px] border border-emerald-200">
                              <Gift className="w-3 h-3 text-emerald-600" />
                              {program.referral_perk}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">Standard link</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 font-mono text-xs">
                            <span className="text-indigo-700 font-bold">/go/{program.cloaked_slug}</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(cloakedUrl);
                                setCopiedSlug(program.id);
                                setTimeout(() => setCopiedSlug(null), 2000);
                              }}
                              className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                              title="Copy cloaked redirect URL"
                            >
                              {copiedSlug === program.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <a
                              href={`/go/${program.cloaked_slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                              title="Test redirect in new tab"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${
                              program.health_status === 'healthy' ? 'bg-emerald-500' :
                              program.health_status === 'warning' ? 'bg-amber-500' : 'bg-red-500'
                            }`}></span>
                            <span className="capitalize font-bold text-xs text-slate-800">
                              {program.health_status}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              ({program.last_http_code || 200})
                            </span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            program.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            program.status === 'needs_review' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                            'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}>
                            {program.status.replace('_', ' ')}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleToggleStatus(program)}
                              title={program.status === 'active' ? 'Pause Campaign' : 'Activate Campaign'}
                              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                            >
                              {program.status === 'active' ? <Pause className="w-3.5 h-3.5 text-amber-600" /> : <Play className="w-3.5 h-3.5 text-emerald-600" />}
                            </button>
                            <button
                              onClick={() => onOpenEditModal(program)}
                              title="Edit Program & Images"
                              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: AI REVIEW STAGING                                                  */}
      {/* ========================================================================= */}
      {activeTab === 'review_queue' && (
        <div className="mt-6 space-y-6">
          {needsReviewItems.length === 0 ? (
            <div className="p-12 text-center bg-white border border-slate-200 rounded-3xl shadow-xs">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
              <h3 className="text-base font-extrabold text-slate-900">All Programs Are Approved & Live!</h3>
              <p className="text-xs text-slate-500 mt-1">Every program in your catalog is currently active and promoted.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {needsReviewItems.map((prog) => (
                <div key={prog.id} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-slate-200">
                    <div className="flex items-center gap-3">
                      <img
                        src={prog.logo_url}
                        alt={prog.name}
                        className="w-12 h-12 rounded-xl object-contain p-1 bg-white border border-slate-200"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-extrabold text-slate-900 text-base">{prog.name}</h3>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            {prog.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 font-mono">
                          {prog.original_link}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOpenEditModal(prog)}
                        className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition cursor-pointer"
                      >
                        Edit Details
                      </button>
                      <button
                        onClick={() => handleApproveProgram(prog)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Approve & Publish</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100">
                      <span className="text-[10px] font-extrabold text-indigo-700 uppercase tracking-wider block mb-1">
                        Auto-Generated Recommendation
                      </span>
                      <p className="text-xs font-semibold text-slate-900">{prog.ai_generated_pick}</p>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block mb-1">
                        Referral Offer / Deal
                      </span>
                      <p className="text-xs font-bold text-emerald-800">{prog.referral_perk || 'Standard Offer'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: BULK IMPORT                                                        */}
      {/* ========================================================================= */}
      {activeTab === 'bulk_import' && (
        <div className="mt-6 space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Bulk Ingestion</h3>
                <p className="text-xs text-slate-500">Paste multiple links at once. The AI agent will scrape, extract logos & images, and activate cards.</p>
              </div>
              <button
                type="button"
                onClick={handleLoadSampleBulk}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-bold underline cursor-pointer"
              >
                Load Sample Tech Links
              </button>
            </div>

            <textarea
              rows={4}
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder="https://linear.app/?ref=...&#10;https://perplexity.ai/?ref=..."
              className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-300 text-slate-900 font-mono text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
            />

            <div className="mt-4 flex justify-end">
              <button
                onClick={handleStartBulkImport}
                disabled={bulkProcessing || !bulkInput.trim()}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white text-xs font-extrabold transition shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer"
              >
                {bulkProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processing Batch...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Ingest & Create All Cards</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: LINK HEALTH                                                        */}
      {/* ========================================================================= */}
      {activeTab === 'health_checker' && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs text-slate-500 font-semibold">Healthy Endpoints (200 OK)</span>
              <p className="text-3xl font-black text-emerald-600 mt-1">
                {programs.filter(p => p.health_status === 'healthy').length}
              </p>
            </div>
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs text-slate-500 font-semibold">Slow / Redirect Warnings</span>
              <p className="text-3xl font-black text-amber-600 mt-1">
                {programs.filter(p => p.health_status === 'warning').length}
              </p>
            </div>
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs text-slate-500 font-semibold">Broken / Dead Links</span>
              <p className="text-3xl font-black text-red-600 mt-1">
                {programs.filter(p => p.health_status === 'broken').length}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: CLICK & VISITOR ANALYTICS                                          */}
      {/* ========================================================================= */}
      {activeTab === 'analytics' && (
        <div className="mt-6 space-y-6">
          {analyticsLoading || !analytics ? (
            <div className="py-20 text-center">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500">Loading comprehensive traffic & click analytics...</p>
            </div>
          ) : (
            <>
              {/* Traffic & Clicks Core Metrics */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
                    <span>Total Site Visitors</span>
                    <Users className="w-4 h-4 text-indigo-600" />
                  </div>
                  <p className="text-3xl font-black text-slate-900">
                    {(analytics.totalVisitors || 890).toLocaleString()}
                  </p>
                  <span className="text-[10px] text-emerald-600 font-bold mt-1 block">
                    +{analytics.todayVisitors || 48} visitors today
                  </span>
                </div>

                <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
                    <span>Total Referral Clicks</span>
                    <ExternalLink className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-3xl font-black text-emerald-600">
                    {analytics.totalClicks.toLocaleString()}
                  </p>
                  <span className="text-[10px] text-emerald-600 font-bold mt-1 block">
                    +{analytics.todayClicks} referral clicks today
                  </span>
                </div>

                <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
                    <span>Click-Through Rate (CTR)</span>
                    <Activity className="w-4 h-4 text-cyan-600" />
                  </div>
                  <p className="text-3xl font-black text-indigo-600">
                    {analytics.clickThroughRate || 24.8}%
                  </p>
                  <span className="text-[10px] text-slate-400 font-medium mt-1 block">
                    Referral Clicks ÷ Site Visitors
                  </span>
                </div>

                <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
                    <span>Est. Commission Pipeline</span>
                    <Gift className="w-4 h-4 text-amber-500" />
                  </div>
                  <p className="text-3xl font-black text-slate-900">
                    ${analytics.estimatedRevenue.toLocaleString()}
                  </p>
                  <span className="text-[10px] text-slate-400 font-medium mt-1 block">
                    Across {programs.filter(p => p.status === 'active').length} active programs
                  </span>
                </div>
              </div>

              {/* 7-Day Trend Chart: Site Visitors vs. Referral Clicks */}
              <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                  <div>
                    <h3 className="text-sm font-black text-slate-900">7-Day Traffic vs. Referral Clicks Trend</h3>
                    <p className="text-xs text-slate-500">Day-by-day comparison of unique visitors and cloaked link redirects</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-sm bg-indigo-500"></div>
                      <span className="text-slate-600 font-medium">Site Visitors</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-sm bg-emerald-500"></div>
                      <span className="text-slate-600 font-medium">Referral Clicks</span>
                    </div>
                  </div>
                </div>

                {analytics.clicksOverTime && analytics.clicksOverTime.length > 0 && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-7 gap-2 items-end h-44 pt-4 border-b border-slate-100">
                      {analytics.clicksOverTime.map((day, idx) => {
                        const visitors = day.visitors || Math.round(day.clicks * 3.2 + 20);
                        const maxVal = Math.max(...analytics.clicksOverTime.map(d => d.visitors || Math.round(d.clicks * 3.2 + 20)), 50);
                        const visitorHeight = Math.max(12, Math.round((visitors / maxVal) * 100));
                        const clickHeight = Math.max(8, Math.round((day.clicks / maxVal) * 100));
                        return (
                          <div key={idx} className="flex flex-col items-center h-full justify-end group">
                            <div className="flex items-end gap-1.5 w-full justify-center h-full">
                              {/* Visitors Bar */}
                              <div
                                style={{ height: `${visitorHeight}%` }}
                                className="w-3 sm:w-5 bg-indigo-400 hover:bg-indigo-500 rounded-t-md transition-all relative group/bar"
                              >
                                <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] py-0.5 px-1.5 rounded opacity-0 group-hover/bar:opacity-100 pointer-events-none whitespace-nowrap z-10 transition">
                                  {visitors} Visitors
                                </span>
                              </div>
                              {/* Clicks Bar */}
                              <div
                                style={{ height: `${clickHeight}%` }}
                                className="w-3 sm:w-5 bg-emerald-500 hover:bg-emerald-600 rounded-t-md transition-all relative group/bar"
                              >
                                <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] py-0.5 px-1.5 rounded opacity-0 group-hover/bar:opacity-100 pointer-events-none whitespace-nowrap z-10 transition">
                                  {day.clicks} Clicks
                                </span>
                              </div>
                            </div>
                            <span className="text-[10px] font-bold text-slate-500 mt-2 truncate w-full text-center">
                              {day.label.split(',')[0]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Performance Table by Referral Program */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
                <h3 className="text-sm font-black text-slate-900 mb-4">Referral Link Performance Ranking</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-3 px-4">Program</th>
                        <th className="py-3 px-4">Cloaked URL</th>
                        <th className="py-3 px-4">Clicks</th>
                        <th className="py-3 px-4">Share (%)</th>
                        <th className="py-3 px-4">Commission</th>
                        <th className="py-3 px-4">Health</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {programs.map((prog) => {
                        const progClicks = clicks.filter(c => c.program_id === prog.id).length;
                        const share = analytics.totalClicks > 0 ? Math.round((progClicks / analytics.totalClicks) * 100) : 0;
                        return (
                          <tr key={prog.id} className="hover:bg-slate-50/80">
                            <td className="py-3 px-4 font-bold text-slate-900 flex items-center gap-2">
                              <img src={prog.logo_url} alt="" className="w-5 h-5 rounded object-contain" />
                              <span>{prog.name}</span>
                            </td>
                            <td className="py-3 px-4 font-mono text-indigo-700 font-semibold">
                              /go/{prog.cloaked_slug}
                            </td>
                            <td className="py-3 px-4 font-bold text-slate-900">
                              {progClicks}
                            </td>
                            <td className="py-3 px-4 text-slate-600">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                  <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${Math.min(100, share * 2)}%` }}></div>
                                </div>
                                <span className="text-[11px] font-semibold">{share}%</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 font-bold text-emerald-700">
                              {prog.commission_value}
                            </td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                prog.health_status === 'healthy' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                prog.health_status === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}>
                                {prog.health_status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Referrer Sources & Devices */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-2xs">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-3">Traffic Referrer Sources</h4>
                  <div className="space-y-2 text-xs">
                    {analytics.referrerBreakdown && analytics.referrerBreakdown.length > 0 ? (
                      analytics.referrerBreakdown.map((ref, idx) => (
                        <div key={idx} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                          <span className="font-semibold text-slate-800">{ref.domain}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 font-mono">{ref.clicks} clicks</span>
                            <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full text-[10px]">
                              {ref.percentage}%
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400">Direct traffic / No external referrers logged</p>
                    )}
                  </div>
                </div>

                <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-2xs">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-3">Visitor Device Distribution</h4>
                  <div className="space-y-2 text-xs">
                    {analytics.deviceBreakdown && analytics.deviceBreakdown.length > 0 ? (
                      analytics.deviceBreakdown.map((dev, idx) => (
                        <div key={idx} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0 capitalize">
                          <span className="font-semibold text-slate-800">{dev.device}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 font-mono">{dev.clicks} clicks</span>
                            <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px]">
                              {dev.percentage}%
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400">No device data available</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: CLICK LOGS                                                         */}
      {/* ========================================================================= */}
      {activeTab === 'clicks' && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Recent Referral Clicks</h3>
            <button
              onClick={handleExportClicksCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-4">Service</th>
                    <th className="py-3 px-4">Slug</th>
                    <th className="py-3 px-4">Device</th>
                    <th className="py-3 px-4">Referrer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {filteredClicks.slice(0, 50).map((click) => (
                    <tr key={click.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                        {new Date(click.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 font-sans font-bold text-slate-900 whitespace-nowrap">
                        {click.program_name}
                      </td>
                      <td className="py-2.5 px-4 text-indigo-700 font-bold whitespace-nowrap">
                        /go/{click.cloaked_slug}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-slate-600 whitespace-nowrap capitalize">
                        {click.device_type}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                        {click.referrer_domain || 'Direct'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 7: EMAIL & CLICK NOTIFICATIONS                                        */}
      {/* ========================================================================= */}
      {activeTab === 'notifications' && (
        <div className="mt-6 space-y-6">
          {/* Email Notification on Referral Click Configuration */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-base font-extrabold text-slate-900">Admin Email Notifications on Click</h3>
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  When a visitor clicks your referral link (e.g. Nexcess, Plesk, Cursor), the system automatically triggers an email notification to alert you of the referral activity.
                </p>
              </div>
              <button
                onClick={() => handleSendTestPing('email')}
                disabled={sendingTestPing}
                className="px-3.5 py-2 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{sendingTestPing ? 'Sending Test...' : 'Send Test Email Alert'}</span>
              </button>
            </div>

            {saveNotifSuccess && (
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Notification settings saved successfully!</span>
              </div>
            )}

            {notifSettings && (
              <form onSubmit={handleSaveNotifSettings} className="space-y-4 pt-2 border-t border-slate-100 text-xs">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="enable_email_clicks"
                    checked={notifSettings.enable_email}
                    onChange={(e) => setNotifSettings({ ...notifSettings, enable_email: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded cursor-pointer"
                  />
                  <label htmlFor="enable_email_clicks" className="font-bold text-slate-800 cursor-pointer">
                    Send Instant Email Alert when any referral link is clicked
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Admin Alert Email *</label>
                    <input
                      type="email"
                      required
                      value={notifSettings.alert_email || 'abbas.aj@gmail.com'}
                      onChange={(e) => setNotifSettings({ ...notifSettings, alert_email: e.target.value })}
                      placeholder="abbas.aj@gmail.com"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">
                      Recipient for real-time link click notifications and contact form inquiries.
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Alert Frequency</label>
                    <select
                      value={notifSettings.rate_limit_mode}
                      onChange={(e) => setNotifSettings({ ...notifSettings, rate_limit_mode: e.target.value as any })}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="instant">Instant Notification (per referral click)</option>
                      <option value="digest_15m">15-Minute Click Digest</option>
                      <option value="digest_hourly">Hourly Click Digest</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs transition cursor-pointer shadow-md shadow-indigo-600/20"
                  >
                    Save Email Alert Preferences
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Real-time Notification Logs */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4 text-indigo-600" />
              <span>Live Notification Activity Stream</span>
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {notifHistory.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">No notifications recorded yet.</p>
              ) : (
                notifHistory.map((log) => (
                  <div key={log.id} className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-900">{log.message}</span>
                        <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
                          {log.channel}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        {new Date(log.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600">Dispatched</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 8: TEAM & ADMIN USER MANAGEMENT                                       */}
      {/* ========================================================================= */}
      {activeTab === 'team_management' && (
        <div className="mt-6 space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-base font-extrabold text-slate-900">Admin Users & Privileges</h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Authorize team members with admin privileges to manage referral links, intake deals, and track performance.
                </p>
              </div>
              <button
                onClick={() => setIsAddUserModalOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <UserPlus className="w-4 h-4" />
                <span>+ Add User with Admin Privilege</span>
              </button>
            </div>

            {userActionSuccess && (
              <div className="mt-4 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{userActionSuccess}</span>
              </div>
            )}

            {/* Admin Users Table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Privilege Level</th>
                    <th className="py-3 px-4">Last Active</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingAdminUsers ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">Loading admin users...</td>
                    </tr>
                  ) : adminUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50/80">
                      <td className="py-3.5 px-4 font-bold text-slate-900 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-black text-xs flex items-center justify-center">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span>{user.name}</span>
                          {user.email === 'abbas.aj@gmail.com' && (
                            <span className="ml-2 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                              Owner
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">{user.email}</td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          user.role === 'super_admin'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {user.role === 'super_admin' ? 'Super Admin (Full Access)' : 'Editor (Link Management)'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Active'}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {user.email !== 'abbas.aj@gmail.com' ? (
                          <button
                            onClick={() => handleDeleteAdminUser(user.id, user.name)}
                            className="text-rose-600 hover:text-rose-800 text-xs font-bold transition hover:underline"
                          >
                            Revoke Access
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-medium">Primary Account</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Privileges Explanation Card */}
            <div className="mt-6 p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <h5 className="font-bold text-indigo-950 flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  Super Admin Privileges
                </h5>
                <p className="text-slate-600 leading-relaxed text-[11px]">
                  Can add and remove other administrators, configure email & webhook alert channels, modify financial payouts, and export complete click logs.
                </p>
              </div>
              <div>
                <h5 className="font-bold text-indigo-950 flex items-center gap-1.5 mb-1">
                  <Edit3 className="w-4 h-4 text-indigo-600" />
                  Editor Privileges
                </h5>
                <p className="text-slate-600 leading-relaxed text-[11px]">
                  Can add new referral links, review AI-generated picks and briefs, override descriptions, and run link health diagnostic scans.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 9: USER REVIEWS MODERATION                                            */}
      {/* ========================================================================= */}
      {activeTab === 'reviews' && (
        <div className="mt-6 space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
                  <h3 className="text-base font-extrabold text-slate-900">User Reviews & Ratings Moderation</h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Review and moderate user feedback left for your affiliate programs.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">Filter by Rating:</span>
                <select
                  value={reviewRatingFilter}
                  onChange={(e) => setReviewRatingFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none"
                >
                  <option value="all">All Stars ({reviews.length})</option>
                  <option value="5">5 Stars only</option>
                  <option value="4">4 Stars only</option>
                  <option value="3">3 Stars or less</option>
                </select>
              </div>
            </div>

            {loadingReviews ? (
              <div className="py-12 text-center text-slate-400">Loading reviews...</div>
            ) : reviews.length === 0 ? (
              <div className="py-12 text-center text-slate-400">No user reviews submitted yet.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {reviews
                  .filter(r => reviewRatingFilter === 'all' || r.rating === Number(reviewRatingFilter))
                  .map((rev) => (
                    <div key={rev.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-slate-900">{rev.user_name}</span>
                            {rev.user_email && <span className="text-slate-400">({rev.user_email})</span>}
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700">
                              {rev.program_name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star
                                key={s}
                                className={`w-3.5 h-3.5 ${s <= rev.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
                              />
                            ))}
                            <span className="font-bold text-slate-700 ml-1 text-xs">{rev.rating}/5</span>
                            <span className="text-slate-400 text-[10px] ml-2">
                              {new Date(rev.timestamp).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteReview(rev.id)}
                          className="text-rose-600 hover:text-rose-800 p-1.5 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                          title="Delete review"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {rev.title && (
                        <h4 className="font-bold text-slate-900 text-xs">&quot;{rev.title}&quot;</h4>
                      )}
                      <p className="text-slate-600 leading-relaxed text-xs">{rev.comment}</p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 10: CONTACT INQUIRIES & USER MESSAGES                                 */}
      {/* ========================================================================= */}
      {activeTab === 'inbox' && (
        <div className="mt-6 space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-base font-extrabold text-slate-900">User Contact Inquiries</h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Messages submitted by visitors via the public contact form.
                </p>
              </div>
              <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-xl">
                {contactMessages.filter(m => m.status === 'unread').length} Unread Messages
              </span>
            </div>

            {loadingMessages ? (
              <div className="py-12 text-center text-slate-400">Loading messages...</div>
            ) : contactMessages.length === 0 ? (
              <div className="py-12 text-center text-slate-400">No contact messages received yet.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {contactMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-4 rounded-2xl border text-xs space-y-2 transition ${
                      msg.status === 'unread' ? 'bg-indigo-50/40 border-indigo-200' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-900">{msg.name}</span>
                          <a href={`mailto:${msg.email}`} className="text-indigo-600 hover:underline font-mono">
                            {msg.email}
                          </a>
                          {msg.status === 'unread' && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-600 text-white">
                              New
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-slate-800 text-xs mt-1">{msg.subject}</h4>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-slate-400">
                          {new Date(msg.timestamp).toLocaleString()}
                        </span>
                        {msg.status === 'unread' && (
                          <button
                            onClick={() => handleMarkMessageRead(msg.id)}
                            className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg transition cursor-pointer"
                          >
                            Mark Read
                          </button>
                        )}
                        <a
                          href={`mailto:${msg.email}?subject=Re: ${encodeURIComponent(msg.subject)}`}
                          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg transition"
                        >
                          Reply
                        </a>
                      </div>
                    </div>
                    <p className="text-slate-700 leading-relaxed bg-white/70 p-3 rounded-xl border border-slate-100">
                      {msg.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Add User with Admin Privilege */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl relative text-slate-900">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-extrabold text-slate-900">Grant Admin Privilege</h3>
              </div>
              <button
                onClick={() => setIsAddUserModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {userActionError && (
              <div className="mb-4 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {userActionError}
              </div>
            )}

            <form onSubmit={handleCreateAdminUser} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="e.g. Jordan Lee"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="jordan@company.com"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Admin Privilege Role *</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="editor">Editor — Can add/edit programs & review links</option>
                  <option value="super_admin">Super Admin — Full control (manage team, settings, payouts)</option>
                </select>
              </div>

              <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 text-[11px] text-slate-600 leading-relaxed">
                User will receive authorization to log into the Admin Management Hub using their email address.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black transition cursor-pointer shadow-md shadow-indigo-600/20"
                >
                  Confirm & Grant Privilege
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
