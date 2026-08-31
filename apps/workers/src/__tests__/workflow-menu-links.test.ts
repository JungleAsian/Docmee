import { describe, expect, it } from 'vitest'
import { menuMessageWithConfiguredLinks } from '../workflow-runner.worker.js'

describe('menuMessageWithConfiguredLinks', () => {
  it('keeps the default Docmee menu links for existing nodes without link fields', () => {
    expect(menuMessageWithConfiguredLinks({ message: 'Choose one' })).toBe([
      'Choose one',
      '🌐 Website: https://docmee.ai/',
      '❓ FAQ: https://docmee.ai/#faq',
      '💬 Contact Us: https://docmee.ai/#contact',
    ].join('\n\n'))
  })

  it('replaces only the customized Website, FAQ, and Contact Us lines', () => {
    expect(menuMessageWithConfiguredLinks({
      message: 'Choose one',
      websiteMessage: '🌐 Website: https://dermapaz.example',
      faqMessage: '❓ FAQ: Ask us in chat',
      contactUsMessage: '💬 Contact: 46082715',
    })).toBe([
      'Choose one',
      '🌐 Website: https://dermapaz.example',
      '❓ FAQ: Ask us in chat',
      '💬 Contact: 46082715',
    ].join('\n\n'))
  })

  it('removes an individual link when its field is intentionally blank', () => {
    expect(menuMessageWithConfiguredLinks({
      message: 'Choose one',
      websiteMessage: '',
      faqMessage: '  ',
      contactUsMessage: '💬 Contact: 46082715',
    })).toBe([
      'Choose one',
      '💬 Contact: 46082715',
    ].join('\n\n'))
  })
})
