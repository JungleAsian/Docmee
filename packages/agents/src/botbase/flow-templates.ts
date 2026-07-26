// Rev1 #28 (Gap #34): prebuilt custom-flow templates.
//
// The five flows the requirement calls out — schedule, reschedule, price,
// surgery, review — shipped as ready-to-instantiate definitions. Admin Studio
// fetches these and a clinic admin turns one into a real (editable) custom flow
// in a click. Content is Spanish (the ES-first product); the admin can translate
// or tweak after instantiating. Each is a valid, reachable FlowDef exercising the
// engine: collected variables, yes/no + keyword branches, an `any` fallback, and
// the book / handoff / end terminal actions.
import type { FlowStep, CustomFlowAction } from './flow-engine.js'
import type { CustomFlowLanguage } from './custom-flows.js'

export type FlowTemplateKey = 'schedule' | 'reschedule' | 'price' | 'surgery' | 'review'

export interface FlowTemplate {
  key: FlowTemplateKey
  name: string
  triggerKeywords: string[]
  language: CustomFlowLanguage
  startStepId: string
  steps: FlowStep[]
  /** Default terminal action surfaced in the editor summary (informational). */
  action?: CustomFlowAction | null
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: 'schedule',
    name: 'Agendar cita',
    triggerKeywords: ['agendar', 'agenda', 'reservar', 'cita', 'turno', 'appointment', 'book'],
    language: 'both',
    // The canonical booking state machine owns the dynamic doctor picker, reason, date/time,
    // availability, confirmation, appointment creation, and calendar sync. Do not
    // collect a partial intake here: custom-flow variables are not booking state.
    startStepId: 'start_booking',
    steps: [
      {
        id: 'start_booking',
        messages: ['¡Con gusto te ayudo a agendar una cita! Primero podrás elegir entre los doctores disponibles; luego confirmaremos el motivo, la fecha y la hora.'],
        next: 'book',
      },
    ],
    action: 'book',
  },
  {
    key: 'reschedule',
    name: 'Reprogramar cita',
    triggerKeywords: ['reprogramar', 'reagendar', 'cambiar cita', 'mover cita', 'reschedule'],
    language: 'both',
    startStepId: 'ask',
    steps: [
      {
        id: 'ask',
        messages: ['¿Deseas reprogramar tu cita actual?'],
        branches: [
          { op: 'yes', next: 'do' },
          { op: 'no', next: 'keep' },
          { op: 'any', next: 'do' },
        ],
      },
      { id: 'do', messages: ['De acuerdo, vamos a reprogramar tu cita. Buscaré nuevos horarios.'], next: 'book' },
      { id: 'keep', messages: ['Entendido, no haremos cambios. ¿Hay algo más en lo que pueda ayudarte?'], next: 'end' },
    ],
    action: 'book',
  },
  {
    key: 'price',
    name: 'Consulta de precios',
    triggerKeywords: ['precio', 'precios', 'costo', 'costos', 'cuanto cuesta', 'tarifa', 'price', 'cost'],
    language: 'both',
    startStepId: 'ask_service',
    steps: [
      {
        id: 'ask_service',
        messages: [
          '¡Claro! ¿Sobre qué servicio quieres saber el precio?',
          'Puedes responder: consulta general, especialista o estudios.',
        ],
        collect: 'service',
        branches: [
          { op: 'contains', keywords: ['general', 'consulta'], next: 'general' },
          { op: 'contains', keywords: ['especialista', 'especialidad'], next: 'specialist' },
          { op: 'contains', keywords: ['estudio', 'estudios', 'laboratorio', 'analisis'], next: 'studies' },
          { op: 'any', next: 'other' },
        ],
      },
      { id: 'general', messages: ['La consulta general tiene un costo de $XX. ¿Quieres agendar una cita?'], next: 'end' },
      { id: 'specialist', messages: ['La consulta con especialista tiene un costo de $XX. ¿Quieres agendar una cita?'], next: 'end' },
      { id: 'studies', messages: ['Los precios de estudios varían según el tipo. Un asesor te dará el detalle.'], next: 'handoff' },
      { id: 'other', messages: ['Para darte el precio exacto te conectaré con nuestro equipo.'], next: 'handoff' },
    ],
    action: 'end',
  },
  {
    key: 'surgery',
    name: 'Información de cirugía',
    triggerKeywords: ['cirugia', 'cirugias', 'operacion', 'operar', 'quirurgico', 'surgery'],
    language: 'both',
    startStepId: 'ask',
    steps: [
      {
        id: 'ask',
        messages: [
          'Las consultas sobre cirugías requieren atención personalizada.',
          '¿Quieres que un especialista te contacte para darte toda la información?',
        ],
        branches: [
          { op: 'yes', next: 'contact' },
          { op: 'no', next: 'later' },
          { op: 'any', next: 'contact' },
        ],
      },
      { id: 'contact', messages: ['Perfecto, un especialista se pondrá en contacto contigo muy pronto.'], next: 'handoff' },
      { id: 'later', messages: ['De acuerdo. Si cambias de opinión, escríbenos cuando gustes. 😊'], next: 'end' },
    ],
    action: 'handoff',
  },
  {
    key: 'review',
    name: 'Solicitud de reseña',
    triggerKeywords: ['resena', 'reseña', 'opinion', 'calificar', 'review', 'feedback'],
    language: 'both',
    startStepId: 'ask_rating',
    steps: [
      {
        id: 'ask_rating',
        messages: ['¡Gracias por tu interés! ¿Cómo calificarías tu experiencia? (excelente, buena, regular o mala)'],
        collect: 'rating',
        branches: [
          { op: 'contains', keywords: ['excelente', 'buena', 'bien', 'genial'], next: 'happy' },
          { op: 'contains', keywords: ['regular', 'mala', 'mal', 'pesima'], next: 'unhappy' },
          { op: 'any', next: 'thanks' },
        ],
      },
      {
        id: 'happy',
        messages: ['¡Nos alegra mucho! ¿Te gustaría dejarnos una reseña en Google? Aquí está el enlace: [enlace de reseñas].'],
        next: 'end',
      },
      {
        id: 'unhappy',
        messages: ['Lamentamos que tu experiencia no fuera la mejor. Un miembro del equipo te contactará para ayudarte.'],
        next: 'handoff',
      },
      { id: 'thanks', messages: ['¡Gracias por tu comentario! Lo tomamos en cuenta para mejorar.'], next: 'end' },
    ],
    action: 'end',
  },
]

export function findFlowTemplate(key: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((t) => t.key === key)
}
