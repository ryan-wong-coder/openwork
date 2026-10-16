"use client";

import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, ChevronRight, FileText, Folder, LayoutDashboard, MessageSquare, Network, Paperclip, Play, Plug, Search, Users, Workflow } from "lucide-react";
import { OnboardingTexture } from "./onboarding-texture";
import styles from "./setup-frame.module.css";

const steps = [
  { id: "account", label: "账号" },
  { id: "space", label: "你的空间" },
  { id: "people", label: "人员" },
  { id: "tools", label: "工具" },
  { id: "ready", label: "开始工作" },
];

const simplifiedSteps = [
  { id: "account", label: "名称" },
  { id: "space", label: "工作区" },
  { id: "people", label: "邀请（可选）" },
];

export type SetupStep = "account" | "space" | "people" | "tools" | "ready";

const exampleCopy: Record<SetupStep, { request: string; reply: string; caption: string }> = {
  account: { request: "根据项目文件创建发布控制台。", reply: "这是可继续使用的控制台。", caption: "在对话中描述需求，获得可直接使用的控制台。" },
  space: { request: "将每周项目进展整理成可复用的工作流。", reply: "这是团队可反复运行的工作流。", caption: "描述一次工作，即可重复运行工作流。" },
  people: { request: "使用团队模板起草项目简报。", reply: "已找到团队共享技能与项目知识。", caption: "在对话中直接使用团队工具。" },
  tools: { request: "哪些工具可以帮助我整理项目进展？", reply: "这些团队工具可提供帮助，连接账户即可开始。", caption: "任务需要时发现合适的工具。" },
  ready: { request: "将项目进展总结为团队简报。", reply: "这是使用团队工具起草的内容。", caption: "在一次对话中使用模型、工具并获得结果。" },
};

function PreviewComposer() {
  return (
    <div className={styles.previewComposer}>
      <div className={styles.composerPlaceholder}>描述想要的更改…</div>
      <div className={styles.composerToolbar}>
        <Paperclip size={12} />
        <span className={styles.composerModel}>OpenAI <ChevronDown size={10} /></span>
        <span className={styles.composerSend}><ArrowRight size={11} /></span>
      </div>
      <div className={styles.composerProviders}>也可选择 Anthropic、Google 等提供商</div>
    </div>
  );
}

function WorkPreview({ step }: { step: SetupStep }) {
  const copy = exampleCopy[step];
  const gateway = step === "tools" || step === "ready";
  return (
    <figure className={styles.preview} aria-label={`产品示例：${copy.caption}`}>
      <div className={styles.previewLabel}><span>OpenWork 实用场景</span><span>示例</span></div>
      <div className={styles.appWindow} aria-hidden="true">
        <div className={styles.appTitlebar}>
          <img src="/openwork-mark.svg" alt="" width={13} height={13} />
          <span>OpenWork</span><span className={styles.appWindowLabel}>新建对话</span>
        </div>
        <div className={styles.appBody}>
          <div className={styles.appSidebar}><MessageSquare size={14} /><LayoutDashboard size={14} /><Workflow size={14} /><Users size={14} /><span /></div>
          <div className={styles.appContent}>
            <div className={styles.appBreadcrumb}><Folder size={10} /> 团队工作区 <ChevronRight size={10} /> 聊天</div>
            <div className={styles.previewPrompt}><span>你</span><p>{copy.request}</p></div>
            <div className={styles.previewResponse}><img src="/openwork-mark.svg" alt="" width={13} height={13} /><p>{copy.reply}</p></div>
            {step === "space" ? (
              <div className={styles.inlineResult}>
                <div className={styles.previewSectionTitle}><Workflow size={12} /> 每周团队简报 <span>工作流</span></div>
                <div className={styles.workflowNode}><span><Search size={12} /></span><div><strong>收集项目进展</strong><small>来自已连接工具</small></div></div>
                <div className={styles.workflowLine} />
                <div className={styles.workflowNode}><span><MessageSquare size={12} /></span><div><strong>总结变化</strong><small>优先事项、决策与下一步</small></div></div>
                <div className={styles.workflowLine} />
                <div className={styles.workflowNode}><span><FileText size={12} /></span><div><strong>创建团队简报</strong><small>可共享的文档</small></div></div>
                <div className={styles.workflowFooter}><span>可重复使用</span><span><Play size={9} /> 运行工作流</span></div>
              </div>
            ) : step === "people" || step === "tools" ? (
              <div className={styles.inlineResult}>
                <div className={styles.previewSectionTitle}><Plug size={12} /> 由团队提供</div>
                <div className={styles.libraryRow}><span><FileText size={14} /></span><div><strong>编写项目简报</strong><small>共享技能 · 团队格式</small></div><ArrowUpRight size={12} /></div>
                <div className={styles.libraryRow}><span><Plug size={14} /></span><div><strong>项目知识</strong><small>{step === "tools" ? "连接 · 需要你的账户" : "连接 · 团队管理访问权限"}</small></div></div>
                {step === "tools"
                  ? <div className={styles.inlineAction}><span>连接账户</span><small>需要时登录</small></div>
                  : <div className={styles.inlineDocument}><FileText size={12} /><span>项目简报</span><small>草稿</small><ArrowUpRight size={11} /></div>}
              </div>
            ) : step === "ready" ? (
              <div className={styles.inlineResult}>
                <div className={styles.previewSectionTitle}><FileText size={12} /> 团队简报 <span>草稿</span></div>
                <div className={styles.briefRow}><span>01</span><strong>待落实的决策</strong></div>
                <div className={styles.briefRow}><span>02</span><strong>下一步与负责人</strong></div>
                <div className={styles.briefRow}><span>03</span><strong>尚未解决的问题</strong></div>
                <div className={styles.inlineDocument}><FileText size={12} /><span>打开文档</span><ArrowUpRight size={11} /></div>
              </div>
            ) : (
              <div className={styles.dashboardPreview}>
                <div className={styles.dashboardHeading}><LayoutDashboard size={12} /><strong>发布概览</strong><span>应用预览</span></div>
                <div className={styles.dashboardChart}><div><small>里程碑</small><strong>12 <span>/ 16</span></strong></div><svg viewBox="0 0 140 48" fill="none"><path d="M2 43 23 36 43 38 63 25 83 29 104 14 122 17 138 4" stroke="#252525" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 43 23 36 43 38 63 25 83 29 104 14 122 17 138 4V48H2Z" fill="#252525" fillOpacity=".04" /></svg></div>
                <div className={styles.dashboardRow}><span><i /> 产品页面</span><small>待审阅</small></div>
                <div className={styles.dashboardRow}><span><i /> 发布清单</span><small>进行中</small></div>
              </div>
            )}
            {gateway ? <div className={styles.gatewayContext}><Network size={12} /><div><strong>OpenWork 网关</strong><small>在桌面端、Codex 与 Claude Code 中使用团队工具</small></div></div> : null}
            <PreviewComposer />
          </div>
        </div>
      </div>
      <figcaption>{copy.caption}</figcaption>
    </figure>
  );
}

