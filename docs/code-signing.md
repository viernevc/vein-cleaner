# Windows 代码签名配置

当前项目未配置证书，`electron-builder` 会跳过签名（构建日志中的 `no code signing certificate configured`）。未签名的 exe 会触发 SmartScreen「未知发布者」。

`electron-builder 26` 已内置两种签名方式，另可用 `win.sign` 接入第三方云签名服务：

| 方案 | 适用证书 | 配置入口 |
|---|---|---|
| PFX 文件签名 | 可导出 PFX 的 OV 证书 | `win.signtoolOptions` |
| Azure Trusted Signing | 微软云签名（推荐新项目） | `win.azureSignOptions` |
| 自定义签名钩子 | EV 硬件令牌、DigiCert KeyLocker、SSL.com eSigner 等 | `win.sign` |

> 注意：`azureSignOptions` 与 `signtoolOptions` 不能同时使用。

## 方案 A：PFX 证书（signtool）

1. 准备证书文件（`.pfx`），放在仓库外或 `secrets/` 目录。
2. 通过环境变量传入，避免写进配置文件：

```powershell
$env:WIN_CSC_LINK = "C:\secrets\vein.pfx"
$env:WIN_CSC_KEY_PASSWORD = "证书密码"
```

`WIN_CSC_LINK` 也支持 base64 内容或 HTTPS 地址；未设置时会回退到 `CSC_LINK`。

3. `electron-builder.yml`：

```yaml
win:
  signtoolOptions:
    signingHashAlgorithms: [sha256]
    rfc3161TimeStampServer: http://timestamp.digicert.com
    # 可选：与证书 CN 一致时用于更新签名校验
    publisherName: "Your Company"
```

如果必须把证书写在配置中（不推荐）：

```yaml
win:
  signtoolOptions:
    certificateFile: C:\\secrets\\vein.pfx
    certificatePassword: ${env.WIN_CSC_KEY_PASSWORD}
```

4. 重新打包：

```bash
pnpm dist
```

## 方案 B：Azure Trusted Signing（推荐）

前提：

- Azure 订阅
- Trusted Signing 账户 + 证书配置文件（Certificate Profile）
- 完成组织/个人身份验证
- 服务主体被授予 `Trusted Signing Certificate Profile Signer` 角色

```yaml
win:
  azureSignOptions:
    publisherName: "Your Company"
    endpoint: "https://wus2.codesigning.azure.net/"
    codeSigningAccountName: "your-account-name"
    certificateProfileName: "your-profile-name"
    # 可选
    # fileDigest: SHA256
    # timestampRfc3161: http://timestamp.acs.microsoft.com
```

认证使用 Azure Identity 环境变量（服务主体）：

```powershell
$env:AZURE_TENANT_ID = "..."
$env:AZURE_CLIENT_ID = "..."
$env:AZURE_CLIENT_SECRET = "..."
```

CI 中把这三项放入 Secrets 注入即可。

## 方案 C：自定义签名钩子

适用于 EV 硬件令牌、DigiCert KeyLocker、SSL.com eSigner 等必须调用厂商 CLI 的场景。

`electron-builder.yml`：

```yaml
win:
  sign: ./scripts/sign.cjs
```

`scripts/sign.cjs` 示例（signtool 本地证书）：

```js
const { execFileSync } = require('node:child_process')

module.exports = async function sign(configuration) {
  execFileSync(
    'signtool.exe',
    [
      'sign',
      '/fd', 'sha256',
      '/tr', 'http://timestamp.digicert.com',
      '/td', 'sha256',
      '/a',
      configuration.path
    ],
    { stdio: 'inherit' }
  )
}
```

云签名服务把 `signtool.exe` 换成对应 CLI 即可（例如 DigiCert KeyLocker 的 `smctl sign`、SSL.com 的 `esigner`），文件路径使用 `configuration.path`。

## CI 配置（GitHub Actions）

PFX 方式：

```yaml
- name: Build & package
  run: pnpm dist
  env:
    WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
    WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

生成 base64 形式的 `WIN_CSC_LINK`：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("vein.pfx")) | Set-Clipboard
```

Azure Trusted Signing 方式注入 `AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_CLIENT_SECRET` 即可。

## 本地自签名（仅用于验证流程）

没有正式证书时，可以用自签名证书验证 electron-builder 的签名链路：

```powershell
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Vein Test" `
  -KeyUsage DigitalSignature `
  -CertStoreLocation Cert:\CurrentUser\My

$pwd = ConvertTo-SecureString -String "test123" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath .\secrets\vein-test.pfx -Password $pwd

$env:WIN_CSC_LINK = (Resolve-Path .\secrets\vein-test.pfx)
$env:WIN_CSC_KEY_PASSWORD = "test123"
pnpm dist
```

自签名证书只在本机导入受信任存储后才被本机信任，**不会**获得公开信任，SmartScreen 仍会提示。它只用于确认签名参数、时间戳和打包流程是否正常。

## 验证签名

```powershell
# 安装包
signtool verify /pa /v dist\Vein-1.0.0-setup.exe

# 应用主程序
signtool verify /pa /v dist\win-unpacked\Vein.exe

# 或使用 PowerShell
Get-AuthenticodeSignature .\dist\Vein-1.0.0-setup.exe |
  Format-List Status, StatusMessage, SignerCertificate
```

`Status` 应为 `Valid`，并且输出中应包含 RFC3161 时间戳。时间戳用于证书到期后保持旧版本签名有效。

## 注意事项

- 不要把 `.pfx`、密码、客户端密钥提交到仓库（已加入 `.gitignore`）
- 新申请的传统 OV 证书通常要求私钥存放在硬件/云端，CA/B Forum 已不允许纯文件形式的新 OV 私钥；新建项目优先考虑 Azure Trusted Signing
- 签名后 SmartScreen 仍需一定下载量积累信誉；EV 证书 / Trusted Signing 通常更快获得信任
- 除主程序与安装包外，如需签名额外 DLL/可执行文件，可配置 `win.signExts`
- 如果使用自动更新，设置 `win.publisherName`，并保持 `verifyUpdateCodeSignature` 默认开启
