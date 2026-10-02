import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Valid email address is required'),
  password: z.string().min(1, 'Password is required'),
});

export const setupSchema = z.object({
  email: z.string().trim().email('Valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters long').default('Admin Owner'),
});

export const programSchema = z.object({
  name: z.string().trim().min(2, 'Program name is required'),
  category: z.string().trim().min(2, 'Category is required'),
  brand_domain: z.string().trim().min(3, 'Brand domain is required'),
  affiliate_url: z.string().trim().url('Valid affiliate URL is required'),
  destination_url: z.string().trim().url('Valid destination URL is required').optional(),
  cloaked_slug: z.string().trim().min(2).regex(/^[a-z0-9_-]+$/i, 'Slug must contain only alphanumeric characters, dashes, or underscores'),
  referral_perk: z.string().trim().optional(),
  description: z.string().trim().optional(),
  cta_label: z.string().trim().optional(),
  commission_type: z.enum(['recurring', 'flat', 'percentage', 'unverified']).default('unverified'),
  commission_value: z.string().nullable().optional(),
  commission_status: z.enum(['verified', 'unverified']).default('unverified'),
  cookie_duration: z.string().nullable().optional(),
  status: z.enum(['active', 'paused', 'expired', 'disabled']).default('active'),
  featured: z.boolean().default(false),
  logo_url: z.string().optional(),
});

export const programUpdateSchema = programSchema.partial();

export const reviewSchema = z.object({
  program_id: z.string().trim().min(1, 'Program ID is required'),
  user_name: z.string().trim().min(2, 'Name must be 2-100 characters').max(100),
  user_email: z.string().trim().email('Valid email required').optional().or(z.literal('')),
  rating: z.number().int().min(1, 'Rating must be between 1 and 5').max(5),
  comment: z.string().trim().min(5, 'Review must be at least 5 characters').max(2000, 'Review cannot exceed 2000 characters'),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().email('Valid email address is required'),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  message: z.string().trim().min(5, 'Message must be at least 5 characters').max(5000, 'Message cannot exceed 5000 characters'),
  program_id: z.string().optional(),
});

export const notificationSettingsSchema = z.object({
  enable_email: z.boolean().default(true),
  alert_email: z.string().trim().email('Valid alert recipient email required'),
  rate_limit_mode: z.enum(['instant', 'digest_15m', 'digest_hourly']).default('instant'),
  smtp_host: z.string().trim().optional().default(''),
  smtp_port: z.number().int().min(1).max(65535).default(587),
  smtp_user: z.string().trim().optional().default(''),
  smtp_pass: z.string().optional().default(''),
  from_email: z.string().trim().optional().default(''),
  webhook_url: z.string().trim().optional().default(''),
  enable_webhook: z.boolean().default(false),
});
