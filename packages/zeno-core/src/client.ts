import { z } from 'zod';
import { personalMediaFilename, validatePersonalMedia } from './media.js';
import { accountSessionSchema, batchMutationResultSchema, deviceSchema, mediaSchema, mutationResultSchema, personalFeaturesSchema, personalRecordSchema, recordMutationSchema, syncResultSchema, type RecordMutation, type PersonalRecord, type Device, type DeviceInventory, type ModelChoice, type WorkspaceChoice } from './schema.js';

z.config({ jitless: true });

export const ZENO_API_PREFIX = '/api/zeno/v1';
export type ApiResponse = { status: number; body: unknown };
export type ZenoTransport = (method: string, path: string, body?: unknown, expectedUserId?: string) => Promise<ApiResponse>;
export interface ZenoDesktopBridge {
  readonly serviceOrigin?: string;
  request: ZenoTransport;
  connect(): Promise<{ verificationUri: string; expiresAt: number }>;
  disconnect(): Promise<void>;
  getDevice(): Promise<Device | null>;
  listWorkspaces(): Promise<WorkspaceChoice[]>;
  listModels(): Promise<ModelChoice[]>;
  notify(title: string, body: string): Promise<void>;
  uploadMedia(file: { name: string; mime: string; bytes: ArrayBuffer; expectedUserId?: string }): Promise<ApiResponse>;
  readMedia(id: string, expectedUserId?: string): Promise<{ mime: string; bytes: ArrayBuffer }>;
  onAccountChanged?(listener: () => void): () => void;
}
export class ZenoApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly current: PersonalRecord | null;
  constructor(status: number, body: unknown) {
    const parsed = z.object({ code: z.string().optional(), message: z.string().optional(), current: personalRecordSchema.optional() }).safeParse(body);
    super(parsed.success && parsed.data.message ? parsed.data.message : status === 401 ? '请重新登录。' : status === 409 ? '此项已在另一台设备修改，请处理冲突。' : '暂时无法完成，请重试。');
    this.name = 'ZenoApiError'; this.status = status;
    this.code = parsed.success ? parsed.data.code ?? 'request_failed' : 'request_failed';
    this.current = parsed.success ? parsed.data.current ?? null : null;
  }
}
const devicesSchema = z.object({ devices: z.array(deviceSchema) });
const jsonResultSchema = z.record(z.string(), z.unknown());

