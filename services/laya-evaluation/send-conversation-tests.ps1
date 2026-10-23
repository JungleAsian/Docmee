param([switch]$Timing, [switch]$Framing, [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
if ($Timing -and $Framing) { throw 'Diagnostic modes are mutually exclusive' }
$taskCheckout = 'C:\w\docmee-laya-20261021'
$identityText = & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' sts get-caller-identity --profile docmee --region mx-central-1 --output json --no-cli-pager --cli-connect-timeout 3 --cli-read-timeout 3
if ($LASTEXITCODE -ne 0) { throw 'Deployment identity unavailable' }
$identity = ($identityText -join "`n") | ConvertFrom-Json
if ($identity.Account -ne '910896516817' -or $identity.Arn -notlike 'arn:aws:sts::910896516817:assumed-role/DocmeeDeployOperator/*') { throw 'Unexpected deployment identity' }
if ((git -C $taskCheckout rev-parse --show-toplevel).Replace('\','/') -ne $taskCheckout.Replace('\','/')) { throw 'Unexpected checkout' }
$assets = @{}
$names = @('conversation_probe.py', 'conversations.py', 'evaluate.py', 'native_probe.py', 'plaintext_variant.py')
if ($Timing) { $names += 'timing.py' }
foreach ($name in $names) {
    $body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $name))
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($body))).ToLowerInvariant()
    $assets[$name] = @{body=$body; sha256=$digest}
}
$assetsJson = ConvertTo-Json -InputObject $assets -Depth 10 -Compress
# A JSON string literal is also a Python string literal; avoid nested base64,
# which defeats compression before the bounded Windows command-line transport.
$assetLiteral = ConvertTo-Json -InputObject $assetsJson -Compress
$runner = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'run_server_conversations.py'))
$timingLiteral = if ($Timing) { 'True' } else { 'False' }
$framingLiteral = if ($Framing) { 'True' } else { 'False' }
$script = "import json`nTIMING_MODE=$timingLiteral`nFRAMING_MODE=$framingLiteral`nASSETS=json.loads($assetLiteral)`n" + $runner
$script | python -B -c 'import ast,sys; ast.parse(sys.stdin.read())'
if ($LASTEXITCODE -ne 0) { throw 'Invalid diagnostic Python source' }
$buffer = [IO.MemoryStream]::new()
$compressor = [IO.Compression.GZipStream]::new($buffer, [IO.Compression.CompressionMode]::Compress, $true)
$scriptBytes = [Text.Encoding]::UTF8.GetBytes($script)
$compressor.Write($scriptBytes, 0, $scriptBytes.Length)
$compressor.Dispose()
$encoded = [Convert]::ToBase64String($buffer.ToArray())
$buffer.Dispose()
$remote = "/usr/bin/python3.12 -I -B - <<'PY'`nimport gzip,base64`nexec(compile(gzip.decompress(base64.b64decode('$encoded')),'reviewed-conversation-replay','exec'))`nPY"
$payload = @{DocumentName='AWS-RunShellScript'; InstanceIds=@('i-0c86fadeec6758b91');
    Comment='Bounded isolated synthetic conversation diagnostic; restore original LAYA service';
    TimeoutSeconds=600; Parameters=@{executionTimeout=@('480'); commands=@($remote)}} | ConvertTo-Json -Depth 10 -Compress
if ($payload.Length -gt 28000) { throw 'Payload exceeds bounded Windows CLI size' }
if ($ValidateOnly) {
    @{validated=$true; payloadCharacters=$payload.Length; assetCount=$assets.Count; timing=[bool]$Timing; framing=[bool]$Framing} | ConvertTo-Json -Compress
    exit 0
}
& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' ssm send-command --cli-input-json $payload --profile docmee --region mx-central-1 --output json --no-cli-pager --cli-connect-timeout 3 --cli-read-timeout 10 --query 'Command.{CommandId:CommandId,Status:Status,RequestedDateTime:RequestedDateTime}'
exit $LASTEXITCODE
