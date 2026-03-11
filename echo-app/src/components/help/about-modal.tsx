'use client'

import { useState } from 'react'

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

const SECTIONS = [
  {
    id: 'overview',
    title: '系统概述',
    content: `NeoEcho 是一款面向写作者的智能辅助工具，通过「共鸣库检索」和「AI 灵感织带」帮助你在创作过程中获得即时反馈。

核心设计理念：
• 非侵入式辅助 —— 灵感出现在视线边缘，不打断写作流
• 可追溯引用 —— 所有建议都能追溯到原文出处
• 模块化扩展 —— 按需启用不同类型的 AI 辅助模块`,
  },
  {
    id: 'architecture',
    title: '技术架构',
    content: `【三层架构】

1. 数据层 (IndexedDB)
   - 文档存储：支持 Markdown、TXT、PDF
   - 共鸣库：向量化后的书籍片段
   - 设置持久化：本地优先，隐私安全

2. 服务层
   • 分块服务 —— 将长文本切分为语义单元 (约 280 字符，50% 重叠)
   • 嵌入服务 —— 文本向量化 (支持本地/云端)
   • RAG 检索 —— 混合搜索 (70% 向量相似 + 30% 关键词)
   • AI 生成 —— 多模块并行生成灵感片段

3. 展示层
   • Tiptap 编辑器 —— 富文本编辑
   • 织带组件 —— 动态网格展示灵感
   • 详情面板 —— Alt+Q 追溯来源`,
  },
  {
    id: 'ribbon',
    title: '织带工作原理',
    content: `【触发机制】
当检测到用户停止输入达到设定时间（默认 2 秒），系统自动：

1. 获取当前段落文本
2. 可选：AI 扩展查询词（语义扩展）
3. 并行执行：
   • 共鸣库检索（如启用）
   • 各 AI 模块生成（如启用）
4. 合并结果 → 语义抖动 → 填充织带

【内容模块类型】
• 共鸣库 —— 基于向量检索的原文引用
• AI 意象 —— 生成意境相关的诗意表达
• AI 润色 —— 词语优化建议
• AI 叙事 —— 情节推进建议
• AI 引用 —— 经典文学引用
• 快速助手 —— 直接 AI 反馈，无需检索
• 自定义 —— 用户定义的提示词模块

【快捷键】
Alt + Q —— 在织带单元间快速切换
Enter —— 打开选中单元的详情面板
Esc —— 关闭详情面板`,
  },
  {
    id: 'rag',
    title: 'RAG 检索策略',
    content: `【混合搜索】
相关性分数 = 0.7 × 向量相似度 + 0.3 × 关键词匹配

【语义抖动】
为避免结果过于集中，引入随机因子：
抖动后分数 = 原分数 × (1 + 随机值 × 0.15)

【强相关保护】
前 2 条高相关结果（分数 ≥ 0.15）不参与抖动，确保核心内容稳定呈现。

【智能扩展】
开启后，AI 将用户查询扩展为同义词集合：
例：「春天」→ 「春天 花开 温暖 春风 复苏」
代价：增加 1-2 秒检索时间
收益：召回率提升 20-40%`,
  },
  {
    id: 'performance',
    title: '性能优化建议',
    content: `【检索速度】
• 关闭「智能扩展查询词」—— 减少 1-2 秒
• 使用本地嵌入模型 —— 避免网络延迟
• 减少强制检索书籍数量 —— 降低向量搜索空间

【生成速度】
• 为织带过滤配置轻量级模型
• 减少同时启用的 AI 模块数量
• 使用快速助手替代全量 RAG

【内存占用】
• 定期清理不用的共鸣库
• 控制单库书籍数量（建议 < 50 本）
• 合理设置分块大小`,
  },
  {
    id: 'privacy',
    title: '隐私说明',
    content: `【本地优先】
• 所有文档存储在浏览器 IndexedDB 中
• 共鸣库向量数据本地生成、本地存储
• 不依赖任何云端服务即可使用基础功能

【API 使用】
• 仅在你配置 API Key 后才会调用 AI 服务
• API Key 存储在本地，不会上传到任何服务器
• 支持自定义 Base URL，可使用本地模型

【数据导出】
• 支持导出共鸣库为 JSON 备份
• 文档可导出为 Markdown`,
  },
]

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const [activeSection, setActiveSection] = useState('overview')

  if (!isOpen) return null

  const activeContent = SECTIONS.find((s) => s.id === activeSection)?.content || ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] shadow-lg w-full max-w-3xl max-h-[85vh] overflow-hidden flex">
        {/* Sidebar */}
        <div className="w-48 border-r border-[var(--color-border)] bg-[var(--color-paper)] flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <h3 className="font-medium text-[var(--color-ink)]">帮助中心</h3>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                  activeSection === section.id
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-medium'
                    : 'text-[var(--color-ink-light)] hover:bg-[var(--color-ink)]/5'
                }`}
              >
                {section.title}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <h3 className="font-medium text-[var(--color-ink)]">
              {SECTIONS.find((s) => s.id === activeSection)?.title}
            </h3>
            <button
              onClick={onClose}
              className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <pre className="text-sm text-[var(--color-ink)] whitespace-pre-wrap font-sans leading-relaxed">
              {activeContent}
            </pre>
          </div>
          <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-paper)]">
            <p className="text-xs text-[var(--color-ink-faint)]">
              NeoEcho v0.1.0 · 本地优先的写作者助手
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
