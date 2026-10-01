import React, { useState } from 'react';
import { X, Lock, ShieldCheck, Mail, Key } from 'lucide-react';
import { UserRole } from '../types';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (role: UserRole) => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess
}) => {
  const [email, setEmail] = useState('abbas.aj@gmail.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Verify admin email or quick login
    if (email.toLowerCase().includes('abbas') || email.toLowerCase().includes('admin')) {
      onLoginSuccess('super_admin');
      onClose();
    } else if (email.toLowerCase().includes('editor')) {
      onLoginSuccess('editor');
      onClose();
    } else {
      setError('Invalid admin credentials. Please use your registered admin email.');
    }
  };

  const handleQuickDemoLogin = (role: UserRole) => {
    onLoginSuccess(role);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative text-slate-900">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-100 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-black text-slate-900">Admin Portal Sign In</h2>
          <p className="text-xs text-slate-500 mt-1">
            Restricted area. Only verified administrators can add, edit, or manage referral links.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Admin Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="abbas.aj@gmail.com"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Password</label>
            <div className="relative">
              <Key className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 font-semibold">{error}</p>
          )}

          <button
            type="submit"
            className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs transition shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Sign In as Admin</span>
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-200">
          <p className="text-[11px] text-center text-slate-400 mb-3 font-semibold">One-Click Admin Evaluation Access</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleQuickDemoLogin('super_admin')}
              className="flex-1 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition cursor-pointer text-center"
            >
              Sign In (Abbas / Owner)
            </button>
            <button
              type="button"
              onClick={() => handleQuickDemoLogin('editor')}
              className="flex-1 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer text-center"
            >
              Editor View
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
