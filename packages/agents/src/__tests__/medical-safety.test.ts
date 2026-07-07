import { describe, it, expect } from 'vitest'
import { screenMedicalSafety, medicalSafetyDeferral } from '../botbase/medical-safety.js'

describe('screenMedicalSafety — dosage', () => {
  it('blocks a number + medical unit (ES + EN)', () => {
    expect(screenMedicalSafety('Tome ibuprofeno 400 mg después de comer.')).toMatchObject({
      safe: false,
      category: 'dosage',
    })
    expect(screenMedicalSafety('Take 5ml twice and rest.')).toMatchObject({
      safe: false,
      category: 'dosage',
    })
  })

  it('blocks pill counts and dosing frequency', () => {
    expect(screenMedicalSafety('Tome 2 comprimidos al despertar.')).toMatchObject({ category: 'dosage' })
    expect(screenMedicalSafety('Tómelo cada 8 horas.')).toMatchObject({ category: 'dosage' })
    expect(screenMedicalSafety('Take one every 6 hours.')).toMatchObject({ category: 'dosage' })
    expect(screenMedicalSafety('3 veces al día con alimentos.')).toMatchObject({ category: 'dosage' })
  })
})

describe('screenMedicalSafety — prescription', () => {
  it('blocks explicit medication recommendations', () => {
    expect(screenMedicalSafety('Te receto paracetamol para el dolor.')).toMatchObject({
      safe: false,
      category: 'prescription',
    })
    expect(screenMedicalSafety('I prescribe amoxicillin for the infection.')).toMatchObject({
      category: 'prescription',
    })
    expect(screenMedicalSafety('Te recomiendo tomar antibióticos.')).toMatchObject({
      category: 'prescription',
    })
  })
})

describe('screenMedicalSafety — diagnosis', () => {
  it('blocks explicit diagnostic assertions', () => {
    expect(screenMedicalSafety('Parece que tienes una infección.')).toMatchObject({
      safe: false,
      category: 'diagnosis',
    })
    expect(screenMedicalSafety('You probably have a sinus infection.')).toMatchObject({
      category: 'diagnosis',
    })
    expect(screenMedicalSafety('Sufres de migraña crónica.')).toMatchObject({ category: 'diagnosis' })
  })
})

describe('screenMedicalSafety — clean clinic replies pass', () => {
  it('does not flag normal booking/hours/logistics answers', () => {
    expect(screenMedicalSafety('Abrimos de lunes a viernes de 9 a 17.')).toEqual({ safe: true })
    expect(screenMedicalSafety('Te recomiendo acudir a la clínica para una valoración.')).toEqual({
      safe: true,
    })
    expect(screenMedicalSafety('We can book you an appointment on Tuesday at 10.')).toEqual({
      safe: true,
    })
    expect(screenMedicalSafety('Por favor toma asiento, te atendemos en breve.')).toEqual({
      safe: true,
    })
  })

  it('the deferral message itself is safe (no recursion trap)', () => {
    expect(screenMedicalSafety(medicalSafetyDeferral('es'))).toEqual({ safe: true })
    expect(screenMedicalSafety(medicalSafetyDeferral('en'))).toEqual({ safe: true })
  })
})

describe('medicalSafetyDeferral', () => {
  it('declines medical advice and points to the clinic in the patient language', () => {
    expect(medicalSafetyDeferral('es')).toContain('clínica')
    expect(medicalSafetyDeferral('en')).toContain('clinic')
  })
})
