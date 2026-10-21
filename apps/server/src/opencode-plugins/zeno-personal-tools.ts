import { z } from 'zod';

export const ZENO_PERSONAL_INSTRUCTION = `日历、健身与本机任务使用当前原生工具 zeno_personal。创建或修改本机任务前先 read kind=task，使用 context 中本账号的真实设备、工作区和模型 ID；心跳可能过期，是否可执行以本机实际确认为准。先 read 读取当前账号的真实记录；read kind=routine 可按 query 搜索计划，按 id 读取详情，并以 offset/limit 逐页读取。动作库用 catalogue 加 query、equipment、muscles 搜索内置中文动作与自己的自定义动作，或用 catalogue 加 id 读取详情；将返回的真实 exerciseId 原样写入 routine/workout 的 exercises，绝不猜测或编造编号。demo 仅在该动作确有原创素材时返回，路径相对于官网，null 表示暂无演示。kind=exercise 的 read 只读个人自定义动作记录，完整动作库必须用 catalogue。用户明确要求的修改可调用 write 并展示返回的撤销入口；按返回 schema 提供完整 data，编辑已有记录携带原 version 作为 baseVersion，重试复用 operationId。主动建议和定时复盘只能调用 propose，等待用户审核。不要声称已完成训练或已执行任务，除非工具返回真实记录。修改重复日程时先确认单次、后续或整个系列。日程、计划和训练记录分别保存；改期不能改写已完成训练。工具返回 account_required 时引导连接自己的账号；关窗、离线或权限失败时如实说明状态。不得退化为执行 shell、私读数据库或另建本地文件来冒充已同步的个人数据。电脑关闭时说明等待电脑，不暗示服务器会执行。模型密钥始终留在本机。`;
export const personalToolArgs = {
  action: z.enum(['read', 'catalogue', 'write', 'propose', 'undo']).describe('read 查询当前账号记录及字段契约；无kind或kind=task时还返回本账号设备/工作区/模型context（心跳可能过期，实际执行由本机确认）；catalogue 搜索完整动作库或按 id 读动作详情；write 明确指令；propose 主动或定时建议；undo 撤销上次工具修改。'),
  kind: z.enum(['event', 'routine', 'trainingSchedule', 'workout', 'measurement', 'exercise', 'membership', 'task', 'run', 'request', 'proposal', 'settings']).optional().describe('read/write 的个人记录类型。routine 为训练计划；exercise 仅个人自定义动作，完整动作库使用 catalogue。'),
  id: z.string().max(128).optional().describe('read/write 的记录 ID；catalogue 的真实 exerciseId，可先搜索取得。'),
  query: z.string().max(240).optional().describe('read 检索记录内容；catalogue 可用中文/英文名称、器械、肌群。'),
  equipment: z.array(z.string().min(1).max(100)).max(30).optional().describe('catalogue 器械筛选，支持中文或目录中的英文 ID。'),
  muscles: z.array(z.string().min(1).max(100)).max(50).optional().describe('catalogue 主要或辅助肌群筛选，支持中文或英文 ID。'),
  category: z.string().max(100).optional().describe('catalogue 动作分类。'),
  bodyPart: z.string().max(100).optional().describe('catalogue 身体部位。'),
  offset: z.number().int().min(0).max(50000).optional().describe('read/catalogue 分页起点；继续读取使用返回的 nextOffset。'),
  limit: z.number().int().min(1).max(200).optional().describe('read/catalogue 每页条数；默认 read=200、catalogue=20。'),
  baseVersion: z.number().int().nonnegative().optional(),
  operationId: z.string().max(128).optional().describe('写操作使用稳定唯一 ID；网络重试必须复用。'),
  data: z.record(z.string(), z.unknown()).optional().describe('完整领域数据；read 返回 schema 和实际记录。'),
  deleted: z.boolean().optional(),
  undoId: z.string().max(128).optional(),
};
export function createZenoPersonalTools(execute: (input: unknown, context: { sessionID?: string; abort?: AbortSignal; signal?: AbortSignal }) => Promise<unknown>) {
  return { zeno_personal: {
    description: `查询真实动作库、训练计划及当前账号记录，或修改用户自己的日历、健身和本机定时任务。catalogue 返回真实 exerciseId、中文动作详情和已有原创演示；read 返回记录版本、分页及字段契约。所有写入通过同一版本校验接口，有冲突时重新读取。\n${ZENO_PERSONAL_INSTRUCTION}`,
    args: personalToolArgs,
    async execute(input: unknown, context: { sessionID?: string; abort?: AbortSignal; signal?: AbortSignal }) { return JSON.stringify(await execute(z.object(personalToolArgs).strict().parse(input), context)); },
  } };
}
