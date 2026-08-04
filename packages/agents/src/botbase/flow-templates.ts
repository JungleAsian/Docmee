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

export type FlowTemplateKey = 'schedule' | 'reschedule' | 'price' | 'surgery' | 'review' | 'nephrology_booking'

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
    // The canonical booking state machine owns doctor, reason, date/time,
    // availability, confirmation, appointment creation, and calendar sync. Do not
    // collect a partial intake here: custom-flow variables are not booking state.
    startStepId: 'start_booking',
    steps: [
      {
        id: 'start_booking',
        messages: ['¡Con gusto te ayudo a agendar una cita! Primero confirmaremos el profesional, el motivo, la fecha y la hora.'],
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
  {
    key: 'nephrology_booking',
    name: 'Nefrologia Integral - WhatsApp Booking Intake',
    triggerKeywords: ['hola', 'cita', 'consulta', 'agendar', 'nefrologia', 'dr', 'doctor', 'precio', 'ubicacion'],
    language: 'both',
    startStepId: 'greeting',
    steps: [
      {
        id: 'greeting',
        messages: [
          'Hola, soy el asistente de Nefrologia Integral. Puedo ayudarte a agendar una consulta, resolver preguntas generales o pasarte con una persona.',
        ],
        branches: [
          { op: 'contains', keywords: ['agendar', 'cita', 'consulta', 'reservar', 'turno', 'booking', 'appointment'], next: 'ask_patient_name' },
          { op: 'contains', keywords: ['pregunta', 'precio', 'ubicacion', 'horario', 'duda', 'question', 'price', 'location'], next: 'question_route' },
          { op: 'contains', keywords: ['humano', 'persona', 'secretaria', 'asesor', 'human', 'staff'], next: 'human_handoff' },
          { op: 'any', next: 'clarify_choice' },
        ],
      },
      {
        id: 'clarify_choice',
        messages: ['Puedo ayudarte con una cita, una pregunta general o pasarte con una persona. Responde: agendar, pregunta o humano.'],
        branches: [
          { op: 'contains', keywords: ['agendar', 'cita', 'consulta', 'reservar', 'turno', 'booking', 'appointment'], next: 'ask_patient_name' },
          { op: 'contains', keywords: ['pregunta', 'precio', 'ubicacion', 'horario', 'duda', 'question', 'price', 'location'], next: 'question_route' },
          { op: 'contains', keywords: ['humano', 'persona', 'secretaria', 'asesor', 'human', 'staff'], next: 'human_handoff' },
          { op: 'any', next: 'human_handoff' },
        ],
      },
      {
        id: 'ask_patient_name',
        messages: ['Claro. Para agendar, dime el nombre del paciente.'],
        collect: 'patient_name',
        branches: [{ op: 'any', next: 'ask_reason' }],
      },
      {
        id: 'ask_reason',
        messages: ['Gracias, {{patient_name}}. Cual es el motivo de la consulta?'],
        collect: 'reason',
        branches: [{ op: 'any', next: 'service_selection' }],
      },
      {
        id: 'service_selection',
        messages: ['Que tipo de consulta necesitas? Puedes responder consulta general, nefrologia, seguimiento, o pedir ayuda humana.'],
        collect: 'service',
        branches: [
          { op: 'contains', keywords: ['consulta general', 'general'], next: 'availability_request' },
          { op: 'contains', keywords: ['nefrologia', 'rinon', 'renal'], next: 'availability_request' },
          { op: 'contains', keywords: ['seguimiento', 'control'], next: 'availability_request' },
          { op: 'contains', keywords: ['humano', 'persona', 'secretaria', 'asesor', 'human', 'staff'], next: 'human_handoff' },
          { op: 'any', next: 'human_handoff' },
        ],
      },
      {
        id: 'availability_request',
        messages: ['Que dia y hora prefieres? Si tienes flexibilidad, dime manana/tarde y el dia.'],
        collect: 'preferred_slot',
        branches: [{ op: 'any', next: 'book' }],
      },
      {
        id: 'question_route',
        messages: ['Escribeme tu pregunta general y revisare la informacion de la clinica. Si no tengo una respuesta segura, te conectare con una persona del equipo.'],
        next: 'end',
      },
      {
        id: 'human_handoff',
        messages: ['Te conecto con una persona del equipo para ayudarte.'],
        next: 'handoff',
      },
    ],
    action: 'book',
  },
]

export function findFlowTemplate(key: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((t) => t.key === key)
}
