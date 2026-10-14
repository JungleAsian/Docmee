import { describe, expect, it } from 'vitest'
import { translate } from './i18n'

describe('shared Inbox Spanish copy', () => {
  it.each([
    ['inbox.display.title', 'Visualización de InboxOS'],
    ['inbox.display.safetyHandoff', 'Seguridad y transferencia'],
    ['inbox.details.hide', 'Ocultar detalles del paciente'],
    ['inbox.details.show', 'Mostrar detalles del paciente'],
    ['inbox.action.confirmAppointment', 'Confirmar cita'],
    ['notifications.volume', 'Volumen'],
    ['media.repository.title', 'Repositorio de archivos'],
    ['conv.collapse', 'Contraer lista de conversaciones'],
    ['conv.assignToMe', 'Asignarme'],
    ['conv.resolve', 'Resolver'],
    ['conv.archive', 'Archivar'],
    ['conv.clearSelection', 'Limpiar selección'],
    ['inbox.mode.readOnly', 'Solo lectura'],
    ['inbox.mode.label', 'Modo de atención por IA o secretaría'],
    ['inbox.mode.error', 'No se pudo cambiar el modo. Inténtalo de nuevo.'],
    ['media.repository.open', 'Abrir repositorio de archivos'],
    ['nav.breadcrumb', 'Ruta de navegación'],
  ])('translates %s without falling back to a raw key', (key, expected) => {
    expect(translate('es', key)).toBe(expected)
    expect(translate('en', key)).not.toBe(key)
  })

  it('keeps user-authored interpolation unchanged', () => {
    expect(translate('es', 'inbox.contact.select', { name: 'Test contact' }))
      .toBe('Seleccionar Test contact')
    expect(translate('es', 'conv.selectedCount', { n: '3' })).toBe('Selecciones: 3')
  })
})
