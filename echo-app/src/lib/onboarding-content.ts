import type { Document } from '../types'

export const BUILTIN_GUIDE_DOC_SLUG = 'builtin-guide'

export interface GuideSection {
  id: string
  title: string
  content: string
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'getting-started',
    title: '开始使用',
    content: `欢迎使用 NeoEcho。
NeoEcho 是一个面向写作者的灵感与整理工作台。你可以在主编辑区持续写作，应用会结合你启用的模块，在上方织带里给出可追溯的提示、改写方向和灵感补充。

你可以这样开始：
1. 先输入标题，写下一段场景、片段或提纲。
2. 在设置里挑选你希望启用的生成模块。
3. 如果你有参考资料，可以导入知识库，让织带建议更贴近你的题材。
4. 在写作过程中随时打开详情面板，把有用内容收进当前文稿。`,
  },
  {
    id: 'core-features',
    title: '主要功能',
    content: `1. 文稿自动保存：当前文章会自动保存在本地，重新打开应用也能继续写。
2. 灵感织带：当你停顿片刻，系统会根据当前段落生成不同方向的提示。
3. 知识库检索：导入资料后，可以从原文中召回片段，减少凭空生成。
4. 右侧详情面板：展开单条建议后，可以查看上下文、来源和延展内容。
5. 自定义模块：你可以按自己的写作习惯增加专属提示方式。`,
  },
  {
    id: 'writing-flow',
    title: '推荐写法',
    content: `如果你是第一次使用，建议先保持默认设置，直接写几段正文，观察织带给出的提示是否对你有帮助。
当你已经有稳定题材时，再逐步接入知识库、自定义模块和更细的运行档。这样更容易判断每个功能是否真的提升了你的写作效率。`,
  },
  {
    id: 'data-and-privacy',
    title: '数据与隐私',
    content: `你的文稿、最近打开记录和大部分设置默认保存在当前设备的本地存储中；知识库导入后的分片与检索数据保存在当前设备的 IndexedDB 中。
只有在你主动配置模型服务后，相关请求才会发送到你填写的接口地址。若你清理应用站点数据，本地保存的文稿、设置和知识库内容也会一并移除。`,
  },
]

export function buildGuideArticleContent(): string {
  return GUIDE_SECTIONS.map((section) => `# ${section.title}\n\n${section.content}`).join('\n\n')
}

export function buildBuiltinGuideDocument(id: string, nowIso: string): Document {
  return {
    id,
    slug: BUILTIN_GUIDE_DOC_SLUG,
    title: '功能说明',
    content: buildGuideArticleContent(),
    createdAt: nowIso,
    updatedAt: nowIso,
    templateKey: BUILTIN_GUIDE_DOC_SLUG,
  }
}

export type RibbonRunProfile = 'balanced' | 'fast' | 'reliable'

export function getRibbonRunProfileCopy(profile: RibbonRunProfile): {
  title: string
  description: string
  detail: string
} {
  switch (profile) {
    case 'fast':
      return {
        title: '低延迟',
        description: '速度优先，适合快速获得首批结果。',
        detail: '会更早结束较慢的模块，并减少补充生成，优先尽快给出可见结果。',
      }
    case 'reliable':
      return {
        title: '稳定优先',
        description: '结果优先，适合希望尽量看到完整产出的场景。',
        detail: '会使用更长等待时间，并在生成过程中保留更明确的状态反馈。',
      }
    case 'balanced':
    default:
      return {
        title: '均衡',
        description: '日常使用，按你启用的项目正常运行。',
        detail: '在速度与完整度之间保持平衡，适合大多数写作场景。',
      }
  }
}
