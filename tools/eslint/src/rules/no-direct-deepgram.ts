import type { Rule } from 'eslint'

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    messages: {
      violation: 'Direct Deepgram fetch forbidden. Use packages/channels/src/transcription/deepgram-provider.ts only.'
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          const [first] = node.arguments
          if (first?.type === 'Literal' && typeof first.value === 'string' && first.value.includes('deepgram')) {
            const filename = context.getFilename().replace(/\\/g, '/')
            if (!filename.includes('packages/channels/src/transcription/deepgram-provider.ts')) {
              context.report({ node, messageId: 'violation' })
            }
          }
        }
      }
    }
  }
}

export default rule
