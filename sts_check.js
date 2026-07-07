const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
(async () => {
  try {
    const client = new STSClient({ region: process.env.AWS_REGION });
    const out = await client.send(new GetCallerIdentityCommand({}));
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('ERR', e.name, e.message);
    process.exit(1);
  }
})();