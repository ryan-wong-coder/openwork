"use client";

import { localizeDenError } from "../app/_lib/error-copy";
import { denStatusLabel, DEFAULT_DEN_LOCALE } from "../app/_lib/locale";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DenButton } from "../app/(den)/_components/ui/button";
import { AdminDashboard } from "./admin/admin-dashboard";
import { DenSelect } from "../app/(den)/_components/ui/select";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { FEATURE_KEYS, mapFeatures, type FeatureKey } from "@openwork/features";
import { denApiCredentials, denBrowserEndpoint } from "../app/(den)/_lib/den-api-origin";
import { withStoredBearer } from "./admin/admin-request";
import { adminOrganizationHref, useAdminListLocation, type AdminDataSection } from "./admin/admin-list-location";
import { AdminDeferredContent } from "./admin/admin-deferred-content";
import { AdminAccessScreen } from "./admin/admin-access-screen";
import { AdminOrganizationFeatureControls, type AdminFeatureState, type AdminOrganizationFeatures } from "./admin/admin-organization-feature-controls";

type AccessState = "ready" | "signed-out" | "forbidden" | "error";

const DEFAULT_FREE_SEAT_COUNT = 5;
const ADMIN_PAGE_SIZE = 50;
const ADMIN_MAX_PAGE_OFFSET = 100_000;
const ADMIN_SCALE_FIXTURE_USERS = 50_000;
const ADMIN_SCALE_FIXTURE_ORGANIZATIONS = 60_000;
const ADMIN_SEARCH_DEBOUNCE_MS = 75;

type AdminBillingStatus = {
  status: "paid" | "unpaid" | "unavailable";
  featureGateEnabled: boolean;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  source: "benefit" | "subscription" | "unavailable";
  note: string | null;
};

type AdminUserOrganization = {
  id: string;
  name: string;
  role: string;
  memberCount: number;
  joinedAt: string | null;
};

type AdminEntry = {
  id: string;
  email: string;
  note: string | null;
  createdAt: string;
};

type InferenceUsageWindow = {
  bucketId: string;
  windowType: string;
  windowStartAt: string;
  windowEndAt: string;
  limitAmount: number;
  organizationUsedAmount: number;
  userUsedAmount: number;
};

type InferenceUsageOrganization = {
  id: string;
  name: string;
  membershipId: string;
  windows: InferenceUsageWindow[];
};

type InferenceUsagePayload = {
  user: { id: string; email: string };
  organizations: InferenceUsageOrganization[];
};

type InferenceUsageCacheEntry =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: InferenceUsagePayload };

type ActivityPoint = {
  day: string;
  activeUsers: number;
  realActiveUsers: number;
  signups: number;
};

type AdminSummary = {
  totalUsers: number;
  totalOrganizations: number;
  verifiedUsers: number | null;
  recentUsers7d: number | null;
  recentUsers30d: number | null;
  totalWorkers: number | null;
  cloudWorkers: number | null;
  localWorkers: number | null;
  usersWithWorkers: number | null;
  usersWithoutWorkers: number | null;
  paidUsers: number | null;
  unpaidUsers: number | null;
  billingUnavailableUsers: number | null;
  adminCount: number;
  billingLoaded: boolean;
  activeUsers1d: number | null;
  activeUsers7d: number | null;
  activeUsers30d: number | null;
  realActiveUsers1d: number | null;
  realActiveUsers7d: number | null;
  realActiveUsers30d: number | null;
  recurringUsers: number | null;
  inviters: number | null;
  medianHoursToFirstInvite: number | null;
  activitySeries: ActivityPoint[];
};

type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastSeenAt: string | null;
  sessionCount: number;
  activeDayCount: number;
  isRecurring: boolean;
  lastActiveAt: string | null;
  invitesSent: number;
  firstInviteAt: string | null;
  hoursToFirstInvite: number | null;
  authProviders: string[];
  workerCount: number;
  cloudWorkerCount: number;
  localWorkerCount: number;
  latestWorkerCreatedAt: string | null;
  billing: AdminBillingStatus | null;
  organizations: AdminUserOrganization[];
};

const ADMIN_FEATURE_SOURCES = ["unavailable", "killed", "lock", "override", "everyone"] as const;

function parseAdminFeatureSource(value: unknown): AdminFeatureState["source"] {
  return ADMIN_FEATURE_SOURCES.find((source) => source === value) ?? "everyone";
}

/** Server featureStates, falling back to the effective capabilities map from older servers. */
function parseAdminOrganizationFeatures(featureStates: unknown, capabilities: unknown): AdminOrganizationFeatures {
  const states = isRecord(featureStates) ? featureStates : {};
  const effective = isRecord(capabilities) ? capabilities : {};
  return mapFeatures((key) => {
    const state = states[key];
    if (!isRecord(state)) {
      const enabled = effective[key] === true;
      return { enabled, source: "everyone", everyone: enabled, killed: false, override: null, overrideApplies: true };
    }
    return {
      enabled: state.enabled === true,
      source: parseAdminFeatureSource(state.source),
      everyone: state.everyone === true,
      killed: state.killed === true,
      override: typeof state.override === "boolean" ? state.override : null,
      overrideApplies: state.overrideApplies === true,
    };
  });
}

type AdminOpenWorkWebAccess = {
  hasAccess: boolean;
  accessSource: "subscription" | "complimentary" | null;
  complimentaryAccess: boolean;
  hasEligibleSubscription: boolean;
  hasOngoingSubscription: boolean;
  subscriptionStatus: string | null;
};

type AdminOrganization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string | null;
  updatedAt: string | null;
  memberCount: number;
  plan: {
    tier: "free" | "team" | "enterprise";
    source: string;
  };
  seatLimit: number;
  freeSeatCount: number;
  seatsFreeAdditional: number;
  billableSeatCount: number;
  features: AdminOrganizationFeatures | null;
  openworkWebAccess: AdminOpenWorkWebAccess;
};

type AdminPageInfo = {
  total: number;
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  search: string;
  durationMs: number;
};

type AdminUsersPayload = {
  users: AdminUser[];
  page: AdminPageInfo;
  billing: {
    loaded: boolean;
    paidUsers: number | null;
    unpaidUsers: number | null;
    billingUnavailableUsers: number | null;
  };
  generatedAt: string | null;
};

type AdminOrganizationsPayload = {
  organizations: AdminOrganization[];
  page: AdminPageInfo;
  generatedAt: string | null;
};

type AdminMetricsPayload = {
  summary: AdminSummary;
  generatedAt: string | null;
};

type AdminPayload = {
  viewer: {
    id: string;
    email: string | null;
    name: string | null;
  };
  admins: AdminEntry[];
  summary: AdminSummary;
  users: AdminUser[];
  organizations: AdminOrganization[];
  userPage: AdminPageInfo;
  organizationPage: AdminPageInfo;
  generatedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNumberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toNullableNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseBillingStatus(value: unknown): AdminBillingStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = value.status === "paid" || value.status === "unpaid" || value.status === "unavailable"
    ? value.status
    : "unavailable";
  const source = value.source === "benefit" || value.source === "subscription" || value.source === "unavailable"
    ? value.source
    : "unavailable";

  return {
    status,
    featureGateEnabled: value.featureGateEnabled === true,
    subscriptionId: toStringValue(value.subscriptionId),
    subscriptionStatus: toStringValue(value.subscriptionStatus),
    currentPeriodEnd: toStringValue(value.currentPeriodEnd),
    source,
    note: toStringValue(value.note)
  };
}

function parseAdminOpenWorkWebAccess(value: unknown): AdminOpenWorkWebAccess {
  if (!isRecord(value)) {
    return {
      hasAccess: false,
      accessSource: null,
      complimentaryAccess: false,
      hasEligibleSubscription: false,
      hasOngoingSubscription: false,
      subscriptionStatus: null
    };
  }

  const accessSource = value.accessSource === "subscription" || value.accessSource === "complimentary"
    ? value.accessSource
    : null;
  return {
    hasAccess: value.hasAccess === true,
    accessSource,
    complimentaryAccess: value.complimentaryAccess === true,
    hasEligibleSubscription: value.hasEligibleSubscription === true,
    hasOngoingSubscription: value.hasOngoingSubscription === true,
    subscriptionStatus: toStringValue(value.subscriptionStatus)
  };
}

function parseActivitySeries(value: unknown): ActivityPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const points: ActivityPoint[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const day = toStringValue(entry.day);
    if (!day) {
      continue;
    }

    points.push({
      day,
      activeUsers: toNumberValue(entry.activeUsers),
      realActiveUsers: toNumberValue(entry.realActiveUsers),
      signups: toNumberValue(entry.signups)
    });
  }

  return points;
}

function parseAdminPageInfo(value: unknown, total: number, returned: number): AdminPageInfo {
  if (!isRecord(value)) {
    return { total, limit: returned, offset: 0, returned, hasMore: false, search: "", durationMs: 0 };
  }

  return {
    total: toNumberValue(value.total),
    limit: toNumberValue(value.limit),
    offset: toNumberValue(value.offset),
    returned: toNumberValue(value.returned),
    hasMore: value.hasMore === true,
    search: toStringValue(value.search) ?? "",
    durationMs: toNumberValue(value.durationMs)
  };
}

function parseAdminSummary(summary: Record<string, unknown>, organizationFallback: number): AdminSummary {
  return {
    totalUsers: toNumberValue(summary.totalUsers),
    totalOrganizations: toNumberValue(summary.totalOrganizations) || organizationFallback,
    verifiedUsers: toNullableNumberValue(summary.verifiedUsers),
    recentUsers7d: toNullableNumberValue(summary.recentUsers7d),
    recentUsers30d: toNullableNumberValue(summary.recentUsers30d),
    totalWorkers: toNullableNumberValue(summary.totalWorkers),
    cloudWorkers: toNullableNumberValue(summary.cloudWorkers),
    localWorkers: toNullableNumberValue(summary.localWorkers),
    usersWithWorkers: toNullableNumberValue(summary.usersWithWorkers),
    usersWithoutWorkers: toNullableNumberValue(summary.usersWithoutWorkers),
    paidUsers: toNullableNumberValue(summary.paidUsers),
    unpaidUsers: toNullableNumberValue(summary.unpaidUsers),
    billingUnavailableUsers: toNullableNumberValue(summary.billingUnavailableUsers),
    adminCount: toNumberValue(summary.adminCount),
    billingLoaded: summary.billingLoaded === true,
    activeUsers1d: toNullableNumberValue(summary.activeUsers1d),
    activeUsers7d: toNullableNumberValue(summary.activeUsers7d),
    activeUsers30d: toNullableNumberValue(summary.activeUsers30d),
    realActiveUsers1d: toNullableNumberValue(summary.realActiveUsers1d),
    realActiveUsers7d: toNullableNumberValue(summary.realActiveUsers7d),
    realActiveUsers30d: toNullableNumberValue(summary.realActiveUsers30d),
    recurringUsers: toNullableNumberValue(summary.recurringUsers),
    inviters: toNullableNumberValue(summary.inviters),
    medianHoursToFirstInvite: toNullableNumberValue(summary.medianHoursToFirstInvite),
    activitySeries: parseActivitySeries(summary.activitySeries)
  };
}

