import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { generateId } from '@/lib/utils/crypto'

/**
 * Node ID Extension
 * Automatically assigns unique IDs to block nodes (paragraphs, headings, etc.)
 * for precise RAG triggering and echo mapping.
 */
export const NodeIdExtension = Extension.create({
  name: 'nodeId',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote', 'listItem'],
        attributes: {
          nodeId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-node-id'),
            renderHTML: (attributes) => {
              if (!attributes.nodeId) return {}
              return { 'data-node-id': attributes.nodeId }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('nodeId'),
        appendTransaction: (transactions, oldState, newState) => {
          const tr = newState.tr
          let modified = false

          newState.doc.descendants((node, pos) => {
            if (
              ['paragraph', 'heading', 'blockquote', 'listItem'].includes(
                node.type.name,
              ) &&
              !node.attrs.nodeId
            ) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                nodeId: generateId(12),
              })
              modified = true
            }
          })

          return modified ? tr : null
        },
      }),
    ]
  },
})
