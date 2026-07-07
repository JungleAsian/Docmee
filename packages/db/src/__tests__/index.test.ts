import { describe, it, expect } from 'vitest'
import * as db from '../index.js'

describe('@docmee/db — package boundary', () => {
  it('exports client factory functions', () => {
    expect(typeof db.createDbClient).toBe('function')
    expect(typeof db.createServiceDbClient).toBe('function')
    expect(typeof db.withClinicContext).toBe('function')
  })

  it('exports repository factory functions', () => {
    expect(typeof db.createClinicsRepository).toBe('function')
    expect(typeof db.createPatientsRepository).toBe('function')
    expect(typeof db.createConversationsRepository).toBe('function')
    expect(typeof db.createMessagesRepository).toBe('function')
    expect(typeof db.createAppointmentsRepository).toBe('function')
    expect(typeof db.createKnowledgeRepository).toBe('function')
    expect(typeof db.createAuditRepository).toBe('function')
  })

  it('repository factories return objects with expected methods when given a mock sql', () => {
    const mockSql = (() => Promise.resolve([])) as unknown as db.Sql
    // TypeScript type checks at compile time; here we just verify runtime shape.
    const clinics = db.createClinicsRepository(mockSql)
    expect(typeof clinics.findById).toBe('function')
    expect(typeof clinics.findBySlug).toBe('function')
    expect(typeof clinics.list).toBe('function')
    expect(typeof clinics.create).toBe('function')
    expect(typeof clinics.update).toBe('function')

    const patients = db.createPatientsRepository(mockSql)
    expect(typeof patients.findById).toBe('function')
    expect(typeof patients.findByContact).toBe('function')
    expect(typeof patients.list).toBe('function')
    expect(typeof patients.create).toBe('function')
    expect(typeof patients.addContact).toBe('function')

    const conversations = db.createConversationsRepository(mockSql)
    expect(typeof conversations.findById).toBe('function')
    expect(typeof conversations.listByClinic).toBe('function')
    expect(typeof conversations.countActive).toBe('function')
    expect(typeof conversations.create).toBe('function')
    expect(typeof conversations.addNote).toBe('function')
    expect(typeof conversations.listPatientNamesByClinic).toBe('function')

    const messages = db.createMessagesRepository(mockSql)
    expect(typeof messages.create).toBe('function')
    expect(typeof messages.listByConversation).toBe('function')

    const appointments = db.createAppointmentsRepository(mockSql)
    expect(typeof appointments.create).toBe('function')
    expect(typeof appointments.listByClinic).toBe('function')
    expect(typeof appointments.listProviders).toBe('function')
    expect(typeof appointments.listServices).toBe('function')

    const knowledge = db.createKnowledgeRepository(mockSql)
    expect(typeof knowledge.createDocument).toBe('function')
    expect(typeof knowledge.createIaProfile).toBe('function')
    expect(typeof knowledge.createIaRule).toBe('function')

    const audit = db.createAuditRepository(mockSql)
    expect(typeof audit.log).toBe('function')
    expect(typeof audit.list).toBe('function')
  })
})
