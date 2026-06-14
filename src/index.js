export const DOCMEE_FOUNDATION = Object.freeze({
  name: 'Docmee',
  status: 'foundation',
  scope: 'multi-tenant WhatsApp clinic assistant platform',
  safetyBoundary: 'not a replacement for licensed clinical judgment'
});

export function getHealth() {
  return {
    ok: true,
    service: DOCMEE_FOUNDATION.name,
    status: DOCMEE_FOUNDATION.status
  };
}

console.log(JSON.stringify(getHealth(), null, 2));
