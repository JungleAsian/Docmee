export interface KbEntry {
  id: string
  clinicId: string
  question: string
  answer: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface KbRepo {
  findByClinic(clinicId: string): Promise<KbEntry[]>
  search(clinicId: string, query: string): Promise<KbEntry[]>
  create(data: Omit<KbEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<KbEntry>
  update(id: string, data: Partial<KbEntry>): Promise<KbEntry>
  delete(id: string): Promise<void>
}

export function createKbRepo(_client: unknown): KbRepo {
  throw new Error('KbRepo: not implemented — requires DbClient (P02+)')
}
