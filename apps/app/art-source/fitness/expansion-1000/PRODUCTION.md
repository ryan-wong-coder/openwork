# 原创动作媒体制作流程

本目录保存动作选项、原创姿态图和可公开的制作证据。`selection.json`、关键帧计划及已接受的静态图都不代表视频已完成；只有实际审片通过、正式文件与 provenance 一致、并由接入负责人注册的条目才能进入运行时 ready 映射。保留原有已验收资源的字节，新增资源使用新的独立文件名。

只使用原创 Zeno 角色与原创绘制的动作场景，不复制受限上游动作媒体。先读 canonical ID 对应的完整 `sourceSteps`，不能只凭动作中文名选择常见变式。文字步骤矛盾、器械不清或姿态配对有疑问时先 hold，交由动作审核处理。

## 工具与制作边界

- 姿态图使用已批准的原创角色参考，通过内置 ImageGen 生成或编辑；生成后必须实际查看。
- LibTV 项目、上传、节点、模型和下载操作只走官方 `libtv` CLI，每次显式传 `-p`。不切换全局项目绑定，不自行请求供应商 HTTP 接口。
- 本批已验证的双帧配置为模型显示名 `Seedance 2.5`、`modeType=frames2video`、4 秒、720p、16:9、静音、`count=1`。官方 schema 的 `frames2video` 图片数为 `[1,2]`，时长下限为 4 秒。后续批次须重新核对实际 CLI schema；显示名与模型 key 不能混用。
- 每项及全局并发、预算、重试次数由当次明确分配决定。此文档不是批量付费授权，也不允许自动预排其他动作。
- 每次新生成前检查共享 STOP 标记。官方明确额度不足时停止新增生成；网络异常或未知终态不能冒充额度不足。已提交的任务保留身份，不能因 STOP 或等待时间较长而另提同一任务。

## 两张姿态图的审核

起图和末图必须是同一角色、器械、机位及构图。使用起图编辑末图，优先保持固定支点和场景几何不变。两图分别记录 repo 相对路径、字节数及 SHA-256。

审核须具体到动作：工作肢体与对侧配对、身体接触点、器械数量、带子/绳的连续连接、固定锚点、动作方向与终点。留足全身、手脚和器械边缘；不能靠视频推镜掩盖构图不足。只接受实际图中出现的角度和行程，例如约 55° 的抬腿不能写成垂直 90°。

## 安全状态机

| 状态 | 可做的下一步 | 不得推断或执行 |
| --- | --- | --- |
| `planned` | 读步骤、审核变式与原创参考 | 不计为 ready，不生成未分配项 |
| `references-approved` | 核对两图字节及 hash，上传到指定画布 | 静态图通过不代表中间动作正确 |
| `created-without-run` | 只读既有节点，核对真实输入顺序和参数 | 不直接付费，不手写 `taskInfo` 或媒体列表 |
| `order-verified` | 保存证明、复核 STOP，再提交唯一一次 `--run` | 不能只相信命令行参数的排列 |
| `submitted` | 等待同一个同步 CLI 进程结束 | 不包外层 provider 轮询、不加超时、不并发重提 |
| `unknown` | 保留原节点/任务/回执，等待明确处置；仅按授权有限读取既有画布状态 | 不标成功、失败或 quota，不释放为可重复提交的空槽 |
| `generated` | 官方下载、完整解码、实际审查单向片段 | 技术完成不等于动作合格 |
| `one-way-approved` | 仅对适用动作做已授权的正放加反放 | 不用反放“修复”错误动作 |
| `final-reviewed` | 交付安全元数据和成片，等待接入负责人审核 | 制作端不自行写运行时映射 |
| `admitted` | 正式文件、映射、provenance 一致后进行产品播放验收 | 不把计划条目、拒稿或未知任务补入 ready 数量 |

每条 attempt 使用独占目录及唯一节点名，命令 stdout/stderr、提交标记和审核记录不覆盖。命令结果解析或后处理失败后，先查已有回执，不能重跑整条生产脚本。上传失败与付费生成失败分别记录；只有确证尚未提交生成且获得明确续行授权，才可有限重试上传，不能凭缺少本地输出认定没有付费任务。

## 官方 CLI 的有序双帧提交

下例均为占位符，替换并审核后逐步执行，不是无人值守批量脚本。原始 CLI 输出可能含资源地址，应保存在私有制作暂存区，不提交仓库。

```sh
libtv upload "<unique-start-name>" -p "<project-uuid>" \
  --resource "<approved-start-png>"
libtv upload "<unique-end-name>" -p "<project-uuid>" \
  --resource "<approved-end-png>"

libtv node create "<unique-video-name>" -p "<project-uuid>" -t video \
  --left "<start-node-id>" --left "<end-node-id>" \
  --prompt "<reviewed-one-way-motion-prompt>" \
  -s "model=Seedance 2.5" -s modeType=frames2video \
  -s ratio=16:9 -s resolution=720p -s duration=4 \
  -s enableSound=off -s count=1

libtv node "<created-video-node-id>" -p "<project-uuid>"
```

创建时不带 `--run`。实际 create 回执使用 `newNodeKey`；随后只读该 ID，保存至少以下证明：