function parseAdminPayload(payload: unknown): AdminPayload | null {
  if (!isRecord(payload) || !isRecord(payload.summary) || !isRecord(payload.userPage) || !isRecord(payload.organizationPage) || !Array.isArray(payload.users) || !Array.isArray(payload.admins)) {
    return null;
  }

  const viewer = isRecord(payload.viewer) ? payload.viewer : {};
  const summary = payload.summary;

  const users: AdminUser[] = payload.users
    .map((value) => {
      if (!isRecord(value) || typeof value.id !== "string" || typeof value.email !== "string") {
        return null;
      }

      const authProviders = Array.isArray(value.authProviders)
        ? value.authProviders.filter((provider): provider is string => typeof provider === "string")
        : [];

      const organizations: AdminUserOrganization[] = Array.isArray(value.organizations)
        ? value.organizations
          .map((organization) => {
            if (!isRecord(organization) || typeof organization.id !== "string" || typeof organization.name !== "string" || typeof organization.role !== "string") {
              return null;
            }

            return {
              id: organization.id,
              name: organization.name,
              role: organization.role,
              memberCount: toNumberValue(organization.memberCount),
              joinedAt: toStringValue(organization.joinedAt)
            };
          })
          .filter((organization): organization is AdminUserOrganization => organization !== null)
        : [];

      return {
        id: value.id,
        name: toStringValue(value.name),
        email: value.email,
        emailVerified: value.emailVerified === true,
        createdAt: toStringValue(value.createdAt),
        updatedAt: toStringValue(value.updatedAt),
        lastSeenAt: toStringValue(value.lastSeenAt),
        sessionCount: toNumberValue(value.sessionCount),
        activeDayCount: toNumberValue(value.activeDayCount),
        isRecurring: value.isRecurring === true,
        lastActiveAt: toStringValue(value.lastActiveAt),
        invitesSent: toNumberValue(value.invitesSent),
        firstInviteAt: toStringValue(value.firstInviteAt),
        hoursToFirstInvite: toNullableNumberValue(value.hoursToFirstInvite),
        authProviders,
        workerCount: toNumberValue(value.workerCount),
        cloudWorkerCount: toNumberValue(value.cloudWorkerCount),
        localWorkerCount: toNumberValue(value.localWorkerCount),
        latestWorkerCreatedAt: toStringValue(value.latestWorkerCreatedAt),
        billing: parseBillingStatus(value.billing),
        organizations
      };
    })
    .filter((value): value is AdminUser => value !== null);

  const admins: AdminEntry[] = payload.admins
    .map((value) => {
      if (!isRecord(value) || typeof value.id !== "string" || typeof value.email !== "string" || typeof value.createdAt !== "string") {
        return null;
      }

      return {
        id: value.id,
        email: value.email,
        note: toStringValue(value.note),
        createdAt: value.createdAt
      };
    })
    .filter((value): value is AdminEntry => value !== null);

  const organizations: AdminOrganization[] = Array.isArray(payload.organizations)
    ? payload.organizations
      .map((value) => {
        if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.slug !== "string") {
          return null;
        }

        const plan = isRecord(value.plan) ? value.plan : {};
        const tier = plan.tier === "team" || plan.tier === "enterprise" ? plan.tier : "free";

        return {
          id: value.id,
          name: value.name,
          slug: value.slug,
          createdAt: toStringValue(value.createdAt),
          updatedAt: toStringValue(value.updatedAt),
          memberCount: toNumberValue(value.memberCount),
          plan: {
            tier,
            source: toStringValue(plan.source) ?? "default"
          },
          seatLimit: toNumberValue(value.seatLimit),
          freeSeatCount: toNumberValue(value.freeSeatCount) || DEFAULT_FREE_SEAT_COUNT,
          seatsFreeAdditional: toNumberValue(value.seatsFreeAdditional),
          billableSeatCount: toNumberValue(value.billableSeatCount),
          features: isRecord(value.featureStates) || isRecord(value.capabilities)
            ? parseAdminOrganizationFeatures(value.featureStates, value.capabilities)
            : null,
          openworkWebAccess: parseAdminOpenWorkWebAccess(value.openworkWebAccess)
        };
      })
      .filter((value): value is AdminOrganization => value !== null)
    : [];

  return {
    viewer: {
      id: typeof viewer.id === "string" ? viewer.id : "unknown",
      email: toStringValue(viewer.email),
      name: toStringValue(viewer.name)
    },
    admins,
    summary: parseAdminSummary(summary, organizations.length),
    users,
    organizations,
    userPage: parseAdminPageInfo(payload.userPage, toNumberValue(summary.totalUsers), users.length),
    organizationPage: parseAdminPageInfo(payload.organizationPage, toNumberValue(summary.totalOrganizations), organizations.length),
    generatedAt: toStringValue(payload.generatedAt)
  };
}

function parseAdminUsersPayload(payload: unknown): AdminUsersPayload | null {
  if (!isRecord(payload) || !Array.isArray(payload.users)) {
    return null;
  }

  const parsed = parseAdminPayload({
    viewer: {},
    admins: [],
    summary: {},
    users: payload.users,
    organizations: [],
    userPage: payload.page,
    organizationPage: {},
    generatedAt: payload.generatedAt
  });
  if (!parsed) {
    return null;
  }

  const billing = isRecord(payload.billing) ? payload.billing : {};
  return {
    users: parsed.users,
    page: parseAdminPageInfo(payload.page, parsed.users.length, parsed.users.length),
    billing: {
      loaded: billing.loaded === true,
      paidUsers: toNullableNumberValue(billing.paidUsers),
      unpaidUsers: toNullableNumberValue(billing.unpaidUsers),
      billingUnavailableUsers: toNullableNumberValue(billing.billingUnavailableUsers)
    },
    generatedAt: toStringValue(payload.generatedAt)
  };
}

function parseAdminOrganizationsPayload(payload: unknown): AdminOrganizationsPayload | null {
  if (!isRecord(payload) || !Array.isArray(payload.organizations)) {
    return null;
  }

  const parsed = parseAdminPayload({
    viewer: {},
    admins: [],
    summary: {},
    users: [],
    organizations: payload.organizations,
    userPage: {},
    organizationPage: payload.page,
    generatedAt: payload.generatedAt
  });
  if (!parsed) {
    return null;
  }

  return {
    organizations: parsed.organizations,
    page: parseAdminPageInfo(payload.page, parsed.organizations.length, parsed.organizations.length),
    generatedAt: toStringValue(payload.generatedAt)
  };
}

function parseAdminMetricsPayload(payload: unknown): AdminMetricsPayload | null {
  if (!isRecord(payload) || !isRecord(payload.summary)) {
    return null;
  }

  return {
    summary: parseAdminSummary(payload.summary, 0),
    generatedAt: toStringValue(payload.generatedAt)
  };
}

function parseAdminInitialPayload(value: unknown, section: AdminDataSection): AdminPayload | null {
  if (section === "overview") return parseAdminPayload(value);
  const users = section === "users" ? parseAdminUsersPayload(value) : null;
  const organizations = section === "organizations" ? parseAdminOrganizationsPayload(value) : null;
  if (!users && !organizations) return null;
  return {
    viewer: { id: "", email: null, name: null },
    admins: [],
    summary: parseAdminSummary({
      totalUsers: users?.page.total ?? 0,
      totalOrganizations: organizations?.page.total ?? 0,
      billingLoaded: users?.billing.loaded ?? false,
      paidUsers: users?.billing.paidUsers,
      unpaidUsers: users?.billing.unpaidUsers,
      billingUnavailableUsers: users?.billing.billingUnavailableUsers,
    }, 0),
    users: users?.users ?? [],
    organizations: organizations?.organizations ?? [],
    userPage: users?.page ?? parseAdminPageInfo({}, 0, 0),
    organizationPage: organizations?.page ?? parseAdminPageInfo({}, 0, 0),
    generatedAt: users?.generatedAt ?? organizations?.generatedAt ?? null,
  };
}

function parseInferenceUsagePayload(payload: unknown): InferenceUsagePayload | null {
  if (!isRecord(payload) || !isRecord(payload.user) || typeof payload.user.id !== "string" || typeof payload.user.email !== "string" || !Array.isArray(payload.organizations)) {
    return null;
  }

  const organizations: InferenceUsageOrganization[] = [];
  for (const value of payload.organizations) {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.membershipId !== "string" || !Array.isArray(value.windows)) {
      return null;
    }

    const windows: InferenceUsageWindow[] = [];
    for (const window of value.windows) {
      if (!isRecord(window) || typeof window.bucketId !== "string" || typeof window.windowType !== "string" || typeof window.windowStartAt !== "string" || typeof window.windowEndAt !== "string") {
        return null;
      }
      windows.push({
        bucketId: window.bucketId,
        windowType: window.windowType,
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        limitAmount: toNumberValue(window.limitAmount),
        organizationUsedAmount: toNumberValue(window.organizationUsedAmount),
        userUsedAmount: toNumberValue(window.userUsedAmount)
      });
    }
    organizations.push({ id: value.id, name: value.name, membershipId: value.membershipId, windows });
  }

  return { user: { id: payload.user.id, email: payload.user.email }, organizations };
}

function getFriendlyHtmlError(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  if (!lower) {
    return null;
  }

  if (lower.includes("cannot get /v1/admin/overview")) {
    return "上游服务的 Den 管理 API 尚未就绪，后端部署可能失败或仍在进行。";
  }

  if (lower.startsWith("<!doctype") || lower.startsWith("<html")) {
    return "上游 Den 服务返回了 HTML，通常表示管理后台路由未更新或不可用。";
  }

  return null;
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") {
    const friendly = getFriendlyHtmlError(payload);
    if (friendly) {
      return friendly;
    }

    if (payload.trim()) {
      return localizeDenError(payload.trim());
    }
  }

  if (!isRecord(payload)) {
    return fallback;
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    return localizeDenError(payload.message.trim());
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    const friendly = getFriendlyHtmlError(payload.error);
    return friendly ?? localizeDenError(payload.error.trim());
  }

  return fallback;
}

function isAdminScaleFixtureEnabled(): boolean {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("adminScaleFixture") === "1";
}

function fixturePageInfo(total: number, returned: number, offset: number, search: string, durationMs: number): AdminPageInfo {
  return {
    total,
    limit: ADMIN_PAGE_SIZE,
    offset,
    returned,
    search,
    durationMs,
    hasMore: offset + returned < total
  };
}

function buildFixtureUser(index: number, includeBilling: boolean): AdminUser {
  const target = index === ADMIN_SCALE_FIXTURE_USERS - 7;
  const email = target ? "scale-search-target@example.com" : `user${index}@company${index % 997}.example`;
  const organizationId = `org_${String(index % ADMIN_SCALE_FIXTURE_ORGANIZATIONS).padStart(5, "0")}`;
  return {
    id: `user_${String(index).padStart(5, "0")}`,
    name: target ? "Scale Search Target" : `User ${index}`,
    email,
    emailVerified: index % 3 !== 0,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
    lastSeenAt: "2026-07-12T12:00:00.000Z",
    sessionCount: target ? 42 : index % 9,
    activeDayCount: target ? 8 : index % 4,
    isRecurring: target || index % 4 > 1,
    lastActiveAt: "2026-07-12T12:00:00.000Z",
    invitesSent: target ? 5 : index % 3,
    firstInviteAt: target ? "2026-07-02T12:00:00.000Z" : null,
    hoursToFirstInvite: target ? 24 : null,
    authProviders: target ? ["scale-provider"] : [index % 2 === 0 ? "google" : "github"],
    workerCount: target ? 3 : index % 2,
    cloudWorkerCount: target ? 2 : index % 2,
    localWorkerCount: target ? 1 : 0,
    latestWorkerCreatedAt: target ? "2026-07-12T10:00:00.000Z" : null,
    billing: includeBilling ? {
      status: target ? "paid" : "unpaid",
      featureGateEnabled: false,
      subscriptionId: target ? "sub_scale_fixture" : null,
      subscriptionStatus: target ? "active" : null,
      currentPeriodEnd: target ? "2026-08-01T00:00:00.000Z" : null,
      source: "subscription",
      note: target ? "已由有效的组织订阅覆盖。" : "缓存的组织订阅未覆盖此用户。"
    } : null,
    organizations: [{
      id: organizationId,
      name: target ? "Scale Target Org" : `Organization ${index % ADMIN_SCALE_FIXTURE_ORGANIZATIONS}`,
      role: target ? "owner" : "member",
      memberCount: target ? 128 : 3,
      joinedAt: "2026-07-01T12:00:00.000Z"
    }]
  };
}

