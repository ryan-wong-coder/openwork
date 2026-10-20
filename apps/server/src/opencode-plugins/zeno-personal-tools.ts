import { z } from 'zod';

export const ZENO_PERSONAL_INSTRUCTION = `泽诺提供日历、健身和本机任务工具 zeno_personal。先读取真实数据，再按用户请求操作；不要声称已完成训练或已执行任务，除非工具返回真实记录。用户明确要求的修改可调用 write 并展示返回的撤销入口。主动建议和定时复盘只能调用 propose，等待用户审核。修改重复日程时先确认单次、后续或整个系列。日程、计划和训练记录分别保存；改期不能改写已完成训练。电脑关闭或离线时说明等待电脑，不暗示服务器会执行。模型密钥始终留在本机。`;
export const personalToolArgs = {
  action: z.enum(['read', 'write', 'propose', 'undo']).describe('read 查询；write 明确指令；propose 主动或定时建议；undo 撤销上次工具修改。'),
  kind: z.enum(['event', 'routine', 'trainingSchedule', 'workout', 'measurement', 'exercise', 'membership', 'task', 'run', 'request', 'proposal', 'settings']).optional(),
  id: z.string().max(128).optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  operationId: z.string().max(128).optional().describe('写操作使用稳定唯一 ID；网络重试必须复用。'),
  data: z.record(z.string(), z.unknown()).optional().describe('完整领域数据；read 返回 schema 和实际记录。'),
  deleted: z.boolean().optional(),
  undoId: z.string().max(128).optional(),
};
export function createZenoPersonalTools(execute: (input: unknown, context: { sessionID?: string; abort?: AbortSignal; signal?: AbortSignal }) => Promise<unknown>) {
  return { zeno_personal: {
    description: `读取或修改用户自己的日历、健身和本机定时任务。所有写入通过同一版本校验接口，有冲突时重新读取。read 返回字段契约。\n${ZENO_PERSONAL_INSTRUCTION}`,
    args: personalToolArgs,
    async execute(input: unknown, context: { sessionID?: string; abort?: AbortSignal; signal?: AbortSignal }) { return JSON.stringify(await execute(z.object(personalToolArgs).strict().parse(input), context)); },
  } };
}