/** One typed boundary shared by native, web and AI. Browser credentials stay in HttpOnly cookies. */
export class ZenoApiClient {
  readonly baseUrl: string;
  readonly transport: ZenoTransport;
  private readonly bridge?: ZenoDesktopBridge;
  readonly expectedUserId?: string;
  private readonly customTransport?: ZenoTransport;
  constructor(options: { baseUrl?: string; transport?: ZenoTransport; desktopBridge?: ZenoDesktopBridge; expectedUserId?: string } = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '').replace(/\/api\/zeno\/v1$/, '');
    this.bridge = options.desktopBridge;
    this.expectedUserId = options.expectedUserId;
    this.customTransport = options.transport;
    this.transport = options.transport ?? options.desktopBridge?.request ?? (async (method, path, body, expectedUserId) => {
      const response = await fetch(this.baseUrl + ZENO_API_PREFIX + path, { method, credentials: 'include', cache: 'no-store',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(expectedUserId ? { 'X-Zeno-Account': expectedUserId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const raw: unknown = await response.json(); return { status: response.status, body: raw };
    });
  }
  forAccount(userId: string) { return new ZenoApiClient({ baseUrl: this.baseUrl, desktopBridge: this.bridge, transport: this.customTransport, expectedUserId: userId }); }
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.transport(method, path, body, this.expectedUserId);
    if (response.status < 200 || response.status >= 300) throw new ZenoApiError(response.status, response.body);
    return response.body;
  }
  async getSession() {
    try { return accountSessionSchema.parse(await this.request('GET', '/me')); }
    catch (error) { if (error instanceof ZenoApiError && error.status === 401) return null; throw error; }
  }
  async signIn(input: { email: string; password: string }) { await this.request('POST', '/auth/sign-in/email', { email: input.email, password: input.password }); return this.getSession(); }
  async signOut() { if (this.bridge) return this.bridge.disconnect(); await this.request('POST', '/auth/sign-out', {}); }
  async redeemInvite(input: { token: string; email: string; name: string; password: string }) { await this.request('POST', '/invites/redeem', input); return this.signIn(input); }
  async resetPassword(input: { token: string; password: string }) { return this.request('POST', '/password/reset', input); }
  async changePassword(input: { currentPassword: string; newPassword: string }) { return this.request('POST', '/auth/change-password', { ...input, revokeOtherSessions: true }); }
  async sync(cursor = 0, limit = 500) { return syncResultSchema.parse(await this.request('GET', '/sync?cursor=' + cursor + '&limit=' + limit)); }
  async mutate(mutation: RecordMutation) { if (!this.expectedUserId) throw new Error('请先绑定当前账号。'); const parsed = recordMutationSchema.parse(mutation); return mutationResultSchema.parse(await this.request('PUT', '/records/' + parsed.kind + '/' + encodeURIComponent(parsed.id), parsed)); }
  async mutateBatch(mutations: RecordMutation[], operationId: string = crypto.randomUUID()) { if (!this.expectedUserId) throw new Error('请先绑定当前账号。'); return batchMutationResultSchema.parse(await this.request('POST', '/records/batch', { operationId, mutations: mutations.map(value => recordMutationSchema.parse(value)) })); }
  async listDevices() { return devicesSchema.parse(await this.request('GET', '/devices')).devices; }
  async revokeDevice(id: string) { return this.request('DELETE', '/devices/' + encodeURIComponent(id)); }
  async approveDevice(userCode: string) { return this.request('POST', '/devices/approve', { userCode }); }
  async heartbeat(inventory: DeviceInventory) { return this.request('POST', '/devices/heartbeat', { inventory }); }
  async features() { return personalFeaturesSchema.parse(await this.request('GET', '/features')); }
  async uploadMedia(file: Blob, name = 'photo') {
    if (!this.expectedUserId) throw new Error('请先绑定当前账号。');
    validatePersonalMedia(file);
    name = personalMediaFilename(name, file.type);
    if (this.bridge) {
      const response = await this.bridge.uploadMedia({ name, mime: file.type, bytes: await file.arrayBuffer(), expectedUserId: this.expectedUserId });
      if (response.status >= 400) throw new ZenoApiError(response.status, response.body);
      return mediaSchema.parse(response.body);
    }
    const body = new FormData(); body.append('file', file, name);
    const response = await fetch(this.baseUrl + ZENO_API_PREFIX + '/media', { method: 'POST', credentials: 'include', body, headers: { 'X-Zeno-Account': this.expectedUserId } });
    const value: unknown = await response.json(); if (!response.ok) throw new ZenoApiError(response.status, value);
    return mediaSchema.parse(value);
  }
  async readMedia(id: string): Promise<Blob> {
    if (this.bridge) { const result = await this.bridge.readMedia(id, this.expectedUserId); return new Blob([result.bytes], { type: result.mime }); }
    const response = await fetch(this.mediaUrl(id), { credentials: 'include', cache: 'no-store', headers: this.expectedUserId ? { 'X-Zeno-Account': this.expectedUserId } : {} });
    if (!response.ok) throw new ZenoApiError(response.status, await response.json());
    return response.blob();
  }
  mediaUrl(id: string) { return this.baseUrl + ZENO_API_PREFIX + '/media/' + encodeURIComponent(id); }
  async deleteMedia(id: string) { return this.request('DELETE', '/media/' + encodeURIComponent(id)); }
  async admin(path: string, method = 'GET', body?: unknown) { return jsonResultSchema.parse(await this.request(method, '/admin/' + path.replace(/^\//, ''), body)); }
}
