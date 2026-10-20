/** Actual route paths shared by the request dispatcher and the contract generator. */
export const API_PREFIX = "/api/zeno/v1";
export const routePaths = Object.freeze({
  health: "/health",
  features: `${API_PREFIX}/features`,
  me: `${API_PREFIX}/me`,
  inviteRedeem: `${API_PREFIX}/invites/redeem`,
  passwordReset: `${API_PREFIX}/password/reset`,
  deviceAuthorization: `${API_PREFIX}/devices/authorization`,
  deviceToken: `${API_PREFIX}/devices/token`,
  deviceApprove: `${API_PREFIX}/devices/approve`,
  deviceHeartbeat: `${API_PREFIX}/devices/heartbeat`,
  devices: `${API_PREFIX}/devices`,
  device: `${API_PREFIX}/devices/{id}`,
  sync: `${API_PREFIX}/sync`,
  batch: `${API_PREFIX}/records/batch`,
  record: `${API_PREFIX}/records/{kind}/{id}`,
  media: `${API_PREFIX}/media`,
  mediaItem: `${API_PREFIX}/media/{id}`,
  adminFeatures: `${API_PREFIX}/admin/features`,
  adminUsers: `${API_PREFIX}/admin/users`,
  adminDevices: `${API_PREFIX}/admin/devices`,
  adminDevice: `${API_PREFIX}/admin/devices/{id}`,
  adminInvites: `${API_PREFIX}/admin/invites`,
  adminInvite: `${API_PREFIX}/admin/invites/{id}`,
  adminPasswordResets: `${API_PREFIX}/admin/password-resets`,
});
export const authOperations = Object.freeze({
  signInEmail: { method: "post", path: `${API_PREFIX}/auth/sign-in/email` },
  signOut: { method: "post", path: `${API_PREFIX}/auth/sign-out` },
  getSession: { method: "get", path: `${API_PREFIX}/auth/get-session` },
  changePassword: { method: "post", path: `${API_PREFIX}/auth/change-password` },
  listSessions: { method: "get", path: `${API_PREFIX}/auth/list-sessions` },
  revokeSession: { method: "post", path: `${API_PREFIX}/auth/revoke-session` },
  revokeOtherSessions: { method: "post", path: `${API_PREFIX}/auth/revoke-other-sessions` },
  revokeSessions: { method: "post", path: `${API_PREFIX}/auth/revoke-sessions` },
});
export function routePattern(template: string): RegExp {
  return new RegExp(`^${template.replace(/\{[^}]+\}/g, "([^/]+)")}$`);
}