function fixtureUserMatches(index: number, search: string): boolean {
  if (!search) {
    return true;
  }

  const user = buildFixtureUser(index, false);
  const haystack = [
    user.id,
    user.name ?? "",
    user.email,
    ...user.authProviders,
    ...user.organizations.flatMap((organization) => [organization.id, organization.name, organization.role])
  ].join(" ").toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function fixtureUsers(search: string, offset: number, includeBilling: boolean) {
  const rows: AdminUser[] = [];
  let total = 0;

  if (!search) {
    for (let index = offset; index < Math.min(offset + ADMIN_PAGE_SIZE, ADMIN_SCALE_FIXTURE_USERS); index += 1) {
      rows.push(buildFixtureUser(index, includeBilling));
    }
    return { rows, total: ADMIN_SCALE_FIXTURE_USERS };
  }

  for (let index = 0; index < ADMIN_SCALE_FIXTURE_USERS; index += 1) {
    if (!fixtureUserMatches(index, search)) {
      continue;
    }
    if (total >= offset && rows.length < ADMIN_PAGE_SIZE) {
      rows.push(buildFixtureUser(index, includeBilling));
    }
    total += 1;
  }

  return { rows, total };
}

function buildFixtureOrganization(index: number, includeFeatures = false): AdminOrganization {
  const target = index === ADMIN_SCALE_FIXTURE_ORGANIZATIONS - 11;
  return {
    id: `org_${String(index).padStart(5, "0")}`,
    name: target ? "Scale Performance Target Organization" : `Organization ${index}`,
    slug: target ? "scale-performance-target" : `organization-${index}`,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
    memberCount: target ? 128 : 4,
    plan: { tier: target ? "enterprise" : "free", source: target ? "manual" : "default" },
    seatLimit: target ? 500 : 5,
    freeSeatCount: target ? 25 : DEFAULT_FREE_SEAT_COUNT,
    seatsFreeAdditional: target ? 20 : 0,
    billableSeatCount: target ? 103 : 0,
    features: includeFeatures ? mapFeatures((key) => {
      const enabled = target && (key === "permissions" || key === "workbot");
      return { enabled, source: "everyone", everyone: enabled, killed: false, override: null, overrideApplies: true };
    }) : null,
    openworkWebAccess: {
      hasAccess: target,
      accessSource: target ? "complimentary" : null,
      complimentaryAccess: target,
      hasEligibleSubscription: false,
      hasOngoingSubscription: false,
      subscriptionStatus: null
    }
  };
}

function fixtureOrganizationMatches(index: number, search: string): boolean {
  if (!search) {
    return true;
  }

  const organization = buildFixtureOrganization(index);
  return [organization.id, organization.name, organization.slug].some((value) => value.toLowerCase().includes(search.toLowerCase()));
}

function fixtureOrganizations(search: string, offset: number) {
  const rows: AdminOrganization[] = [];
  let total = 0;

  if (!search) {
    for (let index = offset; index < Math.min(offset + ADMIN_PAGE_SIZE, ADMIN_SCALE_FIXTURE_ORGANIZATIONS); index += 1) {
      rows.push(buildFixtureOrganization(index));
    }
    return { rows, total: ADMIN_SCALE_FIXTURE_ORGANIZATIONS };
  }

  for (let index = 0; index < ADMIN_SCALE_FIXTURE_ORGANIZATIONS; index += 1) {
    if (!fixtureOrganizationMatches(index, search)) {
      continue;
    }
    if (total >= offset && rows.length < ADMIN_PAGE_SIZE) {
      rows.push(buildFixtureOrganization(index));
    }
    total += 1;
  }

  return { rows, total };
}

function fixtureActivitySeries(): ActivityPoint[] {
  const points: ActivityPoint[] = [];
  for (let index = 29; index >= 0; index -= 1) {
    const day = new Date(Date.now() - index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    points.push({ day, activeUsers: 160 + (29 - index) * 3, realActiveUsers: 80 + (29 - index) * 2, signups: 11 + ((29 - index) % 5) });
  }

  return points;
}

function fixtureMetricsSummary(): AdminSummary {
  return {
    totalUsers: ADMIN_SCALE_FIXTURE_USERS,
    totalOrganizations: ADMIN_SCALE_FIXTURE_ORGANIZATIONS,
    verifiedUsers: 33_333,
    recentUsers7d: 2_100,
    recentUsers30d: 8_400,
    totalWorkers: 25_002,
    cloudWorkers: 25_001,
    localWorkers: 1,
    usersWithWorkers: 25_000,
    usersWithoutWorkers: 25_000,
    paidUsers: null,
    unpaidUsers: null,
    billingUnavailableUsers: null,
    adminCount: 1,
    billingLoaded: false,
    activeUsers1d: 247,
    activeUsers7d: 1_580,
    activeUsers30d: 6_420,
    realActiveUsers1d: 138,
    realActiveUsers7d: 910,
    realActiveUsers30d: 3_770,
    recurringUsers: 25_001,
    inviters: 33_333,
    medianHoursToFirstInvite: 24,
    activitySeries: fixtureActivitySeries()
  };
}

export function adminScaleFixturePayload(path: string): unknown | null {
  if (!isAdminScaleFixtureEnabled()) {
    return null;
  }

  const url = new URL(path, "http://admin.local");
  const search = url.searchParams.get("search")?.trim() ?? "";
  const offset = Math.min(ADMIN_MAX_PAGE_OFFSET, Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0));
  const includeBilling = url.searchParams.get("includeBilling") === "1";
  const generatedAt = new Date().toISOString();
  const startedAt = performance.now();

  if (url.pathname === "/v1/admin/users") {
    const users = fixtureUsers(search, offset, includeBilling);
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      users: users.rows,
      page: fixturePageInfo(users.total, users.rows.length, offset, search, durationMs),
      billing: includeBilling
        ? { loaded: true, paidUsers: users.rows.filter((user) => user.billing?.status === "paid").length, unpaidUsers: users.rows.filter((user) => user.billing?.status === "unpaid").length, billingUnavailableUsers: 0 }
        : { loaded: false, paidUsers: null, unpaidUsers: null, billingUnavailableUsers: null },
      generatedAt
    };
  }

  if (url.pathname === "/v1/admin/organizations") {
    const organizations = fixtureOrganizations(search, offset);
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      organizations: organizations.rows.map(({ features: _features, ...organization }) => organization),
      page: fixturePageInfo(organizations.total, organizations.rows.length, offset, search, durationMs),
      generatedAt
    };
  }

  const featureOrganization = url.pathname.match(/^\/v1\/admin\/organizations\/org_(\d+)\/capabilities$/);
  if (featureOrganization) {
    return { featureStates: buildFixtureOrganization(Number(featureOrganization[1]), true).features };
  }

  if (url.pathname === "/v1/admin/overview") {
    const users = fixtureUsers("", 0, false);
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      viewer: { id: "user_admin_fixture", email: "admin@example.com", name: "Admin Fixture" },
      admins: [{ id: "admin_fixture", email: "admin@example.com", note: "Eval fixture admin", createdAt: generatedAt }],
      users: users.rows,
      organizations: [],
      userPage: fixturePageInfo(ADMIN_SCALE_FIXTURE_USERS, users.rows.length, 0, "", durationMs),
      organizationPage: fixturePageInfo(ADMIN_SCALE_FIXTURE_ORGANIZATIONS, 0, 0, "", 0),
      summary: {
        totalUsers: ADMIN_SCALE_FIXTURE_USERS,
        totalOrganizations: ADMIN_SCALE_FIXTURE_ORGANIZATIONS,
        verifiedUsers: null,
        recentUsers7d: null,
        recentUsers30d: null,
        totalWorkers: null,
        cloudWorkers: null,
        localWorkers: null,
        usersWithWorkers: null,
        usersWithoutWorkers: null,
        paidUsers: null,
        unpaidUsers: null,
        billingUnavailableUsers: null,
        adminCount: 1,
        billingLoaded: false,
        activeUsers1d: null,
        activeUsers7d: null,
        activeUsers30d: null,
        realActiveUsers1d: null,
        realActiveUsers7d: null,
        realActiveUsers30d: null,
        recurringUsers: null,
        inviters: null,
        medianHoursToFirstInvite: null,
        activitySeries: []
      },
      generatedAt
    };
  }

  if (url.pathname === "/v1/admin/metrics") {
    return {
      summary: fixtureMetricsSummary(),
      generatedAt
    };
  }

  return null;
}