1. `data.params.imageListOrder` **恰好**为 `[startNodeId, endNodeId]`。
2. `data.params.imageList.map(item => item.nodeId)` **恰好**为同一顺序，数量为 2。
3. 实际模型、`frames2video`、4 秒、720p、16:9、静音、`count=1` 均符合本次批准配置。
4. 付费前没有已有 `taskInfo`；保存只读原回执 SHA-256 和安全字段摘要。

任一项未知或不符就停止。不能编造 `firstFrame`、`lastFrame`、`loop` 参数，不能手动改写 `imageListOrder`、`taskInfo` 或 `action` 来伪造通过。确认共享 STOP 不存在后，才对这个既有节点执行一次：

```sh
libtv node "<verified-video-node-id>" -p "<project-uuid>" --run
```

`--run` 会提交生成并同步等待终态。工具暂时让出执行权时继续等待同一个进程；不能因 stderr 出现 task ID 就另启查询循环。成功终态须与同一节点/任务对应，再使用官方命令下载既有资源：

```sh
libtv download -n "<completed-video-node-id>" -p "<project-uuid>" \
  -o "<private-output-directory>" --without-ai-watermark
```

`download` 下载当前节点已有资源，不是按 task ID 恢复供应商任务的接口。`node --run` 是重新生成，不能用于恢复。若 CLI 在写回画布时网络中断，即使已有 task ID，也不能从进程 exit code 单独判断供应商生成成功或失败。

## 单向审片与可逆动作预览

先保留原始生成文件的字节数、SHA-256 和实际 `ffprobe` 结果，再制作 1024px 宽的 H.264 静音候选。对完整单向片段做完整解码，并实际查看 4fps 的 16 帧检查图；核对全程动作、支点、器械连接、角色与镜头。必要时另取中间或末端原尺寸大图。检查图是抽帧视觉证据，完整解码是所有帧的技术证据，两者不能互相替代。

只有正确的单向运动才能按授权组成正放加反放预览。例如：

```sh
ffmpeg -i one-way.mp4 \
  -filter_complex \
  '[0:v]split=2[forward][reverseinput];[reverseinput]reverse[backward];[forward][backward]concat=n=2:v=1:a=0[v]' \
  -map '[v]' -an -c:v libx264 -crf 26 -pix_fmt yuv420p \
  -movflags +faststart candidate.mp4
```

这是**约 4 秒生成的单向片段，加同一帧序的反放回程**，仅用于适合可逆处理的动作预览。不能称为原生生成的一次完整 8 秒动作，也不证明负重力学、训练时长或临床动作规范。走路、跳跃、跳绳、腾空等具有方向性、落地或惯性的过程不得直接套用此方法。拒稿不能靠反放获得合格身份。

本流程保留转折点与循环边界的端点帧。实际片段可能为 `4.041667` 秒，合成后可能为 `8.083008` 或 `8.083333` 秒；以实际 `ffprobe` 为准，不把约 8 秒写成精确 8 秒。完整解码最终 MP4，实际查看 8fps 的 64 帧检查图，核对回程、转折和循环边界。拉伸片段的短进入/复位预览不替代文字中的 15–30 秒或 20–30 秒保持；单组对侧动作不能声称展示了完整双侧交替。

## 接入记录和公开边界

制作端提供 `admission-safe.json`，由接入负责人验证并复制正式文件、追加映射和 provenance。至少包括：

- canonical ID、完整英文名、stem、kind，以及映射候选；
- 两张原创参考图的 repo 相对路径、bytes、SHA-256、角色与对应上传 node ID；
- 付费前真实两列表顺序证明、只读回执 hash、节点 ID、任务 ID、实际模型显示名/key、完整生成参数与 prompt；
- 原始生成文件、单向候选、最终 MP4、WebP poster 的 bytes/hash；原始与最终 probe、请求时长和实际时长；
- 正放加反放的准确处理说明，明确哪个阶段是人工反序合成；
- 16 帧单向和 64 帧最终检查图的相对路径/hash、具体观察、完整解码结果；制作端审核与接入负责人实际查看审核分别记录；
- 正式文件的目标相对路径与 hash，不能将私有候选路径当作已发布资源。

保留 producer 待审记录，接入负责人实际查看通过后另写最终接受记录，不能回填原记录让它看似提前通过。公开资料只保留 repo 相对路径和必要技术证据，不包含账户信息、密钥、供应商资源 URL、签名地址或个人绝对路径。原始 CLI 输出及原始大文件留在私有暂存中，不能直接复制进仓库。

## 未完成任务 3006

3006 当前是**未完成、结果未知**的既有任务。一次生成提交后 CLI 在画布写回阶段遇到网络中断；按授权有限读取既有画布后，存储状态仍为 `status=1`、`loading=true`，输出视频列表为空。该证据既不能证明生成失败，也不能证明成功，更不是额度不足的证据。

保留原节点、任务及原始回执，不注册 ready、不计入完成数、不再次执行 `--run`，也不继续读取状态，除非获得新的明确处置授权。此任务继续占用其分配槽位；其他新动作只能使用另一个明确授权的空闲槽位。
