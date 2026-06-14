# Configuration

Use environment variables or a deployment secret manager. Do not commit real values.

## Example names

```text
NODE_ENV=development
APP_URL=http://localhost:3000
DATABASE_URL=replace-me
SESSION_SECRET=replace-me
WHATSAPP_ACCESS_TOKEN=replace-me
WHATSAPP_VERIFY_TOKEN=replace-me
WHATSAPP_PHONE_NUMBER_ID=replace-me
AI_PROVIDER_API_KEY=replace-me
```

## Rules

- Keep local config files out of git.
- Use examples for placeholder names only.
- Rotate any token that is accidentally committed.
- Separate staging and production credentials.