async function requestJson(path: string, signal?: AbortSignal) {
  const fixturePayload = adminScaleFixturePayload(path);
  if (fixturePayload) {
    return { response: new Response(JSON.stringify(fixturePayload), { status: 200 }), payload: fixturePayload };
  }

  const endpoint = denBrowserEndpoint(path);
  const response = await fetch(endpoint, {
    method: "GET",
    credentials: denApiCredentials(endpoint),
    signal,
    headers: withStoredBearer({
      Accept: "application/json"
    })
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { response, payload };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function patchJson(path: string, body: unknown) {
  const endpoint = denBrowserEndpoint(path);
  const response = await fetch(endpoint, {
    method: "PATCH",
    credentials: denApiCredentials(endpoint),
    headers: withStoredBearer({
      Accept: "application/json",
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { response, payload };
}

async function postJson(path: string, body: unknown) {
  const endpoint = denBrowserEndpoint(path);
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: denApiCredentials(endpoint),
    headers: withStoredBearer({
      Accept: "application/json",
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { response, payload };
}

async function putJson(path: string, body: unknown) {
  const endpoint = denBrowserEndpoint(path);
  const response = await fetch(endpoint, {
    method: "PUT",
    credentials: denApiCredentials(endpoint),
    headers: withStoredBearer({
      Accept: "application/json",
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { response, payload };
}

async function deleteJson(path: string) {
  const endpoint = denBrowserEndpoint(path);
  const response = await fetch(endpoint, {
    method: "DELETE",
    credentials: denApiCredentials(endpoint),
    headers: withStoredBearer({
      Accept: "application/json"
    })
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { response, payload };
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(DEFAULT_DEN_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatRelativeTime(value: string | null): string {
  if (!value) {
    return "暂无活动";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "暂无活动";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 1) {
    return "刚刚";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays} 天前`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths} 个月前`;
  }

  return `${Math.floor(diffMonths / 12)} 年前`;
}

function formatHours(hours: number | null): string {
  if (hours === null) {
    return "-";
  }

  if (hours < 1) {
    return "不到 1 小时";
  }

  if (hours < 48) {
    return `${Math.round(hours)} 小时`;
  }

  return `${Math.round(hours / 24)} 天`;
}

function formatOptionalCount(value: number | null): string {
  return value === null ? "待加载" : String(value);
}


function formatUsageAmount(value: number): string {
  return new Intl.NumberFormat(DEFAULT_DEN_LOCALE, {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 2 : 3
  }).format(value);
}

function formatWindowType(value: string): string {
  const normalized = value.toLowerCase().replace(/[-_]/g, " ");
  if (normalized.includes("five") || normalized.includes("5 hour") || normalized.includes("5h")) {
    return "五小时";
  }
  if (normalized.includes("week")) {
    return "每周";
  }
  if (normalized.includes("month")) {
    return "每月";
  }
  return formatProvider(value);
}

function formatProvider(provider: string): string {
  return provider
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function getEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) {
    return "unknown";
  }

  return email.slice(at + 1).trim().toLowerCase();
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, `""`)}"` : value;
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatBillingStatus(value: AdminBillingStatus | null): string {
  if (!value) {
    return "未加载";
  }

  if (value.status === "paid") {
    return "已支付";
  }

  if (value.status === "unpaid") {
    return "未支付";
  }

  return "不可用";
}

function formatSubscriptionStatus(value: string | null): string {
  if (!value) {
    return "无订阅记录";
  }

  return denStatusLabel(value);
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{value}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function ActivityChart({ series }: { series: ActivityPoint[] }) {
  if (series.length === 0) {
    return null;
  }

  const maxActive = Math.max(1, ...series.map((point) => point.activeUsers));

  return (
    <div className="mt-4 border-t border-slate-200 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">活跃用户 · 最近 30 天</p>
        <p className="text-xs text-slate-500">
          <span className="mr-3 inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-md bg-slate-900/80" />任何活动</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-md bg-violet-500" />任务日活（执行过任务）</span>
        </p>
      </div>
      <div className="mt-3 flex h-16 items-end gap-[3px]">
        {series.map((point) => (
          <div
            key={point.day}
            title={`${point.day}：${point.activeUsers} 人活跃 · ${point.realActiveUsers} 人执行任务 · ${point.signups} 人注册`}
            className="relative flex-1"
            style={{ height: "100%" }}
          >
            <div
              className={`absolute inset-x-0 bottom-0 rounded-t transition ${point.activeUsers > 0 ? "bg-slate-900/30 hover:bg-slate-900/45" : "bg-slate-200"}`}
              style={{ height: `${point.activeUsers > 0 ? Math.max(8, Math.round((point.activeUsers / maxActive) * 100)) : 4}%` }}
            />
            {point.realActiveUsers > 0 ? (
              <div
                className="absolute inset-x-0 bottom-0 rounded-t bg-violet-500"
                style={{ height: `${Math.max(8, Math.round((point.realActiveUsers / maxActive) * 100))}%` }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[0.66rem] text-slate-400">
        <span>{series[0].day}</span>
        <span>{series[series.length - 1].day}</span>
      </div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-700">{value}</p>
    </div>
  );
}

function BillingPill({ billing }: { billing: AdminBillingStatus | null }) {
  if (!billing) {
    return (
      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
        未加载
      </span>
    );
  }

  const palette =
    billing.status === "paid"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : billing.status === "unpaid"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${palette}`}>
      {formatBillingStatus(billing)}
    </span>
  );
}

function PlanPill({ tier }: { tier: AdminOrganization["plan"]["tier"] }) {
  const palette = tier === "enterprise"
    ? "border-violet-200 bg-violet-50 text-violet-700"
    : tier === "team"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${palette}`}>
      {tier === "enterprise" ? "企业版" : tier === "team" ? "团队版" : "免费版"}
    </span>
  );
}

function OpenWorkWebAccessPill({ access }: { access: AdminOpenWorkWebAccess }) {
  const label = access.hasOngoingSubscription
    ? "付费订阅"
    : access.complimentaryAccess
      ? "免费赠送"
      : "无访问权限";
  const palette = access.hasOngoingSubscription
    ? "border-violet-200 bg-violet-50 text-violet-700"
    : access.complimentaryAccess
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${palette}`}>
      {label}
    </span>
  );
}

export function DenAdminPanel({ initialPayload, section }: { initialPayload: unknown; section: AdminDataSection }) {
  const viewMode = section;
  const { search: routeSearch, draftSearch, page: routePage, offset: routeOffset, setSearch, setPage } = useAdminListLocation();
  const userQuery = draftSearch;
  const organizationQuery = draftSearch;
  const [initial] = useState(() => parseAdminInitialPayload(initialPayload, section));
  const [accessState, setAccessState] = useState<AccessState>(initial ? "ready" : "error");
  const [payload, setPayload] = useState<AdminPayload | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [copiedOrgId, setCopiedOrgId] = useState<string | null>(null);
  const [includeBilling, setIncludeBilling] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [orgDrafts, setOrgDrafts] = useState<Record<string, { tier: AdminOrganization["plan"]["tier"]; seatLimit: string }>>({});
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null);
  const [freeSeatsDialog, setFreeSeatsDialog] = useState<{ org: AdminOrganization; totalFreeSeats: string } | null>(null);
  const [savingFreeSeatsOrgId, setSavingFreeSeatsOrgId] = useState<string | null>(null);
  const [organizationFeatures, setOrganizationFeatures] = useState<Record<string, AdminOrganizationFeatures>>({});
  const [savingCapabilityOrgId, setSavingCapabilityOrgId] = useState<string | null>(null);
  const [capabilityError, setCapabilityError] = useState<{ orgId: string; message: string } | null>(null);
  const [openworkWebAccessDialog, setOpenWorkWebAccessDialog] = useState<{ org: AdminOrganization; enabled: boolean; reason: string } | null>(null);
  const [savingOpenWorkWebAccessOrgId, setSavingOpenWorkWebAccessOrgId] = useState<string | null>(null);
  const [openworkWebAccessError, setOpenWorkWebAccessError] = useState<{ orgId: string; message: string } | null>(null);
  const [deleteUserDialog, setDeleteUserDialog] = useState<AdminUser | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [adminMutationId, setAdminMutationId] = useState<string | null>(null);
  const [usageByUserId, setUsageByUserId] = useState<Record<string, InferenceUsageCacheEntry>>({});
  const [resetUsageDialog, setResetUsageDialog] = useState<AdminUser | null>(null);
  const [resettingUsageUserId, setResettingUsageUserId] = useState<string | null>(null);
  const [resetSuccessByUserId, setResetSuccessByUserId] = useState<Record<string, number>>({});
  const mountedAtRef = useRef<number | null>(null);
  const overviewRequestIdRef = useRef(0);
  const userRequestIdRef = useRef(0);
  const organizationRequestIdRef = useRef(0);
  const payloadRef = useRef<AdminPayload | null>(initial);
  const usageRequestsRef = useRef(new Set<string>());
  const overviewControllerRef = useRef<AbortController | null>(null);
  const includeBillingRef = useRef(includeBilling);
  const userSearchStartedAtRef = useRef<number | null>(null);
  const organizationSearchStartedAtRef = useRef<number | null>(null);
  const [overviewUsableMs, setOverviewUsableMs] = useState<number | null>(null);
  const [userVisibleDurationMs, setUserVisibleDurationMs] = useState<number | null>(null);
  const [organizationVisibleDurationMs, setOrganizationVisibleDurationMs] = useState<number | null>(null);

  if (mountedAtRef.current === null && typeof performance !== "undefined") {
    mountedAtRef.current = performance.now();
  }

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    includeBillingRef.current = includeBilling;
  }, [includeBilling]);

  const loadOverview = useCallback(async () => {
    const requestId = overviewRequestIdRef.current + 1;
    overviewRequestIdRef.current = requestId;
    overviewControllerRef.current?.abort();
    const controller = new AbortController();
    overviewControllerRef.current = controller;
    setRefreshing(true);
    setError(null);

    try {
      const { response, payload: nextPayload } = await requestJson("/v1/admin/overview?limit=1", controller.signal);
      if (requestId !== overviewRequestIdRef.current) {
        return;
      }

      if (response.status === 401) {
        setAccessState("signed-out");
        setPayload(null);
        return;
      }

      if (response.status === 403) {
        setAccessState("forbidden");
        setPayload(null);
        return;
      }

      if (!response.ok) {
        setAccessState("error");
        setPayload(null);
        setError(getErrorMessage(nextPayload, `管理后台请求失败（HTTP ${response.status}），请重试。`));
        return;
      }

      const parsed = parseAdminPayload(nextPayload);
      if (!parsed) {
        setAccessState("error");
        setPayload(null);
        setError("管理后台返回的数据缺少必要字段。");
        return;
      }

      setIncludeBilling(parsed.summary.billingLoaded);
      setOrganizationFeatures({});
      payloadRef.current = parsed;
      setAccessState("ready");
      setPayload(parsed);
    } catch (nextError) {
      if (requestId === overviewRequestIdRef.current && !isAbortError(nextError)) {
        setAccessState("error");
        setPayload(null);
        setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
      }
    } finally {
      if (requestId === overviewRequestIdRef.current) {
        setRefreshing(false);
      }
    }
  }, []);

  const loadUsers = useCallback(async (search: string, offset: number, loadBilling: boolean, signal?: AbortSignal, existingRequestId?: number) => {
    const requestId = existingRequestId ?? userRequestIdRef.current + 1;
    userRequestIdRef.current = requestId;
    setUsersLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: "50",
        offset: String(offset),
      });
      const trimmed = search.trim();
      if (trimmed) {
        params.set("search", trimmed);
      }
      if (loadBilling) {
        params.set("includeBilling", "1");
      }

      const { response, payload: nextPayload } = await requestJson(`/v1/admin/users?${params.toString()}`, signal);
      if (requestId !== userRequestIdRef.current) {
        return;
      }
      if (response.status === 401) {
        setAccessState("signed-out");
        setPayload(null);
        return;
      }
      if (response.status === 403) {
        setAccessState("forbidden");
        setPayload(null);
        return;
      }
      if (!response.ok) {
        setError(getErrorMessage(nextPayload, `用户搜索失败（HTTP ${response.status}），请重试。`));
        return;
      }

      const parsed = parseAdminUsersPayload(nextPayload);
      if (requestId !== userRequestIdRef.current) {
        return;
      }
      if (!parsed) {
        setError("用户搜索返回的数据缺少必要字段。");
        return;
      }

      setAccessState("ready");
      setIncludeBilling(parsed.billing.loaded);
      setPayload((current) => {
        if (!current) {
          return parseAdminInitialPayload(nextPayload, "users");
        }
        return {
          ...current,
          users: parsed.users,
          userPage: parsed.page,
          generatedAt: parsed.generatedAt,
          summary: {
            ...current.summary,
            billingLoaded: parsed.billing.loaded,
            paidUsers: parsed.billing.paidUsers,
            unpaidUsers: parsed.billing.unpaidUsers,
            billingUnavailableUsers: parsed.billing.billingUnavailableUsers
          }
        };
      });
    } catch (nextError) {
      if (requestId === userRequestIdRef.current && !isAbortError(nextError)) {
        setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
      }
    } finally {
      if (requestId === userRequestIdRef.current) {
        setUsersLoading(false);
      }
    }
  }, []);

  const loadOrganizations = useCallback(async (search: string, offset: number, signal?: AbortSignal, existingRequestId?: number) => {
    const requestId = existingRequestId ?? organizationRequestIdRef.current + 1;
    organizationRequestIdRef.current = requestId;
    setOrganizationsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: "50",
        offset: String(offset),
        includeFeatures: "0",
      });
      const trimmed = search.trim();
      if (trimmed) {
        params.set("search", trimmed);
      }

      const { response, payload: nextPayload } = await requestJson(`/v1/admin/organizations?${params.toString()}`, signal);
      if (requestId !== organizationRequestIdRef.current) {
        return;
      }
      if (response.status === 401) {
        setAccessState("signed-out");
        setPayload(null);
        return;
      }
      if (response.status === 403) {
        setAccessState("forbidden");
        setPayload(null);
        return;
      }
      if (!response.ok) {
        setError(getErrorMessage(nextPayload, `组织搜索失败（HTTP ${response.status}），请重试。`));
        return;
      }

      const parsed = parseAdminOrganizationsPayload(nextPayload);
      if (requestId !== organizationRequestIdRef.current) {
        return;
      }
      if (!parsed) {
        setError("组织搜索返回的数据缺少必要字段。");
        return;
      }

      setAccessState("ready");
      setPayload((current) => {
        if (!current) {
          return parseAdminInitialPayload(nextPayload, "organizations");
        }
        return {
          ...current,
          organizations: parsed.organizations,
          organizationPage: parsed.page,
          generatedAt: parsed.generatedAt
        };
      });
    } catch (nextError) {
      if (requestId === organizationRequestIdRef.current && !isAbortError(nextError)) {
        setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
      }
    } finally {
      if (requestId === organizationRequestIdRef.current) {
        setOrganizationsLoading(false);
      }
    }
  }, []);

  const refreshCurrentPage = useCallback(() => {
    if (section === "users") return loadUsers(routeSearch, routeOffset, includeBillingRef.current);
    if (section === "organizations") return loadOrganizations(routeSearch, routeOffset);
    return loadOverview();
  }, [section, routeSearch, routeOffset, loadUsers, loadOrganizations, loadOverview]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setError(null);

    try {
      const { response, payload: nextPayload } = await requestJson("/v1/admin/metrics");
      if (response.status === 401) {
        setAccessState("signed-out");
        setPayload(null);
        return;
      }
      if (response.status === 403) {
        setAccessState("forbidden");
        setPayload(null);
        return;
      }
      if (!response.ok) {
        setError(getErrorMessage(nextPayload, `分析数据请求失败（HTTP ${response.status}），请重试。`));
        return;
      }

      const parsed = parseAdminMetricsPayload(nextPayload);
      if (!parsed) {
        setError("分析数据缺少必要字段。");
        return;
      }

      setPayload((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          summary: {
            ...parsed.summary,
            billingLoaded: current.summary.billingLoaded,
            paidUsers: current.summary.paidUsers,
            unpaidUsers: current.summary.unpaidUsers,
            billingUnavailableUsers: current.summary.billingUnavailableUsers
          },
          generatedAt: parsed.generatedAt
        };
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const loadInferenceUsage = useCallback(async (userId: string) => {
    if (usageRequestsRef.current.has(userId)) return;
    usageRequestsRef.current.add(userId);
    setUsageByUserId((current) => ({ ...current, [userId]: { status: "loading" } }));
    try {
      const { response, payload: nextPayload } = await requestJson(`/v1/admin/users/${encodeURIComponent(userId)}/inference-usage`);
      if (!response.ok) {
        const message = getErrorMessage(nextPayload, `无法加载模型用量（HTTP ${response.status}），请重试。`);
        setUsageByUserId((current) => ({ ...current, [userId]: { status: "error", message } }));
        return;
      }
      const parsed = parseInferenceUsagePayload(nextPayload);
      if (!parsed) {
        setUsageByUserId((current) => ({ ...current, [userId]: { status: "error", message: "模型用量数据缺少必要字段。" } }));
        return;
      }
      setUsageByUserId((current) => ({ ...current, [userId]: { status: "ready", data: parsed } }));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试";
      setUsageByUserId((current) => ({ ...current, [userId]: { status: "error", message } }));
    } finally {
      usageRequestsRef.current.delete(userId);
    }
  }, []);

  const addAdmin = useCallback(async () => {
    const email = adminEmail.trim();
    const note = adminNote.trim();
    if (!email) {
      setError("请输入新平台管理员的邮箱地址。");
      return;
    }
    setAdminMutationId("add");
    setError(null);
    try {
      const { response, payload: nextPayload } = await postJson("/v1/admin/admins", note ? { email, note } : { email });
      const admin = isRecord(nextPayload) && isRecord(nextPayload.admin) ? nextPayload.admin : null;
      if (!response.ok || !admin || typeof admin.id !== "string" || typeof admin.email !== "string" || typeof admin.createdAt !== "string") {
        setError(getErrorMessage(nextPayload, `无法添加 ${email}，请重试。`));
        return;
      }
      const entry: AdminEntry = { id: admin.id, email: admin.email, note: toStringValue(admin.note), createdAt: admin.createdAt };
      setPayload((current) => current ? {
        ...current,
        admins: [...current.admins, entry],
        summary: { ...current.summary, adminCount: current.summary.adminCount + 1 }
      } : current);
      setAdminEmail("");
      setAdminNote("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
    } finally {
      setAdminMutationId(null);
    }
  }, [adminEmail, adminNote]);

  const removeAdmin = useCallback(async (admin: AdminEntry) => {
    setAdminMutationId(admin.id);
    setError(null);
    try {
      const { response, payload: nextPayload } = await deleteJson(`/v1/admin/admins/${encodeURIComponent(admin.id)}`);
      if (!response.ok) {
        setError(getErrorMessage(nextPayload, `无法移除 ${admin.email}，请重试。`));
        return;
      }
      setPayload((current) => current ? {
        ...current,
        admins: current.admins.filter((entry) => entry.id !== admin.id),
        summary: { ...current.summary, adminCount: Math.max(0, current.summary.adminCount - 1) }
      } : current);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
    } finally {
      setAdminMutationId(null);
    }
  }, []);

  const resetInferenceUsage = useCallback(async () => {
    if (!resetUsageDialog) {
      return;
    }
    const userId = resetUsageDialog.id;
    setResettingUsageUserId(userId);
    setError(null);
    try {
      const { response, payload: nextPayload } = await postJson(`/v1/admin/users/${encodeURIComponent(userId)}/inference-usage/reset`, {});
      if (!response.ok || !isRecord(nextPayload) || typeof nextPayload.resetAmount !== "number") {
        setError(getErrorMessage(nextPayload, `无法重置 ${resetUsageDialog.email} 的用量，请重试。`));
        return;
      }
      const resetAmount = nextPayload.resetAmount;
      setResetSuccessByUserId((current) => ({ ...current, [userId]: resetAmount }));
      setResetUsageDialog(null);
      await loadInferenceUsage(userId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
    } finally {
      setResettingUsageUserId(null);
    }
  }, [loadInferenceUsage, resetUsageDialog]);

  useEffect(() => () => {
    overviewControllerRef.current?.abort();
    overviewRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    if (!copiedOrgId) {
      return;
    }

    const timeout = window.setTimeout(() => setCopiedOrgId(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedOrgId]);

  const copyOrgId = useCallback(async (orgId: string) => {
    try {
      await navigator.clipboard.writeText(orgId);
      setCopiedOrgId(orgId);
    } catch {
      setError("无法复制组织 ID，请手动复制。");
    }
  }, []);

  const filteredUsers = payload?.users ?? [];
  const filteredOrganizations = payload?.organizations ?? [];

  useEffect(() => {
    if (accessState !== "ready" || viewMode !== "users") return;
    const trimmedQuery = routeSearch.trim();
    const currentPage = payloadRef.current?.userPage;
    if (currentPage?.search === trimmedQuery && currentPage.offset === routeOffset) {
      setUsersLoading(false);
      return;
    }
    const requestId = ++userRequestIdRef.current;
    setUsersLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadUsers(trimmedQuery, routeOffset, includeBillingRef.current, controller.signal, requestId);
    }, ADMIN_SEARCH_DEBOUNCE_MS);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [accessState, loadUsers, routeSearch, routeOffset, viewMode]);

  useEffect(() => {
    if (accessState !== "ready" || viewMode !== "organizations") return;
    const trimmedQuery = routeSearch.trim();
    const currentPage = payloadRef.current?.organizationPage;
    if (currentPage?.search === trimmedQuery && currentPage.offset === routeOffset) {
      setOrganizationsLoading(false);
      return;
    }
    const requestId = ++organizationRequestIdRef.current;
    setOrganizationsLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadOrganizations(trimmedQuery, routeOffset, controller.signal, requestId);
    }, ADMIN_SEARCH_DEBOUNCE_MS);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [accessState, loadOrganizations, routeSearch, routeOffset, viewMode]);

  useEffect(() => {
    if (accessState !== "ready" || !payload || overviewUsableMs !== null || mountedAtRef.current === null) {
      return;
    }

    setOverviewUsableMs(Math.round(performance.now() - mountedAtRef.current));
  }, [accessState, overviewUsableMs, payload]);

  useEffect(() => {
    if (!payload || usersLoading || userSearchStartedAtRef.current === null || payload.userPage.search !== userQuery.trim()) {
      return;
    }

    setUserVisibleDurationMs(Math.round(performance.now() - userSearchStartedAtRef.current));
    userSearchStartedAtRef.current = null;
  }, [payload, userQuery, usersLoading]);

  useEffect(() => {
    if (!payload || organizationsLoading || organizationSearchStartedAtRef.current === null || payload.organizationPage.search !== organizationQuery.trim()) {
      return;
    }

    const organizationPageLoaded = payload.organizations.length > 0 || payload.organizationPage.total === 0 || payload.organizationPage.offset > 0 || payload.organizationPage.returned > 0;
    if (!organizationPageLoaded) {
      return;
    }

    setOrganizationVisibleDurationMs(Math.round(performance.now() - organizationSearchStartedAtRef.current));
    organizationSearchStartedAtRef.current = null;
  }, [organizationQuery, organizationsLoading, payload]);

  useEffect(() => {
    if (!payload) {
      setOrgDrafts({});
      return;
    }

    const drafts: Record<string, { tier: AdminOrganization["plan"]["tier"]; seatLimit: string }> = {};
    for (const org of payload.organizations) {
      drafts[org.id] = { tier: org.plan.tier, seatLimit: String(org.seatLimit) };
    }
    setOrgDrafts(drafts);
  }, [payload?.organizations]);

  const saveOrganizationPlan = useCallback(async (org: AdminOrganization) => {
    const draft = orgDrafts[org.id];
    if (!draft) {
      return;
    }

    const seatLimit = Number(draft.seatLimit);
    if (!Number.isInteger(seatLimit) || seatLimit < 1) {
      setError("席位上限必须是正整数。");
      return;
    }

    setSavingOrgId(org.id);
    setError(null);

    try {
      const { response, payload: nextPayload } = await patchJson(`/v1/admin/organizations/${org.id}/plan`, {
        tier: draft.tier,
        seatLimit
      });

      if (!response.ok) {
        setError(getErrorMessage(nextPayload, `无法更新 ${org.name}，请重试。`));
        return;
      }

      setPayload((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          organizations: current.organizations.map((entry) => entry.id === org.id
            ? { ...entry, plan: { ...entry.plan, tier: draft.tier, source: "manual" }, seatLimit }
            : entry)
        };
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
    } finally {
      setSavingOrgId(null);
    }
  }, [orgDrafts]);

  const saveOrganizationFreeSeats = useCallback(async () => {
    if (!freeSeatsDialog) {
      return;
    }

    const totalFreeSeats = Number(freeSeatsDialog.totalFreeSeats);
    if (!Number.isInteger(totalFreeSeats) || totalFreeSeats < DEFAULT_FREE_SEAT_COUNT) {
      setError(`免费席位必须是至少为 ${DEFAULT_FREE_SEAT_COUNT} 的整数。`);
      return;
    }

    setSavingFreeSeatsOrgId(freeSeatsDialog.org.id);
    setError(null);

    try {
      const { response, payload: nextPayload } = await patchJson(`/v1/admin/organizations/${freeSeatsDialog.org.id}/free-seats`, {
        totalFreeSeats
      });

      if (!response.ok) {
        setError(getErrorMessage(nextPayload, `无法更新 ${freeSeatsDialog.org.name} 的免费席位，请重试。`));
        return;
      }

      const updatedOrganization = isRecord(nextPayload) && isRecord(nextPayload.organization) ? nextPayload.organization : null;
      setPayload((current) => {
        if (!current || !updatedOrganization) {
          return current;
        }
        return {
          ...current,
          organizations: current.organizations.map((entry) => entry.id === freeSeatsDialog.org.id
            ? {
              ...entry,
              memberCount: toNumberValue(updatedOrganization.memberCount),
              freeSeatCount: toNumberValue(updatedOrganization.freeSeatCount),
              seatsFreeAdditional: toNumberValue(updatedOrganization.seatsFreeAdditional),
              billableSeatCount: toNumberValue(updatedOrganization.billableSeatCount)
            }
            : entry)
        };
      });
      setFreeSeatsDialog(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
    } finally {
      setSavingFreeSeatsOrgId(null);
    }
  }, [freeSeatsDialog]);

  const setOrganizationFeaturesLocally = useCallback((orgId: string, features: AdminOrganizationFeatures) => {
    setOrganizationFeatures((current) => ({ ...current, [orgId]: features }));
  }, []);

  const loadOrganizationFeatures = useCallback(async (orgId: string, signal: AbortSignal) => {
    const { response, payload: nextPayload } = await requestJson(`/v1/admin/organizations/${encodeURIComponent(orgId)}/capabilities`, signal);
    if (signal.aborted) return;
    if (response.status === 401 || response.status === 403) {
      setAccessState(response.status === 401 ? "signed-out" : "forbidden");
      setPayload(null);
      return;
    }
    if (!response.ok) throw new Error(getErrorMessage(nextPayload, `无法加载功能（HTTP ${response.status}），请重试。`));
    if (!isRecord(nextPayload) || !isRecord(nextPayload.featureStates)) throw new Error("服务器返回的功能数据不完整，请重试。");
    setOrganizationFeaturesLocally(orgId, parseAdminOrganizationFeatures(nextPayload.featureStates, nextPayload.capabilities));
  }, [setOrganizationFeaturesLocally]);

  // value: true/false sets an override for this organization; null makes it follow the deployment-wide state again.
  const saveOrganizationFeature = useCallback(async (org: AdminOrganization, key: FeatureKey, value: boolean | null) => {
    const previous = organizationFeatures[org.id] ?? org.features;
    if (!previous) return;
    setSavingCapabilityOrgId(org.id);
    setError(null);
    setCapabilityError(null);
    // Optimistic: show the change immediately, roll back if the PUT fails.
    setOrganizationFeaturesLocally(org.id, {
      ...previous,
      [key]: {
        ...previous[key],
        enabled: value ?? previous[key].everyone,
        override: value,
        source: value === null ? "everyone" : "override",
      },
    });

    try {
      const { response, payload: nextPayload } = await putJson(`/v1/admin/organizations/${org.id}/capabilities`, {
        capabilities: { [key]: value }
      });

      if (!response.ok) {
        setOrganizationFeaturesLocally(org.id, previous);
        const message = getErrorMessage(nextPayload, `无法更新 ${org.name} 的功能，请重试。`);
        setError(message);
        setCapabilityError({ orgId: org.id, message });
        return;
      }
      // The server's answer is the truth (locks, defaults), not the optimistic guess.
      if (isRecord(nextPayload) && isRecord(nextPayload.featureStates)) {
        const features = parseAdminOrganizationFeatures(nextPayload.featureStates, nextPayload.capabilities);
        setOrganizationFeaturesLocally(org.id, features);
      }
    } catch (nextError) {
      setOrganizationFeaturesLocally(org.id, previous);
      const message = nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试";
      setError(message);
      setCapabilityError({ orgId: org.id, message });
    } finally {
      setSavingCapabilityOrgId(null);
    }
  }, [organizationFeatures, setOrganizationFeaturesLocally]);

  const saveOpenWorkWebAccess = useCallback(async () => {
    if (!openworkWebAccessDialog) {
      return;
    }

    const reason = openworkWebAccessDialog.reason.trim();
    if (reason.length < 3) {
      setOpenWorkWebAccessError({ orgId: openworkWebAccessDialog.org.id, message: "请填写简短原因以记录审计日志。" });
      return;
    }

    const { org, enabled } = openworkWebAccessDialog;
    setSavingOpenWorkWebAccessOrgId(org.id);
    setOpenWorkWebAccessError(null);
    setError(null);

    try {
      const { response, payload: nextPayload } = await putJson(`/v1/admin/organizations/${org.id}/openwork-web-access`, {
        enabled,
        reason
      });
      if (!response.ok) {
        const message = getErrorMessage(nextPayload, `无法更新 ${org.name} 的 OpenWork Web 访问权限，请重试。`);
        setOpenWorkWebAccessError({ orgId: org.id, message });
        setError(message);
        return;
      }

      const updatedOrganization = isRecord(nextPayload) && isRecord(nextPayload.organization) ? nextPayload.organization : null;
      if (!updatedOrganization) {
        throw new Error("OpenWork Web 访问权限响应不完整，请重试。");
      }
      const openworkWebAccess = parseAdminOpenWorkWebAccess(updatedOrganization.openworkWebAccess);
      setPayload((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          organizations: current.organizations.map((entry) => entry.id === org.id
            ? { ...entry, openworkWebAccess }
            : entry)
        };
      });
      setOpenWorkWebAccessDialog(null);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试";
      setOpenWorkWebAccessError({ orgId: org.id, message });
      setError(message);
    } finally {
      setSavingOpenWorkWebAccessOrgId(null);
    }
  }, [openworkWebAccessDialog]);

  const deleteUser = useCallback(async () => {
    if (!deleteUserDialog) {
      return;
    }

    setDeletingUserId(deleteUserDialog.id);
    setError(null);

    try {
      const { response, payload: nextPayload } = await deleteJson(`/v1/admin/users/${deleteUserDialog.id}`);

      if (!response.ok) {
        setError(getErrorMessage(nextPayload, `无法删除 ${deleteUserDialog.email}，请重试。`));
        return;
      }

      setDeleteUserDialog(null);
      setSelectedUserId(null);
      await refreshCurrentPage();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网络错误，请检查连接后重试");
    } finally {
      setDeletingUserId(null);
    }
  }, [deleteUserDialog, refreshCurrentPage]);

  const exportCsv = useCallback(() => {
    const date = new Date().toISOString().slice(0, 10);

    if (viewMode === "organizations") {
      downloadCsv(`den-organizations-${date}.csv`, [
        ["id", "name", "slug", "plan", "plan_source", "seat_limit", "free_seats", "additional_free_seats", "chargeable_seats", "members", "created_at"],
        ...filteredOrganizations.map((org) => [
          org.id,
          org.name,
          org.slug,
          org.plan.tier,
          org.plan.source,
          String(org.seatLimit),
          String(org.freeSeatCount),
          String(org.seatsFreeAdditional),
          String(org.billableSeatCount),
          String(org.memberCount),
          org.createdAt ?? ""
        ])
      ]);
      return;
    }

    downloadCsv(`den-users-${date}.csv`, [
      ["email", "name", "domain", "verified", "signed_up", "last_active", "sign_ins", "active_days", "recurring", "invites_sent", "hours_to_first_invite", "workers", "providers", "organizations"],
      ...filteredUsers.map((user) => [
        user.email,
        user.name ?? "",
        getEmailDomain(user.email),
        user.emailVerified ? "yes" : "no",
        user.createdAt ?? "",
        user.lastActiveAt ?? "",
        String(user.sessionCount),
        String(user.activeDayCount),
        user.isRecurring ? "yes" : "no",
        String(user.invitesSent),
        user.hoursToFirstInvite === null ? "" : String(user.hoursToFirstInvite),
        String(user.workerCount),
        user.authProviders.join("; "),
        user.organizations.map((org) => `${org.name} (${org.id}, ${org.role})`).join("; ")
      ])
    ]);
  }, [filteredOrganizations, filteredUsers, viewMode]);

  useEffect(() => {
    if (!payload) {
      setSelectedUserId(null);
      return;
    }

    setSelectedUserId((current) => {
      if (current && filteredUsers.some((user) => user.id === current)) {
        return current;
      }

      return filteredUsers[0]?.id ?? null;
    });
  }, [filteredUsers, payload]);

  const selectedUser = useMemo(() => {
    return filteredUsers.find((user) => user.id === selectedUserId) ?? filteredUsers[0] ?? null;
  }, [filteredUsers, selectedUserId]);

  const handleDashboardAccessDenied = useCallback((access: "signed-out" | "forbidden") => {
    setAccessState(access);
    setPayload(null);
  }, []);

  if (accessState === "signed-out" || accessState === "forbidden" || accessState === "error") {
    return <AdminAccessScreen state={accessState} message={error ?? undefined} onRetry={() => void refreshCurrentPage()} />;
  }

  if (!payload) {
    return null;
  }

  const analyticsLoaded = payload.summary.verifiedUsers !== null || payload.summary.activitySeries.length > 0;
  const pageDurationLabel = isAdminScaleFixtureEnabled() ? "夹具计算" : "服务器";

  return (
    <section data-testid="admin-data-page" className="mx-auto w-full max-w-6xl bg-white">
      <div className="border-b border-slate-200 pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-950">{section === "overview" ? "概览" : section === "users" ? "用户" : "组织"}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {section === "overview" ? <p className="text-sm text-slate-600">{payload.viewer.email ?? payload.viewer.id}</p> : null}
            <button
              type="button"
              onClick={() => {
                void refreshCurrentPage();
              }}
              disabled={refreshing || usersLoading || organizationsLoading}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "正在刷新…" : "刷新"}
            </button>

          </div>
        </div>

        {error ? (
          <div role="alert" className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            {error}
          </div>
        ) : null}

        {section === "overview" ? <>
        <AdminDashboard refreshKey={payload.generatedAt} totalOrganizations={payload.summary.totalOrganizations} totalUsers={payload.summary.totalUsers} onAccessDenied={handleDashboardAccessDenied} />
        <details className="border-t border-slate-200 py-4">
          <summary className="w-fit cursor-pointer text-sm font-medium text-slate-700 focus-visible:outline-2 focus-visible:outline-slate-500">更多分析</summary>
          <div className="mt-4"><DenButton size="sm" variant="secondary" loading={analyticsLoading} onClick={() => void loadAnalytics()}>{analyticsLoaded ? "刷新分析数据" : "加载分析数据"}</DenButton></div>
          {analyticsLoaded ? <><div className="mt-4 grid gap-4 sm:grid-cols-3">
            <StatCard label="新用户" value={formatOptionalCount(payload.summary.recentUsers7d)} detail="最近 7 天" />
            <StatCard label="执行过任务的用户" value={formatOptionalCount(payload.summary.realActiveUsers30d)} detail="最近 30 天" />
            <StatCard label="创建过工作实例的用户" value={formatOptionalCount(payload.summary.usersWithWorkers)} detail={`${formatOptionalCount(payload.summary.totalWorkers)} 个工作实例`} />
          </div><ActivityChart series={payload.summary.activitySeries} /></> : null}
        </details>
        <details className="border-t border-slate-200 py-4"><summary className="w-fit cursor-pointer text-sm font-medium text-slate-700 focus-visible:outline-2 focus-visible:outline-slate-500">平台管理员（{payload.summary.adminCount}）</summary>
        <div className="pt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">运维访问权限</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_minmax(10rem,1fr)_auto]">
              <input
                type="email"
                data-testid="admin-add-email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                placeholder="电子邮箱"
                aria-label="管理员邮箱"
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-slate-400"
              />
              <input
                data-testid="admin-add-note"
                value={adminNote}
                onChange={(event) => setAdminNote(event.target.value)}
                placeholder="备注（可选）"
                aria-label="管理员备注"
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-slate-400"
              />
              <button
                type="button"
                data-testid="admin-add-action"
                onClick={() => void addAdmin()}
                disabled={adminMutationId !== null || !adminEmail.trim()}
                className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {adminMutationId === "add" ? "正在添加…" : "添加管理员"}
              </button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {payload.admins.map((admin) => {
              const isViewer = admin.email.toLowerCase() === payload.viewer.email?.toLowerCase();
              return (
                <div key={admin.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{admin.email}{isViewer ? " · 你" : ""}</p>
                    <p className="truncate text-xs text-slate-500">{admin.note ?? `添加于 ${formatDateTime(admin.createdAt)}`}</p>
                  </div>
                  {!isViewer ? (
                    <button
                      type="button"
                      data-testid={`admin-remove-${admin.id}`}
                      onClick={() => void removeAdmin(admin)}
                      disabled={adminMutationId !== null}
                      className="shrink-0 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {adminMutationId === admin.id ? "正在移除…" : "移除"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        </details>
        </> : null}
      </div>

      {section !== "overview" ? <div className="py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={exportCsv}
              disabled={viewMode === "organizations" ? filteredOrganizations.length === 0 : filteredUsers.length === 0}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              导出当前页 CSV
            </button>
        </div>

        {isAdminScaleFixtureEnabled() ? (
          <div data-testid="admin-scale-eval-status" className="mt-4 rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-900">
            性能测试夹具已启用：50,000 名用户 · 60,000 个组织 · 每页最多 50 项。页面可用耗时 {overviewUsableMs === null ? "正在测量" : `${overviewUsableMs} ms`}。数据库性能测试命令：pnpm benchmark:admin-scale:mysql（首次加载 500 ms，搜索 300 ms）。
          </div>
        ) : null}

        {(viewMode === "users" && usersLoading) || (viewMode === "organizations" && organizationsLoading) ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600" aria-busy="true">
            正在加载当前页…
          </div>
        ) : null}

        {viewMode === "organizations" ? (
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between" data-testid="admin-orgs-page">
            <div className="grid w-full max-w-xl gap-2">
              <label className="grid gap-2">
                <span className="text-xs font-medium text-slate-500">搜索组织</span>
                <input
                  maxLength={160}
                  aria-label="搜索组织"
                  value={organizationQuery}
                  onChange={(event) => {
                    overviewRequestIdRef.current += 1;
                    setRefreshing(false);
                    organizationRequestIdRef.current += 1;
                    organizationSearchStartedAtRef.current = performance.now();
                    setOrganizationVisibleDurationMs(null);
                    setSearch(event.target.value);
                  }}
                  placeholder="组织名称、标识或 ID"
                  className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-hidden transition focus:border-slate-400"
                />
              </label>
              <p className="text-xs leading-5 text-slate-500">
                页面 {routePage} · {payload.organizationPage.total} 个匹配组织 · {pageDurationLabel} {payload.organizationPage.durationMs} 毫秒{organizationVisibleDurationMs === null ? "" : ` · 浏览器显示耗时 ${organizationVisibleDurationMs} ms`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPage(Math.max(1, routePage - 1));
                }}
                disabled={organizationsLoading || payload.organizationPage.offset === 0}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                上一个
              </button>
              <button
                type="button"
                onClick={() => {
                  setPage(routePage + 1);
                }}
                disabled={organizationsLoading || !payload.organizationPage.hasMore}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                下一步
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid w-full max-w-xl gap-2">
              <label className="grid gap-2">
                <span className="text-xs font-medium text-slate-500">搜索用户</span>
                <input
                  maxLength={160}
                  aria-label="搜索用户"
                  value={userQuery}
                  onChange={(event) => {
                    overviewRequestIdRef.current += 1;
                    setRefreshing(false);
                    userRequestIdRef.current += 1;
                    userSearchStartedAtRef.current = performance.now();
                    setUserVisibleDurationMs(null);
                    setSearch(event.target.value);
                  }}
                  placeholder="邮箱、姓名、用户 ID、提供商或组织"
                  className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-hidden transition focus:border-slate-400"
                />
              </label>
              <p className="text-xs leading-5 text-slate-500">
                页面 {routePage} · {payload.userPage.total} 个匹配用户 · {pageDurationLabel} {payload.userPage.durationMs} 毫秒{userVisibleDurationMs === null ? "" : ` · 浏览器显示耗时 ${userVisibleDurationMs} ms`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {!payload.summary.billingLoaded ? (
                <button
                  type="button"
                  onClick={() => {
                    void loadUsers(userQuery, payload.userPage.offset, true);
                  }}
                  disabled={usersLoading}
                  className="inline-flex items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  加载本页账单
                </button>
              ) : (
                <p className="self-center text-sm text-slate-500">仅已加载本页账单。</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setPage(Math.max(1, routePage - 1));
                }}
                disabled={usersLoading || payload.userPage.offset === 0}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                上一个
              </button>
              <button
                type="button"
                onClick={() => {
                  setPage(routePage + 1);
                }}
                disabled={usersLoading || !payload.userPage.hasMore}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                下一步
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-3">
          {viewMode === "organizations" ? (
            filteredOrganizations.length > 0 ? (
              <>
                {filteredOrganizations.map((org) => {
              const draft = orgDrafts[org.id] ?? { tier: org.plan.tier, seatLimit: String(org.seatLimit) };
              const changed = draft.tier !== org.plan.tier || draft.seatLimit !== String(org.seatLimit);

              return (
                <div key={org.id} data-testid={`admin-org-row-${org.slug}`} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 900px" }} className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={adminOrganizationHref(org.id, routeSearch, routePage)} prefetch={false} className="truncate text-base font-semibold text-slate-950 hover:underline">{org.name}</Link>
                        <PlanPill tier={org.plan.tier} />
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-500">/{org.slug} · {org.id}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {org.memberCount} / {org.seatLimit} 个席位
                      </span>
                      <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        {org.freeSeatCount} 个免费席位
                      </span>
                      <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        {org.billableSeatCount} 个计费席位
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <MetaCell label="已创建" value={formatDateTime(org.createdAt)} />
                    <MetaCell label="套餐来源" value={org.plan.source === "default" ? "默认" : org.plan.source === "override" ? "单独设置" : org.plan.source === "subscription" ? "订阅" : formatProvider(org.plan.source)} />
                    <MetaCell label="成员" value={String(org.memberCount)} />
                    <div>
                      <p className="text-xs font-medium text-slate-500">免费席位</p>
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-sm text-slate-700">{org.freeSeatCount}</p>
                        <button
                          type="button"
                          aria-label={`编辑 ${org.name} 的免费席位`}
                          onClick={() => setFreeSeatsDialog({ org, totalFreeSeats: String(org.freeSeatCount) })}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {org.seatsFreeAdditional > 0 ? `额外 ${org.seatsFreeAdditional} 个` : "默认包含"}
                      </p>
                    </div>
                  </div>

                  <AdminOrganizationFeatureControls
                    organizationId={org.id}
                    features={organizationFeatures[org.id] ?? org.features}
                    loadFeatures={loadOrganizationFeatures}
                    saving={savingCapabilityOrgId === org.id}
                    error={capabilityError?.orgId === org.id ? capabilityError.message : null}
                    onChange={(key, enabled) => void saveOrganizationFeature(org, key, enabled)}
                  />

                  <div className="mt-4 border-t border-slate-200 pt-4" data-testid="admin-openwork-web-access">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-medium text-slate-500">OpenWork Web 计费访问权限</p>
                          <OpenWorkWebAccessPill access={org.openworkWebAccess} />
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {org.openworkWebAccess.hasOngoingSubscription
                            ? `${denStatusLabel(org.openworkWebAccess.subscriptionStatus ?? "active")}状态的 Stripe 订阅控制访问权限与计费。`
                            : org.openworkWebAccess.complimentaryAccess
                              ? "所有已加入的成员均可使用 OpenWork Web，无需 Stripe 订阅或按人付费，即使部署级可用性已关闭。"
                              : "没有免费授权或正在生效的 OpenWork Web 付费订阅。"}
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid="admin-openwork-web-access-action"
                        onClick={() => setOpenWorkWebAccessDialog({
                          org,
                          enabled: !org.openworkWebAccess.complimentaryAccess,
                          reason: ""
                        })}
                        disabled={savingOpenWorkWebAccessOrgId === org.id || (!org.openworkWebAccess.complimentaryAccess && org.openworkWebAccess.hasOngoingSubscription)}
                        className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingOpenWorkWebAccessOrgId === org.id
                          ? "正在保存…"
                          : org.openworkWebAccess.complimentaryAccess
                            ? "撤销免费访问权限"
                            : "授予免费访问权限"}
                      </button>
                    </div>
                    {!org.openworkWebAccess.complimentaryAccess && org.openworkWebAccess.hasOngoingSubscription ? (
                      <p className="mt-2 text-xs leading-5 text-amber-700">
                        请先在 Stripe 中取消或结束付费订阅，再授予免费访问权限。
                      </p>
                    ) : null}
                    {openworkWebAccessError?.orgId === org.id ? (
                      <p data-testid="admin-openwork-web-access-error" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                        {openworkWebAccessError.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 lg:grid-cols-[12rem_10rem_auto] lg:items-end">
                    <label className="grid min-w-0 gap-2">
                      <span className="text-xs font-medium text-slate-500">套餐</span>
                      <DenSelect
                        value={draft.tier}
                        onChange={(event) => {
                          const tier = event.target.value === "enterprise" || event.target.value === "team" ? event.target.value : "free";
                          setOrgDrafts((current) => ({ ...current, [org.id]: { ...draft, tier } }));
                        }}
                        className="w-full min-w-0 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-hidden transition focus:border-slate-400"
                      >
                        <option value="free">免费</option>
                        <option value="team">团队</option>
                        <option value="enterprise">企业版</option>
                      </DenSelect>
                    </label>

                    <label className="grid min-w-0 gap-2">
                      <span className="text-xs font-medium text-slate-500">席位</span>
                      <input
                        type="number"
                        min={1}
                        value={draft.seatLimit}
                        onChange={(event) => setOrgDrafts((current) => ({ ...current, [org.id]: { ...draft, seatLimit: event.target.value } }))}
                        className="w-full min-w-0 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-hidden transition focus:border-slate-400"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        void saveOrganizationPlan(org);
                      }}
                      disabled={!changed || savingOrgId === org.id}
                      className="inline-flex items-center justify-center rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingOrgId === org.id ? "正在保存…" : "保存访问权限"}
                    </button>
                  </div>
                </div>
              );
                })}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
                <p className="text-base font-semibold text-slate-950">没有匹配的组织</p>
                <p className="mt-2 text-sm leading-7 text-slate-500">请尝试其他搜索条件。</p>
              </div>
            )
          ) : filteredUsers.length > 0 ? filteredUsers.map((user) => {
            const isSelected = user.id === selectedUser?.id;
            const usageEntry = usageByUserId[user.id];

            return (
              <div
                key={user.id}
                data-testid={`admin-user-row-${user.id}`}
                style={isSelected ? undefined : { contentVisibility: "auto", containIntrinsicSize: "auto 180px" }}
                className={`min-w-0 rounded-md border px-4 py-4 transition ${isSelected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"}`}
              >
                <button type="button" onClick={() => setSelectedUserId(user.id)} className="block w-full text-left">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-semibold text-slate-950">{user.name?.trim() || user.email}</p>
                        {user.emailVerified ? (
                          <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[0.66rem] font-medium text-emerald-700">
                            已验证
                          </span>
                        ) : null}
                        {user.isRecurring ? (
                          <span className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[0.66rem] font-medium text-sky-700">
                            周期性
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-500">{user.email}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <BillingPill billing={user.billing} />
                      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {user.workerCount} 个工作实例
                      </span>
                      <span className="inline-flex items-center rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                        {user.organizations.length} 个组织
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                    <MetaCell label="注册时间" value={formatDateTime(user.createdAt)} />
                    <MetaCell label="上次活动" value={formatRelativeTime(user.lastActiveAt)} />
                    <MetaCell label="登录次数" value={String(user.sessionCount)} />
                    <MetaCell label="活跃天数" value={String(user.activeDayCount)} />
                    <MetaCell label="邀请" value={user.invitesSent > 0 ? `${user.invitesSent} 次 · 首次邀请在 ${formatHours(user.hoursToFirstInvite)} 后` : "无"} />
                    <MetaCell label="工作实例" value={`${user.cloudWorkerCount} 个云端 / ${user.localWorkerCount} 个本地`} />
                  </div>
                </button>

                {isSelected ? (
                  <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 lg:grid-cols-2">
                    <div className="grid gap-4">
                      <MetaCell label="身份验证提供商" value={user.authProviders.length > 0 ? user.authProviders.map(formatProvider).join(", ") : "无提供商记录"} />
                      <MetaCell label="最新工作实例" value={user.latestWorkerCreatedAt ? `${formatRelativeTime(user.latestWorkerCreatedAt)} · ${formatDateTime(user.latestWorkerCreatedAt)}` : "尚未创建工作实例"} />
                    </div>

                    <div className="grid gap-4">
                      {user.billing ? (
                        <>
                          <MetaCell label="订阅" value={formatSubscriptionStatus(user.billing.subscriptionStatus)} />
                          <MetaCell label="账单备注" value={user.billing.note ?? "未返回账单备注。"} />
                        </>
                      ) : (
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                          <p className="text-sm leading-7 text-slate-600">
                            账单按需加载，以保持管理页面流畅。
                          </p>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void loadUsers(userQuery, payload.userPage.offset, true);
                            }}
                            disabled={usersLoading}
                            className="mt-3 inline-flex items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            加载本页账单
                          </button>
                        </div>
                      )}
                    </div>

                    <AdminDeferredContent
                      key={user.id}
                      label={`${user.email} 的模型消费情况`}
                      className="lg:col-span-2"
                      placeholderClassName="min-h-48"
                      onVisible={() => { if (!usageEntry) void loadInferenceUsage(user.id); }}
                    >
                      {() => (
                        <div data-testid="admin-usage-section" className="rounded-md border border-slate-200 bg-white px-4 py-4 lg:col-span-2">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-xs font-medium text-slate-500">OpenWork 模型用量</p>
                              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                                组织内所有人共用限额。重置仅清除此用户在当前窗口内的已用额度，不更改共享限额或其他成员的用量。
                              </p>
                            </div>
                            <button
                              type="button"
                              data-testid="admin-usage-reset-open"
                              onClick={() => setResetUsageDialog(user)}
                              disabled={usageEntry?.status !== "ready" || usageEntry.data.organizations.length === 0}
                              className="shrink-0 rounded-md border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              重置用量
                            </button>
                          </div>

                          {resetSuccessByUserId[user.id] !== undefined ? (
                            <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                              重置完成，已清除 {formatUsageAmount(resetSuccessByUserId[user.id])} 单位的当前窗口用量。
                            </p>
                          ) : null}

                          {!usageEntry || usageEntry.status === "loading" ? (
                            <p className="mt-4 text-sm text-slate-500" aria-busy="true">正在加载模型用量…</p>
                          ) : usageEntry.status === "error" ? (
                            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                              <p>{usageEntry.message}</p>
                              <button type="button" onClick={() => void loadInferenceUsage(user.id)} className="mt-2 font-semibold underline">重试</button>
                            </div>
                          ) : usageEntry.data.organizations.length === 0 ? (
                            <p className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">此用户没有可用的组织用量窗口。</p>
                          ) : (
                            <div className="mt-4 grid gap-3">
                              {usageEntry.data.organizations.map((organization) => (
                                <div key={organization.membershipId} className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                                  <p className="text-sm font-semibold text-slate-950">{organization.name}</p>
                                  <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{organization.id}</p>
                                  {organization.windows.length === 0 ? (
                                    <p className="mt-3 text-sm text-slate-500">当前没有五小时、每周或每月窗口。</p>
                                  ) : (
                                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                                      {organization.windows.map((window) => (
                                        <div key={window.bucketId} className="rounded-md border border-slate-200 bg-white p-3">
                                          <p className="text-xs font-semibold text-slate-800">{formatWindowType(window.windowType)}</p>
                                          <p className="mt-2 text-sm text-slate-700">用户： <strong>{formatUsageAmount(window.userUsedAmount)}</strong></p>
                                          <p className="mt-1 text-xs text-slate-500">共享额度： {formatUsageAmount(window.organizationUsedAmount)} / {formatUsageAmount(window.limitAmount)}</p>
                                          <p className="mt-2 text-xs leading-5 text-slate-400">重置时间 {formatDateTime(window.windowEndAt)}</p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </AdminDeferredContent>

                    <div className="rounded-md border border-slate-200 bg-white px-4 py-4 lg:col-span-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-slate-500">组织</p>
                          <p className="mt-1 text-sm text-slate-600">
                            {user.organizations.length > 0
                              ? `${user.email} 已加入 ${user.organizations.length} 个组织。`
                              : `${user.email} 尚未加入任何组织。`}
                          </p>
                        </div>
                        {user.organizations.length > 0 ? (
                          <span className="inline-flex items-center rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                            共 {user.organizations.length} 个
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-red-950">删除用户</p>
                            <p className="mt-1 text-sm leading-6 text-red-700">删除此用户账户、活跃会话、身份验证记录和组织成员关系。</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDeleteUserDialog(user)}
                            disabled={deletingUserId === user.id}
                            className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Trash2 size={15} aria-hidden="true" />
                            {deletingUserId === user.id ? "正在删除…" : "删除用户"}
                          </button>
                        </div>
                      </div>

                      {user.organizations.length > 0 ? (
                        <div className="mt-3 grid gap-2">
                          {user.organizations.map((org) => (
                            <div key={org.id} className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-3">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-950">{org.name}</p>
                                  <p className="mt-1 truncate font-mono text-xs text-slate-500">{org.id}</p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                    {org.role === "owner" ? "所有者" : org.role === "admin" ? "管理员" : org.role === "member" ? "成员" : org.role}
                                  </span>
                                  <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                    {org.memberCount} 名成员
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void copyOrgId(org.id);
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300"
                                  >
                                    <Copy size={13} aria-hidden="true" />
                                    {copiedOrgId === org.id ? "已复制" : "复制 ID"}
                                  </button>
                                  <Link
                                    href={`/admin/organizations/${encodeURIComponent(org.id)}`}
                                    prefetch={false}
                                    className="inline-flex items-center justify-center rounded-md bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"
                                  >
                                    查看组织
                                  </Link>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }) : (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
              <p className="text-base font-semibold text-slate-950">没有符合当前筛选条件的用户</p>
              <p className="mt-2 text-sm leading-7 text-slate-500">请扩大搜索范围，或调整工作实例与账单筛选条件。</p>
            </div>
          )}
        </div>

        <p className="mt-6 text-xs leading-6 text-slate-500">数据生成于 {formatDateTime(payload.generatedAt)}.</p>
      </div> : null}

      {openworkWebAccessDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="openwork-web-access-dialog-title"
          onClick={() => setOpenWorkWebAccessDialog(null)}
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">组织计费访问权限</p>
            <h2 id="openwork-web-access-dialog-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
              {openworkWebAccessDialog.enabled ? "授予" : "撤销"} 免费 OpenWork Web 访问权限？
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {openworkWebAccessDialog.enabled
                ? `${openworkWebAccessDialog.org.name} 的所有已加入成员将获得 OpenWork Web 使用权限，无需 Stripe 订阅或按人付费，即使部署级可用性已关闭。`
                : `${openworkWebAccessDialog.org.name} 将立即失去免费使用权限，除非已有符合资格的独立付费订阅。`}
            </p>

            <label className="mt-5 grid gap-2">
              <span className="text-xs font-medium text-slate-500">审计日志原因</span>
              <textarea
                data-testid="admin-openwork-web-access-reason"
                rows={3}
                maxLength={500}
                value={openworkWebAccessDialog.reason}
                onChange={(event) => setOpenWorkWebAccessDialog({ ...openworkWebAccessDialog, reason: event.target.value })}
                placeholder="例如：OpenWork 内部管理组织"
                className="resize-none rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-hidden transition focus:border-slate-400"
              />
            </label>

            {openworkWebAccessError?.orgId === openworkWebAccessDialog.org.id ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
                {openworkWebAccessError.message}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpenWorkWebAccessDialog(null)}
                disabled={savingOpenWorkWebAccessOrgId === openworkWebAccessDialog.org.id}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="admin-openwork-web-access-confirm"
                onClick={() => {
                  void saveOpenWorkWebAccess();
                }}
                disabled={savingOpenWorkWebAccessOrgId === openworkWebAccessDialog.org.id || openworkWebAccessDialog.reason.trim().length < 3}
                className="inline-flex items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingOpenWorkWebAccessOrgId === openworkWebAccessDialog.org.id
                  ? "正在保存…"
                  : openworkWebAccessDialog.enabled
                    ? "授予访问权限"
                    : "撤销访问权限"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {freeSeatsDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="free-seats-dialog-title"
          onClick={() => setFreeSeatsDialog(null)}
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">组织账单</p>
            <h2 id="free-seats-dialog-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
              编辑免费席位
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              设置免费席位总数： {freeSeatsDialog.org.name}。默认包含的 {DEFAULT_FREE_SEAT_COUNT} 个席位保持不变；OpenWork 仅在组织元数据中保存额外席位。
            </p>

            <label className="mt-5 grid gap-2">
              <span className="text-xs font-medium text-slate-500">免费席位总数</span>
              <input
                type="number"
                min={DEFAULT_FREE_SEAT_COUNT}
                value={freeSeatsDialog.totalFreeSeats}
                onChange={(event) => setFreeSeatsDialog({ ...freeSeatsDialog, totalFreeSeats: event.target.value })}
                className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-hidden transition focus:border-slate-400"
              />
            </label>

            <p className="mt-3 rounded-md bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              将保存的额外席位数： {Math.max(0, Number(freeSeatsDialog.totalFreeSeats) - DEFAULT_FREE_SEAT_COUNT) || 0}
            </p>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setFreeSeatsDialog(null)}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveOrganizationFreeSeats();
                }}
                disabled={savingFreeSeatsOrgId === freeSeatsDialog.org.id}
                className="inline-flex items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingFreeSeatsOrgId === freeSeatsDialog.org.id ? "正在保存…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteUserDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-user-dialog-title"
          onClick={() => setDeleteUserDialog(null)}
        >
          <div className="w-full max-w-md rounded-lg border border-red-100 bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-500">危险操作</p>
            <h2 id="delete-user-dialog-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
              删除 {deleteUserDialog.email}?
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              此操作将永久删除用户账户并撤销其会话，组织成员关系将标记为已移除。
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteUserDialog(null)}
                disabled={deletingUserId === deleteUserDialog.id}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void deleteUser();
                }}
                disabled={deletingUserId === deleteUserDialog.id}
                className="inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingUserId === deleteUserDialog.id ? "正在删除…" : "删除用户"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetUsageDialog ? (
        <div
          data-testid="admin-usage-reset-confirmation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-usage-dialog-title"
          onClick={() => setResetUsageDialog(null)}
        >
          <div className="w-full max-w-md rounded-lg border border-amber-100 bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">模型用量</p>
            <h2 id="reset-usage-dialog-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
              重置 {resetUsageDialog.email}?
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              此操作仅清除此用户在当前五小时、每周和每月窗口内的已用额度。组织继续共用限额，其他成员的用量保持不变。
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setResetUsageDialog(null)}
                disabled={resettingUsageUserId === resetUsageDialog.id}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="admin-usage-reset-action"
                onClick={() => void resetInferenceUsage()}
                disabled={resettingUsageUserId === resetUsageDialog.id}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resettingUsageUserId === resetUsageDialog.id ? "正在重置…" : "重置用量"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