/**
 * A shared visual rhythm from the first auth screen to the first useful task.
 * Without a `step` the frame is a one-page flow (agent sign-in, device and
 * claim codes, connection links): no stepper, no eyebrows, and the story column
 * shows who is asking through `aside` instead of the product preview.
 */
export function SetupFrame({ step, title, description, children, aside, panelVisual, embedded = false, compactHeader = false, simplified }: {
  step?: SetupStep;
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
  panelVisual?: ReactNode;
  embedded?: boolean;
  /** Keep the consent panel focal in a device approval flow; other callers retain display type. */
  compactHeader?: boolean;
  /** Shared onboarding steps use the simplified layout unless a caller opts out (single-organization mode). */
  simplified?: boolean;
}) {
  const sharedStep = step === "account" || step === "space" || step === "people";
  const useSimplifiedSteps = sharedStep && (simplified ?? true);
  const visibleSteps = useSimplifiedSteps ? simplifiedSteps : steps;
  const current = step ? visibleSteps.findIndex((item) => item.id === step) : -1;
  const plain = !step;
  const progress = (
    <nav className={styles.progress} aria-label="配置进度">
      <div className={styles.progressSummary}>
        <span>{visibleSteps[current]?.label}</span>
        <span>步骤 {current + 1} / {visibleSteps.length}</span>
      </div>
      <ol className={styles.steps}>{visibleSteps.map((item, index) => (
        <li
          key={item.id}
          aria-current={item.id === step ? "step" : undefined}
          aria-label={`${item.label}: ${index < current ? "已完成" : index === current ? "当前步骤" : "即将开始"}`}
          className={index < current ? styles.done : ""}
        >
          <span className={styles.stepLabel}>{item.label}</span>
          <span className={styles.progressSegment} aria-hidden="true" />
        </li>
      ))}</ol>
    </nav>
  );
  const brand = <div className={styles.brand}><img src="/openwork-mark.svg" alt="" width={25} height={25} /><span>OpenWork<span className={styles.cloud}> / 云端</span></span></div>;
  return (
    <section className={`${styles.frame} ${embedded ? styles.embedded : ""} ${plain ? styles.plain : ""} ${useSimplifiedSteps ? styles.simplified : ""}`} data-testid="setup-frame" data-step={step ?? "none"}>
      {useSimplifiedSteps ? (
        // One column (P7): brand, progress, then one panel that owns the brand
        // texture, the title and the form. No product preview, step eyebrow,
        // description or tagline (P1, P2, C7).
        <div className={styles.simpleBody}>
          {brand}
          {progress}
          <div className={styles.panel}>
            <div className={styles.panelVisual}>{panelVisual ?? <OnboardingTexture />}</div>
            {title ? <h1 className={styles.simpleTitle}>{title}</h1> : null}
            {children}
          </div>
        </div>
      ) : <>
        <header className={styles.top}>
          {brand}
          {step ? progress : null}
        </header>
        <div className={styles.grid}>
          <aside className={styles.story}>
            <div className={styles.intro}>
              {step ? <p className={styles.eyebrow}>减少繁琐工作</p> : null}
              <h1 className={compactHeader ? styles.compactHeading : undefined}>{title}</h1>
              <p className={styles.description}>{description}</p>
              {step ? (
                <div className={styles.modelSupport}>
                  <p>自由选择模型，在一处完成工作。</p>
                  <span>OpenAI</span><i aria-hidden="true">·</i><span>Anthropic</span><i aria-hidden="true">·</i><span>Google</span><i aria-hidden="true">·</i><span>等更多选择</span>
                </div>
              ) : null}
            </div>
            {aside ? <div className={styles.customPreview}>{aside}</div> : step ? <WorkPreview step={step} /> : null}
            {step ? <p className={styles.storyNote}>切换模型时，工具与工作始终保持在同一处。</p> : null}
          </aside>
          <div className={styles.panel} key={step ?? "plain"}>
            {panelVisual ? <div className={styles.panelVisual}>{panelVisual}</div> : null}
            {step ? <div className={styles.panelEyebrow}><span>0{current + 1}</span><span>{visibleSteps[current]?.label}</span><span className={styles.panelRule} /></div> : null}
            {children}
          </div>
        </div>
        <footer className={styles.footer}><span>为工作而设计，也为你保留自由。</span><span>你的桌面、工具与团队</span></footer>
      </>}
    </section>
  );
}
