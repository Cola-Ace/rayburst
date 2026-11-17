import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PreferenceAssociations from '../PreferenceAssociations.vue'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged: vi.fn().mockResolvedValue(vi.fn()) }),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/composables/useAppMessage', () => ({
  useAppMessage: () => ({ success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))
vi.mock('@shared/utils', () => ({ writeAppClipboardText: vi.fn() }))
vi.mock('@shared/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }))
vi.mock('naive-ui', () => ({
  NButton: { props: ['disabled', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
  NDivider: { template: '<div><slot /></div>' },
  NFormItem: { props: ['label'], template: '<div><label>{{ label }}</label><slot /><slot name="feedback" /></div>' },
  NTooltip: { template: '<div><slot name="trigger" /><slot /></div>' },
  NSkeleton: { template: '<span />' },
  NInput: { template: '<div><slot name="prefix" /></div>' },
  NInputGroup: { template: '<div><slot /></div>' },
  NIcon: { template: '<span><slot /></span>' },
}))
beforeEach(() => {
  invoke.mockReset()
})

describe('association settings', () => {
  it('retries failed queries without offering registration or default-app actions', async () => {
    invoke.mockResolvedValue({ state: 'error', handler: null, error: 'native failure' })
    const wrapper = mount(PreferenceAssociations)
    await flushPromises()
    expect(wrapper.text()).toContain('preferences.protocol-thunder')
    expect(wrapper.text()).toContain('Rayburst [rayburst://]')
    const buttons = wrapper.findAll('button').filter((button) => button.attributes('disabled') === undefined)
    expect(buttons.map((button) => button.text())).toEqual(['app.retry', 'app.retry'])
    invoke.mockClear()
    await buttons[0]!.trigger('click')
    await flushPromises()
    expect(invoke.mock.calls).toEqual([
      ['get_association_status', { protocol: 'thunder' }],
      ['get_association_status', { protocol: 'rayburst' }],
    ])
    wrapper.unmount()
  })
})
