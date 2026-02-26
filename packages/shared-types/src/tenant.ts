export type TenantStatus = 'active' | 'suspended' | 'trial' | 'cancelled';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  status: TenantStatus;
  planId: string;
  settings: Record<string, unknown>;
  trialEndsAt: string | null;
  createdAt: string;
}

export type UserRole = 'owner' | 'admin' | 'manager' | 'staff' | 'viewer';

export interface User {
  id: string;
  tenantId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Plan {
  id: string;
  name: string;
  displayName: string;
  priceMonthly: number;
  priceYearly: number | null;
  maxAgents: number;
  maxUsers: number;
  features: Record<string, boolean>;
  isActive: boolean;
}

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'trialing' | 'paused';
export type BillingCycle = 'monthly' | 'yearly';
export type PaymentProvider = 'stripe' | 'mercadopago';

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  paymentProvider: PaymentProvider | null;
  externalSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export type AgentStatus = 'draft' | 'active' | 'paused' | 'error';
export type AgentType = 'assistant' | 'analyst' | 'recommender' | 'notifier' | 'custom';

export interface Agent {
  id: string;
  tenantId: string;
  createdBy: string | null;
  name: string;
  description: string | null;
  type: AgentType;
  status: AgentStatus;
  graphConfig: Record<string, unknown>;
  llmConfig: Record<string, unknown>;
  triggerConfig: Record<string, unknown>;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
}
