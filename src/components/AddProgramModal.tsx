import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Zap,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Copy,
  Globe,
  ExternalLink,
  Image as ImageIcon,
  Gift,
  Star
} from 'lucide-react';
import { AffiliateProgram } from '../types';
import { api } from '../services/api';

interface AddProgramModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProgramAdded: (program: AffiliateProgram) => void;
  existingPrograms: AffiliateProgram[];
}

export const AddProgramModal: React.FC<AddProgramModalProps> = ({
  isOpen,
  onClose,
  onProgramAdded,
  existingPrograms
}) => {
  const [inputUrl, setInputUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [hasPulledData, setHasPulledData] = useState(false);

  // Form State
  const [formData, setFormData] = useState<Partial<AffiliateProgram>>({
    name: '',
    category: 'AI Tools',
    original_link: '',
    cloaked_slug: '',
    logo_url: '',
    banner_url: '',
    referral_perk: 'Special Referral Deal • Free Trial Included',
    cta_label: 'Try It Free',
    ai_generated_pick: '',
    ai_description: '',
    ai_brief: '',
    commission_type: 'recurring',
    commission_value: '25% Recurring',
    cookie_duration_days: 60,
    status: 'active', // default directly to active so it appears immediately!
    key_selling_points: ['Top-rated software in its category', 'Generous trial and fast onboarding', 'Recommended by industry professionals'],
    target_audience: 'Modern teams, creators, and professionals',
    tags: ['Recommended', 'Tool']
  });

  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  // Real-time duplicate check
  const handleUrlChange = (url: string) => {
    setInputUrl(url);
    setDuplicateWarning(null);
    if (!url || url.length < 5) return;

    try {
      let testUrl = url.trim();
      if (!/^https?:\/\//i.test(testUrl)) testUrl = 'https://' + testUrl;
      const parsed = new URL(testUrl);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

      const dup = existingPrograms.find(p => {
        try {
          return new URL(p.original_link).hostname.replace(/^www\./, '').toLowerCase() === host;
        } catch {
          return false;
        }
      });

      if (dup) {
        setDuplicateWarning(`Note: You already have a referral link for "${dup.name}" (/go/${dup.cloaked_slug}).`);
      }
    } catch {}
  };

  const handleRunAiAnalysis = async () => {
    if (!inputUrl) return;
    setAnalyzing(true);
    setAiError(null);

    try {
      let targetUrl = inputUrl.trim();
      if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

      const result = await api.analyzeLinkWithAI(targetUrl);
      if (result && result.program) {
        setFormData(prev => ({
          ...prev,
          ...result.program,
          original_link: targetUrl
        }));
        setHasPulledData(true);
      }
    } catch (err: any) {
      setAiError(err.message || 'Failed to auto-pull details.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.original_link || !formData.cloaked_slug) {
      alert('Please fill out Name, Referral Link, and Cloaked Slug.');
      return;
    }

    setSaving(true);
    try {
      const created = await api.createProgram({
        ...formData,
        status: 'active' // promote immediately
      });
      onProgramAdded(created);
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to save program');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl relative text-slate-900 my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">Add Referral Program</h2>
              <p className="text-xs text-slate-500">Paste your link: the AI agent automatically pulls product details, generates compelling reasons to sign up, and creates images</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1-Step Paste & Auto-Pull Box */}
        <div className="mt-6 p-5 rounded-2xl bg-indigo-50/60 border border-indigo-100">
          <label className="block text-xs font-extrabold text-indigo-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            Paste Your Referral or Partner Link
          </label>
          <div className="flex flex-col sm:flex-row items-center gap-2.5">
            <div className="relative flex-1 w-full">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={inputUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRunAiAnalysis();
                  }
                }}
                placeholder="https://service.com/?ref=my_referral_id"
                className="w-full pl-10 pr-3 py-3 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 font-mono shadow-2xs"
              />
            </div>
            <button
              type="button"
              disabled={analyzing || !inputUrl}
              onClick={handleRunAiAnalysis}
              className="w-full sm:w-auto px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-extrabold text-xs transition flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 shrink-0 cursor-pointer"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Pulling Info & Creating Image...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Auto-Pull Details & Create Image</span>
                </>
              )}
            </button>
          </div>

          {duplicateWarning && (
            <div className="mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{duplicateWarning}</span>
            </div>
          )}

          {aiError && (
            <div className="mt-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
              {aiError}
            </div>
          )}
        </div>

        {/* Live Visual Preview Card (Appears as soon as auto-pull finishes) */}
        {hasPulledData && (
          <div className="mt-6 p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                Live Card Preview (How Users Will See It)
              </span>
              <span className="text-[11px] font-bold text-indigo-600">Auto-Generated by AI</span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm max-w-md mx-auto">
              {formData.banner_url && (
                <div className="h-32 w-full rounded-xl overflow-hidden mb-3 bg-slate-100">
                  <img src={formData.banner_url} alt="Banner Preview" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex items-center gap-2.5 mb-2">
                {formData.logo_url && (
                  <img src={formData.logo_url} alt="Logo" className="w-8 h-8 rounded-lg object-contain p-0.5 border border-slate-200" />
                )}
                <div>
                  <h4 className="font-extrabold text-slate-900 text-sm">{formData.name}</h4>
                  <span className="text-[10px] text-slate-500 font-medium">{formData.category}</span>
                </div>
              </div>
              {formData.referral_perk && (
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-bold mb-2 flex items-center gap-1.5">
                  <Gift className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{formData.referral_perk}</span>
                </div>
              )}
              <p className="text-xs text-slate-600 line-clamp-2 mb-3">{formData.ai_description}</p>
              <div className="py-2 px-3 rounded-xl bg-indigo-600 text-white font-bold text-xs text-center">
                {formData.cta_label || `Try ${formData.name} Free →`}
              </div>
            </div>
          </div>
        )}

        {/* Editable Form with Full Overrides */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4 max-h-[50vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Service / App Name *</label>
              <input
                type="text"
                required
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Cursor, Notion, Linear"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
              <select
                value={formData.category || 'AI Tools'}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white cursor-pointer"
              >
                <option value="AI Tools">AI Tools</option>
                <option value="SaaS & Dev">SaaS & Dev</option>
                <option value="Productivity">Productivity</option>
                <option value="Marketing">Marketing</option>
                <option value="E-Commerce">E-Commerce</option>
                <option value="Finance & Crypto">Finance & Crypto</option>
                <option value="Hosting & Cloud">Hosting & Cloud</option>
                <option value="Security">Security</option>
              </select>
            </div>
          </div>

          {/* Referral Perk & CTA Button Text */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-emerald-800 mb-1 flex items-center gap-1">
                <Gift className="w-3.5 h-3.5 text-emerald-600" />
                Referral Perk / Bonus (Shows on Card)
              </label>
              <input
                type="text"
                value={formData.referral_perk || ''}
                onChange={(e) => setFormData({ ...formData, referral_perk: e.target.value })}
                placeholder="e.g. Free 14-Day Pro Trial + 20% Off"
                className="w-full px-3 py-2 rounded-xl bg-emerald-50/50 border border-emerald-300 text-emerald-950 font-medium text-xs focus:outline-none focus:border-emerald-600 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Button Call-to-Action Text</label>
              <input
                type="text"
                value={formData.cta_label || ''}
                onChange={(e) => setFormData({ ...formData, cta_label: e.target.value })}
                placeholder="e.g. Try Cursor Free, Claim 20% Deal"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Cloaked Slug & Original Link */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Cloaked Link Slug *</label>
              <div className="flex items-center">
                <span className="px-3 py-2 rounded-l-xl bg-slate-100 text-slate-500 font-mono text-xs border border-r-0 border-slate-300">
                  /go/
                </span>
                <input
                  type="text"
                  required
                  value={formData.cloaked_slug || ''}
                  onChange={(e) => setFormData({ ...formData, cloaked_slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                  placeholder="cursor"
                  className="w-full px-3 py-2 rounded-r-xl bg-slate-50 border border-slate-300 text-indigo-700 font-mono text-xs font-bold focus:outline-none focus:border-indigo-600 focus:bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Destination Referral Link *</label>
              <input
                type="url"
                required
                value={formData.original_link || ''}
                onChange={(e) => setFormData({ ...formData, original_link: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Image & Logo URLs (Auto-pulled) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                <span>Program Logo URL (Auto-Generated)</span>
                {formData.logo_url && <span className="text-[10px] text-emerald-600 font-semibold">✓ Active</span>}
              </label>
              <input
                type="url"
                value={formData.logo_url || ''}
                onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-700 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                <span>Card Banner Image URL (Auto-Created)</span>
                {formData.banner_url && <span className="text-[10px] text-emerald-600 font-semibold">✓ Active</span>}
              </label>
              <input
                type="url"
                value={formData.banner_url || ''}
                onChange={(e) => setFormData({ ...formData, banner_url: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-700 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
              />
            </div>
          </div>

          {/* AI Generated Pick / Verdict */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Why We Recommend It (Verdict Headline)
            </label>
            <input
              type="text"
              value={formData.ai_generated_pick || ''}
              onChange={(e) => setFormData({ ...formData, ai_generated_pick: e.target.value })}
              placeholder="e.g. Editor's Pick ★ 4.9/5 — High efficiency developer favorite"
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Marketing Description (Shows on Card)
            </label>
            <textarea
              rows={2}
              value={formData.ai_description || ''}
              onChange={(e) => setFormData({ ...formData, ai_description: e.target.value })}
              placeholder="Convincing summary of why this application is great..."
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
            />
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs transition shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              <span>Publish Referral Program</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
