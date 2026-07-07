import type { Rule } from 'eslint'

export function createImportRule(lib: string, wrapperPath: string): Rule.RuleModule {
  return {
    meta: {
      type: 'problem',
      messages: {
        violation: `Direct import of ${lib} forbidden. Use ${wrapperPath} only.`
      }
    },
    create(context) {
      return {
        ImportDeclaration(node) {
          if (node.source.value === lib) {
            const filename = context.getFilename().replace(/\\/g, '/')
            if (!filename.includes(wrapperPath)) context.report({ node, messageId: 'violation' })
          }
        }
      }
    }
  }
}
